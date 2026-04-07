import { convertHeicToJpegIfNeeded } from "@/lib/heic-to-jpeg-client";

/**
 * Сжатие фото в браузере перед отправкой на API (лимит тела на Netlify ~6 MB).
 * Качество умеренное — для макета и печати достаточно, вес меньше.
 * На узких экранах чуть сильнее даунскейл — быстрее кодирование на телефоне и меньше тело запроса.
 */
const MAX_EDGE_DESKTOP = 1200;
const MAX_EDGE_MOBILE = 900;
const JPEG_QUALITY_DESKTOP = 0.68;
const JPEG_QUALITY_MOBILE = 0.62;
/** Ниже этого размера не перекодируем (уже лёгкие файлы) */
const SKIP_BELOW_BYTES = 220_000;

function resizeTargets(): { maxEdge: number; quality: number } {
  if (typeof window === "undefined") {
    return { maxEdge: MAX_EDGE_DESKTOP, quality: JPEG_QUALITY_DESKTOP };
  }
  const narrow = window.innerWidth < 768;
  return {
    maxEdge: narrow ? MAX_EDGE_MOBILE : MAX_EDGE_DESKTOP,
    quality: narrow ? JPEG_QUALITY_MOBILE : JPEG_QUALITY_DESKTOP,
  };
}

export async function compressImageForUpload(file: File): Promise<File> {
  const decoded = await convertHeicToJpegIfNeeded(file);
  if (!decoded.type.startsWith("image/")) return decoded;
  if (decoded.size <= SKIP_BELOW_BYTES) return decoded;

  const { maxEdge: MAX_EDGE_PX, quality: JPEG_QUALITY } = resizeTargets();

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
