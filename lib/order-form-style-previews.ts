import { printStyles } from "@/lib/landing-data";

/**
 * Превью стилей в форме заказа.
 * Файлы: `public/order-form-styles/{life|speed|rainy}/2.png` (или 2.jpg).
 */
export const ORDER_FORM_STYLE_PREVIEW_BY_ID: Record<string, string> = {
  life: "/order-form-styles/life/2.png",
  speed: "/order-form-styles/speed/2.png",
  rainy: "/order-form-styles/rainy/2.png",
};

export function getOrderFormPreviewUrl(styleId: string): string {
  return ORDER_FORM_STYLE_PREVIEW_BY_ID[styleId] ?? "";
}

/** @deprecated используйте getOrderFormPreviewUrl */
export function getOrderFormPreviewCandidatesByStyle(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { value } of printStyles) {
    const url = getOrderFormPreviewUrl(value);
    out[value] = url ? [url] : [];
  }
  return out;
}
