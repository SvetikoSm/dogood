import { NextResponse } from "next/server";

import { processNextOrderInQueue } from "@/lib/ops/process-queue";

/**
 * Вызов из Google Apps Script после новой строки заказа.
 * Тело: { "secret": "<OPS_WEBHOOK_SECRET>", "orderId": "hvostik…", "event": "new_order" }
 */
export async function POST(request: Request) {
  const expected = process.env.OPS_WEBHOOK_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ ok: false, error: "webhook not configured" }, { status: 501 });
  }

  let body: { secret?: string; orderId?: string; event?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (body.secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await processNextOrderInQueue({
    orderId: body.orderId?.trim() || undefined,
  });
  return NextResponse.json({
    ok: true,
    processed: result.processed,
    orderId: result.orderId,
    detail: result.detail,
  });
}
