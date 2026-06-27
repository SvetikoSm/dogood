import { BelowFoldSections } from "@/components/landing/below-fold-sections";
import Catalog from "@/components/landing/catalog";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { OrderForm } from "@/components/landing/order-form";

export default function Home() {
  return (
    <>
      <Header />
      <main className="site-color-bg flex-1">
        <Hero />
        <Catalog />
        <BelowFoldSections />
        <OrderForm />
      </main>
      <Footer />
    </>
  );
}
