import { NextResponse } from "next/server";

import { requireStudioSession } from "@/lib/studio/http-guard";
import { syncStudioOrdersFromGoogleSheet } from "@/lib/studio/google/sync-orders-from-sheet";

export async function POST() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const r = await syncStudioOrdersFromGoogleSheet();
  return NextResponse.json(r);
}
