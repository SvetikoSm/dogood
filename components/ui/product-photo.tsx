"use client";

import { useRef, useState } from "react";

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
  const chainRef = useRef([...imageFallbackChain(src), ...fallbacks]);
  const [currentSrc, setCurrentSrc] = useState(src);

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
