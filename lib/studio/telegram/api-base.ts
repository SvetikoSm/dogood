import "server-only";

import { getEnvRaw } from "@/lib/studio/runtime-env";

/**
 * Base URL for Telegram Bot API.
 * Default: https://api.telegram.org
 * Override with TELEGRAM_API_BASE when routing via Cloudflare Worker proxy
 * (workers/telegram-api-proxy) — needed when the VPS cannot reach Telegram
 * directly. No trailing slash.
 */
export function telegramApiBase(): string {
  const raw = getEnvRaw("TELEGRAM_API_BASE")?.trim() || "https://api.telegram.org";
  return raw.replace(/\/+$/, "");
}

/** Optional HTTP(S) proxy for curl→Telegram (Cloudflare WARP local proxy). */
export function telegramHttpsProxy(): string | undefined {
  const p = getEnvRaw("TELEGRAM_HTTPS_PROXY")?.trim();
  return p || undefined;
}
