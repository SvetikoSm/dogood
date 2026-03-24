import type { ReactNode } from "react";
import { GlowCard } from "@/components/ui/spotlight-card";

type SectionProps = {
  id?: string;
  children: ReactNode;
  className?: string;
  surfaceClassName?: string;
  /** Обводка с подсветкой под курсором (spotlight) */
  useSpotlight?: boolean;
};

export function Section({
  id,
  children,
  className = "",
  surfaceClassName = "",
  useSpotlight = true,
}: SectionProps) {
  return (
    <section id={id} className={`relative scroll-mt-24 ${surfaceClassName}`}>
      <div
        className={`mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24 ${className}`}
      >
        {useSpotlight ? (
          <GlowCard
            customSize
            glowColor="purple"
            className="w-full max-w-none border-fuchsia-200/70 bg-white/70 !p-5 shadow-[0_20px_60px_rgba(236,72,153,0.12)] sm:!p-8"
          >
            {children}
          </GlowCard>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto mb-7 max-w-2xl text-center lg:mb-10">
      {eyebrow ? (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-dogood-muted">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="font-display text-3xl font-bold uppercase tracking-tight text-foreground sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}
