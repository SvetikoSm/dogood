import "server-only";

import { Readable } from "node:stream";

import type { GoogleWebhookFilePart } from "@/lib/forward-order-to-google";
import { getGoogleOpsClients } from "@/lib/ops/google-client";
import { extractDriveFolderId } from "@/lib/studio/google/drive-folder-id";

export type DrivePhotoUploadResult = {
  uploaded: number;
  fileIds: string[];
  errors: string[];
};

/**
 * Загрузка фото в папку заказа через Drive API (сервисный аккаунт).
 * Используется, если Apps Script создал папку, но createFile в GAS не сработал.
 * Папку-родителя нужно расшарить на email сервисного аккаунта (редактор).
 */
export async function uploadOrderPhotosToDriveFolder(opts: {
  folderIdOrUrl: string;
  files: GoogleWebhookFilePart[];
}): Promise<DrivePhotoUploadResult> {
  const folderId =
    extractDriveFolderId(opts.folderIdOrUrl) || opts.folderIdOrUrl.trim();
  const clients = getGoogleOpsClients();
  if (!clients) {
    return {
      uploaded: 0,
      fileIds: [],
      errors: ["GOOGLE_SERVICE_ACCOUNT_JSON не задан на сервере"],
    };
  }
  if (!folderId) {
    return { uploaded: 0, fileIds: [], errors: ["не указан id папки Drive"] };
  }

  const fileIds: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < opts.files.length; i++) {
    const f = opts.files[i]!;
    try {
      if (!f.dataBase64?.length) {
        errors.push(`${f.field || i}: empty dataBase64`);
        continue;
      }
      const buf = Buffer.from(f.dataBase64, "base64");
      if (buf.length === 0) {
        errors.push(`${f.field || i}: empty buffer`);
        continue;
      }
      const name = (f.originalName || `photo-${i + 1}.jpg`).replace(
        /[^\w.\-()]/g,
        "_",
      );
      const mime = f.mimeType?.startsWith("image/")
        ? f.mimeType
        : "image/jpeg";

      const res = await clients.drive.files.create({
        requestBody: {
          name,
          parents: [folderId],
          mimeType: mime,
        },
        media: {
          mimeType: mime,
          body: Readable.from(buf),
        },
        fields: "id",
        supportsAllDrives: true,
      });
      if (res.data.id) fileIds.push(res.data.id);
    } catch (e) {
      errors.push(
        `${f.field || i}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { uploaded: fileIds.length, fileIds, errors };
}
