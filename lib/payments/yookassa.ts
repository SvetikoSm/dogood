import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, gte } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
import { isStudioMockMode } from "@/lib/studio/env";
import { getEnvRaw } from "@/lib/studio/runtime-env";

const API_BASE = "https://api.yookassa.ru/v3";

/** In-process only — used by STUDIO_MOCK_AI dry runs to fake payment state without hitting the real API. */
const mockPayments = new Map<string, YookassaPayment>();

/** Test-only: flips a mock payment to "succeeded" so a dry-run script can drive the webhook/poll path. */
export function __mockMarkPaymentSucceeded(paymentId: string): void {
  const p = mockPayments.get(paymentId);
  if (p) p.status = "succeeded";
}

export function isYookassaEnabled(): boolean {
  return Boolean(
    getEnvRaw("YOOKASSA_SHOP_ID")?.trim() &&
      getEnvRaw("YOOKASSA_SECRET_KEY")?.trim() &&
      getEnvRaw("YOOKASSA_ENABLED")?.trim() === "true",
  );
}

function authHeader(): string {
  const shopId = getEnvRaw("YOOKASSA_SHOP_ID")?.trim() ?? "";
  const secret = getEnvRaw("YOOKASSA_SECRET_KEY")?.trim() ?? "";
  return `Basic ${Buffer.from(`${shopId}:${secret}`).toString("base64")}`;
}

export type YookassaPayment = {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  confirmation?: { confirmation_url?: string };
};

export type CreatePaymentInput = {
  amountRub: number;
  description: string;
  /** Arbitrary metadata echoed back on the payment object (max ~16 keys, ~512 bytes total per YooKassa). */
  metadata: Record<string, string>;
  email?: string;
};

/** Checkout API payment creation — no SDK, plain fetch. Under STUDIO_MOCK_AI, fakes the payment in-process. */
export async function createPayment(
  input: CreatePaymentInput,
): Promise<{ ok: true; payment: YookassaPayment } | { ok: false; error: string }> {
  if (isStudioMockMode()) {
    const payment: YookassaPayment = {
      id: `mock_${randomUUID()}`,
      status: "pending",
      confirmation: { confirmation_url: "https://example.invalid/mock-pay" },
    };
    mockPayments.set(payment.id, payment);
    console.log(`[yookassa mock] created payment ${payment.id} for ${input.amountRub}₽`);
    return { ok: true, payment };
  }
  if (!isYookassaEnabled()) return { ok: false, error: "yookassa disabled" };
  const botUsername = getEnvRaw("TELEGRAM_CLIENT_BOT_USERNAME")?.trim();
  const returnUrl = botUsername ? `https://t.me/${botUsername}` : "https://dogood-brand.ru";

  const body: Record<string, unknown> = {
    amount: { value: input.amountRub.toFixed(2), currency: "RUB" },
    capture: true,
    confirmation: { type: "redirect", return_url: returnUrl },
    description: input.description.slice(0, 128),
    metadata: input.metadata,
  };

  if (getEnvRaw("FAIR_SEND_RECEIPT")?.trim() === "true" && input.email) {
    body.receipt = {
      customer: { email: input.email },
      items: [
        {
          description: input.description.slice(0, 128),
          quantity: "1.00",
          amount: { value: input.amountRub.toFixed(2), currency: "RUB" },
          vat_code: Number(getEnvRaw("FAIR_VAT_CODE")?.trim() ?? "1"),
          payment_mode: "full_prepayment",
          payment_subject: "commodity",
        },
      ],
    };
  }

  try {
    const res = await fetch(`${API_BASE}/payments`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Idempotence-Key": randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `YooKassa HTTP ${res.status}: ${text.slice(0, 400)}` };
    const payment = JSON.parse(text) as YookassaPayment;
    return { ok: true, payment };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getPayment(
  paymentId: string,
): Promise<{ ok: true; payment: YookassaPayment } | { ok: false; error: string }> {
  if (isStudioMockMode()) {
    const payment = mockPayments.get(paymentId);
    if (!payment) return { ok: false, error: "mock payment not found" };
    return { ok: true, payment };
  }
  if (!isYookassaEnabled()) return { ok: false, error: "yookassa disabled" };
  try {
    const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: authHeader() },
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `YooKassa HTTP ${res.status}: ${text.slice(0, 400)}` };
    const payment = JSON.parse(text) as YookassaPayment;
    return { ok: true, payment };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fallback for missed/unregistered webhooks: re-check every fair order still
 * marked "pending" (bounded to the last 6h so a stale draft doesn't get
 * polled forever) and confirm any that actually succeeded. Called at the
 * start of every cron tick. Dynamic import of fair-flow avoids a require
 * cycle (fair-flow calls createPayment from this module).
 */
export async function pollPendingFairPayments(): Promise<number> {
  if (!isStudioMockMode() && !isYookassaEnabled()) return 0;
  const db = getStudioDb();
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(schema.studioFairOrders)
    .where(
      and(eq(schema.studioFairOrders.paymentStatus, "pending"), gte(schema.studioFairOrders.updatedAt, cutoff)),
    );
  if (!rows.length) return 0;

  const { onFairPaymentSucceeded } = await import("@/lib/studio/telegram/fair-flow");
  let confirmed = 0;
  for (const row of rows) {
    if (!row.paymentId) continue;
    const r = await getPayment(row.paymentId);
    if (r.ok && r.payment.status === "succeeded") {
      await onFairPaymentSucceeded(row.id);
      confirmed += 1;
    }
  }
  return confirmed;
}
