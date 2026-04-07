import { Section, SectionHeading } from "@/components/ui/section";

const faqItems = [
  {
    q: "Сколько длится производство?",
    a: "Макет готовим за 1–2 дня. После вашего одобрения подготовка к печати занимает обычно 3–5 рабочих дней. Если заказ срочный — напишите в комментариях к заявке, постараемся найти решение.",
  },
  {
    q: "Как доставляете?",
    a: "Отправляем из Москвы через СДЭК до ПВЗ по России. Посылка уходит с Большой Новодмитровской улицы в Москве — если нужен точный расчёт, введите этот адрес (или ближайший пункт приёма СДЭК рядом с ним) как отправление в калькуляторе на cdek.ru. На сайте DOGOOD доставку не списываем: в форме только ориентир; оплата перевозчику при получении.",
  },
  {
    q: "Можно ли вернуть вещь?",
    a: "Индивидуальная печать по вашему фото не подлежит возврату, если нет брака. Если обнаружили дефект ткани или нанесения — напишите в течение 14 дней, разберёмся и предложим замену или компенсацию.",
  },
  {
    q: "Что если фото плохого качества?",
    a: "Ничего страшного — подойдут собаки, кошки и другие питомцы. Желательно прислать 2–3 снимка: мордочка и кадр в полный рост. Остальное команда доработает под печать.",
  },
  {
    q: "Как подтверждается пожертвование?",
    a: "Для каждого заказа мы сохраняем привязку к выбранному приюту в базе, переводим средства в конкретную организацию и фиксируем данные. На этапе масштабирования публикуем сводную отчётность в том же духе открытости, что и сами приюты в своей отчётности.",
  },
  {
    q: "Есть ли международная доставка?",
    a: "Сейчас фокус на РФ. Если нужен другой регион — уточним индивидуально.",
  },
];

export function Faq() {
  return (
    <Section id="faq" surfaceClassName="bg-transparent">
      <SectionHeading
        eyebrow="вопросы"
        title="FAQ"
        description="Если чего-то не хватает — напишите на почту или в мессенджер."
      />
      <div className="mx-auto max-w-3xl divide-y divide-fuchsia-200 rounded-3xl border border-fuchsia-200 bg-white/80 shadow-[0_16px_40px_rgba(168,85,247,0.1)]">
        {faqItems.map((item) => (
          <details
            key={item.q}
            className="group px-5 py-4 open:bg-fuchsia-50/70 sm:px-6 sm:py-5"
          >
            <summary className="cursor-pointer list-none font-display text-base font-semibold uppercase tracking-wide text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-4">
                {item.q}
                <span className="text-dogood-pink transition-transform duration-300 group-open:rotate-45">
                  +
                </span>
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </Section>
  );
}
