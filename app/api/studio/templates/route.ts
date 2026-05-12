import { NextResponse } from "next/server";

import { getStudioDb, schema } from "@/lib/studio/db";
import { requireStudioSession } from "@/lib/studio/http-guard";

export async function GET() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const db = getStudioDb();
  const rows = await db.select().from(schema.studioTemplates);
  return NextResponse.json({ ok: true, templates: rows });
}
