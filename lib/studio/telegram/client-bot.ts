import "server-only";

import fs from "node:fs/promises";

import { isStudioMockMode } from "@/lib/studio/env";
import { getEnvRaw } from "@/lib/studio/runtime-env";
import { tgFetch } from "@/lib/studio/telegram/tg-fetch";

const BOT_API = "https://api.telegram.org";

export type InlineKeyboard = { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };

export function clientBotToken(): string | undefined {
  return getEnvRaw("TELEGRAM_CLIENT_BOT_TOKEN")?.trim();
}

export function isClientBotEnabled(): boolean {
  return Boolean(clientBotToken()) && getEnvRaw("FAIR_ENABLED")?.trim() === "true";
}

export async function clientSend(chatId: string, text: string, keyboard?: InlineKeyboard): Promise<void> {
  if (isStudioMockMode()) {
    console.log(`[client-bot mock] -> ${chatId}: ${text.replace(/\n/g, " / ")}`);
    return;
  }
  const t = clientBotToken();
  if (!t) return;
  try {
    await tgFetch(`${BOT_API}/bot${t}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: keyboard }),
    });
  } catch (e) {
    console.error("[client-bot] send", e);
  }
}

export async function clientSendPhoto(
  chatId: string,
  absPath: string,
  caption: string,
  keyboard?: InlineKeyboard,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isStudioMockMode()) {
    console.log(`[client-bot mock] -> ${chatId} [photo ${absPath}]: ${caption.replace(/\n/g, " / ")}`);
    return { ok: true };
  }
  const t = clientBotToken();
  if (!t) return { ok: false, error: "client bot not configured" };
  try {
    const buf = await fs.readFile(absPath);
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", caption.slice(0, 900));
    if (keyboard) form.append("reply_markup", JSON.stringify(keyboard));
    form.append("photo", new Blob([buf]), "mockup.png");
    const res = await tgFetch(`${BOT_API}/bot${t}/sendPhoto`, { method: "POST", body: form });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function clientAnswerCallback(callbackQueryId: string, text = ""): Promise<void> {
  if (isStudioMockMode()) return;
  const t = clientBotToken();
  if (!t) return;
  try {
    await tgFetch(`${BOT_API}/bot${t}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text.slice(0, 190) }),
    });
  } catch (e) {
    console.error("[client-bot] answerCallback", e);
  }
}
