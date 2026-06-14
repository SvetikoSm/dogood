import { NextResponse } from "next/server";

import { syncStudioTemplatesFromDrive } from "@/lib/studio/google/sync-templates-from-drive";

export async function POST(req: Request) {
  const secret = process.env.STUDIO_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  const h = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!secret || h !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const r = await syncStudioTemplatesFromDrive();
  if (!r.ok) return NextResponse.json(r, { status: 500 });
  return NextResponse.json(r);
}
