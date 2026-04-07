import "server-only";

import {
  LOGISTICS_MANUAL_HEADERS,
  LOGISTICS_SHEET_HEADERS,
  extractShirtSizeFromShirtsCell,
} from "@/lib/ops/logistics-sheet-columns";
import {
  getGoogleOpsClients,
  getLogisticsSheetTabName,
  getRevolutionPrintFolderUrl,
  getSpreadsheetId,
} from "@/lib/ops/google-client";
import {
  getColLetter,
  headerIndexMap,
  rowArrayToRecord,
} from "@/lib/ops/sheet-columns";
import { fetchOrderSheetGrid } from "@/lib/ops/sheet-repository";

function tabQuote(tab: string) {
  return `'${tab.replace(/'/g, "''")}'`;
}

function logisticsRowFromOrder(
  values: Record<string, string>,
  revolutionFolderUrl: string | undefined,
): Record<string, string> {
  const shirts = values["Футболки"]?.trim() ?? "";
  const orderId = values["Order ID"]?.trim() ?? "";
  return {
    "Order ID": orderId,
    ФИО: values["Имя"]?.trim() ?? "",
    Телефон: values["Телефон"]?.trim() ?? "",
    Адрес: values["Адрес"]?.trim() ?? "",
    Доставка: values["Доставка"]?.trim() ?? "",
    "Цвет футболки": values["Цвет футболки"]?.trim() ?? "",
    "Размер футболки": extractShirtSizeFromShirtsCell(shirts),
    "Папка с фото (Google Drive)": values["Папка с фото"]?.trim() ?? "",
    Статус: values["status"]?.trim() ?? "",
    "Согласованное изображение": values["approved_image_url"]?.trim() ?? "",
    "Папка Revolution Print (общая)": revolutionFolderUrl ?? "",
    "Ссылка финал Revolution Print": "",
    "Комментарий логистики": "",
  };
}

async function fetchLogisticsManualByOrderId(): Promise<
  Map<string, Record<string, string>>
> {
  const id = getSpreadsheetId();
  const clients = getGoogleOpsClients();
  if (!id || !clients) return new Map();

  const tab = getLogisticsSheetTabName();
  const res = await clients.sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tabQuote(tab)}!A1:ZZ2000`,
  });

  const grid = res.data.values;
  if (!grid?.length) return new Map();

  const headers = (grid[0] as unknown[]).map((c) => String(c ?? ""));
  const hMap = headerIndexMap(headers);
  const orderIdCol = hMap.get("Order ID");
  if (orderIdCol === undefined) return new Map();

  const manualKeys = [...LOGISTICS_MANUAL_HEADERS];
  const out = new Map<string, Record<string, string>>();

  for (let i = 1; i < grid.length; i++) {
    const line = grid[i] as unknown[];
    if (!line?.length) continue;
    const padded = [...line];
    while (padded.length < headers.length) padded.push("");
    const rec = rowArrayToRecord(padded, headers);
    const oid = rec["Order ID"]?.trim();
    if (!oid) continue;
    const manual: Record<string, string> = {};
    for (const k of manualKeys) {
      manual[k] = rec[k]?.trim() ?? "";
    }
    out.set(oid, manual);
  }

  return out;
}

/**
 * Перезаписывает лист логистики строками, собранными из основного листа заказов.
 * Ручные колонки («Ссылка финал…», «Комментарий логистики») подмешиваются из текущего листа логистики.
 */
export async function syncLogisticsSheetFromOrders(): Promise<
  | { ok: true; rowsWritten: number }
  | { ok: false; error: string }
> {
  const id = getSpreadsheetId();
  const clients = getGoogleOpsClients();
  if (!id || !clients) {
    return { ok: false, error: "google not configured" };
  }

  const main = await fetchOrderSheetGrid();
  if (!main) {
    return { ok: false, error: "sheet read failed" };
  }

  const manualByOrder = await fetchLogisticsManualByOrderId();
  const revolutionFolderUrl = getRevolutionPrintFolderUrl();

  const merged: Record<string, string>[] = [];
  for (const row of main.rows) {
    const base = logisticsRowFromOrder(row.values, revolutionFolderUrl);
    const manual = manualByOrder.get(base["Order ID"]?.trim() ?? "");
    if (manual) {
      for (const k of LOGISTICS_MANUAL_HEADERS) {
        if (manual[k]) base[k] = manual[k]!;
      }
    }
    merged.push(base);
  }

  const tab = getLogisticsSheetTabName();
  const headerRow = [...LOGISTICS_SHEET_HEADERS];
  const dataRows = merged.map((rec) =>
    headerRow.map((h) => rec[h] ?? ""),
  );
  const allRows = [headerRow, ...dataRows];

  const lastLetter = getColLetter(Math.max(headerRow.length - 1, 0));
  const lastRow = allRows.length;

  await clients.sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `${tabQuote(tab)}!A1:ZZ2000`,
  });

  await clients.sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${tabQuote(tab)}!A1:${lastLetter}${lastRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: allRows },
  });

  return { ok: true, rowsWritten: merged.length };
}
