import { Section } from "@/components/ui/section";

export function About() {
  return (
    <Section id="about" surfaceClassName="bg-transparent">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-dogood-muted">
            миссия
          </p>
          <h2 className="font-display text-3xl font-bold uppercase tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Миссия
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Помогаем владельцам питомцев поддерживать приюты и сохранять память о
            своём любимце в вещи, которую действительно хочется носить.
          </p>
          <div className="mt-6 space-y-3 text-base leading-relaxed text-muted-foreground">
            <p>Мы делаем стильные принты, а не «футболки для дачи».</p>
            <p>
              20% прибыли с каждого заказа отправляем в приют, который выбираете вы.
            </p>
            <p>
              Все переводы фиксируем и публикуем прозрачную агрегированную отчётность.
            </p>
            <p className="rounded-2xl border border-fuchsia-200 bg-white/80 p-4 text-foreground">
              <span className="font-semibold text-dogood-pink">Важно:</span>{" "}
              вклад клиента всегда привязан к конкретному приюту, а не к
              абстрактному «фонду».
            </p>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-3xl border border-fuchsia-200 bg-gradient-to-br from-dogood-pink-soft via-white to-dogood-yellow-soft p-10 shadow-[0_20px_50px_rgba(244,114,182,0.15)]">
          <p className="font-display text-4xl font-bold uppercase leading-tight text-foreground sm:text-5xl">
            20%
          </p>
          <p className="mt-2 text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            от прибыли — в приют по вашему выбору
          </p>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            Превращаем любовь к одному хвостику в заботу о многих.
          </p>
        </div>
      </div>
    </Section>
  );
}
