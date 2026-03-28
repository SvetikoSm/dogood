import { NextResponse } from "next/server";

import { saveOrderSubmission } from "@/lib/save-order-submission";

/**
 * Принимает multipart/form-data из формы заказа.
 * Сохраняет metadata.json и файлы в `data/order-submissions/<orderId>/`.
 *
 * Локально: откройте папку `data/order-submissions` после отправки формы.
 * Netlify Functions: диск эфемерный — для продакшена лучше S3/R2, Supabase Storage
 * или вебхук в CRM; при неудачной записи на диск ответ всё равно 200, но в JSON будет warning.
 */
export async function POST(request: Request) {
  const formData = await request.formData();

  const summary: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (value instanceof File) {
      summary[key] = `File(${value.name}, ${value.size} bytes)`;
    } else {
      summary[key] = String(value);
    }
  });

  const saved = await saveOrderSubmission(formData);

  console.log("[api/order]", saved.orderId, saved.savedToDisk ? "saved" : "not saved", summary);

  return NextResponse.json({
    ok: true,
    orderId: saved.orderId,
    savedToDisk: saved.savedToDisk,
    submissionDir: saved.submissionDir,
    ...(saved.error ? { warning: "disk_save_failed", detail: saved.error } : {}),
    received: Object.keys(summary),
  });
}
