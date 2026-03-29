/**
 * HEIC/HEIF с телефонов часто не декодируются в canvas / <img> без конвертации.
 * Динамический импорт, чтобы не тянуть wasm в первый бандл страницы.
 */
export function looksLikeHeic(file: File): boolean {
  const base = file.name.split("?")[0] ?? file.name;
  return (
    /image\/hei[cf]/i.test(file.type) ||
    /\.hei[cf]$/i.test(base)
  );
}

export async function convertHeicToJpegIfNeeded(file: File): Promise<File> {
  if (!looksLikeHeic(file)) return file;
  try {
    const { default: heic2any } = await import("heic2any");
    const out = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.7,
    });
    const blob = Array.isArray(out) ? out[0] : out;
    if (!blob) return file;
    const name =
      file.name.replace(/\.[^.]+$/i, ".jpg") || "photo.jpg";
    return new File([blob], name, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
