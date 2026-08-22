import "server-only";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
import { uploadStudioArtifactToFolder } from "@/lib/studio/google/upload-artifact";
import { isParallelStageMode } from "@/lib/studio/pipeline/modes";
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

/**
 * mode="full"/"fair" only: dog and text are approved independently, so
 * whichever approve call finishes the pair is responsible for advancing the
 * order. Preserves the existing auto-composition behavior (final stage
 * starts once both approved) — just triggered by "both approved" instead of
 * the old assumption that text approval always came after dog approval.
 */
async function maybeCompleteFullOrder(orderId: string): Promise<void> {
  const db = getStudioDb();
  const [order] = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  if (!order || !isParallelStageMode(order.mode)) return;
  if (order.dogStatus !== "approved" || order.textStatus !== "approved") return;
  if (["final_in_progress", "final_awaiting_approval", "completed"].includes(order.status)) return;
  await db
    .update(schema.studioOrders)
    .set({ status: "final_in_progress", updatedAt: new Date() })
    .where(eq(schema.studioOrders.id, orderId));
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
  if (isParallelStageMode(order.mode)) {
    // dog and text run independently for full/fair orders — record dogStatus
    // and let maybeCompleteFullOrder decide if the pair is done.
    await db
      .update(schema.studioOrders)
      .set({
        approvedDogArtifactPath: row.outputArtifactPath,
        dogStatus: "approved",
        lastError: "",
        updatedAt: new Date(),
      })
      .where(eq(schema.studioOrders.id, orderId));
    await maybeCompleteFullOrder(orderId);
  } else {
    // Standalone "create dog illustration" jobs finish here; pack orders proceed to text.
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
  }
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
  const [order] = await db
    .select({ mode: schema.studioOrders.mode })
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  await db
    .update(schema.studioOrders)
    .set(
      order && isParallelStageMode(order.mode)
        ? { dogStatus: "in_progress", lastError: note.slice(0, 2000), updatedAt: new Date() }
        : { status: "dog_in_progress", lastError: note.slice(0, 2000), updatedAt: new Date() },
    )
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
  if (order && isParallelStageMode(order.mode)) {
    // dog and text run independently for full/fair orders — record
    // textStatus and let maybeCompleteFullOrder decide if the pair is done.
    await db
      .update(schema.studioOrders)
      .set({
        approvedTextArtifactPath: row.outputArtifactPath,
        textStatus: "approved",
        lastError: "",
        updatedAt: new Date(),
      })
      .where(eq(schema.studioOrders.id, orderId));
    await maybeCompleteFullOrder(orderId);
  } else {
    // name_only / dog_text (pack) finish after text; no final stage for these modes.
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
  }
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
  const [order] = await db
    .select({ mode: schema.studioOrders.mode })
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  await db
    .update(schema.studioOrders)
    .set(
      order && isParallelStageMode(order.mode)
        ? { textStatus: "in_progress", lastError: note.slice(0, 2000), updatedAt: new Date() }
        : { status: "text_in_progress", lastError: note.slice(0, 2000), updatedAt: new Date() },
    )
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
  let driveFileId = "";
  if (orderRow?.petNameRaw) {
    const up = await uploadStudioArtifactToFolder({
      studioRelativePath: row.outputArtifactPath,
      folderKey: "approved",
      fileBaseName: `${orderRow.petNameRaw}_final`,
    });
    if (!up.ok) console.error("[approveFinalStage] drive upload:", up.error);
    else driveFileId = up.fileId;
  }
  if (orderRow?.mode === "fair") {
    // Fair-event orders: hand the mockup to the client + start checkout.
    // Dynamic import avoids a require cycle (fair-flow imports human-actions).
    const { handleFairFinalApproved } = await import("@/lib/studio/telegram/fair-flow");
    await handleFairFinalApproved(orderId, driveFileId).catch((e) =>
      console.error("[approveFinalStage] fair hook:", e),
    );
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
