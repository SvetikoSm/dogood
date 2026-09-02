import { NextResponse } from "next/server";

import { ensureStudioSchema } from "@/lib/studio/db/ensure-schema";
import { runStudioPipelineTick } from "@/lib/studio/pipeline/orchestrator";
import { clientAnswerCallback } from "@/lib/studio/telegram/client-bot";
import {
  handleFairCallback,
  handleFairCommand,
  handleFairPhoto,
  handleFairText,
  type FairResult,
} from "@/lib/studio/telegram/fair-flow";
import { getEnvRaw } from "@/lib/studio/runtime-env";
import { claimTelegramUpdate } from "@/lib/studio/telegram/update-dedupe";

/** Persistent server (VPS) can finish this after the 200; keeps Telegram snappy. */
function kickTick() {
  void runStudioPipelineTick().catch((e) =>
    console.error("[client webhook] tick", e),
  );
}

function after(result: FairResult) {
  if (result.triggerTick) kickTick();
}

/**
 * Client-facing (fair event) Telegram bot webhook — separate bot/token from
 * the owner's review bot. Same ACK-first pattern as the owner webhook: reply
 * 200 immediately, do the real work after.
 */
async function processUpdate(body: {
  update_id?: number;
  message?: {
    text?: string;
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
  if (!(await claimTelegramUpdate("client", body.update_id))) {
    console.warn("[client webhook] duplicate update", body.update_id);
    return;
  }

  const cb = body.callback_query;
  if (cb?.id) {
    const chatId = cb.message?.chat?.id;
    if (chatId && cb.data) {
      const r = await handleFairCallback(String(chatId), cb.data);
      after(r);
    }
    await clientAnswerCallback(cb.id);
    return;
  }

  const msg = body.message;
  const chatId = msg?.chat?.id;
  if (!chatId) return;

  if (msg?.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1];
    const r = await handleFairPhoto(String(chatId), largest.file_id);
    after(r);
    return;
  }

  const text = msg?.text?.trim();
  if (!text) return;

  const cmd = await handleFairCommand(String(chatId), text);
  if (cmd.handled) {
    after(cmd);
    return;
  }

  const r = await handleFairText(String(chatId), text);
  after(r);
}

export async function POST(req: Request) {
  if (getEnvRaw("FAIR_ENABLED")?.trim() !== "true") {
    return NextResponse.json({ ok: false, error: "fair bot disabled" }, { status: 503 });
  }

  const secret = getEnvRaw("TELEGRAM_CLIENT_WEBHOOK_SECRET")?.trim();
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
  void processUpdate(body).catch((e) =>
    console.error("[client webhook] process", e),
  );

  return NextResponse.json({ ok: true });
}
