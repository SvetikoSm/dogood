import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/ops/cron-auth";
import { processNextOrderInQueue } from "@/lib/ops/process-queue";

export const maxDuration = 120;

/**
 * Внешний scheduler (1–2 мин): GET или POST с CRON_SECRET.
 */
export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await processNextOrderInQueue();
  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    processed: result.processed,
    orderId: result.orderId,
    detail: result.detail,
  });
}
