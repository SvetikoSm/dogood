import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** HTML всегда свежий; CSS/JS кэшируются по hash (immutable). Без Clear-Site-Data — на мобиле он рвёт соединение. */
const NO_STORE =
  "private, no-cache, no-store, max-age=0, must-revalidate";

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", NO_STORE);
  response.headers.set("Pragma", "no-cache");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
