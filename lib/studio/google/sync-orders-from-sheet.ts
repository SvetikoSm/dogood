import "server-only";

import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { fetchOrderSheetGrid } from "@/lib/ops/sheet-repository";
import { normalizeStyleId } from "@/lib/ops/style-masters";
import { getStudioDb, schema } from "@/lib/studio/db";
import { extractDriveFolderId } from "@/lib/studio/google/drive-folder-id";
import { getEnvRaw } from "@/lib/studio/runtime-env";
import { inferPetNameScript } from "@/lib/studio/script-detect";

function petNameFromSheetRow(values: Record<string, string>): string {
  const col = getEnvRaw("STUDIO_SHEET_PET_NAME_COLUMN")?.trim();
  if (col && values[col]?.trim()) return values[col].trim();
  const direct = values["pet_name"]?.trim() || values["Pet name"]?.trim();
  if (direct) return direct;
  const futbolki = values["Футболки"] ?? "";
  return futbolki.split("\n")[0]?.trim() ?? "";
}

/**
 * Upsert orders from the same Google Sheet used by ops (`fetchOrderSheetGrid`).
 * Fills `studio_orders` for the internal Studio dashboard.
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
    const sheetOrderId = v["Order ID"]?.trim() ?? "";
    if (!sheetOrderId) continue;

    const customerName = v["Имя"]?.trim() ?? "";
    const petNameRaw = petNameFromSheetRow(v);
    const styleRaw = v["style_id"]?.trim() ?? "";
    const designSlug =
      normalizeStyleId(styleRaw) ?? (styleRaw.trim().toLowerCase() || "speed");
    const driveFolderUrl = v["Папка с фото"]?.trim() ?? "";
    const driveFolderId = extractDriveFolderId(driveFolderUrl);

    const existing = await db
      .select({ id: schema.studioOrders.id })
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
          designSlug,
          driveFolderUrl,
          driveFolderId,
          sheetPayloadJson,
          updatedAt: new Date(),
        })
        .where(eq(schema.studioOrders.id, existing.id));
    } else {
      await db.insert(schema.studioOrders).values({
        id: randomUUID(),
        sheetOrderId,
        customerName,
        petNameRaw,
        petNameScript,
        designSlug,
        driveFolderUrl,
        driveFolderId,
        status: "new",
        sheetPayloadJson,
      });
    }
    n += 1;
  }
  return { ok: true, upserted: n };
}
