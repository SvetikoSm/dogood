import "server-only";

import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { fetchOrderSheetGrid } from "@/lib/ops/sheet-repository";
import { normalizeStyleId } from "@/lib/ops/style-masters";
import { STUDIO_SHEET_DEFAULTS } from "@/lib/studio/config";
import { getStudioDb, schema } from "@/lib/studio/db";
import { extractDriveFolderId } from "@/lib/studio/google/drive-folder-id";
import { getEnvRaw } from "@/lib/studio/runtime-env";
import { inferPetNameScript } from "@/lib/studio/script-detect";

function petNameFromSheetRow(values: Record<string, string>): string {
  const col =
    getEnvRaw("STUDIO_SHEET_PET_NAME_COLUMN")?.trim() ||
    STUDIO_SHEET_DEFAULTS.petNameColumn;
  if (values[col]?.trim()) return values[col].trim();
  const direct = values["pet_name"]?.trim() || values["Pet name"]?.trim();
  if (direct) return direct;
  const futbolki = values["Футболки"] ?? "";
  return futbolki.split("\n")[0]?.trim() ?? "";
}

function styleFromSheetRow(values: Record<string, string>): string {
  return (
    values[STUDIO_SHEET_DEFAULTS.styleColumn]?.trim() ||
    values["style_id"]?.trim() ||
    values["Стиль"]?.trim() ||
    ""
  );
}

/** Photo folder/link column varies by sheet vintage; first non-empty wins. */
function photoFolderUrlFromSheetRow(values: Record<string, string>): string {
  return (
    values[STUDIO_SHEET_DEFAULTS.driveFolderColumn]?.trim() ||
    values["Ссылка на фото"]?.trim() ||
    values["Ссылки на фото"]?.trim() ||
    ""
  );
}

function isProcessableSheetRow(values: Record<string, string>): boolean {
  const orderId = values[STUDIO_SHEET_DEFAULTS.orderIdColumn]?.trim() ?? "";
  if (!orderId || orderId.toLowerCase().startsWith("add-on")) return false;
  if (photoFolderUrlFromSheetRow(values)) return true;
  // Newer rows: the site uploads photos to a Drive folder named by Order ID
  // and the link cell stays empty — "Количество фото" is the signal.
  const photoCount = parseInt(values["Количество фото"] ?? "", 10);
  return Number.isFinite(photoCount) && photoCount > 0;
}

/**
 * Upsert orders from the Google Sheet (`fetchOrderSheetGrid`).
 * Skips add-on rows and rows without a photo folder or photo links.
 */
export async function syncStudioOrdersFromGoogleSheet(): Promise<{
  ok: true;
  upserted: number;
  detail?: string;
}> {
  const grid = await fetchOrderSheetGrid();
  if (!grid) {
    return { ok: true, upserted: 0, detail: "sheet not configured or empty" };
  }

  const db = getStudioDb();
  let n = 0;
  for (const row of grid.rows) {
    const v = row.values;
    if (!isProcessableSheetRow(v)) continue;

    const sheetOrderId = v[STUDIO_SHEET_DEFAULTS.orderIdColumn]?.trim() ?? "";
    if (!sheetOrderId) continue;

    const customerName = v["Имя"]?.trim() ?? "";
    const petNameRaw = petNameFromSheetRow(v);
    const styleRaw = styleFromSheetRow(v);
    const normalized = normalizeStyleId(styleRaw);
    if (!normalized) continue;

    const driveFolderUrl = photoFolderUrlFromSheetRow(v);
    const driveFolderId = extractDriveFolderId(driveFolderUrl);

    const existing = await db
      .select({ id: schema.studioOrders.id, status: schema.studioOrders.status })
      .from(schema.studioOrders)
      .where(eq(schema.studioOrders.sheetOrderId, sheetOrderId))
      .get();

    const sheetPayloadJson = JSON.stringify(v);
    const petNameScript = inferPetNameScript(petNameRaw);

    if (existing?.id) {
      await db
        .update(schema.studioOrders)
        .set({
          customerName,
          petNameRaw,
          petNameScript,
          designSlug: normalized,
          driveFolderUrl,
          driveFolderId,
          sheetPayloadJson,
          updatedAt: new Date(),
        })
        .where(eq(schema.studioOrders.id, existing.id));
    } else {
      // Rows that already have a print link were produced before this system
      // existed — import them as completed so they are never reprocessed.
      const alreadyPrinted = Boolean(v["Ссылка на принт"]?.trim());
      await db.insert(schema.studioOrders).values({
        id: randomUUID(),
        sheetOrderId,
        customerName,
        petNameRaw,
        petNameScript,
        designSlug: normalized,
        driveFolderUrl,
        driveFolderId,
        status: alreadyPrinted ? "completed" : "new",
        sheetPayloadJson,
      });
    }
    n += 1;
  }
  return { ok: true, upserted: n };
}
