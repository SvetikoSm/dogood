 "use client";

import Image from "next/image";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Card } from "@/components/ui/card";
import { Section, SectionHeading } from "@/components/ui/section";
import { shelters } from "@/lib/landing-data";

export function Shelters() {
  const [activeShelterId, setActiveShelterId] = useState<string | null>(null);
  const activeShelter = shelters.find((s) => s.id === activeShelterId) ?? null;

  useEffect(() => {
    if (!activeShelterId) return;

    // Prevent background scroll while modal is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setActiveShelterId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [activeShelterId]);

  return (
    <Section id="shelters" surfaceClassName="bg-transparent">
      <SectionHeading
        eyebrow="партнёры"
        title="Приюты"
        description="Примеры партнёров. Список будем расширять — следите за обновлениями."
      />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {shelters.map((s) => (
          <Card
            key={s.id}
            className="flex h-full cursor-pointer flex-col"
            hover
            role="button"
            aria-label={`Открыть информацию о приюте ${s.name}`}
            tabIndex={0}
            onClick={() => setActiveShelterId(s.id)}
            onPointerUp={(e) => {
              // Some mobile browsers require pointer handlers for reliable tap.
              if (e.pointerType === "touch") setActiveShelterId(s.id);
            }}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveShelterId(s.id);
              }
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {s.city}
            </p>
            <h3 className="mt-2 font-display text-xl font-semibold uppercase tracking-wide text-foreground">
              {s.name}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {s.description}
            </p>
            <a
              href={s.socialUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-auto pt-4 inline-flex text-sm font-medium text-dogood-pink hover:underline"
            >
              {s.socialLabel}
            </a>
          </Card>
        ))}
      </div>
      {activeShelter ? (
        <div
          className="fixed inset-0 z-[999] bg-black/55 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveShelterId(null);
          }}
        >
          {/* Desktop modal */}
          <div
            className="hidden h-fit w-full max-w-3xl overflow-hidden rounded-3xl border border-fuchsia-200 bg-white shadow-[0_30px_90px_rgba(0,0,0,0.2)] sm:block"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Информация о приюте ${activeShelter.name}`}
          >
            <div className="relative h-52 w-full sm:h-64">
              <Image
                src={activeShelter.imageUrl}
                alt={activeShelter.name}
                fill
                className="object-cover"
                unoptimized
              />
              <button
                type="button"
                onClick={() => setActiveShelterId(null)}
                className="absolute right-3 top-3 rounded-full bg-white/95 px-3 py-1 text-lg font-bold text-neutral-900"
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-dogood-muted">
                  {activeShelter.city}
                </p>
                <h3 className="mt-1 font-display text-2xl font-bold uppercase text-foreground">
                  {activeShelter.name}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {activeShelter.location}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {activeShelter.detailBlocks.map((block) => (
                  <div
                    key={block}
                    className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-3 text-sm text-muted-foreground"
                  >
                    {block}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-fuchsia-100 pt-3">
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Соцсети:
                </span>
                <a
                  href={activeShelter.socialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-dogood-pink hover:underline"
                >
                  {activeShelter.socialLabel}
                </a>
              </div>
            </div>
          </div>

          {/* Mobile fullscreen modal */}
          <div
            className="flex h-full w-full flex-col bg-white"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Информация о приюте ${activeShelter.name}`}
          >
            <div className="relative h-52 w-full sm:hidden">
              <Image
                src={activeShelter.imageUrl}
                alt={activeShelter.name}
                fill
                className="object-cover"
                unoptimized
              />
              <button
                type="button"
                onClick={() => setActiveShelterId(null)}
                className="absolute right-3 top-3 rounded-full bg-white/95 px-3 py-1 text-lg font-bold text-neutral-900 shadow-sm"
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-dogood-muted">
                  {activeShelter.city}
                </p>
                <h3 className="mt-1 font-display text-2xl font-bold uppercase text-foreground">
                  {activeShelter.name}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {activeShelter.location}
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {activeShelter.detailBlocks.map((block) => (
                  <div
                    key={block}
                    className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-3 text-sm text-muted-foreground"
                  >
                    {block}
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-fuchsia-100 pt-4">
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Соцсети:
                </span>
                <a
                  href={activeShelter.socialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-dogood-pink hover:underline"
                >
                  {activeShelter.socialLabel}
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
