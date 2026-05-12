import { NextResponse } from "next/server";

import { desc, eq } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
import { requireStudioSession } from "@/lib/studio/http-guard";

type Ctx = { params: Promise<{ orderId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { orderId } = await ctx.params;
  const db = getStudioDb();
  const [order] = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  if (!order) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const photos = await db
    .select()
    .from(schema.studioOrderPhotos)
    .where(eq(schema.studioOrderPhotos.orderId, orderId));
  const steps = await db
    .select()
    .from(schema.studioStepRuns)
    .where(eq(schema.studioStepRuns.orderId, orderId))
    .orderBy(desc(schema.studioStepRuns.createdAt));
  const [tpl] = await db
    .select()
    .from(schema.studioTemplates)
    .where(eq(schema.studioTemplates.slug, order.designSlug))
    .limit(1);
  return NextResponse.json({ ok: true, order, photos, steps, template: tpl ?? null });
}
