import "server-only";

import fs from "node:fs/promises";

import { eq } from "drizzle-orm";

import { styleDisplayName } from "@/lib/ops/style-masters";
import type { StyleSlug } from "@/lib/ops/style-masters";
import { getStudioDb, schema } from "@/lib/studio/db";
import { isStudioMockMode } from "@/lib/studio/env";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";
import { isParallelStageMode } from "@/lib/studio/pipeline/modes";
import { tgFetch } from "@/lib/studio/telegram/tg-fetch";

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
  const res = await tgFetch(`${BOT_API}/bot${token}/${method}`, {
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
  const res = await tgFetch(`${BOT_API}/bot${token}/sendPhoto`, { method: "POST", body: form });
  if (!res.ok) return { ok: false, error: await res.text() };
  return { ok: true };
}

/** Plain-text ops alert to the review chat (e.g. an order parked as error). */
export async function sendStudioAlert(text: string): Promise<void> {
  if (isStudioMockMode()) {
    console.log(`[review-bot mock] alert: ${text.replace(/\n/g, " / ")}`);
    return;
  }
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
        { text: "✅ Одобрить", callback_data: `a|${stage}|${sheetOrderId}`.slice(0, 64) },
        { text: "❌ На доработку", callback_data: `r|${stage}|${sheetOrderId}`.slice(0, 64) },
      ],
    ],
  };
}

const rejectNoCommentKeyboard = {
  inline_keyboard: [[{ text: "Без комментария", callback_data: "rj:none" }]],
};

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
  const headerLines = [
    `DoGood review: ${stage.toUpperCase()}`,
    `Order: ${order.sheetOrderId}`,
    `Pet: ${order.petNameRaw}`,
    `Style: ${style}`,
  ];
  if (order.mode === "fair") {
    const fairRow = await db
      .select({ email: schema.studioFairOrders.email })
      .from(schema.studioFairOrders)
      .where(eq(schema.studioFairOrders.orderId, orderId))
      .get();
    headerLines.push(`🎪 ЯРМАРКА • клиент: ${fairRow?.email || "—"} • кличка: ${order.petNameRaw}`);
  }
  headerLines.push(
    "",
    "Нажмите кнопку под картинкой, или ответьте командой:",
    `/reject_${stage}_${order.sheetOrderId} ваш комментарий — чтобы направить доработку`,
  );
  const header = headerLines.join("\n");

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

  // mode="full"/"fair" dog/text stages each get their own notified flag since
  // both can be awaiting approval at once; final stage and other modes keep
  // the single shared reviewNotifiedFor as before.
  const notifiedPatch =
    isParallelStageMode(order.mode) && stage === "dog"
      ? { dogNotified: true }
      : isParallelStageMode(order.mode) && stage === "text"
        ? { textNotified: true }
        : { reviewNotifiedFor: stage };
  await db
    .update(schema.studioOrders)
    .set({ ...notifiedPatch, updatedAt: new Date() })
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

  // mode="full"/"fair" text rejects write textRejectNote (kept separate from
  // the dog note so a reject on one stage can't clobber a pending note on
  // the other) and reset only that stage's notified flag; everything else
  // keeps the original single-field behavior.
  const isParallel = isParallelStageMode(order.mode);
  const patch =
    isParallel && stage === "text"
      ? { textRejectNote: noteTrim, textNotified: false, updatedAt: new Date() }
      : isParallel && stage === "dog"
        ? { humanRejectNote: noteTrim, dogNotified: false, updatedAt: new Date() }
        : { humanRejectNote: noteTrim, reviewNotifiedFor: "", updatedAt: new Date() };
  await db
    .update(schema.studioOrders)
    .set(patch)
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

  if (/^\/fair\b/i.test(t) && !/^\/fair_/i.test(t)) {
    const { listActiveFairOrders } = await import("@/lib/studio/telegram/fair-flow");
    const rows = await listActiveFairOrders(20);
    if (!rows.length) return "🎪 Активных ярмарочных заказов нет.";
    return [
      `🎪 Активные ярмарочные заказы (${rows.length}):`,
      ...rows.map(
        (r) => `• ${r.petName} — шаг: ${r.step}, оплата: ${r.paymentStatus}, ${r.sheetOrderId} (chatId ${r.chatId})`,
      ),
    ].join("\n");
  }

  const fairReset = t.match(/^\/fair_reset\s+(\S+)/i);
  if (fairReset) {
    const { resetFairSession } = await import("@/lib/studio/telegram/fair-flow");
    const r = await resetFairSession(fairReset[1]);
    return r.ok ? `✅ Сессия ${fairReset[1]} сброшена.` : `Не удалось сбросить: ${r.error}`;
  }

  const fairResend = t.match(/^\/fair_resend\s+(\S+)/i);
  if (fairResend) {
    const { resendFairOffer } = await import("@/lib/studio/telegram/fair-flow");
    const r = await resendFairOffer(fairResend[1]);
    return r.ok ? `✅ Макет и ссылка на оплату отправлены заново для ${fairResend[1]}.` : `Не удалось отправить: ${r.error}`;
  }

  return "Нажмите ✅/❌ под фото на проверке, или используйте команду:\n/approve_dog_ORDERID\n/reject_dog_ORDERID ваш комментарий\n/fair — активные ярмарочные заказы\n/fair_reset chatId\n/fair_resend chatId";
}

