import dynamic from "next/dynamic";

import { About } from "@/components/landing/about";
import { Faq } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { GoodDeed } from "@/components/landing/good-deed";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ProductBenefits } from "@/components/landing/product-benefits";
import { Reviews } from "@/components/landing/reviews";
import { Shelters } from "@/components/landing/shelters";
import { MobileAccordionSection } from "@/components/ui/mobile-accordion-section";

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

const OrderForm = dynamic(
  () =>
    import("@/components/landing/order-form").then((mod) => mod.OrderForm),
  {
    loading: () => (
      <section
        id="order"
        className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8"
        aria-busy="true"
        aria-label="Загрузка формы заказа"
      />
    ),
  },
);

export default function Home() {
  return (
    <>
      <Header />
      <main className="site-color-bg flex-1">
        <Hero />
        <Catalog />
        <MobileAccordionSection title="Как это работает">
          <HowItWorks />
        </MobileAccordionSection>
        <MobileAccordionSection title="Миссия">
          <About />
        </MobileAccordionSection>
        <MobileAccordionSection title="Ваше доброе дело">
          <GoodDeed />
        </MobileAccordionSection>
        <MobileAccordionSection title="Приюты">
          <Shelters />
        </MobileAccordionSection>
        <MobileAccordionSection title="Почему наши вещи живут долго">
          <ProductBenefits />
        </MobileAccordionSection>
        <MobileAccordionSection title="Отзывы">
          <Reviews />
        </MobileAccordionSection>
        <MobileAccordionSection title="FAQ">
          <Faq />
        </MobileAccordionSection>
        <OrderForm />
      </main>
      <Footer />
    </>
  );
}
