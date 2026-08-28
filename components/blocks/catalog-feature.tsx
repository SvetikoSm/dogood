"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";
import { Layout, Sparkles, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CatalogDesign } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

import { ProductImageCarousel } from "@/components/blocks/product-image-carousel";

const icons = [
  <Zap key="z" className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />,
  <Sparkles key="s" className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />,
  <Layout key="l" className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />,
];

export function CatalogFeature({ designs }: { designs: CatalogDesign[] }) {
  const tabs = designs.map((d, i) => ({
    value: d.id,
    icon: icons[i % icons.length],
    label: d.name,
    design: d,
  }));
  const [activeTab, setActiveTab] = useState(tabs[0]!.value);

  return (
    <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="w-full">
      {tabs.length > 1 ? (
        <Tabs.List
          className="grid w-full gap-1.5 sm:gap-3"
          style={{
            gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
          }}
          aria-label="Три базовых дизайна"
        >
          {tabs.map((tab) => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className={cn(
                "flex min-h-[4.25rem] w-full min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-center text-[10px] font-semibold leading-snug text-muted-foreground transition-colors sm:min-h-0 sm:flex-row sm:gap-2 sm:rounded-xl sm:px-3 sm:py-3 sm:text-left sm:text-sm",
                "border-fuchsia-200 bg-white/70 hover:bg-white",
                "data-[state=active]:border-dogood-pink/50 data-[state=active]:bg-fuchsia-50 data-[state=active]:text-foreground",
              )}
            >
              {tab.icon}
              <span className="max-w-full break-words leading-tight">{tab.label}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      ) : null}

      <div className="mt-8 rounded-2xl border border-fuchsia-200 bg-white/80 p-5 shadow-[0_18px_50px_rgba(244,114,182,0.12)] sm:p-8 lg:p-12">
        {tabs.map((tab) => (
          <Tabs.Content
            key={tab.value}
            value={tab.value}
            className="outline-none data-[state=inactive]:hidden"
          >
            <div className="grid min-w-0 gap-10 lg:grid-cols-2 lg:gap-12">
              <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
                <Badge variant="outline" className="w-fit border-fuchsia-200 bg-white">
                  {tab.design.priceRub.toLocaleString("ru-RU")} ₽
                </Badge>
                <h3 className="font-display text-2xl font-bold uppercase tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                  {tab.design.name}
                </h3>
              </div>
              <div className="flex min-w-0 w-full flex-col gap-4 lg:row-span-2">
                <ProductImageCarousel
                  key={tab.value}
                  imageMain={tab.design.imageMain}
                  gallery={tab.design.gallery}
                  catalogDesignId={tab.value}
                  priority={tab.value === tabs[0]?.value}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
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
                  Отправляете нам фото -&gt; мы высылаем макет футболки -&gt; оплата только
                  если понравится макет
                </p>
                <Button asChild size="lg" className="mt-2 w-fit gap-2 bg-primary">
                  <a href={`/?style=${tab.value}#order`}>Получить бесплатный макет</a>
                </Button>
              </div>
            </div>
          </Tabs.Content>
        ))}
      </div>
    </Tabs.Root>
  );
}
