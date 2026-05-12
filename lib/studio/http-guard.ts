import "server-only";

import { NextResponse } from "next/server";

import { isStudioAuthenticated } from "@/lib/studio/session";

export async function requireStudioSession(): Promise<NextResponse | null> {
  if (!(await isStudioAuthenticated())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
