import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { getGoogleOpsClients } from "@/lib/ops/google-client";
import { getStudioDb, schema } from "@/lib/studio/db";
import { absoluteFromStudioRelative, getStudioDataDir } from "@/lib/studio/paths";

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
  if (!order.driveFolderId) {
    return { ok: false, error: "order has no Drive folder id (sync sheet / check Папка с фото)" };
  }

  const clients = getGoogleOpsClients();
  if (!clients) {
    return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON not configured" };
  }

  const list = await clients.drive.files.list({
    q: `'${order.driveFolderId}' in parents and trashed=false`,
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
    const buf = Buffer.from(res.data as ArrayBuffer);
    const ext =
      f.mimeType === "image/png"
        ? ".png"
        : f.mimeType === "image/webp"
          ? ".webp"
          : f.mimeType === "image/gif"
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
      mimeType: f.mimeType || "application/octet-stream",
      localRelativePath: rel.replace(/\\/g, "/"),
    });
    sort += 1;
    n += 1;
  }

  await db
    .update(schema.studioOrders)
    .set({
      status: n > 0 ? "assets_loaded" : "new",
      lastError: n === 0 ? "Drive folder had no raster images" : "",
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, orderId));

  return { ok: true, downloaded: n, detail: n === 0 ? "no images downloaded" : undefined };
}
