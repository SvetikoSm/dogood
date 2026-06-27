import { printStyles } from "@/lib/landing-data";
import { assetUrl } from "@/lib/asset-url";

type StylePreview = {
  src: string;
  fallbacks: string[];
};

/**
 * Превью стилей в форме заказа.
 * WebP основной; при ошибке — png из той же папки или из каталога.
 */
export const ORDER_FORM_STYLE_PREVIEW: Record<string, StylePreview> = {
  life: {
    src: assetUrl("/order-form-styles/life/2.webp"),
    fallbacks: [assetUrl("/order-form-styles/life/2.png")],
  },
  speed: {
    src: assetUrl("/order-form-styles/speed/2.webp"),
    fallbacks: [
      assetUrl("/products/speed/2.webp"),
      assetUrl("/products/speed/2.png"),
    ],
  },
  rainy: {
    src: assetUrl("/order-form-styles/rainy/2.webp"),
    fallbacks: [
      assetUrl("/products/rainy/2.webp"),
      assetUrl("/products/rainy/2.png"),
    ],
  },
};

export function getOrderFormPreviewUrl(styleId: string): string {
  return ORDER_FORM_STYLE_PREVIEW[styleId]?.src ?? "";
}

export function getOrderFormPreviewFallbacks(styleId: string): string[] {
  return ORDER_FORM_STYLE_PREVIEW[styleId]?.fallbacks ?? [];
}

/** @deprecated используйте getOrderFormPreviewUrl */
export function getOrderFormPreviewCandidatesByStyle(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { value } of printStyles) {
    const p = ORDER_FORM_STYLE_PREVIEW[value];
    out[value] = p ? [p.src, ...p.fallbacks] : [];
  }
  return out;
}
