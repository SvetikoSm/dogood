"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/** Персонаж в hero — только md+ (на телефоне не грузим картинку). */
export function HeroPersonImage() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setShow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!show) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center">
      <Image
        src="/products/hero-person.webp"
        alt="Амбассадор DOGOOD"
        width={520}
        height={900}
        className="block h-[51vh] w-auto object-contain sm:h-[55vh] lg:h-[59vh]"
        unoptimized
        priority
      />
    </div>
  );
}
