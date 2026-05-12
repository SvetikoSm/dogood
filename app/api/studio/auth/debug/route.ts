import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { envLocalHasKey, getEnvRaw } from "@/lib/studio/runtime-env";

/**
 * Только для локальной отладки: видно ли серверу пароль и откуда запущен процесс.
 * В production отключено.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const cwd = process.cwd();
  const envLocal = path.join(cwd, ".env.local");
  let envLocalExists = false;
  try {
    envLocalExists = fs.existsSync(envLocal);
  } catch {
    envLocalExists = false;
  }
  return NextResponse.json({
    ok: true,
    cwd,
    envLocalPath: envLocal,
    envLocalExists,
    studioPasswordSet: Boolean(getEnvRaw("STUDIO_ADMIN_PASSWORD")?.trim()),
    studioPasswordKeyInEnvFile: envLocalHasKey("STUDIO_ADMIN_PASSWORD"),
    sessionSecretSet: Boolean(
      getEnvRaw("STUDIO_SESSION_SECRET")?.trim() ||
        getEnvRaw("REVIEW_SESSION_SECRET")?.trim() ||
        getEnvRaw("CRON_SECRET")?.trim(),
    ),
  });
}
