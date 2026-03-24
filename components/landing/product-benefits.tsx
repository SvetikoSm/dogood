import { Card } from "@/components/ui/card";
import { Section, SectionHeading } from "@/components/ui/section";

const benefits = [
  {
    title: "Ткань премиум‑класса",
    text: "Плотный хлопок и устойчивая структура — вещь держит форму и приятна к телу.",
  },
  {
    title: "Современная печать",
    text: "Яркие цвета и аккуратное нанесение без «короба» на груди — носится комфортно и выглядит дорого.",
  },
  {
    title: "Стойкость к стирке",
    text: "Принт держится на футболке в хорошем качестве после десятков циклов стирки при бережном уходе.",
  },
  {
    title: "Oversize‑посадка",
    text: "Свободный крой и продуманные пропорции — сидит современно на разных типах фигур.",
  },
  {
    title: "Унисекс",
    text: "Линейка без навязчивого гендерного деления — лекала подходят всем, кто любит собак.",
  },
];

export function ProductBenefits() {
  return (
    <Section id="benefits" surfaceClassName="bg-transparent">
      <SectionHeading
        eyebrow="продукт"
        title="Почему наши вещи живут долго"
        description="Без громких обещаний — только то, что проверяем сами и показываем в макетах до производства."
      />
      <div className="flex flex-wrap justify-center gap-5">
        {benefits.map((b) => (
          <Card key={b.title} className="w-full max-w-sm sm:w-[calc(50%-0.625rem)] lg:w-[calc(33.333%-0.9rem)]">
            <h3 className="font-display text-lg font-semibold uppercase tracking-wide text-foreground">
              {b.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {b.text}
            </p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
