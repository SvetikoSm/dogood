import "server-only";

import { and, eq, inArray, lt, ne, or } from "drizzle-orm";

import {
  getStudioMaxConcurrentLanes,
  isStudioFairOnly,
  STUDIO_LANE_LOCK_MS,
  STUDIO_MAX_DOG_GENERATIONS,
  STUDIO_MAX_FINAL_GENERATIONS,
  STUDIO_MAX_TEXT_GENERATIONS,
  STUDIO_STEP_RETRY_BACKOFF_MINUTES,
  STUDIO_STEP_RETRY_BACKOFF_SECONDS_FAIR,
  STUDIO_TICK_BUDGET_MS,
  STUDIO_TICK_LOCK_MS,
} from "@/lib/studio/config";
import { getStudioDb, schema } from "@/lib/studio/db";
import { ensureStudioSchema } from "@/lib/studio/db/ensure-schema";
import type { StudioLaneStage, StudioOrder, StudioOrderStatus } from "@/lib/studio/db/schema";
import { syncStudioOrdersFromGoogleSheet } from "@/lib/studio/google/sync-orders-from-sheet";
import { isParallelStageMode, skipsAutoCritique } from "@/lib/studio/pipeline/modes";
import { latestSuccessfulStepRun } from "@/lib/studio/pipeline/step-queries";
import { runStudioStep } from "@/lib/studio/pipeline/run-studio-step";
import { pollPendingFairPayments } from "@/lib/payments/yookassa";
import { STUDIO_STEP_KEYS, type StudioStepKey } from "@/lib/studio/step-keys";
import { retryFailedFairReceipts, retryUnwrittenFairSheetRows } from "@/lib/studio/telegram/fair-flow";
import { parseLlmReviewEnvelope } from "@/lib/studio/types/llm-json";
import {
  sendStudioAlert,
  sendStudioReviewRequest,
} from "@/lib/studio/telegram/review-bot";

const AWAITING_STATUSES = [
  "dog_awaiting_approval",
  "text_awaiting_approval",
  "final_awaiting_approval",
] as const;

/** Statuses where a non-parallel (legacy) order still has automated work. */
const LEGACY_WORK_STATUSES = [
  "new",
  "assets_loaded",
  "dog_in_progress",
  "dog_approved_idle",
  "text_in_progress",
] as const;

/** Statuses (any mode) that feed the final-composition lane. */
const FINAL_WORK_STATUSES = ["text_approved_idle", "final_in_progress"] as const;

const TICK_LOCK_NAME = "studio_cron_tick";

/** Lane parked after exhausting retries — skipped until a human intervenes. */
const LANE_PARKED_MS = 365 * 24 * 60 * 60 * 1000;

/* ---------------- locks ---------------- */

/**
 * Atomically claim a named lock: ensure the row exists, then take it with a
 * conditional UPDATE that only matches while the lock is expired. Used both
 * for the global tick lock and for per-lane claims, so two workers can never
 * run the same lane at once.
 */
async function claimLock(name: string, ttlMs: number): Promise<boolean> {
  const db = getStudioDb();
  const now = new Date();
  await db
    .insert(schema.studioLocks)
    .values({ name, lockedUntil: new Date(0) })
    .onConflictDoNothing();
  const res = await db
    .update(schema.studioLocks)
    .set({ lockedUntil: new Date(now.getTime() + ttlMs) })
    .where(and(eq(schema.studioLocks.name, name), lt(schema.studioLocks.lockedUntil, now)));
  return (res.rowsAffected ?? 0) > 0;
}

async function refreshLock(name: string, ttlMs: number): Promise<void> {
  const db = getStudioDb();
  await db
    .update(schema.studioLocks)
    .set({ lockedUntil: new Date(Date.now() + ttlMs) })
    .where(eq(schema.studioLocks.name, name));
}

