/**
 * Заголовки листа заказов (порядок важен для Apps Script appendRow).
 * Первые 12 колонок — как в текущем проде; дальше — операционка генерации.
 */
export const ORDER_SHEET_HEADERS = [
  "Время",
  "Order ID",
  "Имя",
  "Email",
  "Телефон",
  "Приют",
  "Адрес",
  "Доставка",
  "Футболки",
  "Комментарий",
  "Папка с фото",
  "Кол-во файлов",
  "Цвет футболки",
  "style_id",
  "status",
  "generation_attempt",
  "generated_image_url",
  "approved_image_url",
  "review_comment",
  "last_error",
  "lock_until",
  "lock_token",
  "dog_photo_urls",
] as const;

export type OrderSheetHeader = (typeof ORDER_SHEET_HEADERS)[number];

export type OrderSheetRow = {
  rowNumber: number;
  values: Record<string, string>;
};

export const ORDER_STATUSES = [
  "NEW",
  "READY_FOR_GENERATION",
  "GENERATING",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED_NEEDS_REGEN",
  "REGENERATING",
  "FAILED",
  "GENERATION_LIMIT",
] as const;

export type OrderPipelineStatus = (typeof ORDER_STATUSES)[number];

export const MAX_GENERATION_RUNS = 3;

export function headerIndexMap(headers: string[]): Map<string, number> {
  const m = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = String(h ?? "").trim();
    if (key) m.set(key, i);
  });
  return m;
}

export function rowArrayToRecord(
  row: unknown[],
  headers: string[],
): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => {
    const key = String(h ?? "").trim();
    if (!key) return;
    const v = row[i];
    o[key] = v == null ? "" : String(v);
  });
  return o;
}

export function getColLetter(indexZeroBased: number): string {
  let n = indexZeroBased + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
