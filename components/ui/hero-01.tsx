"use client";

import Image from "next/image";
import Link from "next/link";
import { PawPrint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GradientWave } from "@/components/ui/gradient-wave";

export function HeroSection01() {
  return (
    <div className="relative flex min-h-[98vh] w-full items-center justify-center overflow-hidden rounded-[2rem] border border-white/50 bg-white/40 px-4 py-16 shadow-[0_30px_120px_rgba(236,72,153,0.2)] backdrop-blur-md sm:min-h-[104vh] sm:px-8 lg:min-h-[108vh]">
      <GradientWave
        colors={["#ffffff", "#fb7185", "#e879f9", "#a3e635", "#ffffff"]}
        shadowPower={4}
        darkenTop={false}
        noiseFrequency={[0.0001, 0.0002]}
        deform={{ incline: 0.2, noiseAmp: 100, noiseFlow: 2 }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center pb-[32vh] text-center sm:pb-[36vh] lg:pb-[40vh]">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-fuchsia-700">
          <PawPrint className="h-4 w-4" />
          Premium streetwear
        </div>

        <h1 className="pt-8 font-display text-4xl font-bold uppercase leading-[1.03] tracking-tight text-neutral-900 sm:text-6xl lg:text-7xl">
          Твоя собака - амбассадор
          <br />
          премиального streetwear бренда
        </h1>

        <p className="mt-6 max-w-2xl text-base leading-relaxed text-neutral-800 sm:text-xl">
          Создаем стильные футболки с вашим хвостатым и отправляем 20% прибыли в приюты.
          Вы сами выбираете, кому именно помочь.
        </p>

        <div className="mt-5 inline-flex items-center rounded-full border-2 border-fuchsia-500 bg-fuchsia-500/15 px-5 py-2 text-sm font-extrabold uppercase tracking-wider text-fuchsia-800 shadow-[0_0_45px_rgba(217,70,239,0.35)]">
          20% прибыли отправляем в приюты
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link href="#order">
            <Button className="h-12 cursor-pointer rounded-full bg-fuchsia-600 px-8 text-sm font-semibold hover:bg-fuchsia-500">
              Заказать футболку
            </Button>
          </Link>
          <Link href="#catalog">
            <Button
              variant="secondary"
              className="h-12 cursor-pointer rounded-full bg-white/75 px-8 text-sm font-semibold text-neutral-900 hover:bg-white"
            >
              Смотреть каталог
            </Button>
          </Link>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-1/2 z-20 -translate-x-1/2">
        <Image
          src="/products/hero-person.png"
          alt="Амбассадор DOGOOD"
          width={520}
          height={900}
          className="h-[51vh] w-auto object-contain sm:h-[55vh] lg:h-[59vh]"
          unoptimized
          priority
        />
      </div>
    </div>
  );
}
