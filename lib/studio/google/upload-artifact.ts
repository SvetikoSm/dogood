import "server-only";

import { Readable } from "node:stream";

import { getGoogleOpsClients } from "@/lib/ops/google-client";
import { getStudioDriveFolder } from "@/lib/studio/config";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";
import { getEnvRaw } from "@/lib/studio/runtime-env";
import fs from "node:fs/promises";

function safeFileBase(name: string): string {
  return (
    name
      .trim()
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "artifact"
  );
}

/**
 * Upload via the Apps Script web app, which runs as the Drive owner and so
 * has real storage quota. Returns null when the webhook isn't configured, so
 * the caller can fall back to the service account.
 */
async function uploadViaAppsScript(opts: {
  folderId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ ok: true; fileId: string; webViewLink?: string } | { ok: false; error: string } | null> {
  const url = getEnvRaw("GOOGLE_ORDER_WEBHOOK_URL")?.trim();
  const secret = getEnvRaw("GOOGLE_ORDER_WEBHOOK_SECRET")?.trim();
  if (!url || !secret) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        action: "studioUpload",
        folderId: opts.folderId,
        fileName: opts.fileName,
        mimeType: opts.mimeType,
        dataBase64: opts.bytes.toString("base64"),
      }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `webhook HTTP ${res.status}: ${text.slice(0, 300)}` };
    const j = JSON.parse(text) as { ok?: boolean; error?: string; fileId?: string; fileUrl?: string };
    if (!j.ok || !j.fileId) return { ok: false, error: j.error || "webhook returned no fileId" };
    return { ok: true, fileId: j.fileId, webViewLink: j.fileUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function uploadBytesToDriveFolder(opts: {
  folderId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ ok: true; fileId: string; webViewLink?: string } | { ok: false; error: string }> {
  // Prefer the Apps Script web app: a service account has no Drive quota and
  // cannot create files in a personal-Gmail folder. Fall back only if the
  // webhook isn't configured.
  const viaScript = await uploadViaAppsScript(opts);
  if (viaScript) return viaScript;

  const clients = getGoogleOpsClients();
  if (!clients) return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON not configured" };

  try {
    const res = await clients.drive.files.create({
      requestBody: {
        name: opts.fileName,
        parents: [opts.folderId],
      },
      media: {
        mimeType: opts.mimeType,
        body: Readable.from(opts.bytes),
      },
      fields: "id,webViewLink",
      supportsAllDrives: true,
    });
    const id = res.data.id;
    if (!id) return { ok: false, error: "Drive upload returned no file id" };
    return { ok: true, fileId: id, webViewLink: res.data.webViewLink ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function uploadStudioArtifactToFolder(opts: {
  studioRelativePath: string;
  folderKey: "approved" | "textBadges" | "suboptimal";
  fileBaseName: string;
  suffix?: string;
}): Promise<{ ok: true; fileName: string; fileId: string } | { ok: false; error: string }> {
  const abs = absoluteFromStudioRelative(opts.studioRelativePath);
  const bytes = await fs.readFile(abs);
  const ext =
    abs.toLowerCase().endsWith(".jpg") || abs.toLowerCase().endsWith(".jpeg")
      ? ".jpg"
      : ".png";
  const fileName = `${safeFileBase(opts.fileBaseName)}${opts.suffix ?? ""}${ext}`;
  const folderId = getStudioDriveFolder(opts.folderKey);
  const up = await uploadBytesToDriveFolder({
    folderId,
    fileName,
    mimeType: ext === ".jpg" ? "image/jpeg" : "image/png",
    bytes,
  });
  if (!up.ok) return up;
  return { ok: true, fileName, fileId: up.fileId };
}
