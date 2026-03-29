"use client";

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Card } from "@/components/ui/card";
import { Section, SectionHeading } from "@/components/ui/section";
import { shelters } from "@/lib/landing-data";

function ShelterModalClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute right-3 top-3 z-10 rounded-full border border-fuchsia-200 bg-white px-3 py-1 text-lg font-bold text-neutral-900 shadow-sm hover:bg-fuchsia-50"
      aria-label="Закрыть"
    >
      ×
    </button>
  );
}

export function Shelters() {
  const [activeShelterId, setActiveShelterId] = useState<string | null>(null);
  const activeShelter = shelters.find((s) => s.id === activeShelterId) ?? null;

  useEffect(() => {
    if (!activeShelterId) return;

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
        eyebrow="приюты"
        title="Приюты"
        description="Организации, которым мы направляем часть средств. Список будем расширять — следите за обновлениями."
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
              if (e.pointerType === "touch") setActiveShelterId(s.id);
            }}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveShelterId(s.id);
              }
            }}
          >
            <h3 className="font-display text-xl font-semibold uppercase tracking-wide text-foreground">
              {s.name}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {s.description}
            </p>
            <div className="mt-auto flex flex-col gap-2 pt-4">
              {s.socialLinks.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex text-sm font-medium text-dogood-pink hover:underline"
                >
                  {link.label}
                </a>
              ))}
            </div>
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
          {/* Desktop */}
          <div
            className="relative hidden max-h-[90vh] w-full max-w-3xl flex-col overflow-y-auto rounded-3xl border border-fuchsia-200 bg-white shadow-[0_30px_90px_rgba(0,0,0,0.2)] sm:flex"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Информация о приюте ${activeShelter.name}`}
          >
            <ShelterModalClose onClose={() => setActiveShelterId(null)} />
            <div className="space-y-4 p-5 pb-6 pr-14 pt-5 sm:p-6 sm:pr-16">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-dogood-muted">
                  {activeShelter.city}
                </p>
                <h3 className="mt-1 font-display text-2xl font-bold uppercase text-foreground">
                  {activeShelter.name}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {activeShelter.description}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {activeShelter.detailBlocks.map((block) => (
                  <div
                    key={block}
                    className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-3 text-sm text-muted-foreground"
                  >
                    {block}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 border-t border-fuchsia-100 pt-4">
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Ссылки
                </span>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {activeShelter.socialLinks.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-dogood-pink hover:underline"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Mobile fullscreen */}
          <div
            className="relative flex h-full w-full flex-col overflow-hidden bg-white sm:hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Информация о приюте ${activeShelter.name}`}
          >
            <ShelterModalClose onClose={() => setActiveShelterId(null)} />
            <div className="flex-1 overflow-y-auto p-5 pb-8 pr-14 pt-14">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-dogood-muted">
                  {activeShelter.city}
                </p>
                <h3 className="mt-1 font-display text-2xl font-bold uppercase text-foreground">
                  {activeShelter.name}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {activeShelter.description}
                </p>
              </div>

              <div className="mt-4 grid gap-3">
                {activeShelter.detailBlocks.map((block) => (
                  <div
                    key={block}
                    className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-3 text-sm text-muted-foreground"
                  >
                    {block}
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-2 border-t border-fuchsia-100 pt-4">
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Ссылки
                </span>
                <div className="flex flex-col gap-2">
                  {activeShelter.socialLinks.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-dogood-pink hover:underline"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
