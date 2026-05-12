import fs from "node:fs";
import path from "node:path";

import { getEnvRaw } from "@/lib/studio/runtime-env";

/** Root for SQLite DB file, cached uploads, generated artifacts, bundled template assets. */
export function getStudioDataDir(): string {
  const override = getEnvRaw("STUDIO_DATA_DIR")?.trim();
  if (override) return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  return path.join(process.cwd(), "data", "studio");
}

export function ensureStudioDirs(): void {
  const root = getStudioDataDir();
  for (const sub of ["artifacts", "cache", "templates"]) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
}

export function studioRelative(...segments: string[]): string {
  return path.posix.join(...segments);
}

export function absoluteFromStudioRelative(rel: string): string {
  const safe = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (safe.includes("..")) {
    throw new Error("invalid path");
  }
  return path.join(getStudioDataDir(), ...safe.split("/"));
}
