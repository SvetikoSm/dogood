import { timingSafeEqual } from "node:crypto";

/**
 * MVP: один пароль из env для доступа к review-панели.
 * Позже сюда же можно добавить проверку Google OAuth / session cookie, не меняя вызовы бизнес-логики.
 */
export function getReviewAdminPassword(): string | undefined {
  return process.env.REVIEW_ADMIN_PASSWORD?.trim() || undefined;
}

export function isReviewAuthConfigured(): boolean {
  return Boolean(getReviewAdminPassword());
}

export function verifyReviewAdminPassword(submitted: string): boolean {
  const expected = getReviewAdminPassword();
  if (!expected) return false;
  return safeEqualStrings(submitted.trim(), expected);
}

function safeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
