import { CatalogFeature } from "@/components/blocks/catalog-feature";
import { Section } from "@/components/ui/section";
import { getCatalogDesignsWithImages } from "@/lib/catalog-images";
import { printStyles } from "@/lib/landing-data";

export default async function Catalog() {
  const styleOrder = new Map<string, number>(printStyles.map((s, idx) => [s.value, idx]));
  const designs = getCatalogDesignsWithImages().sort(
    (a, b) => (styleOrder.get(a.id) ?? 999) - (styleOrder.get(b.id) ?? 999),
  );

  return (
    <Section
      id="catalog"
      surfaceClassName="bg-transparent"
    >
      <div className="mx-auto mb-4 max-w-2xl text-center lg:mb-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-dogood-muted">
          витрина
        </p>
        <h2 className="font-display text-3xl font-bold uppercase tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          Три базовых дизайна
        </h2>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
          Выберите стиль — в дизайне мы заменим графику на портрет вашего питомца и
          кличку.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Отправляете нам фото -> мы высылаем макет футболки -> оплата только если
          понравится макет
        </p>
      </div>
      <CatalogFeature designs={designs} />
    </Section>
  );
}
