"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { ImageLightbox } from "@/components/ui/image-lightbox";
import { ProductPhoto } from "@/components/ui/product-photo";
import { cn } from "@/lib/utils";

type Props = {
  imageMain: string;
  gallery: string[];
  priority?: boolean;
  catalogDesignId?: string;
};

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
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const suppressTapOpen = useRef(false);

  const n = slides.length;
  const current = slides[index] ?? slides[0] ?? "";
  const contain =
    catalogDesignId === "rainy" && current && isRainyGalleryFile2(current);

  const go = (dir: -1 | 1) => {
    setIndex((prev) => (prev + dir + n) % n);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    suppressTapOpen.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dx > 10 && dx > dy) suppressTapOpen.current = true;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (dx > 48) go(-1);
    else if (dx < -48) go(1);
  };

  if (n === 0 || !current) return null;

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-3">
      <div
        className="product-photo-frame [touch-action:pan-x_pinch-zoom]"
        style={{ aspectRatio: "4/5" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="region"
        aria-roledescription="карусель"
        aria-label="Фотографии товара"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (suppressTapOpen.current) {
              suppressTapOpen.current = false;
              return;
            }
            setLightboxOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setLightboxOpen(true);
            }
          }}
          className="h-full w-full cursor-pointer"
          aria-label="Открыть фото на весь экран"
        >
          <ProductPhoto
            src={current}
            alt="Фото стиля"
            style={{
              width: "100%",
              height: "100%",
              objectFit: contain ? "contain" : "cover",
              display: "block",
            }}
            loading={priority && index === 0 ? "eager" : "lazy"}
            decoding="async"
          />
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
        src={current}
        alt="Фото стиля"
        onClose={() => setLightboxOpen(false)}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
      />
    </div>
  );
}
