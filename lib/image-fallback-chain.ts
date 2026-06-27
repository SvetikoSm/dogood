/** Запасные URL, если webp не декодировался (Safari, обрыв загрузки). */
export function imageFallbackChain(src: string): string[] {
  const m = src.match(/^(.+)\.(webp|jpe?g|png)$/i);
  if (!m) return [];
  const base = m[1]!;
  const ext = m[2]!.toLowerCase().replace("jpeg", "jpg");
  const out: string[] = [];
  if (ext !== "jpg") out.push(`${base}.jpg`, `${base}.jpeg`);
  if (ext !== "png") out.push(`${base}.png`);
  return out;
}
