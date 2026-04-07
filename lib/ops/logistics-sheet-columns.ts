/**
 * Второй лист в той же таблице: срез для логистики и типографии (Revolution Print).
 * Синхронизируется из основного листа заказов; часть колонок заполняется вручную и не затирается.
 */
export const LOGISTICS_SHEET_HEADERS = [
  "Order ID",
  "ФИО",
  "Телефон",
  "Адрес",
  "Доставка",
  "Цвет футболки",
  "Размер футболки",
  "Папка с фото (Google Drive)",
  "Статус",
  "Согласованное изображение",
  "Папка Revolution Print (общая)",
  "Ссылка финал Revolution Print",
  "Комментарий логистики",
] as const;

export type LogisticsSheetHeader = (typeof LOGISTICS_SHEET_HEADERS)[number];

/** Колонки, которые при синхронизации не перезаписываются из основного листа. */
export const LOGISTICS_MANUAL_HEADERS = [
  "Ссылка финал Revolution Print",
  "Комментарий логистики",
] as const;

const SIZE_RE =
  /\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)\b|(?:размер|size)[:\s]*([^\n,;]+)/i;

/**
 * Пытается вытащить размер из текста «Футболки» (кличка питомца часто в первой строке).
 */
export function extractShirtSizeFromShirtsCell(shirtsRaw: string): string {
  const text = (shirtsRaw ?? "").trim();
  if (!text) return "";

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(SIZE_RE);
    if (m) return (m[1] ?? m[2] ?? "").trim();
  }
  const m = text.match(SIZE_RE);
  if (m) return (m[1] ?? m[2] ?? "").trim();

  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}
