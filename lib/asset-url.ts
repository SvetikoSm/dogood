/** Версия статики (?v=…) — сбрасывает битый кэш Safari/Cloudflare без Purge Everything. */
const BUST =
  process.env.NEXT_PUBLIC_CACHE_BUST_ID?.trim() ||
  process.env.CACHE_BUST_ID?.trim() ||
  "";

export function assetUrl(path: string): string {
  if (!path || !BUST) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const sep = normalized.includes("?") ? "&" : "?";
  return `${normalized}${sep}v=${encodeURIComponent(BUST)}`;
}
