import "server-only";

import fs from "node:fs/promises";

import { eq } from "drizzle-orm";

import { styleDisplayName } from "@/lib/ops/style-masters";
import type { StyleSlug } from "@/lib/ops/style-masters";
import { getStudioDb, schema } from "@/lib/studio/db";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";

const BOT_API = "https://api.telegram.org";

function getToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN?.trim();
}

function getChatId(): string | undefined {
  return process.env.TELEGRAM_CHAT_ID?.trim();
}

export function isTelegramReviewEnabled(): boolean {
  return Boolean(getToken() && getChatId() && process.env.OPS_NOTIFY_TELEGRAM?.trim() === "true");
}

async function tgPost(method: string, body: Record<string, unknown>) {
  const token = getToken();
  if (!token) return { ok: false as const, error: "no token" };
  const res = await fetch(`${BOT_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) return { ok: false as const, error: raw.slice(0, 400) };
  return { ok: true as const, raw };
}

async function sendPhoto(
  pathAbs: string,
  caption: string,
  replyMarkup?: Record<string, unknown>,
) {
  const token = getToken();
  const chatId = getChatId();
  if (!token || !chatId) return { ok: false, error: "telegram not configured" };
  const buf = await fs.readFile(pathAbs);
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption.slice(0, 900));
  if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
  form.append("photo", new Blob([buf]), "preview.png");
  const res = await fetch(`${BOT_API}/bot${token}/sendPhoto`, { method: "POST", body: form });
  if (!res.ok) return { ok: false, error: await res.text() };
  return { ok: true };
}

/** Plain-text ops alert to the review chat (e.g. an order parked as error). */
export async function sendStudioAlert(text: string): Promise<void> {
  const token = getToken();
  const chatId = getChatId();
  if (!token || !chatId) return;
  try {
    await tgPost("sendMessage", { chat_id: chatId, text: text.slice(0, 4000) });
  } catch {
    /* alerts must never crash the pipeline */
  }
}

function approvalKeyboard(stage: "dog" | "text" | "final", sheetOrderId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `a|${stage}|${sheetOrderId}`.slice(0, 64) },
        { text: "❌ Reject", callback_data: `r|${stage}|${sheetOrderId}`.slice(0, 64) },
      ],
    ],
  };
}

export async function sendStudioReviewRequest(orderId: string, stage: "dog" | "text" | "final"): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!isTelegramReviewEnabled()) return { ok: false, error: "telegram disabled" };

  const db = getStudioDb();
  const order = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .get();
  if (!order) return { ok: false, error: "order not found" };

  const style = styleDisplayName(order.designSlug as StyleSlug);
  const header = [
    `DoGood review: ${stage.toUpperCase()}`,
    `Order: ${order.sheetOrderId}`,
    `Pet: ${order.petNameRaw}`,
    `Style: ${style}`,
    "",
    "Use the buttons under the generated image, or reply with:",
    `/reject_${stage}_${order.sheetOrderId} your comment — to guide the correction`,
  ].join("\n");

  await tgPost("sendMessage", { chat_id: getChatId(), text: header });

  const photos = await db
    .select()
    .from(schema.studioOrderPhotos)
    .where(eq(schema.studioOrderPhotos.orderId, orderId))
    .limit(3);

  for (const p of photos) {
    const abs = absoluteFromStudioRelative(p.localRelativePath);
    await sendPhoto(abs, `Client photo: ${p.originalName}`);
  }

  let artifact = "";
  if (stage === "dog") {
    const runs = await db
      .select()
      .from(schema.studioStepRuns)
      .where(eq(schema.studioStepRuns.orderId, orderId));
    const dogImg = runs
      .filter((r) => r.stepKey.startsWith("DOG_IMG") && r.status === "success" && r.outputArtifactPath)
      .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))[0];
    artifact = dogImg?.outputArtifactPath ?? "";
  } else if (stage === "text") {
    artifact = order.approvedDogArtifactPath;
    const runs = await db.select().from(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, orderId));
    const textImg = runs
      .filter((r) => r.stepKey.startsWith("TEXT_IMG") && r.status === "success" && r.outputArtifactPath)
      .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))[0];
    if (textImg?.outputArtifactPath) artifact = textImg.outputArtifactPath;
  } else {
    const runs = await db.select().from(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, orderId));
    const finalImg = runs
      .filter((r) => r.stepKey.startsWith("FINAL_IMG") && r.status === "success" && r.outputArtifactPath)
      .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))[0];
    artifact = finalImg?.outputArtifactPath ?? "";
  }

  if (artifact) {
    await sendPhoto(
      absoluteFromStudioRelative(artifact),
      `Generated ${stage} — ${order.petNameRaw}`,
      approvalKeyboard(stage, order.sheetOrderId),
    );
  } else {
    await tgPost("sendMessage", {
      chat_id: getChatId(),
      text: `No ${stage} artifact found for ${order.sheetOrderId} — check /studio/orders.`,
      reply_markup: approvalKeyboard(stage, order.sheetOrderId),
    });
  }

  await db
    .update(schema.studioOrders)
    .set({ reviewNotifiedFor: stage, updatedAt: new Date() })
    .where(eq(schema.studioOrders.id, orderId));

  return { ok: true };
}

type ReviewStage = "dog" | "text" | "final";

/** Used when the reviewer rejects without a comment — the LLM decides what to fix. */
const GENERIC_REJECT_NOTE =
  "The human reviewer rejected this image without a comment. Compare it carefully against the customer photos and the style references, identify the most likely flaws, and produce an improved version.";

async function applyApprove(stage: ReviewStage, sheetOrderId: string): Promise<string> {
  const db = getStudioDb();
  const order = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.sheetOrderId, sheetOrderId))
    .get();
  if (!order) return `Order not found: ${sheetOrderId}`;
  const { approveDogStage, approveTextStage, approveFinalStage } = await import(
    "@/lib/studio/pipeline/human-actions"
  );
  const fn =
    stage === "dog" ? approveDogStage : stage === "text" ? approveTextStage : approveFinalStage;
  const r = await fn(order.id);
  return r.ok
    ? `✅ ${stage} approved for ${sheetOrderId}`
    : `${stage} approve failed: ${r.error}`;
}

async function applyReject(
  stage: ReviewStage,
  sheetOrderId: string,
  note: string,
): Promise<string> {
  const db = getStudioDb();
  const order = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.sheetOrderId, sheetOrderId))
    .get();
  if (!order) return `Order not found: ${sheetOrderId}`;
  const noteTrim = note.trim() || GENERIC_REJECT_NOTE;
  await db
    .update(schema.studioOrders)
    .set({
      humanRejectNote: noteTrim,
      reviewNotifiedFor: "",
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, order.id));

  const { rejectDogStage, rejectTextStage, rejectFinalStage } = await import(
    "@/lib/studio/pipeline/human-actions"
  );
  const fn =
    stage === "dog" ? rejectDogStage : stage === "text" ? rejectTextStage : rejectFinalStage;
  await fn(order.id, noteTrim);
  return `❌ ${stage} rejected for ${sheetOrderId}. Regeneration queued.`;
}

export async function handleTelegramCommand(text: string): Promise<string> {
  const t = text.trim();
  const approve = t.match(/^\/approve_(dog|text|final)_(\S+)/i);
  if (approve) {
    return applyApprove(approve[1].toLowerCase() as ReviewStage, approve[2]);
  }

  const reject = t.match(/^\/reject_(dog|text|final)_(\S+)\s*([\s\S]*)$/i);
  if (reject) {
    return applyReject(reject[1].toLowerCase() as ReviewStage, reject[2], reject[3] ?? "");
  }

  return "Use the ✅/❌ buttons under review images, or:\n/approve_dog_ORDERID\n/reject_dog_ORDERID your comment";
}

/** Inline-button presses: callback_data is "a|stage|sheetOrderId" or "r|stage|sheetOrderId". */
export async function handleTelegramCallback(data: string): Promise<string> {
  const m = data.match(/^([ar])\|(dog|text|final)\|(.+)$/);
  if (!m) return "Unknown action";
  const [, kind, stage, sheetOrderId] = m;
  if (kind === "a") return applyApprove(stage as ReviewStage, sheetOrderId);
  const reply = await applyReject(stage as ReviewStage, sheetOrderId, "");
  return `${reply}\nTip: to guide the fix, send /reject_${stage}_${sheetOrderId} your comment`;
}
