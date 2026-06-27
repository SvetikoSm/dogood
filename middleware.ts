import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** HTML свежий, но без no-store — Safari может держать bfcache; статика immutable. */
const HTML_CACHE = "private, max-age=0, must-revalidate";

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", HTML_CACHE);
  response.headers.set("Pragma", "no-cache");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
