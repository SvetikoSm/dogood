import "server-only";

import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";

import {
  STUDIO_MAX_DOG_GENERATIONS,
  STUDIO_MAX_FINAL_GENERATIONS,
  STUDIO_MAX_TEXT_GENERATIONS,
  STUDIO_MAX_STEP_RETRIES,
  STUDIO_STEP_RETRY_BACKOFF_MINUTES,
  STUDIO_TICK_BUDGET_MS,
  STUDIO_TICK_LOCK_MS,
} from "@/lib/studio/config";
import { getStudioDb, schema } from "@/lib/studio/db";
import { ensureStudioSchema } from "@/lib/studio/db/ensure-schema";
import type { StudioOrder, StudioOrderStatus } from "@/lib/studio/db/schema";
import { syncStudioOrdersFromGoogleSheet } from "@/lib/studio/google/sync-orders-from-sheet";
import { latestSuccessfulStepRun } from "@/lib/studio/pipeline/step-queries";
import { runStudioStep } from "@/lib/studio/pipeline/run-studio-step";
import { STUDIO_STEP_KEYS, type StudioStepKey } from "@/lib/studio/step-keys";
import { parseLlmReviewEnvelope } from "@/lib/studio/types/llm-json";
import {
  sendStudioAlert,
  sendStudioReviewRequest,
} from "@/lib/studio/telegram/review-bot";

const WORK_STATUSES = [
  "new",
  "assets_loaded",
  "dog_in_progress",
  "dog_approved_idle",
  "text_in_progress",
  "text_approved_idle",
  "final_in_progress",
] as const;

const AWAITING_STATUSES = [
  "dog_awaiting_approval",
  "text_awaiting_approval",
  "final_awaiting_approval",
] as const;

const TICK_LOCK_NAME = "studio_cron_tick";

/* ---------------- tick lock ---------------- */

async function acquireTickLock(): Promise<boolean> {
  const db = getStudioDb();
  const now = new Date();
  // Ensure the row exists, then claim it atomically: only one caller's
  // conditional UPDATE can match while the lock is expired.
  await db
    .insert(schema.studioLocks)
    .values({ name: TICK_LOCK_NAME, lockedUntil: new Date(0) })
    .onConflictDoNothing();
  const res = await db
    .update(schema.studioLocks)
    .set({ lockedUntil: new Date(now.getTime() + STUDIO_TICK_LOCK_MS) })
    .where(
      and(eq(schema.studioLocks.name, TICK_LOCK_NAME), lt(schema.studioLocks.lockedUntil, now)),
    );
  return (res.rowsAffected ?? 0) > 0;
}

async function refreshTickLock(): Promise<void> {
  const db = getStudioDb();
  await db
    .update(schema.studioLocks)
    .set({ lockedUntil: new Date(Date.now() + STUDIO_TICK_LOCK_MS) })
    .where(eq(schema.studioLocks.name, TICK_LOCK_NAME));
}

async function releaseTickLock(): Promise<void> {
  const db = getStudioDb();
  await db
    .update(schema.studioLocks)
    .set({ lockedUntil: new Date(0) })
    .where(eq(schema.studioLocks.name, TICK_LOCK_NAME));
}

/* ---------------- helpers ---------------- */

async function setOrderStatus(orderId: string, status: StudioOrderStatus) {
  const db = getStudioDb();
  await db
    .update(schema.studioOrders)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.studioOrders.id, orderId));
}

async function countSuccessfulSteps(orderId: string, stepKeyPrefix: string): Promise<number> {
  const db = getStudioDb();
  const rows = await db
    .select({ stepKey: schema.studioStepRuns.stepKey })
    .from(schema.studioStepRuns)
    .where(
      and(
        eq(schema.studioStepRuns.orderId, orderId),
        eq(schema.studioStepRuns.status, "success"),
      ),
    );
  return rows.filter((r) => r.stepKey.startsWith(stepKeyPrefix)).length;
}

type CritiqueState = "missing_or_stale" | "ok" | "needs_correction";

/**
 * A critique only counts if it ran AFTER the latest image for the stage —
 * otherwise a correction would never get re-checked.
 */
async function critiqueState(
  orderId: string,
  critiqueKey: string,
  imageKeys: string[],
): Promise<CritiqueState> {
  const [critique, image] = await Promise.all([
    latestSuccessfulStepRun(orderId, [critiqueKey]),
    latestSuccessfulStepRun(orderId, imageKeys),
  ]);
  if (!critique?.llmOutputJson) return "missing_or_stale";
  if (
    image?.finishedAt &&
    critique.finishedAt &&
    critique.finishedAt.getTime() < image.finishedAt.getTime()
  ) {
    return "missing_or_stale";
  }
  const env = parseLlmReviewEnvelope(critique.llmOutputJson);
  if (!env) return "needs_correction";
  return env.status === "needs_correction" ? "needs_correction" : "ok";
}

