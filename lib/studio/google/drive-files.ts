import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { getGoogleOpsClients } from "@/lib/ops/google-client";
import type { StyleSlug } from "@/lib/ops/style-masters";
import { MOCKUP_MASTER_FILENAMES } from "@/lib/studio/config";
import { getStudioDataDir } from "@/lib/studio/paths";

export type DriveListedFile = {
  id: string;
  name: string;
  mimeType: string;
};

export async function listDriveFolderImages(
  folderId: string,
): Promise<DriveListedFile[] | { ok: false; error: string }> {
  const clients = getGoogleOpsClients();
  if (!clients) return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON not configured" };

  const list = await clients.drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = (list.data.files ?? []).filter(
    (f) => f.id && f.mimeType?.startsWith("image/"),
  ) as DriveListedFile[];
  return files;
}

export async function downloadDriveFile(
  fileId: string,
  destAbs: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clients = getGoogleOpsClients();
  if (!clients) return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON not configured" };
  try {
    const res = await clients.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" },
    );
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await fs.writeFile(destAbs, Buffer.from(res.data as ArrayBuffer));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function nameMatches(name: string, candidates: string[]): boolean {
  const n = name.replace(/\.[^.]+$/, "").trim().toLowerCase();
  return candidates.some((c) => n === c.toLowerCase() || n.includes(c.toLowerCase()));
}

export function pickDriveFileByNames(
  files: DriveListedFile[],
  candidates: string[],
): DriveListedFile | null {
  for (const c of candidates) {
    const hit = files.find((f) => {
      const base = f.name.replace(/\.[^.]+$/, "").trim().toLowerCase();
      return base === c.toLowerCase() || base.includes(c.toLowerCase());
    });
    if (hit) return hit;
  }
  return files.find((f) => nameMatches(f.name, candidates)) ?? null;
}

export function extFromMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return ".jpg";
}

export async function downloadDriveFolderFileToRelative(
  folderId: string,
  fileNameCandidates: string[],
  relativeDest: string,
): Promise<{ ok: true; file: DriveListedFile } | { ok: false; error: string }> {
  const listed = await listDriveFolderImages(folderId);
  if ("ok" in listed && listed.ok === false) return listed;
  const files = listed as DriveListedFile[];
  const pick = pickDriveFileByNames(files, fileNameCandidates);
  if (!pick) {
    return {
      ok: false,
      error: `No file matching [${fileNameCandidates.join(", ")}] in folder ${folderId}`,
    };
  }
  const abs = path.join(getStudioDataDir(), ...relativeDest.split("/"));
  const dl = await downloadDriveFile(pick.id, abs);
  if (!dl.ok) return dl;
  return { ok: true, file: pick };
}

export function mockupCandidatesForSlug(slug: StyleSlug): string[] {
  return MOCKUP_MASTER_FILENAMES[slug];
}
