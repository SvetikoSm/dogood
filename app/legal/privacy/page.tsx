import Link from "next/link";

const UPDATED_AT = "06.04.2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="site-color-bg min-h-screen">
      <section className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-fuchsia-200 bg-white/90 p-6 shadow-[0_20px_60px_rgba(168,85,247,0.14)] sm:p-8">
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight text-foreground sm:text-4xl">
            Политика обработки персональных данных
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Редакция от {UPDATED_AT}</p>

          <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
            <section>
              <h2 className="font-semibold uppercase tracking-wide">1. Какие данные обрабатываются</h2>
              <p className="mt-2">
                Мы можем обрабатывать: имя, email, телефон, адрес доставки, комментарий к заказу,
                параметры заказа (размер, цвет, стиль, данные о питомце), а также фото, загруженные
                вами для подготовки макета.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">2. Цели обработки</h2>
              <p className="mt-2">
                Персональные данные обрабатываются только для приема, подтверждения и исполнения
                заказа, связи с покупателем, подготовки макета, организации доставки, финансового
                учета и урегулирования претензий.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">3. Правовые основания</h2>
              <p className="mt-2">
                Основаниями являются согласие субъекта персональных данных и необходимость
                исполнения договора, заключаемого путем акцепта публичной оферты на сайте.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">4. Действия с данными</h2>
              <p className="mt-2">
                Мы осуществляем сбор, запись, систематизацию, хранение, уточнение, использование,
                передачу в пределах, необходимых для исполнения заказа (например, службе доставки),
                обезличивание, блокирование и удаление данных.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">5. Срок хранения</h2>
              <p className="mt-2">
                Данные хранятся не дольше, чем это необходимо для целей обработки и исполнения
                обязательств, если иной срок не требуется законодательством РФ.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">6. Защита данных</h2>
              <p className="mt-2">
                Мы применяем разумные организационные и технические меры для защиты данных от
                утраты, неправомерного доступа, изменения, раскрытия и уничтожения.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">7. Права субъекта данных</h2>
              <p className="mt-2">
                Вы вправе запросить информацию о своих данных, их уточнение, блокирование, удаление
                и отзыв согласия на обработку, если иное не препятствует исполнению заказа и не
                противоречит требованиям закона.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">8. Контакты по вопросам ПДн</h2>
              <p className="mt-2">
                По вопросам обработки персональных данных вы можете обратиться в Telegram:
                <a
                  href="https://t.me/DoGoodBrand"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 font-semibold text-fuchsia-700 hover:text-fuchsia-600"
                >
                  @DoGoodBrand
                </a>
                .
              </p>
            </section>
          </div>

          <div className="mt-8">
            <Link
              href="/"
              className="text-sm font-semibold text-fuchsia-700 hover:text-fuchsia-600"
            >
              ← Вернуться на сайт
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
