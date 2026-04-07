import { Card } from "@/components/ui/card";
import { Section, SectionHeading } from "@/components/ui/section";

const steps = [
  {
    title: "Выбор стиля",
    body: "Выберите 1 из 3 стилей для вашего принта.",
    highlight: false,
  },
  {
    title: "Фото питомца",
    body: "Загрузите 2–3 снимка: мордочка и полный рост.",
    highlight: false,
  },
  {
    title: "Приют",
    body: "Выберите приют из списка. Туда пойдут 20% прибыли.",
    highlight: false,
  },
  {
    title: "Макет и оплата",
    body: "Сначала показываем макет. Оплата только после вашего «ок».",
    highlight: true,
  },
  {
    title: "Доставка",
    body: "Печатаем в Москве и отправляем выбранной службой.",
    highlight: false,
  },
];

export function HowItWorks() {
  return (
    <Section id="how" surfaceClassName="bg-transparent">
      <SectionHeading
        eyebrow="процесс"
        title="Как это работает"
        description="Пять простых шагов от идеи до посылки."
      />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((step, i) => (
          <Card
            key={step.title}
            className={`flex flex-col gap-4 ${
              step.highlight
                ? "ring-2 ring-dogood-pink/70 ring-offset-2 ring-offset-transparent"
                : ""
            }`}
          >
            <span className="font-display text-2xl font-bold text-dogood-pink/90">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="font-display text-base font-semibold uppercase tracking-wide text-foreground sm:text-lg">
              {step.title}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              {step.body}
            </p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
