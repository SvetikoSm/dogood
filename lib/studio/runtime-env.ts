import "server-only";

import fs from "node:fs";
import path from "node:path";

/**
 * Парсинг `.env.local` вручную (минимальный формат KEY=value).
 * Нужен потому что в части сценариев Next/webpack не кладёт `STUDIO_*` в `process.env`,
 * хотя файл на диске есть — иначе логин Studio «не видит» пароль.
 */
function parseDotenvBody(content: string): Record<string, string> {
  const text = content.replace(/^\uFEFF/, "");
  const map: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!key) continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    map[key] = val;
  }
  return map;
}

let fileCache: { mtimeMs: number; map: Record<string, string> } | null = null;

function readEnvLocalFile(): Record<string, string> {
  const p = path.join(process.cwd(), ".env.local");
  try {
    const st = fs.statSync(p);
    if (fileCache && fileCache.mtimeMs === st.mtimeMs) return fileCache.map;
    const raw = fs.readFileSync(p, "utf8");
    const map = parseDotenvBody(raw);
    fileCache = { mtimeMs: st.mtimeMs, map };
    return map;
  } catch {
    return {};
  }
}

function fromFileIfMissing(key: string, fromProc: string | undefined): string | undefined {
  if (typeof fromProc === "string" && fromProc.trim() !== "") return fromProc;
  const fileMap = readEnvLocalFile();
  const v = fileMap[key];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/**
 * Чтение env: сначала `process.env` (динамический ключ), если пусто — строка из `.env.local` на диске.
 */
export function getEnvRaw(key: string): string | undefined {
  const v = process.env[key];
  return fromFileIfMissing(key, typeof v === "string" ? v : undefined);
}

/** Для /api/studio/auth/debug — есть ли ключ в распарсенном `.env.local` (без значения). */
export function envLocalHasKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(readEnvLocalFile(), key);
}
