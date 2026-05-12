import "server-only";

import { timingSafeEqual } from "node:crypto";

import { getEnvRaw } from "@/lib/studio/runtime-env";

/** Убирает типичные артефакты из .env: кавычки, BOM, пробелы по краям. */
function normalizeEnvPassword(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  let s = raw.replace(/^\uFEFF/, "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s || undefined;
}

/** То, что вводит человек в форму: BOM, лишние пробелы по краям. */
function normalizeSubmittedPassword(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim();
}

export function getStudioAdminPassword(): string | undefined {
  return normalizeEnvPassword(getEnvRaw("STUDIO_ADMIN_PASSWORD"));
}

export function isStudioAuthConfigured(): boolean {
  return Boolean(getStudioAdminPassword());
}

export function verifyStudioAdminPassword(submitted: string): boolean {
  const expected = getStudioAdminPassword();
  if (!expected) return false;
  const a = Buffer.from(normalizeSubmittedPassword(submitted), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
