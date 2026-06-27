"use client";

import type { ReactNode } from "react";

type MobileAccordionSectionProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

/** Одна копия в DOM: на md+ обычная секция, на телефоне — accordion. */
export function MobileAccordionSection({
  title,
  children,
  defaultOpen = false,
}: MobileAccordionSectionProps) {
  return (
    <details
      open={defaultOpen}
      className="group mx-auto my-3 w-full max-w-6xl px-2 max-md:overflow-hidden max-md:rounded-2xl max-md:border max-md:border-fuchsia-200 max-md:bg-white/75 max-md:shadow-sm max-md:backdrop-blur md:contents"
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold uppercase tracking-wide text-foreground md:hidden [&::-webkit-details-marker]:hidden">
        <span className="inline-flex w-full items-center justify-between gap-2">
          {title}
          <span className="text-fuchsia-700">+</span>
        </span>
      </summary>
      <div className="max-md:-mt-2 md:contents">{children}</div>
    </details>
  );
}
