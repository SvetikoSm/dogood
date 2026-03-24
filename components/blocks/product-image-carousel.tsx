"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { ImageLightbox } from "@/components/ui/image-lightbox";
import { cn } from "@/lib/utils";

type Props = {
  imageMain: string;
  gallery: string[];
  priority?: boolean;
};

function uniqueSlides(imageMain: string, gallery: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of [imageMain, ...gallery]) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

export function ProductImageCarousel({
  imageMain,
  gallery,
  priority,
}: Props) {
  const slides = useMemo(
    () => uniqueSlides(imageMain, gallery),
    [imageMain, gallery],
  );
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const n = slides.length;
  const go = (dir: -1 | 1) => {
    setIndex((prev) => (prev + dir + n) % n);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (dx > 48) go(-1);
    else if (dx < -48) go(1);
  };

  if (n === 0) return null;

  return (
    <div className="flex w-full flex-col gap-3">
      <div
        className="relative aspect-[4/5] w-full overflow-hidden rounded-xl bg-white touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        role="region"
        aria-roledescription="карусель"
        aria-label="Фотографии товара"
      >
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{
            width: `${n * 100}%`,
            transform: `translateX(-${(index / n) * 100}%)`,
          }}
        >
          {slides.map((src, idx) => (
            <div
              key={`${src}-${idx}`}
              className="relative h-full flex-shrink-0"
              style={{ width: `${100 / n}%` }}
            >
              <button
                type="button"
                onClick={() => {
                  setIndex(idx);
                  setLightboxOpen(true);
                }}
                className="relative block h-full w-full"
                aria-label="Открыть фото на весь экран"
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  unoptimized
                  priority={priority && idx === 0}
                />
              </button>
            </div>
          ))}
        </div>

        {n > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-fuchsia-200 bg-white/80 text-fuchsia-700 backdrop-blur-sm transition hover:bg-white md:left-3"
              aria-label="Предыдущее фото"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-fuchsia-200 bg-white/80 text-fuchsia-700 backdrop-blur-sm transition hover:bg-white md:right-3"
              aria-label="Следующее фото"
            >
              <ChevronRight className="h-6 w-6" aria-hidden />
            </button>
          </>
        ) : null}
      </div>

      {n > 1 ? (
        <>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {slides.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setIndex(idx)}
                className={cn(
                  "h-2 rounded-full transition-all",
                  idx === index
                    ? "w-6 bg-dogood-pink"
                    : "w-2 bg-fuchsia-300/50 hover:bg-fuchsia-400/60",
                )}
                aria-label={`Фото ${idx + 1} из ${n}`}
              />
            ))}
          </div>
          <p className="text-center text-[11px] text-muted-foreground sm:text-xs">
            Стрелки, точки внизу или свайп влево/вправо
          </p>
        </>
      ) : null}
      <ImageLightbox
        open={lightboxOpen}
        src={slides[index] ?? ""}
        alt="Фото стиля"
        onClose={() => setLightboxOpen(false)}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
      />
    </div>
  );
}
