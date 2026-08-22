import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getStudioDb, schema } from "@/lib/studio/db";
import { isStudioMockMode } from "@/lib/studio/env";
import { getStudioDataDir } from "@/lib/studio/paths";
import { tgFetch } from "@/lib/studio/telegram/tg-fetch";

const BOT_API = "https://api.telegram.org";

const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAAhKDveksOskAAAAAElFTkSuQmCC";

async function mockDownload(orderId: string, fileId: string, sortOrder: number): Promise<boolean> {
  const rel = path.posix.join("cache", orderId, `${sortOrder}_${fileId}.png`);
  const abs = path.join(getStudioDataDir(), ...rel.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.from(MOCK_PNG_BASE64, "base64"));
  await getStudioDb().insert(schema.studioOrderPhotos).values({
    id: randomUUID(),
    orderId,
    sortOrder,
    driveFileId: "",
    originalName: `mock_${fileId}.png`,
    mimeType: "image/png",
    localRelativePath: rel,
  });
  return true;
}

/**
 * Download a Telegram photo (by file_id, using the given bot token) and
 * attach it to a studio order's photo list. Shared by the owner's manual
 * menu and the fair-event client bot — each calls with its own bot token.
 * Under STUDIO_MOCK_AI, writes a placeholder file instead of hitting the
 * real Telegram API (used by dry-run e2e scripts).
 */
export async function downloadTelegramFileToOrder(
  botToken: string,
  orderId: string,
  fileId: string,
  sortOrder: number,
): Promise<boolean> {
  if (isStudioMockMode()) return mockDownload(orderId, fileId, sortOrder);
  if (!botToken) return false;
  try {
    const info = await tgFetch(`${BOT_API}/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const infoJson = (await info.json()) as { ok?: boolean; result?: { file_path?: string } };
    const filePath = infoJson.result?.file_path;
    if (!filePath) return false;
    const bin = await tgFetch(`${BOT_API}/file/bot${botToken}/${filePath}`);
    if (!bin.ok) return false;
    const buf = Buffer.from(await bin.arrayBuffer());
    const ext = path.extname(filePath) || ".jpg";
    const rel = path.posix.join("cache", orderId, `${sortOrder}_${fileId}${ext}`);
    const abs = path.join(getStudioDataDir(), ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    await getStudioDb().insert(schema.studioOrderPhotos).values({
      id: randomUUID(),
      orderId,
      sortOrder,
      driveFileId: "",
      originalName: path.basename(filePath),
      mimeType: ext === ".png" ? "image/png" : "image/jpeg",
      localRelativePath: rel,
    });
    return true;
  } catch (e) {
    console.error("[download-photo] download", e);
    return false;
  }
}