/* ---------------- reject-with-comment flow ---------------- */

/** How long a "waiting for a comment" reject can sit before we give up on it. */
const PENDING_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;

async function setReviewPending(chatId: string, stage: ReviewStage, sheetOrderId: string) {
  const db = getStudioDb();
  const existing = await getReviewPending(chatId);
  if (existing && (existing.stage !== stage || existing.sheetOrderId !== sheetOrderId)) {
    // A different reject was left hanging (owner pressed ❌ on another order
    // before finishing this one) — apply it without a comment rather than
    // silently losing it when the new pending row overwrites this one.
    await applyReject(existing.stage as ReviewStage, existing.sheetOrderId, "");
    await tgPost("sendMessage", {
      chat_id: chatId,
      text: `Доработка ${existing.stage} (${existing.sheetOrderId}) отправлена без комментария — начали новую доработку.`,
    });
  }
  await db
    .insert(schema.studioReviewPending)
    .values({ chatId, stage, sheetOrderId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.studioReviewPending.chatId,
      set: { stage, sheetOrderId, updatedAt: new Date() },
    });
}

async function getReviewPending(chatId: string) {
  const db = getStudioDb();
  return db
    .select()
    .from(schema.studioReviewPending)
    .where(eq(schema.studioReviewPending.chatId, chatId))
    .get();
}

async function clearReviewPending(chatId: string) {
  const db = getStudioDb();
  await db.delete(schema.studioReviewPending).where(eq(schema.studioReviewPending.chatId, chatId));
}

/**
 * A plain text message from the owner's chat while a reject is pending a
 * comment. Must be checked BEFORE the manual-menu text handler, otherwise a
 * correction comment would get swallowed as a pet name / menu input.
 */
export async function handlePendingReviewComment(
  chatId: string,
  text: string,
): Promise<{ handled: boolean }> {
  const pending = await getReviewPending(chatId);
  if (!pending) return { handled: false };

  // A slash command is not a correction comment — leave the pending reject
  // alone and let this message fall through to command handling / the
  // manual menu instead of being swallowed as a comment.
  if (text.trim().startsWith("/")) return { handled: false };

  if (Date.now() - pending.updatedAt.getTime() > PENDING_REVIEW_TIMEOUT_MS) {
    // Forgotten reject — apply it without a comment so it can't block the
    // stage forever, but don't consume THIS message as the comment (it may
    // be unrelated, sent long after the owner forgot about the ❌).
    await clearReviewPending(chatId);
    const reply = await applyReject(pending.stage as ReviewStage, pending.sheetOrderId, "");
    await tgPost("sendMessage", {
      chat_id: chatId,
      text: `⏱ Комментарий к доработке ${pending.sheetOrderId} не пришёл вовремя — отправил без комментария.\n${reply}`,
    });
    return { handled: false };
  }

  await clearReviewPending(chatId);
  const reply = await applyReject(
    pending.stage as ReviewStage,
    pending.sheetOrderId,
    text.trim(),
  );
  await tgPost("sendMessage", { chat_id: chatId, text: reply });
  return { handled: true };
}

/**
 * Inline-button presses: callback_data is "a|stage|sheetOrderId" (approve),
 * "r|stage|sheetOrderId" (start reject-with-comment), or "rj:none" (confirm
 * reject without a comment for the chat's pending reject).
 */
export async function handleTelegramCallback(data: string, chatId?: string): Promise<string> {
  if (data === "rj:none") {
    if (!chatId) return "Unknown action";
    const pending = await getReviewPending(chatId);
    if (!pending) return "Нет ожидающей доработки — используйте кнопку ❌ ещё раз.";
    await clearReviewPending(chatId);
    return applyReject(pending.stage as ReviewStage, pending.sheetOrderId, "");
  }

  const m = data.match(/^([ar])\|(dog|text|final)\|(.+)$/);
  if (!m) return "Unknown action";
  const [, kind, stage, sheetOrderId] = m;
  if (kind === "a") return applyApprove(stage as ReviewStage, sheetOrderId);

  if (chatId) {
    const target = await getStudioDb()
      .select({ petNameRaw: schema.studioOrders.petNameRaw })
      .from(schema.studioOrders)
      .where(eq(schema.studioOrders.sheetOrderId, sheetOrderId))
      .get();
    await setReviewPending(chatId, stage as ReviewStage, sheetOrderId);
    const petLabel = target?.petNameRaw ? `, «${target.petNameRaw}»` : "";
    await tgPost("sendMessage", {
      chat_id: chatId,
      text: `Напишите комментарий одним сообщением — что поправить в ${stage} (${sheetOrderId}${petLabel}).`,
      reply_markup: rejectNoCommentKeyboard,
    });
    return "";
  }
  // Fallback (no chatId available): reject immediately without a comment.
  const reply = await applyReject(stage as ReviewStage, sheetOrderId, "");
  return `${reply}\nTip: to guide the fix, send /reject_${stage}_${sheetOrderId} your comment`;
}