async function releaseLock(name: string): Promise<void> {
  const db = getStudioDb();
  await db
    .update(schema.studioLocks)
    .set({ lockedUntil: new Date(0) })
    .where(eq(schema.studioLocks.name, name));
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

async function setDogStatus(orderId: string, dogStatus: schema.StudioStageStatus) {
  const db = getStudioDb();
  await db
    .update(schema.studioOrders)
    .set({ dogStatus, updatedAt: new Date() })
    .where(eq(schema.studioOrders.id, orderId));
}

async function setTextStatus(orderId: string, textStatus: schema.StudioStageStatus) {
  const db = getStudioDb();
  await db
    .update(schema.studioOrders)
    .set({ textStatus, updatedAt: new Date() })
    .where(eq(schema.studioOrders.id, orderId));
}

async function hasPhotos(orderId: string): Promise<boolean> {
  const db = getStudioDb();
  const photos = await db
    .select({ id: schema.studioOrderPhotos.id })
    .from(schema.studioOrderPhotos)
    .where(eq(schema.studioOrderPhotos.orderId, orderId))
    .limit(1);
  return photos.length > 0;
}

/**
 * Ingest lane (parallel modes): make sure the order has its photos, then open
 * it for the dog/text lanes by moving it to "in_progress".
 */
async function resolveIngestStep(order: StudioOrder): Promise<StudioStepKey | null> {
  if (!(await hasPhotos(order.id))) return STUDIO_STEP_KEYS.FETCH_DRIVE_PHOTOS;
  await setOrderStatus(order.id, "in_progress");
  return null;
}

/**
 * mode="full"/"fair" dog-stage resolution — tracked via dogStatus instead of
 * order.status so it can progress independently of the text stage.
 */
async function resolveDogStepForFull(order: StudioOrder): Promise<StudioStepKey | null> {
  const id = order.id;
  if (order.humanRejectNote?.trim()) return STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION;

  if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.DOG_LLM_INITIAL_PROMPT]))) {
    return STUDIO_STEP_KEYS.DOG_LLM_INITIAL_PROMPT;
  }
  if (!(await latestSuccessfulStepRun(id, DOG_IMAGE_KEYS))) {
    return STUDIO_STEP_KEYS.DOG_IMG_V1;
  }

  // Fair-event orders skip the LLM critique: the owner reviews every image by
  // eye in Telegram, and skipping the extra LLM call saves cost + wait time.
  if (skipsAutoCritique(order.mode)) {
    await setDogStatus(id, "awaiting_approval");
    return null;
  }

  const state = await critiqueState(id, STUDIO_STEP_KEYS.DOG_LLM_CRITIQUE, DOG_IMAGE_KEYS);
  if (state === "missing_or_stale") return STUDIO_STEP_KEYS.DOG_LLM_CRITIQUE;
  if (state === "ok") {
    await setDogStatus(id, "awaiting_approval");
    return null;
  }
  // needs_correction — respect the generation budget
  const dogImgCount = await countSuccessfulSteps(id, "DOG_IMG");
  if (dogImgCount < STUDIO_MAX_DOG_GENERATIONS) {
    return STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION;
  }
  await setDogStatus(id, "awaiting_approval"); // budget spent; human decides
  return null;
}

/**
 * mode="full"/"fair" text-stage resolution — tracked via textStatus, with NO
 * wait on dog approval. Reads/clears textRejectNote instead of the shared
 * humanRejectNote, since dog and text can both be awaiting a reject at once.
 */
async function resolveTextStepForFull(order: StudioOrder): Promise<StudioStepKey | null> {
  const id = order.id;
  if (order.textRejectNote?.trim()) return STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION;

  if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.TEXT_LLM_STYLE_PROMPT]))) {
    return STUDIO_STEP_KEYS.TEXT_LLM_STYLE_PROMPT;
  }
  const textImageKeys = [STUDIO_STEP_KEYS.TEXT_IMG_V1, STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION];
  if (!(await latestSuccessfulStepRun(id, textImageKeys))) {
    return STUDIO_STEP_KEYS.TEXT_IMG_V1;
  }

  if (skipsAutoCritique(order.mode)) {
    await setTextStatus(id, "awaiting_approval");
    return null;
  }

  const state = await critiqueState(id, STUDIO_STEP_KEYS.TEXT_LLM_CRITIQUE, textImageKeys);
  if (state === "missing_or_stale") return STUDIO_STEP_KEYS.TEXT_LLM_CRITIQUE;
  if (state === "ok") {
    await setTextStatus(id, "awaiting_approval");
    return null;
  }
  const textImgCount = await countSuccessfulSteps(id, "TEXT_IMG");
  if (textImgCount < STUDIO_MAX_TEXT_GENERATIONS) {
    return STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION;
  }
  await setTextStatus(id, "awaiting_approval");
  return null;
}

