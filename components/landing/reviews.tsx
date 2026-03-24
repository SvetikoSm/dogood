import { Card } from "@/components/ui/card";
import { Section, SectionHeading } from "@/components/ui/section";

const reviews = [
  {
    name: "Алина",
    city: "Москва",
    text: "Сделали макет быстро, принт аккуратный, футболка плотная. Приятно, что часть ушла в приют, который я выбрала сама — чувствуешь, что покупка не только про вещь.",
  },
  {
    name: "Марк",
    city: "Казань",
    text: "Фото было слабее, чем хотелось, но команда спокойно довела до ума. Оверсайз сидит как надо — минималистично и дерзко.",
  },
  {
    name: "Ксения",
    city: "Санкт-Петербург",
    text: "Заказала подарок подруге на день рождения — у неё такса. Восторг, футболку снимает только в стирку, потом заказала себе такую же вторую.",
  },
];

export function Reviews() {
  return (
    <Section id="reviews" surfaceClassName="bg-transparent">
      <SectionHeading
        eyebrow="голоса"
        title="Отзывы"
        description="Короткие истории клиентов — счастливые собачники, которые дарят счастье тем, кто в нём нуждается."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        {reviews.map((r) => (
          <Card key={r.name + r.city}>
            <p className="font-display text-lg font-semibold uppercase text-foreground">
              {r.name}
            </p>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {r.city}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              «{r.text}»
            </p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
