import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { getGoogleOpsClients } from "@/lib/ops/google-client";
import { getStudioDb, schema } from "@/lib/studio/db";
import { absoluteFromStudioRelative, getStudioDataDir } from "@/lib/studio/paths";
import { getOrderDriveParentFolderId } from "@/lib/upload-order-photos-to-drive";

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

/**
 * List image files in the customer's Drive folder and download into `cache/<orderId>/…`.
 * Clears previous rows in `studio_order_photos` for the order.
 */
export async function fetchDrivePhotosForOrder(orderId: string): Promise<{
  ok: true;
  downloaded: number;
  detail?: string;
} | { ok: false; error: string }> {
  const db = getStudioDb();
  const order = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .get();
  if (!order) return { ok: false, error: "order not found" };

  const clients = getGoogleOpsClients();
  if (!clients) {
    return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON not configured" };
  }

  let folderId = order.driveFolderId;
  if (!folderId) {
    // Newer orders: the site uploads photos into a folder named by Order ID
    // under the shared parent — the sheet's link cell stays empty.
    const parent = getOrderDriveParentFolderId();
    if (parent) {
      const safeName = order.sheetOrderId.replace(/['\\]/g, "");
      const found = await clients.drive.files.list({
        q: `'${parent}' in parents and mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`,
        fields: "files(id,name)",
        pageSize: 5,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      folderId = found.data.files?.[0]?.id ?? "";
      if (folderId) {
        await db
          .update(schema.studioOrders)
          .set({
            driveFolderId: folderId,
            driveFolderUrl: `https://drive.google.com/drive/folders/${folderId}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.studioOrders.id, orderId));
      }
    }
  }
  if (!folderId) {
    return {
      ok: false,
      error: `no Drive folder: sheet link empty and no folder named "${order.sheetOrderId}" under the orders parent folder`,
    };
  }

  const list = await clients.drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType)",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = list.data.files ?? [];
  const images = files.filter(
    (f) => f.mimeType && (IMAGE_MIME.has(f.mimeType) || f.mimeType.startsWith("image/")),
  );

  await db.delete(schema.studioOrderPhotos).where(eq(schema.studioOrderPhotos.orderId, orderId));

  const cacheDir = path.join(getStudioDataDir(), "cache", orderId);
  await fs.mkdir(cacheDir, { recursive: true });

  let n = 0;
  let sort = 0;
  for (const f of images) {
    if (!f.id) continue;
    const res = await clients.drive.files.get(
      { fileId: f.id, alt: "media" },
      { responseType: "arraybuffer" },
    );
    let buf: Buffer = Buffer.from(res.data as ArrayBuffer);
    let mimeType = f.mimeType || "application/octet-stream";
    // iPhone photos: models reject HEIC bytes — convert to JPEG first.
    if (
      mimeType === "image/heic" ||
      mimeType === "image/heif" ||
      /\.hei[cf]$/i.test(f.name || "")
    ) {
      const { convertHeicBufferToJpeg } = await import("@/lib/convert-heic-server");
      const jpeg = await convertHeicBufferToJpeg(buf);
      if (!jpeg) {
        console.error("[fetchDrivePhotos] heic convert failed:", f.name);
        continue;
      }
      buf = jpeg;
      mimeType = "image/jpeg";
    }
    const ext =
      mimeType === "image/png"
        ? ".png"
        : mimeType === "image/webp"
          ? ".webp"
          : mimeType === "image/gif"
            ? ".gif"
            : ".jpg";
    const safeName = (f.name || "photo").replace(/[^\w.\-()]/g, "_");
    const rel = path.posix.join("cache", orderId, `${sort}_${f.id}${ext}`);
    const abs = absoluteFromStudioRelative(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);

    await db.insert(schema.studioOrderPhotos).values({
      id: randomUUID(),
      orderId,
      sortOrder: sort,
      driveFileId: f.id,
      originalName: f.name || safeName,
      mimeType,
      localRelativePath: rel.replace(/\\/g, "/"),
    });
    sort += 1;
    n += 1;
  }

  // An empty folder used to reset status back to "new", which made the order
  // get picked up again next tick, find the folder empty again, and loop
  // forever — with no backoff, since this step itself reports success. Park
  // it in "error" instead so a human has to look at it once.
  await db
    .update(schema.studioOrders)
    .set({
      status: n > 0 ? "assets_loaded" : "error",
      lastError: n === 0 ? "Drive folder had no raster images — nothing to generate from" : "",
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, orderId));

  return { ok: true, downloaded: n, detail: n === 0 ? "no images downloaded" : undefined };
}
