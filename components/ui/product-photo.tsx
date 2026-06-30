"use client";

import { useRef, useState } from "react";

import { assetUrl } from "@/lib/asset-url";
import { imageFallbackChain } from "@/lib/image-fallback-chain";
import { cn } from "@/lib/utils";

type ProductPhotoProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src"
> & {
  src: string;
  /** Доп. URL после автоматической цепочки jpg/png */
  fallbacks?: string[];
};

/**
 * Обычный img (без next/image): меньше сюрпризов на Safari.
 * При ошибке webp пробует jpg/png с тем же именем.
 */
export function ProductPhoto({
  src,
  fallbacks = [],
  className,
  onError,
  alt = "",
  ...props
}: ProductPhotoProps) {
  const buildChain = (s: string) => [
    ...imageFallbackChain(s),
    ...fallbacks.map((u) => assetUrl(u)),
  ];
  const chainRef = useRef(buildChain(src));
  const [currentSrc, setCurrentSrc] = useState(() => assetUrl(src));

  // Когда меняется проп src (например, листаем карусель), сбрасываем
  // картинку и цепочку фолбэков на новое фото. Без этого useState/useRef
  // «застывают» на первом фото и все слайды показывают одно и то же.
  const prevSrc = useRef(src);
  if (prevSrc.current !== src) {
    prevSrc.current = src;
    chainRef.current = buildChain(src);
    setCurrentSrc(assetUrl(src));
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- надёжнее next/image на мобиле
    <img
      {...props}
      alt={alt}
      src={currentSrc}
      className={cn(className)}
      onError={(e) => {
        const next = chainRef.current.shift();
        if (next) {
          setCurrentSrc(next);
          return;
        }
        onError?.(e);
      }}
    />
  );
}
