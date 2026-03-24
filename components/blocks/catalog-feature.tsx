"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { Layout, Sparkles, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CatalogDesign } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

import { ProductImageCarousel } from "@/components/blocks/product-image-carousel";

const icons = [
  <Zap key="z" className="h-4 w-4 shrink-0" aria-hidden />,
  <Sparkles key="s" className="h-4 w-4 shrink-0" aria-hidden />,
  <Layout key="l" className="h-4 w-4 shrink-0" aria-hidden />,
];

export function CatalogFeature({ designs }: { designs: CatalogDesign[] }) {
  const tabs = designs.map((d, i) => ({
    value: d.id,
    icon: icons[i % icons.length],
    label: d.name,
    design: d,
  }));

  return (
    <Tabs.Root defaultValue={tabs[0]!.value} className="w-full">
      <Tabs.List
        className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3"
        aria-label="Три базовых дизайна"
      >
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-left text-sm font-semibold text-muted-foreground transition-colors",
              "border-fuchsia-200 bg-white/70 hover:bg-white",
              "data-[state=active]:border-dogood-pink/50 data-[state=active]:bg-fuchsia-50 data-[state=active]:text-foreground",
            )}
          >
            {tab.icon}
            <span className="leading-tight">{tab.label}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <div className="mt-8 rounded-2xl border border-fuchsia-200 bg-white/80 p-5 shadow-[0_18px_50px_rgba(244,114,182,0.12)] sm:p-8 lg:p-12">
        {tabs.map((tab) => (
          <Tabs.Content
            key={tab.value}
            value={tab.value}
            className="outline-none data-[state=inactive]:hidden"
          >
            <div className="grid min-w-0 gap-10 lg:grid-cols-2 lg:gap-12">
              <div className="flex min-w-0 flex-col gap-5">
                <Badge variant="outline" className="w-fit border-fuchsia-200 bg-white">
                  {tab.design.priceRub.toLocaleString("ru-RU")} ₽
                </Badge>
                <h3 className="font-display text-2xl font-bold uppercase tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                  {tab.design.name}
                </h3>
                <p className="text-muted-foreground lg:text-lg">
                  {tab.design.shortLine}
                </p>
                <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground lg:text-base">
                  {tab.design.detailBullets.map((line) => (
                    <li key={line} className="marker:text-dogood-pink">
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Фото выше — примеры ткани и кроя. Свои снимки для принта загружаете
                  в форме заказа: 2–3 кадра (морда + рост).
                </p>
                <Button asChild size="lg" className="mt-2 w-fit gap-2 bg-primary">
                  <a href={`/?style=${tab.value}#order`}>Оформить в этом стиле</a>
                </Button>
              </div>
              <div className="flex min-w-0 w-full flex-col">
                <ProductImageCarousel
                  key={tab.value}
                  imageMain={tab.design.imageMain}
                  gallery={tab.design.gallery}
                  priority={tab.value === tabs[0]?.value}
                />
              </div>
            </div>
          </Tabs.Content>
        ))}
      </div>
    </Tabs.Root>
  );
}