/* ---------------- step resolution ---------------- */

const DOG_IMAGE_KEYS = [
  STUDIO_STEP_KEYS.DOG_IMG_V1,
  STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION,
  STUDIO_STEP_KEYS.DOG_IMG_V3_IDENTITY,
];

async function resolveNextAutomatedStep(order: StudioOrder): Promise<StudioStepKey | null> {
  const id = order.id;

  /* ---- Stage A: dog illustration ---- */
  if (["new", "assets_loaded", "dog_in_progress"].includes(order.status)) {
    const db = getStudioDb();
    const photos = await db
      .select({ id: schema.studioOrderPhotos.id })
      .from(schema.studioOrderPhotos)
      .where(eq(schema.studioOrderPhotos.orderId, id))
      .limit(1);
    if (!photos.length) return STUDIO_STEP_KEYS.FETCH_DRIVE_PHOTOS;

    if (order.humanRejectNote?.trim()) return STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION;

    if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.DOG_LLM_INITIAL_PROMPT]))) {
      return STUDIO_STEP_KEYS.DOG_LLM_INITIAL_PROMPT;
    }
    if (!(await latestSuccessfulStepRun(id, DOG_IMAGE_KEYS))) {
      return STUDIO_STEP_KEYS.DOG_IMG_V1;
    }

    const state = await critiqueState(id, STUDIO_STEP_KEYS.DOG_LLM_CRITIQUE, DOG_IMAGE_KEYS);
    if (state === "missing_or_stale") return STUDIO_STEP_KEYS.DOG_LLM_CRITIQUE;
    if (state === "ok") {
      await setOrderStatus(id, "dog_awaiting_approval");
      return null;
    }
    // needs_correction — respect the generation budget
    const dogImgCount = await countSuccessfulSteps(id, "DOG_IMG");
    if (dogImgCount < STUDIO_MAX_DOG_GENERATIONS) {
      return STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION;
    }
    await setOrderStatus(id, "dog_awaiting_approval"); // budget spent; human decides
    return null;
  }

  /* ---- Stage B: pet-name text ---- */
  if (order.status === "dog_approved_idle" || order.status === "text_in_progress") {
    if (order.humanRejectNote?.trim()) return STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION;

    if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.TEXT_LLM_STYLE_PROMPT]))) {
      return STUDIO_STEP_KEYS.TEXT_LLM_STYLE_PROMPT;
    }
    const textImageKeys = [
      STUDIO_STEP_KEYS.TEXT_IMG_V1,
      STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION,
    ];
    if (!(await latestSuccessfulStepRun(id, textImageKeys))) {
      return STUDIO_STEP_KEYS.TEXT_IMG_V1;
    }

    const state = await critiqueState(id, STUDIO_STEP_KEYS.TEXT_LLM_CRITIQUE, textImageKeys);
    if (state === "missing_or_stale") return STUDIO_STEP_KEYS.TEXT_LLM_CRITIQUE;
    if (state === "ok") {
      await setOrderStatus(id, "text_awaiting_approval");
      return null;
    }
    const textImgCount = await countSuccessfulSteps(id, "TEXT_IMG");
    if (textImgCount < STUDIO_MAX_TEXT_GENERATIONS) {
      return STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION;
    }
    await setOrderStatus(id, "text_awaiting_approval");
    return null;
  }

  /* ---- Stage C: final composition (phase 2 — kept for manual/experimental use) ---- */
  if (order.status === "text_approved_idle" || order.status === "final_in_progress") {
    const finalImageKeys = [
      STUDIO_STEP_KEYS.FINAL_IMG_V1,
      STUDIO_STEP_KEYS.FINAL_IMG_V2_CORRECTION,
    ];
    if (!(await latestSuccessfulStepRun(id, finalImageKeys))) {
      return STUDIO_STEP_KEYS.FINAL_IMG_V1;
    }
    const state = await critiqueState(id, STUDIO_STEP_KEYS.FINAL_LLM_CRITIQUE, finalImageKeys);
    if (state === "missing_or_stale") return STUDIO_STEP_KEYS.FINAL_LLM_CRITIQUE;
    if (state === "ok") {
      await setOrderStatus(id, "final_awaiting_approval");
      return null;
    }
    const finalImgCount = await countSuccessfulSteps(id, "FINAL_IMG");
    if (finalImgCount < STUDIO_MAX_FINAL_GENERATIONS) {
      return STUDIO_STEP_KEYS.FINAL_IMG_V2_CORRECTION;
    }
    await setOrderStatus(id, "final_awaiting_approval");
    return null;
  }

  return null;
}

/* ---------------- failure handling ---------------- */

