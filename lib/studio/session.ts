import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { getEnvRaw } from "@/lib/studio/runtime-env";

export const STUDIO_SESSION_COOKIE = "dogood_studio_session";

function getSigningSecret(): string | undefined {
  return (
    getEnvRaw("STUDIO_SESSION_SECRET")?.trim() ||
    getEnvRaw("REVIEW_SESSION_SECRET")?.trim() ||
    getEnvRaw("CRON_SECRET")?.trim() ||
    undefined
  );
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createStudioSessionValue(ttlSeconds: number): string | null {
  const secret = getSigningSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadB64 = Buffer.from(JSON.stringify({ exp }), "utf8").toString("base64url");
  const sig = signPayload(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export function verifyStudioSessionValue(token: string | undefined): boolean {
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

export async function isStudioAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  return verifyStudioSessionValue(jar.get(STUDIO_SESSION_COOKIE)?.value);
}

export function isStudioSessionConfigured(): boolean {
  return Boolean(getSigningSecret());
}
