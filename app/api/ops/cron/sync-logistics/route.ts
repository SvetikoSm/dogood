import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/ops/cron-auth";
import { syncLogisticsSheetFromOrders } from "@/lib/ops/sync-logistics-sheet";

export const maxDuration = 60;

/**
 * Периодический sync: основной лист заказов → лист «Логистика Revolution Print».
 * Тот же CRON_SECRET, что и у /api/ops/cron/process-queue.
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
  const result = await syncLogisticsSheetFromOrders();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, ranAt: new Date().toISOString() },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    rowsWritten: result.rowsWritten,
    ranAt: new Date().toISOString(),
  });
}
