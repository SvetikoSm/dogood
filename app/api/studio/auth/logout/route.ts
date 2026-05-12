import { NextResponse } from "next/server";

import { STUDIO_SESSION_COOKIE } from "@/lib/studio/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STUDIO_SESSION_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
