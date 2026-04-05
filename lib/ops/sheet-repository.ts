import "server-only";

import {
  ORDER_SHEET_HEADERS,
  headerIndexMap,
  rowArrayToRecord,
  getColLetter,
  type OrderSheetRow,
} from "@/lib/ops/sheet-columns";

export type { OrderSheetRow } from "@/lib/ops/sheet-columns";
import {
  getGoogleOpsClients,
  getSheetTabName,
  getSpreadsheetId,
} from "@/lib/ops/google-client";

function rowRange(tab: string, row: number, lastLetter: string) {
  return `'${tab.replace(/'/g, "''")}'!A${row}:${lastLetter}${row}`;
}

export async function fetchOrderSheetGrid(): Promise<{
  headers: string[];
  rows: OrderSheetRow[];
} | null> {
  const id = getSpreadsheetId();
  const clients = getGoogleOpsClients();
  if (!id || !clients) return null;

  const tab = getSheetTabName();
  const res = await clients.sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${tab.replace(/'/g, "''")}'!A1:ZZ2000`,
  });

  const grid = res.data.values;
  if (!grid?.length) return { headers: [...ORDER_SHEET_HEADERS], rows: [] };

  const headers = (grid[0] as unknown[]).map((c) => String(c ?? ""));
  const rows: OrderSheetRow[] = [];
  const hMap = headerIndexMap(headers);
  const orderIdCol = hMap.get("Order ID") ?? 1;

  for (let i = 1; i < grid.length; i++) {
    const line = grid[i] as unknown[];
    if (!line?.length) continue;
    const padded = [...line];
    while (padded.length < headers.length) padded.push("");
    const orderId = String(padded[orderIdCol] ?? "").trim();
    if (!orderId) continue;
    rows.push({
      rowNumber: i + 1,
      values: rowArrayToRecord(padded, headers),
    });
  }
  return { headers, rows };
}

export async function findRowByOrderId(
  orderId: string,
): Promise<OrderSheetRow | null> {
  const { rows } = (await fetchOrderSheetGrid()) ?? { rows: [] };
  return rows.find((r) => r.values["Order ID"]?.trim() === orderId) ?? null;
}

export async function updateOrderRowCells(
  rowNumber: number,
  patch: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = getSpreadsheetId();
  const clients = getGoogleOpsClients();
  if (!id || !clients) {
    return { ok: false, error: "google not configured" };
  }

  const grid = await fetchOrderSheetGrid();
  if (!grid) return { ok: false, error: "sheet read failed" };

  const { headers } = grid;
  const map = headerIndexMap(headers);
  const res = await clients.sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${getSheetTabName().replace(/'/g, "''")}'!A${rowNumber}:ZZ${rowNumber}`,
  });
  const line = (res.data.values?.[0] as unknown[]) ?? [];
  const row: unknown[] = [...line];
  while (row.length < headers.length) row.push("");

  for (const [key, val] of Object.entries(patch)) {
    const idx = map.get(key);
    if (idx === undefined) continue;
    row[idx] = val;
  }

  const lastLetter = getColLetter(Math.max(headers.length - 1, 0));
  await clients.sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: rowRange(getSheetTabName(), rowNumber, lastLetter),
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row.map((c) => (c == null ? "" : String(c)))] },
  });

  return { ok: true };
}
