import type { TrackedOrder } from "@/lib/order-tracking-types";

export type GoogleWebhookFilePart = {
  field: string;
  originalName: string;
  mimeType: string;
  dataBase64: string;
};

type ForwardResult = { ok: true } | { ok: false; error: string };

/**
 * Отправляет JSON в развёрнутый Google Apps Script (веб-приложение).
 * Скрипт сам пишет строку в таблицу и складывает файлы в папку на Google Диске.
 * Обычную Google Form с сайта так не заполнить — вложения туда не POST'ятся.
 */
export async function forwardOrderToGoogleWebhook(opts: {
  webhookUrl: string;
  secret: string;
  order: TrackedOrder;
  files: GoogleWebhookFilePart[];
}): Promise<ForwardResult> {
  const { webhookUrl, secret, order, files } = opts;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, order, files }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
    }
    try {
      const json = JSON.parse(text) as { ok?: boolean; error?: string };
      if (json.ok === false) {
        return { ok: false, error: json.error ?? "webhook rejected" };
      }
    } catch {
      /* пустой или не-JSON ответ — считаем успехом при 2xx */
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
