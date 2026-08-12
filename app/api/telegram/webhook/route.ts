import { NextResponse } from "next/server";

import {
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
import { ensureStudioSchema } from "@/lib/studio/db/ensure-schema";

const BOT_API = "https://api.telegram.org";

async function sendReply(chatId: number | string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !chatId || !text) return;
  await fetch(`${BOT_API}/bot${token}/sendMessage`, {
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

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  await ensureStudioSchema();

  const body = (await req.json()) as {
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
  };

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  // --- Inline button presses ---
  const cb = body.callback_query;
  if (cb?.id) {
    const chatId = cb.message?.chat?.id ?? process.env.TELEGRAM_CHAT_ID?.trim();
    let reply = "";
    if (cb.data && /^(mm:|ms:|mg$|mn$|mx$)/.test(cb.data) && chatId) {
      const r = await handleManualCallback(String(chatId), cb.data);
      afterManual(r);
      // manual-flow sends its own messages
    } else if (cb.data) {
      reply = await handleTelegramCallback(cb.data);
    }
    if (token) {
      await fetch(`${BOT_API}/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id, text: reply.slice(0, 190) }),
      });
    }
    if (chatId && reply) await sendReply(chatId, reply);
    return NextResponse.json({ ok: true });
  }

  const msg = body.message;
  const chatId = msg?.chat?.id ?? process.env.TELEGRAM_CHAT_ID?.trim();

  // --- Photo messages (manual dog / pack upload; caption may be the pet name) ---
  if (msg?.photo?.length && chatId) {
    const largest = msg.photo[msg.photo.length - 1];
    const r = await handleManualPhoto(String(chatId), largest.file_id, msg.caption);
    afterManual(r);
    return NextResponse.json({ ok: true });
  }

  // --- Text messages ---
  const text = msg?.text?.trim();
  if (!text || !chatId) return NextResponse.json({ ok: true });

  if (/^\/(menu|start)\b/.test(text)) {
    await sendStudioMenu(String(chatId));
    return NextResponse.json({ ok: true });
  }

  // If we're mid manual-flow waiting for a name, this text is the name.
  const manual = await handleManualText(String(chatId), text);
  if (manual.handled) {
    afterManual(manual);
    return NextResponse.json({ ok: true });
  }

  // Otherwise: typed approve/reject commands.
  const reply = await handleTelegramCommand(text);
  if (reply) await sendReply(chatId, reply);
  return NextResponse.json({ ok: true });
}
