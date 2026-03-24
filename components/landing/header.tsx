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
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <a
          href="#hero"
          className="font-display text-xl font-bold uppercase tracking-[0.18em] text-fuchsia-700 sm:text-2xl"
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
          className="shrink-0 px-4 py-2 text-xs sm:px-6 sm:text-sm"
        >
          заказать футболку
        </DogoodButtonLink>
      </div>
      <nav className="flex justify-center gap-3 overflow-x-auto border-t border-fuchsia-200/70 px-4 py-2 lg:hidden">
        {nav.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-neutral-700 hover:text-dogood-pink"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
