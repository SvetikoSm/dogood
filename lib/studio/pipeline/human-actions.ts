import "server-only";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
import { uploadStudioArtifactToFolder } from "@/lib/studio/google/upload-artifact";
import { latestSuccessfulStepRun } from "@/lib/studio/pipeline/step-queries";
import { STUDIO_STEP_KEYS } from "@/lib/studio/step-keys";

async function logHuman(
  orderId: string,
  stage: string,
  stepKey: string,
  payload: Record<string, unknown>,
) {
  const db = getStudioDb();
  await db.insert(schema.studioStepRuns).values({
    id: randomUUID(),
    orderId,
    stage,
    stepKey,
    attempt: 1,
    status: "success",
    llmOutputJson: JSON.stringify(payload),
    startedAt: new Date(),
    finishedAt: new Date(),
  });
}

export async function approveDogStage(orderId: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const db = getStudioDb();
  const [order] = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  if (!order) return { ok: false, error: "order not found" };
  const row = await latestSuccessfulStepRun(orderId, [
    STUDIO_STEP_KEYS.DOG_IMG_V3_IDENTITY,
    STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION,
    STUDIO_STEP_KEYS.DOG_IMG_V1,
  ]);
  if (!row?.outputArtifactPath) {
    return { ok: false, error: "No successful dog image step yet" };
  }
  // Standalone "create dog illustration" jobs finish here; full orders proceed to text.
  const dogNextStatus = order.mode === "dog_only" ? "completed" : "dog_approved_idle";
  await db
    .update(schema.studioOrders)
    .set({
      approvedDogArtifactPath: row.outputArtifactPath,
      status: dogNextStatus,
      lastError: "",
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, orderId));
  await logHuman(orderId, "dog", STUDIO_STEP_KEYS.HUMAN_APPROVE_DOG, {
    artifact: row.outputArtifactPath,
  });
  const up = await uploadStudioArtifactToFolder({
    studioRelativePath: row.outputArtifactPath,
    folderKey: "approved",
    fileBaseName: order.petNameRaw?.trim() || `dog_${order.sheetOrderId}`,
  });
  if (!up.ok) {
    console.error("[approveDogStage] drive upload:", up.error);
  }
  return { ok: true };
}

export async function rejectDogStage(
  orderId: string,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getStudioDb();
  await db
    .update(schema.studioOrders)
    .set({
      status: "dog_in_progress",
      lastError: note.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, orderId));
  await logHuman(orderId, "dog", STUDIO_STEP_KEYS.HUMAN_REJECT_DOG, { note });
  return { ok: true };
}

export async function approveTextStage(orderId: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const db = getStudioDb();
  const [order] = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  const row = await latestSuccessfulStepRun(orderId, [
    STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION,
    STUDIO_STEP_KEYS.TEXT_IMG_V1,
  ]);
  if (!row?.outputArtifactPath) {
    return { ok: false, error: "No successful text image step yet" };
  }
  // name_only / dog_text finish after text; full sheet orders proceed to final.
  const textNextStatus =
    order?.mode === "name_only" || order?.mode === "dog_text"
      ? "completed"
      : "text_approved_idle";
  await db
    .update(schema.studioOrders)
    .set({
      approvedTextArtifactPath: row.outputArtifactPath,
      status: textNextStatus,
      lastError: "",
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, orderId));
  await logHuman(orderId, "text", STUDIO_STEP_KEYS.HUMAN_APPROVE_TEXT, {
    artifact: row.outputArtifactPath,
  });
  const [orderRow] = await db.select().from(schema.studioOrders).where(eq(schema.studioOrders.id, orderId)).limit(1);
  if (orderRow?.petNameRaw) {
    const up = await uploadStudioArtifactToFolder({
      studioRelativePath: row.outputArtifactPath,
      folderKey: "textBadges",
      fileBaseName: orderRow.petNameRaw,
    });
    if (!up.ok) console.error("[approveTextStage] drive upload:", up.error);
  }
  return { ok: true };
}

export async function rejectTextStage(
  orderId: string,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getStudioDb();
  await db
    .update(schema.studioOrders)
    .set({
      status: "text_in_progress",
      lastError: note.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, orderId));
  await logHuman(orderId, "text", STUDIO_STEP_KEYS.HUMAN_REJECT_TEXT, { note });
  return { ok: true };
}

export async function approveFinalStage(orderId: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const db = getStudioDb();
  const row = await latestSuccessfulStepRun(orderId, [
    STUDIO_STEP_KEYS.FINAL_IMG_V2_CORRECTION,
    STUDIO_STEP_KEYS.FINAL_IMG_V1,
  ]);
  if (!row?.outputArtifactPath) {
    return { ok: false, error: "No successful final image step yet" };
  }
  await db
    .update(schema.studioOrders)
    .set({
      approvedFinalArtifactPath: row.outputArtifactPath,
      status: "completed",
      lastError: "",
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, orderId));
  await logHuman(orderId, "final", STUDIO_STEP_KEYS.HUMAN_APPROVE_FINAL, {
    artifact: row.outputArtifactPath,
  });
  const [orderRow] = await db.select().from(schema.studioOrders).where(eq(schema.studioOrders.id, orderId)).limit(1);
  if (orderRow?.petNameRaw) {
    const up = await uploadStudioArtifactToFolder({
      studioRelativePath: row.outputArtifactPath,
      folderKey: "approved",
      fileBaseName: `${orderRow.petNameRaw}_final`,
    });
    if (!up.ok) console.error("[approveFinalStage] drive upload:", up.error);
  }
  return { ok: true };
}

export async function rejectFinalStage(
  orderId: string,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getStudioDb();
  await db
    .update(schema.studioOrders)
    .set({
      status: "final_in_progress",
      lastError: note.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, orderId));
  await logHuman(orderId, "final", STUDIO_STEP_KEYS.HUMAN_REJECT_FINAL, { note });
  return { ok: true };
}
