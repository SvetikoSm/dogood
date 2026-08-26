import "server-only";

import { getEnvRaw } from "@/lib/studio/runtime-env";

export function isStudioMockMode(): boolean {
  const v = getEnvRaw("STUDIO_MOCK_AI")?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getStudioLlmModel(): string {
  return getEnvRaw("STUDIO_LLM_MODEL")?.trim() || "google/gemini-2.5-flash";
}

export function getStudioImageModel(): string {
  return getEnvRaw("STUDIO_IMAGE_MODEL")?.trim() || "";
}

export function getStudioImageHttpUrl(): string | undefined {
  const u = getEnvRaw("STUDIO_IMAGE_HTTP_URL")?.trim();
  return u || undefined;
}

/** База OpenRouter API. Прокси нужен там, где провайдер блокирует IP сервера. */
export function getOpenRouterBaseUrl(): string {
  return (getEnvRaw("OPENROUTER_BASE_URL")?.trim() || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}

/** Общий секрет для собственного прокси (пусто = прокси без авторизации/не используется). */
export function getOpenRouterProxySecret(): string {
  return getEnvRaw("OPENROUTER_PROXY_SECRET")?.trim() || "";
}
