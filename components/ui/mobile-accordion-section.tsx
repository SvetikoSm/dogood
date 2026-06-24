"use client";

import type { ReactNode } from "react";

type MobileAccordionSectionProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function MobileAccordionSection({
  title,
  children,
  defaultOpen = false,
}: MobileAccordionSectionProps) {
  return (
    <>
      <div className="md:hidden px-2">
        <details
          className="mx-auto my-3 w-full max-w-6xl overflow-hidden rounded-2xl border border-fuchsia-200 bg-white/75 shadow-sm backdrop-blur"
          open={defaultOpen}
        >
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold uppercase tracking-wide text-foreground">
            <span className="inline-flex w-full items-center justify-between gap-2">
              {title}
              <span className="text-fuchsia-700">+</span>
            </span>
          </summary>
          <div className="-mt-2">{children}</div>
        </details>
      </div>
      <div className="hidden md:block">{children}</div>
    </>
  );
}
