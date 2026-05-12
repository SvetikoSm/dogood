import { NextResponse } from "next/server";

import { requireStudioSession } from "@/lib/studio/http-guard";
import { rejectDogStage } from "@/lib/studio/pipeline/human-actions";

type Ctx = { params: Promise<{ orderId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { orderId } = await ctx.params;
  let note = "";
  try {
    const b = (await req.json()) as { note?: string };
    note = b.note?.trim() ?? "";
  } catch {
    /* optional body */
  }
  const r = await rejectDogStage(orderId, note || "rejected");
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
