import { NextResponse } from "next/server";

import { requireStudioSession } from "@/lib/studio/http-guard";
import { approveTextStage } from "@/lib/studio/pipeline/human-actions";

type Ctx = { params: Promise<{ orderId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { orderId } = await ctx.params;
  const r = await approveTextStage(orderId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
