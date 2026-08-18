import type { TrackedOrder } from "@/lib/order-tracking-types";

export type GoogleWebhookFilePart = {
  field: string;
  originalName: string;
  mimeType: string;
  dataBase64: string;
};

/** Короткий разбор ответа веб-приложения Google (для логов и JSON ответа /api/order). */
export type GoogleWebhookSummary = {
  fileCount?: number;
  filesReceived?: number;
  uploadErrors?: { field?: string; error?: string }[];
  /** Не удалось выставить «доступ по ссылке» — файлы при этом загружены. */
  sharingErrors?: { field?: string; error?: string }[];
  driveError?: string | null;
  duplicateSkipped?: boolean;
  duplicatePhotoMerge?: boolean;
  folderUrl?: string;
};

export type ForwardResult =
  | { ok: true; summary?: GoogleWebhookSummary }
  | { ok: false; error: string };

type WebhookJson = {
  ok?: boolean;
  error?: string;
  fileCount?: number;
  filesReceived?: number;
  uploadErrors?: { field?: string; error?: string }[];
  sharingErrors?: { field?: string; error?: string }[];
  driveError?: string | null;
  duplicateSkipped?: boolean;
  duplicatePhotoMerge?: boolean;
  folderUrl?: string;
};

function summarizeWebhookJson(parsed: WebhookJson | null): GoogleWebhookSummary | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const trimIssues = (list: { field?: string; error?: string }[] | undefined) =>
    list?.length
      ? list.slice(0, 20).map((e) => ({
          field: e.field,
          error: e.error ? String(e.error).slice(0, 400) : "",
        }))
      : undefined;
  const uploadErrors = trimIssues(parsed.uploadErrors);
  const sharingErrors = trimIssues(parsed.sharingErrors);
  return {
    fileCount: typeof parsed.fileCount === "number" ? parsed.fileCount : undefined,
    filesReceived: typeof parsed.filesReceived === "number" ? parsed.filesReceived : undefined,
    uploadErrors,
    sharingErrors,
    driveError: parsed.driveError != null ? String(parsed.driveError).slice(0, 800) : undefined,
    duplicateSkipped: parsed.duplicateSkipped === true,
    duplicatePhotoMerge: parsed.duplicatePhotoMerge === true,
    folderUrl: typeof parsed.folderUrl === "string" ? parsed.folderUrl : undefined,
  };
}

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
    const summary = summarizeWebhookJson(parsed);
    /* Не считаем fileCount=0 ошибкой: строки в Таблице уже могли записаться, а фото — нет;
     * тогда сайт делал fallback без файлов + duplicateSkipped в GAS и фото никогда не догружались. */
    if (
      files.length > 0 &&
      parsed &&
      typeof parsed.fileCount === "number" &&
      parsed.fileCount === 0
    ) {
      const hint: string[] = [];
      if (typeof parsed.filesReceived === "number") {
        hint.push(`filesReceived=${parsed.filesReceived}`);
      }
      if (parsed.uploadErrors?.length) {
        hint.push(`uploadErrors=${JSON.stringify(parsed.uploadErrors).slice(0, 1500)}`);
      }
      if (parsed.driveError) {
        hint.push(`driveError=${String(parsed.driveError).slice(0, 400)}`);
      }
      console.warn(
        "[forwardOrderToGoogleWebhook] Google вернул fileCount=0 при отправленных файлах:",
        files.length,
        hint.length ? hint.join("; ") : "(без деталей)",
      );
    }
    return { ok: true, summary };
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
