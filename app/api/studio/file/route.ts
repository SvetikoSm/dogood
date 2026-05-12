import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { requireStudioSession } from "@/lib/studio/http-guard";
import { getStudioDataDir } from "@/lib/studio/paths";

function mimeFor(ext: string): string {
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

export async function GET(req: Request) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const url = new URL(req.url);
  const rel = url.searchParams.get("path")?.trim() ?? "";
  if (!rel || rel.includes("..")) {
    return NextResponse.json({ ok: false, error: "invalid path" }, { status: 400 });
  }
  const root = path.resolve(getStudioDataDir());
  const abs = path.resolve(path.join(root, ...rel.split("/")));
  if (!abs.startsWith(root)) {
    return NextResponse.json({ ok: false, error: "path outside studio dir" }, { status: 400 });
  }
  try {
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": mimeFor(ext),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
}
