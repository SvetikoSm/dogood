import { NextResponse } from "next/server";

import { forwardOrderToGoogleWebhook } from "@/lib/forward-order-to-google";
import { saveOrderSubmission } from "@/lib/save-order-submission";

export const maxDuration = 120;

/**
 * Принимает multipart/form-data из формы заказа.
 * Сохраняет `order.json` и файлы в `data/order-submissions/<orderId>/uploads/`.
 *
 * Если заданы `GOOGLE_ORDER_WEBHOOK_URL` и `GOOGLE_ORDER_WEBHOOK_SECRET`, после сохранения
 * отправляет тот же заказ в Google Apps Script (строка в Таблице + файлы на Диск).
 * Обычную Google Form с сайта так не подключить — файлы туда не уходят; нужен скрипт из `scripts/`.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, detail: message },
      { status: 413 },
    );
  }

  const summary: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (value instanceof File) {
      summary[key] = `File(${value.name}, ${value.size} bytes)`;
    } else {
      summary[key] = String(value);
    }
  });

  const webhookUrl = process.env.GOOGLE_ORDER_WEBHOOK_URL?.trim();
  const webhookSecret = process.env.GOOGLE_ORDER_WEBHOOK_SECRET?.trim() ?? "";
  const includeWebhookPayload = Boolean(webhookUrl && webhookSecret);

  const saved = await saveOrderSubmission(formData, {
    includeWebhookPayload,
  });
  const filesPreparedForGoogle = saved.googleWebhookPayload?.files.length ?? 0;
  const pendingFilesCount = saved.diagnostics?.pendingFilesCount ?? 0;
  const pendingTotalBytes = saved.diagnostics?.pendingTotalBytes ?? 0;

  let googleWebhookStatus: "skipped" | "ok" | "error" = "skipped";
  let googleWebhookError: string | undefined;

  /* Вебхук не привязываем к savedToDisk: на Netlify запись в data/ часто недоступна,
   * но заказ и файлы уже собраны в памяти (googleWebhookPayload). */
  if (includeWebhookPayload && saved.googleWebhookPayload && webhookUrl) {
    const fwd = await forwardOrderToGoogleWebhook({
      webhookUrl,
      secret: webhookSecret,
      order: saved.googleWebhookPayload.order,
      files: saved.googleWebhookPayload.files,
    });
    googleWebhookStatus = fwd.ok ? "ok" : "error";
    if (!fwd.ok) googleWebhookError = fwd.error;
    if (!fwd.ok) {
      console.error("[api/order] google webhook failed:", fwd.error);
    }
  }

  console.log(
    "[api/order]",
    saved.orderId,
    saved.savedToDisk ? "saved" : "not saved",
    googleWebhookStatus,
    `pendingFiles:${pendingFilesCount}`,
    `pendingBytes:${pendingTotalBytes}`,
    `googleFiles:${filesPreparedForGoogle}`,
    summary,
  );

  return NextResponse.json({
    ok: true,
    orderId: saved.orderId,
    savedToDisk: saved.savedToDisk,
    submissionDir: saved.submissionDir,
    googleWebhook: googleWebhookStatus,
    pendingFilesCount,
    pendingTotalBytes,
    filesPreparedForGoogle,
    ...(googleWebhookError ? { googleWebhookError } : {}),
    ...(saved.error ? { warning: "disk_save_failed", detail: saved.error } : {}),
    received: Object.keys(summary),
  });
}
