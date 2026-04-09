import type { TrackedOrder } from "@/lib/order-tracking-types";

export type GoogleWebhookFilePart = {
  field: string;
  originalName: string;
  mimeType: string;
  dataBase64: string;
};

type ForwardResult = { ok: true } | { ok: false; error: string };
type WebhookJson = { ok?: boolean; error?: string; fileCount?: number };

/**
 * Отправляет JSON в развёрнутый Google Apps Script (веб-приложение).
 * Скрипт сам пишет строку в таблицу и складывает файлы в папку на Google Диске.
 * Обычную Google Form с сайта так не заполнить — вложения туда не POST'ятся.
 */
const WEBHOOK_TIMEOUT_MS = 90_000;

export async function forwardOrderToGoogleWebhook(opts: {
  webhookUrl: string;
  secret: string;
  order: TrackedOrder;
  files: GoogleWebhookFilePart[];
}): Promise<ForwardResult> {
  const { webhookUrl, secret, order, files } = opts;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, order, files }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
    }
    let parsed: WebhookJson | null = null;
    try {
      parsed = JSON.parse(text) as WebhookJson;
      if (parsed.ok === false) {
        return { ok: false, error: parsed.error ?? "webhook rejected" };
      }
    } catch {
      /* пустой или не-JSON ответ — считаем успехом при 2xx */
    }
    if (
      files.length > 0 &&
      parsed &&
      typeof parsed.fileCount === "number" &&
      parsed.fileCount === 0
    ) {
      return {
        ok: false,
        error:
          "Google webhook вернул fileCount=0 при отправленных файлах. Проверьте deployment Apps Script и WEBHOOK URL.",
      };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "The user aborted a request." || message.includes("abort")) {
      return {
        ok: false,
        error: `Превышено время ожидания ответа Google (${WEBHOOK_TIMEOUT_MS / 1000} с). Попробуйте меньше фото или повторите позже.`,
      };
    }
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
