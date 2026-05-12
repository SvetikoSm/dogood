import { NextResponse } from "next/server";

import { requireStudioSession } from "@/lib/studio/http-guard";
import { runStudioStep } from "@/lib/studio/pipeline/run-studio-step";
import { STUDIO_STEP_KEYS, type StudioStepKey } from "@/lib/studio/step-keys";

export const maxDuration = 300;

type Ctx = { params: Promise<{ orderId: string }> };

const RUNNABLE = new Set<string>(
  Object.values(STUDIO_STEP_KEYS).filter((k) => !k.startsWith("HUMAN_")),
);

export async function POST(req: Request, ctx: Ctx) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { orderId } = await ctx.params;
  let body: { stepKey?: string };
  try {
    body = (await req.json()) as { stepKey?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const stepKey = body.stepKey?.trim() ?? "";
  if (!RUNNABLE.has(stepKey)) {
    return NextResponse.json({ ok: false, error: "invalid stepKey" }, { status: 400 });
  }
  const r = await runStudioStep(orderId, stepKey as StudioStepKey);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, stepRunId: r.stepRunId });
}
