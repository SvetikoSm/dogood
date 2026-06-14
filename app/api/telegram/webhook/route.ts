import { NextResponse } from "next/server";

import { handleTelegramCommand } from "@/lib/studio/telegram/review-bot";

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const body = (await req.json()) as {
    message?: { text?: string; chat?: { id?: number } };
  };
  const text = body.message?.text?.trim();
  if (!text) return NextResponse.json({ ok: true });

  const reply = await handleTelegramCommand(text);
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = body.message?.chat?.id ?? process.env.TELEGRAM_CHAT_ID?.trim();
  if (token && chatId && reply) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: reply }),
    });
  }

  return NextResponse.json({ ok: true });
}
