import { NextResponse } from "next/server";

import { desc } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
import { requireStudioSession } from "@/lib/studio/http-guard";

export async function GET() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const db = getStudioDb();
  const rows = await db
    .select({
      id: schema.studioOrders.id,
      sheetOrderId: schema.studioOrders.sheetOrderId,
      customerName: schema.studioOrders.customerName,
      petNameRaw: schema.studioOrders.petNameRaw,
      designSlug: schema.studioOrders.designSlug,
      status: schema.studioOrders.status,
      updatedAt: schema.studioOrders.updatedAt,
    })
    .from(schema.studioOrders)
    .orderBy(desc(schema.studioOrders.updatedAt));
  return NextResponse.json({ ok: true, orders: rows });
}
