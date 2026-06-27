import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Меняйте при деплое — один раз сбрасывает Safari-кэш у всех, кто зайдёт. */
const CACHE_BUST_ID = process.env.CACHE_BUST_ID ?? "20250627-safari";

const NO_STORE =
  "private, no-cache, no-store, max-age=0, must-revalidate";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  response.headers.set("Cache-Control", NO_STORE);
  response.headers.set("Pragma", "no-cache");

  const bustCookie = request.cookies.get("dogood-cache-bust")?.value;
  if (bustCookie !== CACHE_BUST_ID) {
    response.headers.set("Clear-Site-Data", '"cache"');
    response.cookies.set("dogood-cache-bust", CACHE_BUST_ID, {
      path: "/",
      maxAge: 60 * 60 * 24 * 400,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
