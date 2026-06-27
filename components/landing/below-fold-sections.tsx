"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

import { MobileAccordionSection } from "@/components/ui/mobile-accordion-section";

function LazySectionShell({ label }: { label: string }) {
  return (
    <div
      className="mx-auto max-w-6xl px-4 py-12 sm:px-6"
      aria-busy="true"
      aria-label={`Загрузка: ${label}`}
    >
      <div className="mx-auto h-6 w-40 animate-pulse rounded-full bg-fuchsia-100" />
      <div className="mx-auto mt-4 h-4 w-64 max-w-full animate-pulse rounded-full bg-fuchsia-50" />
    </div>
  );
}

function lazySection<T extends Record<string, ComponentType>>(
  loader: () => Promise<T>,
  exportName: keyof T,
  label: string,
) {
  return dynamic(
    () => loader().then((mod) => mod[exportName]),
    {
      ssr: false,
      loading: () => <LazySectionShell label={label} />,
    },
  );
}

const HowItWorks = lazySection(
  () => import("@/components/landing/how-it-works"),
  "HowItWorks",
  "Как это работает",
);

const About = lazySection(
  () => import("@/components/landing/about"),
  "About",
  "Миссия",
);

const GoodDeed = lazySection(
  () => import("@/components/landing/good-deed"),
  "GoodDeed",
  "Ваше доброе дело",
);

const Shelters = lazySection(
  () => import("@/components/landing/shelters"),
  "Shelters",
  "Приюты",
);

const ProductBenefits = lazySection(
  () => import("@/components/landing/product-benefits"),
  "ProductBenefits",
  "Почему наши вещи живут долго",
);

const Reviews = lazySection(
  () => import("@/components/landing/reviews"),
  "Reviews",
  "Отзывы",
);

const Faq = lazySection(
  () => import("@/components/landing/faq"),
  "Faq",
  "FAQ",
);

export function BelowFoldSections() {
  return (
    <>
      <MobileAccordionSection title="Как это работает">
        <HowItWorks />
      </MobileAccordionSection>
      <MobileAccordionSection title="Миссия">
        <About />
      </MobileAccordionSection>
      <MobileAccordionSection title="Ваше доброе дело">
        <GoodDeed />
      </MobileAccordionSection>
      <MobileAccordionSection title="Приюты">
        <Shelters />
      </MobileAccordionSection>
      <MobileAccordionSection title="Почему наши вещи живут долго">
        <ProductBenefits />
      </MobileAccordionSection>
      <MobileAccordionSection title="Отзывы">
        <Reviews />
      </MobileAccordionSection>
      <MobileAccordionSection title="FAQ">
        <Faq />
      </MobileAccordionSection>
    </>
  );
}