async function handleStepFailure(order: StudioOrder, step: StudioStepKey, error: string) {
  const db = getStudioDb();
  const failures = (order.retryCount ?? 0) + 1;
  if (failures > STUDIO_MAX_STEP_RETRIES) {
    await db
      .update(schema.studioOrders)
      .set({
        status: "error",
        retryCount: failures,
        nextRetryAt: null,
        lastError: error.slice(0, 4000),
        updatedAt: new Date(),
      })
      .where(eq(schema.studioOrders.id, order.id));
    await sendStudioAlert(
      [
        `⚠️ Order ${order.sheetOrderId} parked with status ERROR.`,
        `Step ${step} failed ${failures} times.`,
        `Last error: ${error.slice(0, 500)}`,
        `Fix the cause, then reset the order from /studio/orders.`,
      ].join("\n"),
    );
    return;
  }
  const minutes =
    STUDIO_STEP_RETRY_BACKOFF_MINUTES[
      Math.min(failures, STUDIO_STEP_RETRY_BACKOFF_MINUTES.length) - 1
    ];
  await db
    .update(schema.studioOrders)
    .set({
      retryCount: failures,
      nextRetryAt: new Date(Date.now() + minutes * 60_000),
      lastError: error.slice(0, 4000),
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, order.id));
}

async function clearRetryState(orderId: string) {
  const db = getStudioDb();
  await db
    .update(schema.studioOrders)
    .set({ retryCount: 0, nextRetryAt: null, lastError: "", updatedAt: new Date() })
    .where(eq(schema.studioOrders.id, orderId));
}

/* ---------------- notifications ---------------- */

async function notifyAwaitingReviews(): Promise<string[]> {
  const db = getStudioDb();
  const notes: string[] = [];
  for (const st of AWAITING_STATUSES) {
    const stage = st.replace("_awaiting_approval", "") as "dog" | "text" | "final";
    const rows = await db
      .select()
      .from(schema.studioOrders)
      .where(eq(schema.studioOrders.status, st));
    for (const o of rows) {
      if (o.reviewNotifiedFor === stage) continue;
      const r = await sendStudioReviewRequest(o.id, stage);
      notes.push(r.ok ? `telegram:${o.sheetOrderId}:${stage}` : `telegram_fail:${r.error}`);
    }
  }
  return notes;
}

/* ---------------- main tick ---------------- */

async function pickWorkingOrder(): Promise<StudioOrder | null> {
  const db = getStudioDb();
  const rows = await db
    .select()
    .from(schema.studioOrders)
    .where(
      and(
        inArray(schema.studioOrders.status, [...WORK_STATUSES]),
        or(
          isNull(schema.studioOrders.nextRetryAt),
          lte(schema.studioOrders.nextRetryAt, new Date()),
        ),
      ),
    )
    .orderBy(asc(schema.studioOrders.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * One cron tick: sync sheet, then keep running automated steps (across orders)
 * until the time budget is spent or there is no more work, then ping Telegram
 * for anything newly awaiting review.
 */
export async function runStudioPipelineTick(): Promise<{ ok: true; detail: string }> {
  await ensureStudioSchema();
  if (!(await acquireTickLock())) {
    return { ok: true, detail: "skipped: previous tick still running" };
  }

  const started = Date.now();
  const actions: string[] = [];
  try {
    try {
      const sync = await syncStudioOrdersFromGoogleSheet();
      actions.push(`synced=${sync.upserted}`);
    } catch (e) {
      actions.push(`sync_fail=${e instanceof Error ? e.message : String(e)}`);
    }

    while (Date.now() - started < STUDIO_TICK_BUDGET_MS) {
      const order = await pickWorkingOrder();
      if (!order) break;

      const step = await resolveNextAutomatedStep(order);
      if (!step) {
        // resolveNext either transitioned the status (loop continues with the
        // next order) or found nothing to do — guard against spinning.
        const db = getStudioDb();
        const [fresh] = await db
          .select({ status: schema.studioOrders.status })
          .from(schema.studioOrders)
          .where(eq(schema.studioOrders.id, order.id))
          .limit(1);
        if (!fresh || fresh.status === order.status) break;
        continue;
      }

      await refreshTickLock();
      const run = await runStudioStep(order.id, step);
      if (run.ok) {
        await clearRetryState(order.id);
        actions.push(`ran ${step} for ${order.sheetOrderId}`);
      } else {
        await handleStepFailure(order, step, run.error);
        actions.push(`failed ${step} for ${order.sheetOrderId}: ${run.error.slice(0, 160)}`);
      }
    }

    const notify = await notifyAwaitingReviews();
    actions.push(...notify);
    return { ok: true, detail: actions.join("; ") || "idle" };
  } finally {
    await releaseTickLock();
  }
}
