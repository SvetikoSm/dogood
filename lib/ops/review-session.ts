import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

export const REVIEW_SESSION_COOKIE = "dogood_review_session";

function getSigningSecret(): string | undefined {
  return (
    process.env.REVIEW_SESSION_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    undefined
  );
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/** Подписанная cookie: exp (unix s), без хранения state на сервере (подходит для serverless). */
export function createReviewSessionValue(ttlSeconds: number): string | null {
  const secret = getSigningSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadB64 = Buffer.from(JSON.stringify({ exp }), "utf8").toString(
    "base64url",
  );
  const sig = signPayload(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export function verifyReviewSessionValue(token: string | undefined): boolean {
  if (!token) return false;
  const secret = getSigningSecret();
  if (!secret) return false;
  const i = token.lastIndexOf(".");
  if (i <= 0) return false;
  const payloadB64 = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = signPayload(payloadB64, secret);
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  try {
    const json = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as { exp?: number };
    if (typeof json.exp !== "number") return false;
    return json.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function isReviewAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  return verifyReviewSessionValue(jar.get(REVIEW_SESSION_COOKIE)?.value);
}
