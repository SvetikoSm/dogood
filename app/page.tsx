import dynamic from "next/dynamic";

import { BelowFoldSections } from "@/components/landing/below-fold-sections";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";

const Catalog = dynamic(() => import("@/components/landing/catalog"), {
  loading: () => (
    <section
      id="catalog"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6 lg:px-8"
      aria-busy="true"
      aria-label="Загрузка каталога"
    />
  ),
});

export default function Home() {
  return (
    <>
      <Header />
      <main className="site-color-bg flex-1">
        <Hero />
        <Catalog />
        <BelowFoldSections />
      </main>
      <Footer />
    </>
  );
}
