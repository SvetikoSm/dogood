import { catalogDesignTemplates, printStyles } from "@/lib/landing-data";

/**
 * Превью стилей в форме заказа: сначала файлы из `public/products`, которые реально есть в репозитории,
 * затем опциональные `public/order-form-styles`, в конце — внешний URL с витрины (Unsplash и т.д.).
 * Так превью не зависят от CDN и не «проматывают» десятки 404 на медленном канале.
 */
const localProductPreviews: Record<string, readonly string[]> = {
  life: ["/products/life/3.jpg", "/products/life/4.jpg"],
  speed: ["/products/speed/3.jpg", "/products/speed/4.png"],
  rainy: [
    "/products/rainy/main.png",
    "/products/rainy/3.jpg",
    "/products/rainy/4.jpg",
  ],
};

function optionalOrderFormStyleFiles(styleId: string): string[] {
  return [
    `/order-form-styles/${styleId}/2.webp`,
    `/order-form-styles/${styleId}/2.jpg`,
    `/order-form-styles/${styleId}/2.png`,
  ];
}

function catalogFallbackUrl(styleId: string): string {
  const design = catalogDesignTemplates.find((d) => d.id === styleId);
  return design?.gallery[0] ?? design?.imageMain ?? "";
}

export function getOrderFormPreviewCandidatesByStyle(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { value } of printStyles) {
    const locals = localProductPreviews[value] ?? [];
    const remote = catalogFallbackUrl(value);
    out[value] = Array.from(
      new Set([...locals, ...optionalOrderFormStyleFiles(value), remote].filter(Boolean)),
    );
  }
  return out;
}
