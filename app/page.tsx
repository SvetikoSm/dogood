import { About } from "@/components/landing/about";
import Catalog from "@/components/landing/catalog";
import { Faq } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { OrderForm } from "@/components/landing/order-form";
import { ProductBenefits } from "@/components/landing/product-benefits";
import { Reviews } from "@/components/landing/reviews";
import { Shelters } from "@/components/landing/shelters";
import { MobileAccordionSection } from "@/components/ui/mobile-accordion-section";

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
