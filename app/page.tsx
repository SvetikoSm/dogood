import dynamic from "next/dynamic";

import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
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

const HowItWorks = dynamic(
  () => import("@/components/landing/how-it-works").then((m) => m.HowItWorks),
);

const About = dynamic(() =>
  import("@/components/landing/about").then((m) => m.About),
);

const GoodDeed = dynamic(() =>
  import("@/components/landing/good-deed").then((m) => m.GoodDeed),
);

const Shelters = dynamic(() =>
  import("@/components/landing/shelters").then((m) => m.Shelters),
);

const ProductBenefits = dynamic(() =>
  import("@/components/landing/product-benefits").then((m) => m.ProductBenefits),
);

const Reviews = dynamic(() =>
  import("@/components/landing/reviews").then((m) => m.Reviews),
);

const Faq = dynamic(() => import("@/components/landing/faq").then((m) => m.Faq));

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
