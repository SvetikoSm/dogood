import { convertHeicToJpegIfNeeded } from "@/lib/heic-to-jpeg-client";

/**
 * Сжатие фото в браузере перед отправкой на API (лимит тела на Netlify ~6 MB).
 * Качество умеренное — для макета и печати достаточно, вес меньше.
 */
const MAX_EDGE_PX = 1200;
const JPEG_QUALITY = 0.68;
/** Ниже этого размера не перекодируем (уже лёгкие файлы) */
const SKIP_BELOW_BYTES = 220_000;

export async function compressImageForUpload(file: File): Promise<File> {
  const decoded = await convertHeicToJpegIfNeeded(file);
  if (!decoded.type.startsWith("image/")) return decoded;
  if (decoded.size <= SKIP_BELOW_BYTES) return decoded;

  try {
    const bitmap = await createImageBitmap(decoded);
    try {
      const { width, height } = bitmap;
      const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return decoded;
      ctx.drawImage(bitmap, 0, 0, w, h);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY),
      );
      if (!blob) return decoded;
      if (blob.size >= decoded.size) return decoded;

      const baseName = (decoded.name || "photo").replace(/\.[^.]+$/, "");
      return new File([blob], `${baseName}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } finally {
      bitmap.close();
    }
  } catch {
    return decoded;
  }
}

/** Суммарный лимит до отправки (чуть ниже лимита Netlify на тело запроса). */
export const MAX_ORDER_UPLOAD_BYTES = 5 * 1024 * 1024;
