/**
 * Сжатие фото в браузере перед отправкой на API (лимит тела на Netlify ~6 MB).
 * Вызывать только из клиентских компонентов.
 */
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;
/** Не трогаем уже небольшие файлы */
const SKIP_BELOW_BYTES = 350_000;

export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height } = bitmap;
      const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY),
      );
      if (!blob) return file;
      if (blob.size >= file.size) return file;

      const baseName = (file.name || "photo").replace(/\.[^.]+$/, "");
      return new File([blob], `${baseName}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

/** Суммарный лимит до отправки (чуть ниже лимита Netlify на тело запроса). */
export const MAX_ORDER_UPLOAD_BYTES = 5 * 1024 * 1024;
