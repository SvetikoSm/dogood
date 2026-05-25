/**
 * HEIC/HEIF с телефонов часто не декодируются в canvas / <img> без конвертации.
 * Динамический импорт, чтобы не тянуть тяжёлый бандл на первый экран.
 */

export function looksLikeHeic(file: File): boolean {
  const base = file.name.split("?")[0] ?? file.name;
  return (
    /image\/hei[cf]/i.test(file.type) ||
    /\.hei[cf]$/i.test(base)
  );
}

/** ISO BMFF «ftyp»: на iOS часто пустой MIME, но внутри всё равно HEIF. */
export async function isLikelyHeifContainer(file: File): Promise<boolean> {
  if (looksLikeHeic(file)) return true;
  if (file.type && !file.type.startsWith("image/")) return false;
  try {
    const buf = await file.slice(0, 16).arrayBuffer();
    const b = new Uint8Array(buf);
    if (b.length < 12) return false;
    const tag = String.fromCharCode(b[4]!, b[5]!, b[6]!, b[7]!);
    if (tag !== "ftyp") return false;
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    return /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/i.test(brand);
  } catch {
    return false;
  }
}

export async function tryHeic2anyToJpegFile(file: File): Promise<File | null> {
  try {
    const { default: heic2any } = await import("heic2any");
    const out = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.65,
    });
    const blob = Array.isArray(out) ? out[0] : out;
    if (!blob) return null;
    const name =
      file.name.replace(/\.[^.]+$/i, ".jpg") || "photo.jpg";
    return new File([blob], name, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return null;
  }
}

/** Safari / новый Edge иногда декодируют HEIC через createImageBitmap + canvas. */
export async function tryRasterizeToJpegFile(
  file: File,
  quality = 0.82,
): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
      );
      if (!blob || blob.size === 0) return null;
      const name = file.name.replace(/\.[^.]+$/i, ".jpg") || "photo.jpg";
      return new File([blob], name, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

export const HEIC_UPLOAD_HELP =
  "Не удалось прочитать фото в формате HEIC (часто с iPhone). В «Фото» откройте снимок → Поделиться → «Сохранить как JPEG» или выберите другое фото (JPG/PNG).";

export async function convertHeicToJpegIfNeeded(file: File): Promise<File> {
  const should =
    looksLikeHeic(file) || (await isLikelyHeifContainer(file));
  if (!should) return file;

  const viaLib = await tryHeic2anyToJpegFile(file);
  if (viaLib) return viaLib;

  const viaCanvas = await tryRasterizeToJpegFile(file);
  if (viaCanvas) return viaCanvas;

  /* Браузер не смог — отправляем HEIC как есть; сервер (heic-convert) переведёт в JPEG. */
  return file;
}
