"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

type ImageLightboxProps = {
  open: boolean;
  src: string;
  alt?: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
};

export function ImageLightbox({
  open,
  src,
  alt = "Увеличенное изображение",
  onClose,
  onPrev,
  onNext,
}: ImageLightboxProps) {
  const isBrowser = typeof window !== "undefined";

  useEffect(() => {
    if (!open) return;

    // Prevent background scroll while the lightbox is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, onPrev, onNext]);

  if (!open || !src) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/85 p-3 sm:p-4"
      onPointerDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр изображения"
    >
      <div
        className="relative h-[calc(100vh-1.75rem)] w-full max-w-5xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/92 text-xl font-bold text-neutral-900 shadow-sm hover:bg-white"
          aria-label="Закрыть изображение"
        >
          ×
        </button>
        {onPrev ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
            className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/92 px-3 py-2 text-sm font-semibold text-neutral-900 shadow-sm hover:bg-white"
            aria-label="Предыдущее изображение"
          >
            ←
          </button>
        ) : null}
        {onNext ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/92 px-3 py-2 text-sm font-semibold text-neutral-900 shadow-sm hover:bg-white"
            aria-label="Следующее изображение"
          >
            →
          </button>
        ) : null}
        <Image src={src} alt={alt} fill className="object-contain" unoptimized />
      </div>
    </div>
  );

  if (!isBrowser) return overlay;
  return createPortal(overlay, document.body);
}
