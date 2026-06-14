import { NextResponse } from "next/server";

import { runStudioPipelineTick } from "@/lib/studio/pipeline/orchestrator";

export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.STUDIO_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const h = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const q = new URL(req.url).searchParams.get("secret")?.trim();
  return h === secret || q === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const r = await runStudioPipelineTick();
  return NextResponse.json(r);
}

export async function POST(req: Request) {
  return GET(req);
}
