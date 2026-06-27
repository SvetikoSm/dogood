"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type MobileAccordionSectionProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

/**
 * На телефоне: контент монтируется только при раскрытии (меньше параллельных запросов).
 * На md+: одна копия в DOM, секции всегда видны.
 */
export function MobileAccordionSection({
  title,
  children,
  defaultOpen = false,
}: MobileAccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const showChildren = isDesktop || open;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group mx-auto my-3 w-full max-w-6xl px-2 max-md:overflow-hidden max-md:rounded-2xl max-md:border max-md:border-fuchsia-200 max-md:bg-white/75 max-md:shadow-sm max-md:backdrop-blur md:contents"
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold uppercase tracking-wide text-foreground md:hidden [&::-webkit-details-marker]:hidden">
        <span className="inline-flex w-full items-center justify-between gap-2">
          {title}
          <span className="text-fuchsia-700">+</span>
        </span>
      </summary>
      <div className="max-md:-mt-2 md:contents">
        {showChildren ? children : null}
      </div>
    </details>
  );
}
