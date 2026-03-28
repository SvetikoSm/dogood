import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SUBMISSIONS_ROOT = path.join(process.cwd(), "data", "order-submissions");

export type SavedOrderResult = {
  orderId: string;
  savedToDisk: boolean;
  /** Локальный папка заявки (если сохранили на диск) */
  submissionDir?: string;
  error?: string;
};

/**
 * Сохраняет заявку: metadata.json + файлы в uploads/.
 * Работает на локальной машине и на VPS с записываемым диском.
 * На Netlify/Vercel serverless файловая система эфемерная — запись может не сохраниться между вызовами;
 * тогда смотрите логи и подключите БД / S3 / вебхук (см. комментарий в route).
 */
export async function saveOrderSubmission(
  formData: FormData,
): Promise<SavedOrderResult> {
  const orderId = randomUUID();
  const submissionDir = path.join(SUBMISSIONS_ROOT, orderId);
  const uploadsDir = path.join(submissionDir, "uploads");

  const fields: Record<string, string | string[]> = {};
  const filesMeta: Array<{
    field: string;
    savedAs: string;
    originalName: string;
    size: number;
    type: string;
  }> = [];

  try {
    await mkdir(uploadsDir, { recursive: true });

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        if (value.size === 0) continue;
        const buf = Buffer.from(await value.arrayBuffer());
        const safeOriginal = (value.name || "file").replace(/[^\w.\-()]/g, "_");
        const savedAs = `${filesMeta.length}_${key.replace(/[^\w[\].-]/g, "_")}_${safeOriginal}`;
        await writeFile(path.join(uploadsDir, savedAs), buf);
        filesMeta.push({
          field: key,
          savedAs,
          originalName: value.name,
          size: value.size,
          type: value.type || "application/octet-stream",
        });
        continue;
      }

      const s = String(value);
      const existing = fields[key];
      if (existing === undefined) {
        fields[key] = s;
      } else if (Array.isArray(existing)) {
        existing.push(s);
      } else {
        fields[key] = [existing, s];
      }
    }

    const metadata = {
      orderId,
      createdAt: new Date().toISOString(),
      fields,
      files: filesMeta,
    };

    await writeFile(
      path.join(submissionDir, "metadata.json"),
      JSON.stringify(metadata, null, 2),
      "utf-8",
    );

    return { orderId, savedToDisk: true, submissionDir };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[saveOrderSubmission]", message);
    return {
      orderId,
      savedToDisk: false,
      error: message,
    };
  }
}
