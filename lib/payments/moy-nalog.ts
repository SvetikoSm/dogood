import "server-only";

import { randomUUID } from "node:crypto";

import { isStudioMockMode } from "@/lib/studio/env";
import { getEnvRaw } from "@/lib/studio/runtime-env";

/**
 * «Мой налог» (lknpd.nalog.ru) — регистрация дохода самозанятого и выдача
 * ссылки на чек после каждой успешной оплаты ЮKassa. API неофициальное (то
 * же, что использует веб-кабинет), поэтому все ошибки здесь мягкие: сбой
 * регистрации чека никогда не должен ломать платёжный поток.
 */

const API_BASE = "https://lknpd.nalog.ru/api/v1";

/**
 * Two auth options, either works:
 *   1. MOY_NALOG_REFRESH_TOKEN (+ MOY_NALOG_DEVICE_ID) — долгоживущий токен,
 *      полученный одноразовым входом по СМС (scripts/moy-nalog-sms-login.mjs).
 *      Пароль нигде не хранится.
 *   2. MOY_NALOG_PASSWORD — пароль от lknpd.nalog.ru.
 */
export function isMoyNalogEnabled(): boolean {
  return Boolean(
    getEnvRaw("MOY_NALOG_INN")?.trim() &&
      (getEnvRaw("MOY_NALOG_REFRESH_TOKEN")?.trim() || getEnvRaw("MOY_NALOG_PASSWORD")?.trim()),
  );
}

/* ---------------- auth: token cached in-process, re-auth on 401 ---------------- */

// The VPS app is a single long-lived Node process, so an in-memory cache is
// enough; a restart simply re-authenticates on the next receipt.
let cachedToken = "";
let cachedRefreshToken = "";
let tokenExpiresAt = 0;

// The refresh token is bound to the device id it was issued for, so when the
// token comes from the SMS-login script we must reuse that same device id.
const deviceInfo = {
  sourceDeviceId:
    getEnvRaw("MOY_NALOG_DEVICE_ID")?.trim() || randomUUID().replace(/-/g, "").slice(0, 21),
  sourceType: "WEB",
  appVersion: "1.0.0",
  metaDetails: {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  },
};

type AuthResponse = {
  token?: string;
  refreshToken?: string;
  tokenExpireIn?: string;
};

function rememberAuth(a: AuthResponse): boolean {
  if (!a.token) return false;
  cachedToken = a.token;
  if (a.refreshToken) cachedRefreshToken = a.refreshToken;
  // Fall back to 5 minutes if the API didn't say; refresh 60s before expiry.
  const expMs = a.tokenExpireIn ? Date.parse(a.tokenExpireIn) : Date.now() + 5 * 60_000;
  tokenExpiresAt = (Number.isFinite(expMs) ? expMs : Date.now() + 5 * 60_000) - 60_000;
  return true;
}

async function authWithPassword(): Promise<{ ok: true } | { ok: false; error: string }> {
  const inn = getEnvRaw("MOY_NALOG_INN")?.trim() ?? "";
  const password = getEnvRaw("MOY_NALOG_PASSWORD")?.trim() ?? "";
  try {
    const res = await fetch(`${API_BASE}/auth/lkfl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: inn, password, deviceInfo }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `auth HTTP ${res.status}: ${text.slice(0, 300)}` };
    if (!rememberAuth(JSON.parse(text) as AuthResponse)) {
      return { ok: false, error: "auth response had no token" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function refreshAuth(): Promise<boolean> {
  if (!cachedRefreshToken) cachedRefreshToken = getEnvRaw("MOY_NALOG_REFRESH_TOKEN")?.trim() ?? "";
  if (!cachedRefreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceInfo, refreshToken: cachedRefreshToken }),
    });
    if (!res.ok) return false;
    return rememberAuth((await res.json()) as AuthResponse);
  } catch {
    return false;
  }
}

async function getToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (cachedToken && Date.now() < tokenExpiresAt) return { ok: true, token: cachedToken };
  if (await refreshAuth()) return { ok: true, token: cachedToken };
  if (!getEnvRaw("MOY_NALOG_PASSWORD")?.trim()) {
    return {
      ok: false,
      error:
        "refresh-токен не сработал, а пароль не задан — выполните вход заново: node scripts/moy-nalog-sms-login.mjs",
    };
  }
  const r = await authWithPassword();
  if (!r.ok) return r;
  return { ok: true, token: cachedToken };
}

/* ---------------- income registration ---------------- */

/** Moscow-time ISO string with explicit offset, the format the API expects. */
function nowWithOffset(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  // Server timezone may be UTC; compute the local offset actually in effect.
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export type RegisterIncomeInput = {
  amountRub: number;
  /** Line shown on the receipt, e.g. «Футболка DoGood — Бублик» */
  description: string;
};

/**
 * Register a sale to a private individual and return the public receipt URL.
 * Under STUDIO_MOCK_AI returns a fake URL without touching the real API.
 */
export async function registerFairIncome(
  input: RegisterIncomeInput,
): Promise<{ ok: true; receiptUrl: string } | { ok: false; error: string }> {
  if (isStudioMockMode()) {
    const url = `https://lknpd.nalog.ru/api/v1/receipt/000000000000/mock-${randomUUID().slice(0, 8)}/print`;
    console.log(`[moy-nalog mock] registered income ${input.amountRub}₽ → ${url}`);
    return { ok: true, receiptUrl: url };
  }
  if (!isMoyNalogEnabled()) return { ok: false, error: "moy-nalog disabled (no INN/password)" };

  const auth = await getToken();
  if (!auth.ok) return { ok: false, error: `Мой налог: ${auth.error}` };

  const time = nowWithOffset();
  const body = {
    operationTime: time,
    requestTime: time,
    paymentType: "CASH",
    ignoreMaxTotalIncomeRestriction: false,
    client: { contactPhone: null, displayName: null, inn: null, incomeType: "FROM_INDIVIDUAL" },
    services: [{ name: input.description.slice(0, 128), amount: input.amountRub, quantity: 1 }],
    totalAmount: String(input.amountRub),
  };

  const post = async (token: string) =>
    fetch(`${API_BASE}/income`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  try {
    let res = await post(auth.token);
    if (res.status === 401) {
      // Token invalidated server-side (e.g. logged in elsewhere) — one clean re-auth.
      cachedToken = "";
      const re = await getToken();
      if (!re.ok) return { ok: false, error: `Мой налог: ${re.error}` };
      res = await post(re.token);
    }
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `Мой налог HTTP ${res.status}: ${text.slice(0, 300)}` };
    const uuid = (JSON.parse(text) as { approvedReceiptUuid?: string }).approvedReceiptUuid;
    if (!uuid) return { ok: false, error: "Мой налог: ответ без approvedReceiptUuid" };
    const inn = getEnvRaw("MOY_NALOG_INN")?.trim() ?? "";
    return { ok: true, receiptUrl: `${API_BASE}/receipt/${inn}/${uuid}/print` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
