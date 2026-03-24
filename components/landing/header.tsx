"use client";

import { useEffect, useState } from "react";
import { DogoodButtonLink } from "@/components/ui/dogood-button";

const nav = [
  { href: "#hero", label: "главная" },
  { href: "#how", label: "как это работает" },
  { href: "#catalog", label: "каталог" },
  { href: "#about", label: "миссия" },
  { href: "#faq", label: "FAQ" },
  { href: "#contacts", label: "контакты" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b border-transparent transition-all duration-300 ${
        scrolled
          ? "border-fuchsia-200/70 bg-white/80 shadow-lg backdrop-blur-md"
          : "bg-white/65 backdrop-blur-sm"
      }`}
    >
      <div
        className="h-0.5 w-full bg-gradient-to-r from-dogood-pink via-dogood-yellow to-dogood-pink"
        aria-hidden
      />
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3 lg:px-8">
        <a
          href="#hero"
          className="rounded-full border border-fuchsia-200/80 bg-white/80 px-3 py-1.5 font-display text-lg font-bold uppercase tracking-[0.16em] text-fuchsia-700 shadow-sm sm:text-2xl"
        >
          DOGOOD
        </a>
        <nav className="hidden items-center gap-6 text-xs font-medium uppercase tracking-wider text-neutral-700 lg:flex">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-dogood-pink"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <DogoodButtonLink
          href="#order"
          variant="primary"
          className="shrink-0 px-3 py-2 text-[11px] sm:px-6 sm:text-sm"
        >
          заказать футболку
        </DogoodButtonLink>
      </div>
      <nav className="flex gap-2 overflow-x-auto border-t border-fuchsia-200/70 bg-white/75 px-3 py-2.5 lg:hidden">
        {nav.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="whitespace-nowrap rounded-full border border-fuchsia-200 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-700 transition-colors hover:border-dogood-pink/60 hover:text-dogood-pink"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
