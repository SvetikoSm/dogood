import { NextResponse } from "next/server";

import {
  getStudioAdminPassword,
  verifyStudioAdminPassword,
} from "@/lib/studio/auth-password";
import { createStudioSessionValue, STUDIO_SESSION_COOKIE } from "@/lib/studio/session";

export async function POST(req: Request) {
  if (!getStudioAdminPassword()) {
    return NextResponse.json(
      { ok: false, error: "STUDIO_ADMIN_PASSWORD not configured" },
      { status: 503 },
    );
  }
  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const password = body.password ?? "";
  if (!verifyStudioAdminPassword(password)) {
    const dev =
      process.env.NODE_ENV !== "production"
        ? {
            devHint:
              "Вставь только значение после = (без STUDIO_ADMIN_PASSWORD=). Проверь, что нет пробела в конце строки в .env.local.",
            lengthExpected: getStudioAdminPassword()?.length ?? 0,
            lengthReceived: password.replace(/^\uFEFF/, "").trim().length,
          }
        : undefined;
    return NextResponse.json(
      { ok: false, error: "invalid password", ...dev },
      { status: 401 },
    );
  }
  const token = createStudioSessionValue(60 * 60 * 24 * 7);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Set STUDIO_SESSION_SECRET (or REVIEW_SESSION_SECRET / CRON_SECRET)" },
      { status: 503 },
    );
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STUDIO_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
