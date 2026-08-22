import { NextResponse } from "next/server";

import { getPayment } from "@/lib/payments/yookassa";
import { ensureStudioSchema } from "@/lib/studio/db/ensure-schema";
import { getFairOrderByPaymentId, onFairPaymentSucceeded } from "@/lib/studio/telegram/fair-flow";

/**
 * YooKassa HTTP notification. The request body is untrusted — always
 * re-fetch the payment by id and act on the real status, never on what the
 * webhook body claims. Ack fast; YooKassa retries on timeout/non-2xx.
 */
async function processNotification(objectId: string | undefined) {
  if (!objectId) return;
  await ensureStudioSchema();

  const r = await getPayment(objectId);
  if (!r.ok || r.payment.status !== "succeeded") return;

  const fair = await getFairOrderByPaymentId(objectId);
  if (!fair) return;

  await onFairPaymentSucceeded(fair.id).catch((e) =>
    console.error("[yookassa webhook] onFairPaymentSucceeded", e),
  );
}

export async function POST(req: Request) {
  let body: { event?: string; object?: { id?: string } };
  try {
    body = (await req.json()) as { event?: string; object?: { id?: string } };
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  void processNotification(body.object?.id).catch((e) =>
    console.error("[yookassa webhook] process", e),
  );

  return NextResponse.json({ ok: true });
}
