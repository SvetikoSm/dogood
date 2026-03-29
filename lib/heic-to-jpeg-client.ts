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

export async function convertHeicToJpegIfNeeded(file: File): Promise<File> {
  const should =
    looksLikeHeic(file) || (await isLikelyHeifContainer(file));
  if (!should) return file;
  return (await tryHeic2anyToJpegFile(file)) ?? file;
}
