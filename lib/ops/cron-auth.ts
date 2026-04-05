import { timingSafeEqual } from "node:crypto";

/**
 * Защита HTTP-endpoints для внешнего scheduler (cron/ping).
 * Передавайте секрет заголовком, не в query (чтобы не светился в логах прокси).
 *
 * Поддержка:
 * - `Authorization: Bearer <CRON_SECRET>`
 * - `x-cron-secret: <CRON_SECRET>` (если провайдер не умеет кастомный Authorization)
 */
export function getCronSecret(): string | undefined {
  return process.env.CRON_SECRET?.trim() || undefined;
}

export function verifyCronRequest(request: Request): boolean {
  const expected = getCronSecret();
  if (!expected) return false;

  const auth = request.headers.get("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) {
      const token = m[1]!.trim();
      if (safeEqualStrings(token, expected)) return true;
    }
  }

  const header = request.headers.get("x-cron-secret");
  if (header && safeEqualStrings(header.trim(), expected)) return true;

  return false;
}

function safeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