/** Stage C: compose the approved dog + name onto the master template. */
async function resolveFinalStep(order: StudioOrder): Promise<StudioStepKey | null> {
  const id = order.id;
  const finalImageKeys = [
    STUDIO_STEP_KEYS.FINAL_IMG_V1,
    STUDIO_STEP_KEYS.FINAL_IMG_V2_CORRECTION,
  ];
  if (!(await latestSuccessfulStepRun(id, finalImageKeys))) {
    return STUDIO_STEP_KEYS.FINAL_IMG_V1;
  }
  // Human reject always wins over the critique/skip logic — the reviewer is
  // the throttle here, same as on the dog and text stages.
  if (order.humanRejectNote?.trim()) return STUDIO_STEP_KEYS.FINAL_IMG_V2_CORRECTION;
  if (skipsAutoCritique(order.mode)) {
    await setOrderStatus(id, "final_awaiting_approval");
    return null;
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

/**
 * Non-parallel modes (dog_only / name_only / dog_text): dog and text are
 * sequential and tracked on order.status, exactly as before lanes existed.
 * One lane per order, so behavior is unchanged for these.
 */
async function resolveLegacyStep(order: StudioOrder): Promise<StudioStepKey | null> {
  const id = order.id;

  /* ---- Stage A: dog illustration ---- */
  if (["new", "assets_loaded", "dog_in_progress"].includes(order.status)) {
    if (!(await hasPhotos(id))) return STUDIO_STEP_KEYS.FETCH_DRIVE_PHOTOS;

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

  return null;
}

/** Dispatcher: which step (if any) this lane should run next. */
async function resolveStepForLane(
  order: StudioOrder,
  stage: StudioLaneStage,
): Promise<StudioStepKey | null> {
  switch (stage) {
    case "ingest":
      return resolveIngestStep(order);
    case "dog":
      return resolveDogStepForFull(order);
    case "text":
      return resolveTextStepForFull(order);
    case "final":
      return resolveFinalStep(order);
    case "legacy":
      return resolveLegacyStep(order);
    default:
      return null;
  }
}

/* ---------------- lanes ---------------- */

type Lane = {
  orderId: string;
  sheetOrderId: string;
  mode: string;
  stage: StudioLaneStage;
  createdAt: Date;
};

function laneLockName(orderId: string, stage: StudioLaneStage): string {
  return `lane:${orderId}:${stage}`;
}

function laneKey(orderId: string, stage: string): string {
  return `${orderId}:${stage}`;
}

/**
 * Every lane that currently has automated work, fair-event orders first (a
 * customer is standing at the stand waiting; website orders are not urgent),
 * then oldest order first within each group, capped at `limit`. Lanes still
 * in retry backoff are skipped. When STUDIO_FAIR_ONLY is set, website/sheet
 * orders (mode="full") are excluded entirely instead of just deprioritized.
 * The owner’s manual Telegram orders keep running: those are deliberate
 * one-off requests made during the event, not the website backlog.
 */
async function collectRunnableLanes(limit: number): Promise<Lane[]> {
  const db = getStudioDb();
  const fairOnly = isStudioFairOnly();
  const orders = await db
    .select()
    .from(schema.studioOrders)
    .where(
      and(
        or(
          inArray(schema.studioOrders.status, [...LEGACY_WORK_STATUSES]),
          inArray(schema.studioOrders.status, [...FINAL_WORK_STATUSES]),
          eq(schema.studioOrders.status, "in_progress"),
        ),
        fairOnly ? ne(schema.studioOrders.mode, "full") : undefined,
      ),
    );
  if (!orders.length) return [];

  // Fair orders first (a live customer is waiting), then oldest-first within
  // each group — same idea FIX-7 already used for cross-order fairness.
  orders.sort((a, b) => {
    const rank = (o: (typeof orders)[number]) => (o.mode === "fair" ? 0 : 1);
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const laneStates = await db
    .select()
    .from(schema.studioLaneState)
    .where(
      inArray(
        schema.studioLaneState.orderId,
        orders.map((o) => o.id),
      ),
    );
  const now = Date.now();
  const blocked = new Set(
    laneStates
      .filter((s) => s.nextRetryAt && s.nextRetryAt.getTime() > now)
      .map((s) => laneKey(s.orderId, s.stage)),
  );

  const lanes: Lane[] = [];
  for (const order of orders) {
    const base = {
      orderId: order.id,
      sheetOrderId: order.sheetOrderId,
      mode: order.mode,
      createdAt: order.createdAt,
    };
    const orderLanes: Lane[] = [];
    const push = (stage: StudioLaneStage) => {
      if (!blocked.has(laneKey(order.id, stage))) orderLanes.push({ ...base, stage });
    };

    if (isParallelStageMode(order.mode)) {
      if (order.status === "new" || order.status === "assets_loaded") {
        push("ingest");
      } else if (order.status === "in_progress") {
        // Both stages at once — this is the in-order parallelism.
        if (order.dogStatus === "pending" || order.dogStatus === "in_progress") push("dog");
        if (order.textStatus === "pending" || order.textStatus === "in_progress") push("text");
      }
    } else if ((LEGACY_WORK_STATUSES as readonly string[]).includes(order.status)) {
      push("legacy");
    }

    if ((FINAL_WORK_STATUSES as readonly string[]).includes(order.status)) push("final");

    if (!orderLanes.length) continue;
    // A single order's lanes are added atomically — either all of them or
    // none — so dog+text never get split across ticks by the limit. The
    // only exception: an empty batch always takes at least one order's
    // lanes, even if that alone exceeds the limit, so it isn't stuck forever.
    if (lanes.length > 0 && lanes.length + orderLanes.length > limit) break;
    lanes.push(...orderLanes);
    if (lanes.length >= limit) break;
  }
  return lanes;
}

/* ---------------- lane failure bookkeeping ---------------- */

function laneBackoffMs(mode: string, attempt: number): number | null {
  const ladder =
    mode === "fair"
      ? STUDIO_STEP_RETRY_BACKOFF_SECONDS_FAIR.map((s) => s * 1000)
      : STUDIO_STEP_RETRY_BACKOFF_MINUTES.map((m) => m * 60_000);
  return attempt <= ladder.length ? ladder[attempt - 1] : null;
}

async function upsertLaneState(
  orderId: string,
  stage: StudioLaneStage,
  patch: { retryCount: number; nextRetryAt: Date | null; lastError: string },
): Promise<void> {
  const db = getStudioDb();
  await db
    .insert(schema.studioLaneState)
    .values({ orderId, stage, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.studioLaneState.orderId, schema.studioLaneState.stage],
      set: { ...patch, updatedAt: new Date() },
    });
}

async function clearLaneState(orderId: string, stage: StudioLaneStage): Promise<void> {
  const db = getStudioDb();
  await db
    .delete(schema.studioLaneState)
    .where(
      and(eq(schema.studioLaneState.orderId, orderId), eq(schema.studioLaneState.stage, stage)),
    );
}

/**
 * A failed step backs off THIS lane only. Deliberately never parks the whole
 * order with status="error": that would kill a healthy sibling stage that is
 * running concurrently. An exhausted lane is parked far in the future and the
 * owner gets an alert instead.
 */
async function recordLaneFailure(lane: Lane, step: StudioStepKey, error: string): Promise<void> {
  const db = getStudioDb();
  const [state] = await db
    .select()
    .from(schema.studioLaneState)
    .where(
      and(
        eq(schema.studioLaneState.orderId, lane.orderId),
        eq(schema.studioLaneState.stage, lane.stage),
      ),
    )
    .limit(1);

  const failures = (state?.retryCount ?? 0) + 1;
  const backoff = laneBackoffMs(lane.mode, failures);
  await upsertLaneState(lane.orderId, lane.stage, {
    retryCount: failures,
    nextRetryAt: new Date(Date.now() + (backoff ?? LANE_PARKED_MS)),
    lastError: error.slice(0, 4000),
  });
  // Mirror the message onto the order so /studio/orders still shows it.
  await db
    .update(schema.studioOrders)
    .set({ lastError: error.slice(0, 4000), updatedAt: new Date() })
    .where(eq(schema.studioOrders.id, lane.orderId));

  if (backoff === null) {
    await sendStudioAlert(
      [
        `⚠️ Дорожка ${lane.stage} заказа ${lane.sheetOrderId} остановлена после ${failures} неудач.`,
        `Шаг: ${step}`,
        `Ошибка: ${error.slice(0, 500)}`,
        `Остальные стадии заказа продолжают работать. Перезапустить можно из /studio/orders.`,
      ].join("\n"),
    );
  }
}

/* ---------------- lane execution ---------------- */

type LaneOutcome = "ran" | "failed" | "progressed" | "noop";
type LaneResult = { outcome: LaneOutcome; log?: string };

/**
 * Run at most ONE step of one lane, then release it. Lanes execute
 * concurrently, which is safe because:
 *   1. every step re-reads its own order, photos and artifacts by orderId —
 *      no mutable state is shared between lanes;
 *   2. lanes of the same order write DIFFERENT columns (dog_status /
 *      dogNotified / humanRejectNote vs text_status / textNotified /
 *      textRejectNote) — never replace these targeted `.set({ field })`
 *      updates with a whole-row write;
 *   3. artifacts live at artifacts/<orderId>/<runId>.png, so two orders can
 *      never collide on a file path.
 * Steps WITHIN a lane stay strictly sequential (prompt → image → correction).
 */
async function runLane(lane: Lane): Promise<LaneResult> {
  const lockName = laneLockName(lane.orderId, lane.stage);
  if (!(await claimLock(lockName, STUDIO_LANE_LOCK_MS))) return { outcome: "noop" };
  try {
    const db = getStudioDb();
    const [order] = await db
      .select()
      .from(schema.studioOrders)
      .where(eq(schema.studioOrders.id, lane.orderId))
      .limit(1);
    if (!order) return { outcome: "noop" };

    const before = {
      status: order.status,
      dogStatus: order.dogStatus,
      textStatus: order.textStatus,
    };
    const step = await resolveStepForLane(order, lane.stage);

    if (!step) {
      // No step to run: either the resolver advanced the order (e.g. moved a
      // stage to awaiting_approval) or there is genuinely nothing to do.
      const [fresh] = await db
        .select({
          status: schema.studioOrders.status,
          dogStatus: schema.studioOrders.dogStatus,
          textStatus: schema.studioOrders.textStatus,
        })
        .from(schema.studioOrders)
        .where(eq(schema.studioOrders.id, lane.orderId))
        .limit(1);
      const changed =
        !!fresh &&
        (fresh.status !== before.status ||
          fresh.dogStatus !== before.dogStatus ||
          fresh.textStatus !== before.textStatus);
      return { outcome: changed ? "progressed" : "noop" };
    }

    const run = await runStudioStep(lane.orderId, step);
    if (run.ok) {
      await clearLaneState(lane.orderId, lane.stage);
      await db
        .update(schema.studioOrders)
        .set({ retryCount: 0, nextRetryAt: null, lastError: "", updatedAt: new Date() })
        .where(eq(schema.studioOrders.id, lane.orderId));
      return { outcome: "ran", log: `ran ${step} for ${lane.sheetOrderId}/${lane.stage}` };
    }
    await recordLaneFailure(lane, step, run.error);
    return {
      outcome: "failed",
      log: `failed ${step} for ${lane.sheetOrderId}/${lane.stage}: ${run.error.slice(0, 160)}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordLaneFailure(lane, STUDIO_STEP_KEYS.FETCH_DRIVE_PHOTOS, msg).catch(() => {});
    return {
      outcome: "failed",
      log: `lane_error ${lane.sheetOrderId}/${lane.stage}: ${msg.slice(0, 160)}`,
    };
  } finally {
    await releaseLock(lockName).catch(() => {});
  }
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

  // mode="full"/"fair" orders: dog and text are tracked independently and can
  // both be awaiting approval at once, so each stage gets its own notified
  // flag instead of the single shared reviewNotifiedFor used above.
  const fullAwaiting = await db
    .select()
    .from(schema.studioOrders)
    .where(
      and(
        inArray(schema.studioOrders.mode, ["full", "fair"]),
        or(
          and(
            eq(schema.studioOrders.dogStatus, "awaiting_approval"),
            eq(schema.studioOrders.dogNotified, false),
          ),
          and(
            eq(schema.studioOrders.textStatus, "awaiting_approval"),
            eq(schema.studioOrders.textNotified, false),
          ),
        ),
      ),
    );
  for (const o of fullAwaiting) {
    if (o.dogStatus === "awaiting_approval" && !o.dogNotified) {
      const r = await sendStudioReviewRequest(o.id, "dog");
      notes.push(r.ok ? `telegram:${o.sheetOrderId}:dog` : `telegram_fail:${r.error}`);
    }
    if (o.textStatus === "awaiting_approval" && !o.textNotified) {
      const r = await sendStudioReviewRequest(o.id, "text");
      notes.push(r.ok ? `telegram:${o.sheetOrderId}:text` : `telegram_fail:${r.error}`);
    }
  }
  return notes;
}

/* ---------------- main tick ---------------- */

/**
 * One cron tick: sync sheet + payments, then keep running batches of lanes
 * CONCURRENTLY (dog ‖ text within an order, and across orders) until the time
 * budget is spent or there is no more work, then ping Telegram for anything
 * newly awaiting review.
 */
export async function runStudioPipelineTick(): Promise<{ ok: true; detail: string }> {
  await ensureStudioSchema();
  if (!(await claimLock(TICK_LOCK_NAME, STUDIO_TICK_LOCK_MS))) {
    return { ok: true, detail: "skipped: previous tick still running" };
  }

  const started = Date.now();
  const actions: string[] = [];
  const heartbeat = setInterval(() => {
    void refreshLock(TICK_LOCK_NAME, STUDIO_TICK_LOCK_MS).catch(() => {});
  }, 60_000);

  try {
    if (isStudioFairOnly()) {
      // Fair-only mode: don't even pull new rows from the sheet in — website
      // orders must stay out of the pipeline entirely while the event runs.
      actions.push("sync_skipped=fair_only");
    } else {
      try {
        const sync = await syncStudioOrdersFromGoogleSheet();
        actions.push(`synced=${sync.upserted}`);
      } catch (e) {
        actions.push(`sync_fail=${e instanceof Error ? e.message : String(e)}`);
      }
    }

    try {
      const polled = await pollPendingFairPayments();
      if (polled > 0) actions.push(`fair_payments_confirmed=${polled}`);
    } catch (e) {
      actions.push(`fair_poll_fail=${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const written = await retryUnwrittenFairSheetRows();
      if (written > 0) actions.push(`fair_sheet_rows_written=${written}`);
    } catch (e) {
      actions.push(`fair_sheet_retry_fail=${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const receipts = await retryFailedFairReceipts();
      if (receipts > 0) actions.push(`fair_receipts_sent=${receipts}`);
    } catch (e) {
      actions.push(`fair_receipt_retry_fail=${e instanceof Error ? e.message : String(e)}`);
    }

    const maxLanes = getStudioMaxConcurrentLanes();
    while (Date.now() - started < STUDIO_TICK_BUDGET_MS) {
      const lanes = await collectRunnableLanes(maxLanes);
      if (!lanes.length) break;

      const results = await Promise.all(lanes.map((lane) => runLane(lane)));
      for (const r of results) if (r.log) actions.push(r.log);
      // Everything idle-looped: nothing ran and nothing advanced, so another
      // pass would just repeat the same queries.
      if (results.every((r) => r.outcome === "noop")) break;
    }

    const notify = await notifyAwaitingReviews();
    actions.push(...notify);
    return { ok: true, detail: actions.join("; ") || "idle" };
  } finally {
    clearInterval(heartbeat);
    await releaseLock(TICK_LOCK_NAME);
  }
}
