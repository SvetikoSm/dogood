/**
 * Local Telegram worker for Studio manual flow.
 *
 * Why: Telegram cannot reach the VPS webhook, and the VPS often cannot call
 * api.telegram.org either. This machine can talk to both Telegram and OpenRouter,
 * so we run the menu / pack flow + pipeline ticks here.
 *
 *   npx tsx --conditions react-server scripts/telegram-local-bot.ts
 *
 * Keep the window open while you use the bot.
 */
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();
process.env.STUDIO_MOCK_AI = process.env.STUDIO_MOCK_AI || "false";
process.env.OPS_NOTIFY_TELEGRAM = "true";

/** Only one getUpdates poller may run; otherwise Telegram returns 409 Conflict. */
const LOCK_PATH = path.join(process.cwd(), "data", "studio", "telegram-local-bot.lock");
function acquireSingletonLock() {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const oldPid = Number(fs.readFileSync(LOCK_PATH, "utf8").trim());
      if (oldPid && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0);
          console.error(
            `[local-bot] another instance is already running (pid ${oldPid}). Exit it first.`,
          );
          process.exit(2);
        } catch {
          /* stale lock — previous process is gone */
        }
      }
    }
    fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: "w" });
  } catch (e) {
    console.error("[local-bot] lock failed", e);
    process.exit(2);
  }
  const release = () => {
    try {
      if (fs.existsSync(LOCK_PATH) && fs.readFileSync(LOCK_PATH, "utf8").trim() === String(process.pid)) {
        fs.unlinkSync(LOCK_PATH);
      }
    } catch {
      /* ignore */
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    release();
    process.exit(0);
  });
  console.log(`[local-bot] singleton lock ok pid=${process.pid}`);
}
acquireSingletonLock();

const TOK = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!TOK) {
  console.error("TELEGRAM_BOT_TOKEN missing in .env.local");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOK}`;

async function tg(method: string, body?: Record<string, unknown>) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json() as Promise<{ ok: boolean; result?: unknown; description?: string }>;
}

async function tgSafe(method: string, body?: Record<string, unknown>) {
  try {
    return await tg(method, body);
  } catch (e) {
    console.error(`[local-bot] tg ${method} failed`, e instanceof Error ? e.message : e);
    return { ok: false, description: String(e) };
  }
}

async function main() {
  const { ensureStudioSchema } = await import("../lib/studio/db/ensure-schema");
  const {
    handleManualCallback,
    handleManualPhoto,
    handleManualText,
    sendStudioMenu,
  } = await import("../lib/studio/telegram/manual-flow");
  const {
    handleTelegramCallback,
    handleTelegramCommand,
  } = await import("../lib/studio/telegram/review-bot");
  const { runStudioPipelineTick } = await import("../lib/studio/pipeline/orchestrator");
  const { syncStudioTemplatesFromDrive } = await import(
    "../lib/studio/google/sync-templates-from-drive"
  );

  await ensureStudioSchema();
  console.log("[local-bot] schema ok");

  try {
    const sync = await syncStudioTemplatesFromDrive();
    console.log("[local-bot] templates", sync);
  } catch (e) {
    console.warn("[local-bot] template sync failed (will use DB if already seeded)", e);
  }

  // Best-effort: Telegram API from this network is sometimes flaky.
  for (let i = 0; i < 5; i++) {
    const wh = await tgSafe("deleteWebhook", { drop_pending_updates: true });
    if (wh.ok) break;
    console.warn(`[local-bot] deleteWebhook retry ${i + 1}`, wh.description);
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  console.log("[local-bot] webhook cleared, pending dropped — polling. Use ONLY the newest menu message.");

  let offset = 0;

  async function kickTick() {
    try {
      const r = await runStudioPipelineTick();
      console.log("[local-bot] tick", r.detail.slice(0, 240));
    } catch (e) {
      console.error("[local-bot] tick error", e);
    }
  }

  for (;;) {
    try {
      const data = (await fetch(`${API}/getUpdates?timeout=25&offset=${offset}`).then((r) =>
        r.json(),
      )) as {
        ok: boolean;
        error_code?: number;
        description?: string;
        result?: Array<{
          update_id: number;
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
        }>;
      };

      if (!data.ok) {
        console.error("[local-bot] getUpdates", data.error_code, data.description);
        if (data.error_code === 409) {
          console.error("[local-bot] another poller is running — exiting to avoid conflict");
          process.exit(2);
        }
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      for (const u of data.result || []) {
        offset = u.update_id + 1;
        const cb = u.callback_query;
        if (cb?.id) {
          const chatId = String(
            cb.message?.chat?.id ?? process.env.TELEGRAM_CHAT_ID ?? "",
          );
          console.log("[local-bot] callback", cb.data, "chat", chatId);
          let reply = "";
          try {
            if (cb.data && /^(mm:|ms:|mg$|mn$|mx$)/.test(cb.data) && chatId) {
              const r = await handleManualCallback(chatId, cb.data);
              if (r.triggerTick) void kickTick();
            } else if (cb.data) {
              reply = await handleTelegramCallback(cb.data);
              void kickTick();
            }
          } catch (e) {
            console.error("[local-bot] callback handler", e);
            reply = `Ошибка: ${e instanceof Error ? e.message : String(e)}`.slice(0, 180);
          }
          await tgSafe("answerCallbackQuery", {
            callback_query_id: cb.id,
            text: (reply || "OK").slice(0, 190),
          });
          if (chatId && reply) {
            await tgSafe("sendMessage", { chat_id: chatId, text: reply.slice(0, 3500) });
          }
          continue;
        }

        const msg = u.message;
        const chatId = String(msg?.chat?.id ?? "");
        if (!chatId) continue;

        if (msg?.photo?.length) {
          const largest = msg.photo[msg.photo.length - 1];
          console.log("[local-bot] photo", chatId);
          try {
            const r = await handleManualPhoto(chatId, largest.file_id, msg.caption);
            if (r.triggerTick) void kickTick();
            if (!r.handled) {
              await tgSafe("sendMessage", {
                chat_id: chatId,
                text:
                  "Чтобы прикрепить фото, сначала откройте меню: /menu → «🎨 Создать комплект (собака + имя)».\n\nСтарые кнопки в чате не работают — используйте только последнее меню.",
              });
            }
          } catch (e) {
            console.error("[local-bot] photo handler", e);
            await tgSafe("sendMessage", {
              chat_id: chatId,
              text: `Не удалось сохранить фото: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
          continue;
        }

        const text = msg?.text?.trim();
        if (!text) continue;
        console.log("[local-bot] text", text);

        if (/^\/(menu|start)(@\w+)?\b/.test(text)) {
          await sendStudioMenu(chatId);
          continue;
        }

        try {
          const manual = await handleManualText(chatId, text);
          if (manual.handled) {
            if (manual.triggerTick) void kickTick();
            continue;
          }
          const reply = await handleTelegramCommand(text);
          if (reply) {
            await tgSafe("sendMessage", { chat_id: chatId, text: reply.slice(0, 3500) });
          } else if (!/^\/\w/.test(text)) {
            await tgSafe("sendMessage", {
              chat_id: chatId,
              text:
                "Не понял сообщение. Отправьте /menu и начните с «🎨 Создать комплект» — порядок: фото → кличка → стиль.",
            });
          }
        } catch (e) {
          console.error("[local-bot] text handler", e);
          await tgSafe("sendMessage", {
            chat_id: chatId,
            text: `Ошибка: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    } catch (e) {
      console.error("[local-bot] loop", e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
