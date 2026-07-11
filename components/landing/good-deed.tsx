import { Section, SectionHeading } from "@/components/ui/section";

const donations = [
  { shelter: "Фонд «Сиба-Ину»", amount: "9000 ₽" },
  { shelter: "Френчбуль Хелп", amount: "2500 ₽" },
  { shelter: "Shelter tails", amount: "6100 ₽" },
  { shelter: "Искра", amount: "500 ₽" },
  { shelter: "Супер Собака", amount: "500 ₽" },
];

export function GoodDeed() {
  return (
    <Section id="good-deed" surfaceClassName="bg-transparent">
      <SectionHeading
        eyebrow="помощь"
        title="Ваше доброе дело"
        description="Благодаря невероятным клиентам DOGOOD было переведено в помощь:"
      />
      <div className="mx-auto max-w-3xl rounded-3xl border border-fuchsia-200 bg-white/80 p-5 shadow-[0_16px_40px_rgba(168,85,247,0.1)] sm:p-6">
        <ul className="space-y-3">
          {donations.map((item) => (
            <li
              key={item.shelter}
              className="flex items-center justify-between gap-4 rounded-2xl border border-fuchsia-100 bg-white/85 px-4 py-3"
            >
              <span className="text-sm font-medium text-foreground sm:text-base">
                {item.shelter}
              </span>
              <span className="text-sm font-semibold text-dogood-pink sm:text-base">
                {item.amount}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Все пожертвования пойдут на корм, лечение и товары для приютов.
        </p>
      </div>
    </Section>
  );
}
