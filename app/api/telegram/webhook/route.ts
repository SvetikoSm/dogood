import { NextResponse } from "next/server";

import {
  handlePendingReviewComment,
  handleTelegramCallback,
  handleTelegramCommand,
} from "@/lib/studio/telegram/review-bot";
import {
  handleManualCallback,
  handleManualPhoto,
  handleManualText,
  sendStudioMenu,
  type ManualResult,
} from "@/lib/studio/telegram/manual-flow";
import { runStudioPipelineTick } from "@/lib/studio/pipeline/orchestrator";
import { claimTelegramUpdate } from "@/lib/studio/telegram/update-dedupe";
import { ensureStudioSchema } from "@/lib/studio/db/ensure-schema";
import { telegramApiBase } from "@/lib/studio/telegram/api-base";
import { tgFetch } from "@/lib/studio/telegram/tg-fetch";

const BOT_API = () => telegramApiBase();

async function sendReply(chatId: number | string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !chatId || !text) return;
  await tgFetch(`${BOT_API()}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

/** Persistent server (VPS) can finish this after the 200; keeps Telegram snappy. */
function kickTick() {
  void runStudioPipelineTick().catch((e) =>
    console.error("[telegram webhook] tick", e),
  );
}

function afterManual(result: ManualResult) {
  if (result.triggerTick) kickTick();
}

/**
 * Telegram retries/drops webhooks that are slow or time out. Do all real work
 * after we have already decided to ACK, and never block the HTTP response on
 * outbound Bot API calls longer than necessary.
 */
async function processUpdate(body: {
  update_id?: number;
  message?: {
    text?: string;
    caption?: string;
    chat?: { id?: number };
    photo?: { file_id: string }[];
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat?: { id?: number } };
  };
}) {
  await ensureStudioSchema();

  // Telegram replays any update whose offset was not confirmed; handle once.
  if (!(await claimTelegramUpdate("owner", body.update_id))) {
    console.warn("[owner webhook] duplicate update", body.update_id);
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  const cb = body.callback_query;
  if (cb?.id) {
    const chatId = cb.message?.chat?.id ?? process.env.TELEGRAM_CHAT_ID?.trim();
    let reply = "";
    if (cb.data && /^(mm:|ms:|mg$|mn$|mx$)/.test(cb.data) && chatId) {
      const r = await handleManualCallback(String(chatId), cb.data);
      afterManual(r);
    } else if (cb.data) {
      reply = await handleTelegramCallback(cb.data, chatId ? String(chatId) : undefined);
      // An approve/reject just unblocked work (final composition after both
      // approvals, or a correction after a reject) — start it now instead of
      // waiting for the next cron tick.
      kickTick();
    }
    if (token) {
      await tgFetch(`${BOT_API()}/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id, text: reply.slice(0, 190) }),
      });
    }
    if (chatId && reply) await sendReply(chatId, reply);
    return;
  }

  const msg = body.message;
  const chatId = msg?.chat?.id ?? process.env.TELEGRAM_CHAT_ID?.trim();

  if (msg?.photo?.length && chatId) {
    const largest = msg.photo[msg.photo.length - 1];
    const r = await handleManualPhoto(String(chatId), largest.file_id, msg.caption);
    afterManual(r);
    return;
  }

  const text = msg?.text?.trim();
  if (!text || !chatId) return;

  if (/^\/(menu|start)(@\w+)?\b/.test(text)) {
    await sendStudioMenu(String(chatId));
    return;
  }

  // A reject-with-comment is pending for this chat: this text is the
  // correction comment, not a manual-menu input (pet name, style, etc).
  const pendingReview = await handlePendingReviewComment(String(chatId), text);
  if (pendingReview.handled) {
    kickTick(); // the correction is queued — run it right away
    return;
  }

  const manual = await handleManualText(String(chatId), text);
  if (manual.handled) {
    afterManual(manual);
    return;
  }

  const reply = await handleTelegramCommand(text);
  if (reply) await sendReply(chatId, reply);
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let body: Parameters<typeof processUpdate>[0];
  try {
    body = (await req.json()) as Parameters<typeof processUpdate>[0];
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  // ACK immediately so Telegram does not mark the webhook as timed out.
  // Work continues on the Node process (Docker/VPS is long-lived).
  void processUpdate(body).catch((e) =>
    console.error("[telegram webhook] process", e),
  );

  return NextResponse.json({ ok: true });
}
