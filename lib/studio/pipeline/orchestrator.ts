import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { STUDIO_AUTO_MAX_DOG_CORRECTIONS } from "@/lib/studio/config";
import { getStudioDb, schema } from "@/lib/studio/db";
import type { StudioOrder } from "@/lib/studio/db/schema";
import { syncStudioOrdersFromGoogleSheet } from "@/lib/studio/google/sync-orders-from-sheet";
import { latestSuccessfulStepRun } from "@/lib/studio/pipeline/step-queries";
import { runStudioStep } from "@/lib/studio/pipeline/run-studio-step";
import { STUDIO_STEP_KEYS, type StudioStepKey } from "@/lib/studio/step-keys";
import { parseLlmReviewEnvelope } from "@/lib/studio/types/llm-json";
import { sendStudioReviewRequest } from "@/lib/studio/telegram/review-bot";

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

async function critiqueNeedsCorrection(orderId: string, stepKey: string): Promise<boolean> {
  const row = await latestSuccessfulStepRun(orderId, [stepKey]);
  if (!row?.llmOutputJson) return true;
  const env = parseLlmReviewEnvelope(row.llmOutputJson);
  return env?.status === "needs_correction";
}

async function resolveNextAutomatedStep(order: StudioOrder): Promise<StudioStepKey | null> {
  const id = order.id;

  if (order.status === "new" || order.status === "assets_loaded") {
    const db = getStudioDb();
    const photos = await db
      .select({ id: schema.studioOrderPhotos.id })
      .from(schema.studioOrderPhotos)
      .where(eq(schema.studioOrderPhotos.orderId, id))
      .limit(1);
    if (!photos.length) return STUDIO_STEP_KEYS.FETCH_DRIVE_PHOTOS;
  }

  if (["new", "assets_loaded", "dog_in_progress"].includes(order.status)) {
    if (order.humanRejectNote?.trim()) return STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION;
    if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.DOG_LLM_INITIAL_PROMPT]))) {
      return STUDIO_STEP_KEYS.DOG_LLM_INITIAL_PROMPT;
    }
    if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.DOG_IMG_V1]))) {
      return STUDIO_STEP_KEYS.DOG_IMG_V1;
    }
    const dogImgCount = await countSuccessfulSteps(id, "DOG_IMG");
    const lastCritique = await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.DOG_LLM_CRITIQUE]);
    if (!lastCritique) return STUDIO_STEP_KEYS.DOG_LLM_CRITIQUE;
    const needsFix = await critiqueNeedsCorrection(id, STUDIO_STEP_KEYS.DOG_LLM_CRITIQUE);
    if (needsFix && dogImgCount < STUDIO_AUTO_MAX_DOG_CORRECTIONS) {
      return STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION;
    }
    if (needsFix && dogImgCount >= STUDIO_AUTO_MAX_DOG_CORRECTIONS) {
      await getStudioDb()
        .update(schema.studioOrders)
        .set({ status: "dog_awaiting_approval", updatedAt: new Date() })
        .where(eq(schema.studioOrders.id, id));
      return null;
    }
    if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.DOG_IMG_V3_IDENTITY]))) {
      if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.DOG_LLM_IDENTITY_PROMPT]))) {
        return STUDIO_STEP_KEYS.DOG_LLM_IDENTITY_PROMPT;
      }
      return STUDIO_STEP_KEYS.DOG_IMG_V3_IDENTITY;
    }
    return null;
  }

  if (order.status === "dog_approved_idle" || order.status === "text_in_progress") {
    if (order.humanRejectNote?.trim()) return STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION;
    if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.TEXT_LLM_STYLE_PROMPT]))) {
      return STUDIO_STEP_KEYS.TEXT_LLM_STYLE_PROMPT;
    }
    if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.TEXT_IMG_V1]))) {
      return STUDIO_STEP_KEYS.TEXT_IMG_V1;
    }
    if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.TEXT_LLM_CRITIQUE]))) {
      return STUDIO_STEP_KEYS.TEXT_LLM_CRITIQUE;
    }
    const needsFix = await critiqueNeedsCorrection(id, STUDIO_STEP_KEYS.TEXT_LLM_CRITIQUE);
    const textImgCount = await countSuccessfulSteps(id, "TEXT_IMG");
    if (needsFix && textImgCount < 2) return STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION;
    return null;
  }

  if (order.status === "text_approved_idle" || order.status === "final_in_progress") {
    if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.FINAL_IMG_V1]))) {
      return STUDIO_STEP_KEYS.FINAL_IMG_V1;
    }
    if (!(await latestSuccessfulStepRun(id, [STUDIO_STEP_KEYS.FINAL_LLM_CRITIQUE]))) {
      return STUDIO_STEP_KEYS.FINAL_LLM_CRITIQUE;
    }
    const needsFix = await critiqueNeedsCorrection(id, STUDIO_STEP_KEYS.FINAL_LLM_CRITIQUE);
    const finalImgCount = await countSuccessfulSteps(id, "FINAL_IMG");
    if (needsFix && finalImgCount < 2) return STUDIO_STEP_KEYS.FINAL_IMG_V2_CORRECTION;
    return null;
  }

  return null;
}

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

async function pickWorkingOrder(): Promise<StudioOrder | null> {
  const db = getStudioDb();
  const rows = await db
    .select()
    .from(schema.studioOrders)
    .where(inArray(schema.studioOrders.status, [...WORK_STATUSES]))
    .orderBy(asc(schema.studioOrders.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * One cron tick: sync sheet, ping Telegram for awaiting reviews, run one automated step.
 */
export async function runStudioPipelineTick(): Promise<{
  ok: true;
  detail: string;
}> {
  const sync = await syncStudioOrdersFromGoogleSheet();
  const notify = await notifyAwaitingReviews();

  const order = await pickWorkingOrder();
  if (!order) {
    return {
      ok: true,
      detail: `idle; synced=${sync.upserted}; notify=${notify.join(",") || "none"}`,
    };
  }

  const step = await resolveNextAutomatedStep(order);
  if (!step) {
    return {
      ok: true,
      detail: `no-step order=${order.sheetOrderId} status=${order.status}; notify=${notify.join(",")}`,
    };
  }

  const run = await runStudioStep(order.id, step);
  return {
    ok: true,
    detail: run.ok
      ? `ran ${step} for ${order.sheetOrderId}`
      : `failed ${step} for ${order.sheetOrderId}: ${run.error}`,
  };
}
