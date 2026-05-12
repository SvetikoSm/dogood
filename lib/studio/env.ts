import "server-only";

import { getEnvRaw } from "@/lib/studio/runtime-env";

export function isStudioMockMode(): boolean {
  const v = getEnvRaw("STUDIO_MOCK_AI")?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getStudioLlmModel(): string {
  return (
    getEnvRaw("STUDIO_LLM_MODEL")?.trim() ||
    "google/gemini-2.5-flash-preview-05-20"
  );
}

export function getStudioImageModel(): string {
  return getEnvRaw("STUDIO_IMAGE_MODEL")?.trim() || "";
}

export function getStudioImageHttpUrl(): string | undefined {
  const u = getEnvRaw("STUDIO_IMAGE_HTTP_URL")?.trim();
  return u || undefined;
}
