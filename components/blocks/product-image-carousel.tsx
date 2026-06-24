"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ImageLightbox } from "@/components/ui/image-lightbox";
import { cn } from "@/lib/utils";

type Props = {
  imageMain: string;
  gallery: string[];
  priority?: boolean;
  /** id стиля из витрины: life | speed | rainy */
  catalogDesignId?: string;
};

/** В галерее «No rainy days» файл `2.*` показываем целиком в рамке; остальные — crop как раньше. */
function isRainyGalleryFile2(src: string): boolean {
  return /\/rainy\/2\.(jpe?g|png|webp)/i.test(src);
}

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
  catalogDesignId,
}: Props) {
  const slides = useMemo(
    () => uniqueSlides(imageMain, gallery),
    [imageMain, gallery],
  );
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef<number | null>(null);
  const suppressTapOpen = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const n = slides.length;

  const scrollToIndex = useCallback((next: number, smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = ((next % n) + n) % n;
    el.scrollTo({
      left: clamped * el.clientWidth,
      behavior: smooth ? "smooth" : "auto",
    });
    setIndex(clamped);
  }, [n]);

  const go = (dir: -1 | 1) => {
    scrollToIndex(index + dir);
  };

  useEffect(() => {
    setIndex(0);
    const el = scrollRef.current;
    if (el) el.scrollLeft = 0;
  }, [imageMain, gallery]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      if (scrollRaf.current !== null) return;
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = null;
        const width = el.clientWidth;
        if (width <= 0) return;
        const next = Math.round(el.scrollLeft / width);
        setIndex((prev) => (prev === next ? prev : next));
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollRaf.current !== null) {
        cancelAnimationFrame(scrollRaf.current);
      }
    };
  }, [n]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    suppressTapOpen.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      suppressTapOpen.current = true;
    }
  };

  const onTouchEnd = () => {
    touchStartX.current = null;
    touchStartY.current = null;
  };

  if (n === 0) return null;

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-3">
      <div className="relative w-full max-w-full min-w-0">
        <div
          ref={scrollRef}
          className="flex aspect-[4/5] w-full max-w-full touch-manipulation snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-xl bg-white [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          role="region"
          aria-roledescription="карусель"
          aria-label="Фотографии товара"
        >
          {slides.map((src, idx) => (
            <div
              key={`${src}-${idx}`}
              className="relative h-full w-full min-w-full shrink-0 grow-0 basis-full snap-center snap-always"
            >
              <button
                type="button"
                onClick={() => {
                  if (suppressTapOpen.current) {
                    suppressTapOpen.current = false;
                    return;
                  }
                  scrollToIndex(idx, false);
                  setLightboxOpen(true);
                }}
                className="relative block h-full w-full"
                aria-label="Открыть фото на весь экран"
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  className={
                    catalogDesignId === "rainy" && isRainyGalleryFile2(src)
                      ? "object-contain"
                      : "object-cover"
                  }
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  unoptimized
                  priority={priority && idx === 0}
                  draggable={false}
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
                onClick={() => scrollToIndex(idx)}
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
