import "server-only";

import { Readable } from "node:stream";

import { getGoogleOpsClients } from "@/lib/ops/google-client";
import { getStudioDriveFolder } from "@/lib/studio/config";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";
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

export async function uploadBytesToDriveFolder(opts: {
  folderId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ ok: true; fileId: string; webViewLink?: string } | { ok: false; error: string }> {
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
