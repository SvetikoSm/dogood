import Link from "next/link";

const UPDATED_AT = "06.04.2026";

export default function PublicOfferPage() {
  return (
    <main className="site-color-bg min-h-screen">
      <section className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-fuchsia-200 bg-white/90 p-6 shadow-[0_20px_60px_rgba(168,85,247,0.14)] sm:p-8">
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight text-foreground sm:text-4xl">
            Публичная оферта и условия заказа
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Редакция от {UPDATED_AT}</p>

          <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
            <section>
              <h2 className="font-semibold uppercase tracking-wide">1. Общие положения</h2>
              <p className="mt-2">
                Этот документ является предложением заключить договор розничной купли-продажи
                футболок по индивидуальному заказу. Оформление заявки на сайте означает акцепт
                оферты и согласие с ее условиями.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">2. Заказ и оплата</h2>
              <p className="mt-2">
                Заказ считается принятым после подтверждения менеджером. Перед запуском в работу
                мы отправляем макет на согласование. Оплата производится после подтверждения
                заказа по реквизитам, направленным покупателю.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">3. Индивидуальный характер товара</h2>
              <p className="mt-2">
                Товар изготавливается по персональным параметрам покупателя (стиль, имя питомца,
                фото и иные данные). Допустимы незначительные отличия цвета и расположения
                элементов от изображения на экране из-за особенностей печати и устройств.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">4. Доставка</h2>
              <p className="mt-2">
                Сроки и стоимость доставки зависят от выбранного способа и адреса. Риск случайной
                гибели или повреждения товара переходит к покупателю с момента передачи заказа
                службе доставки, если иное не предусмотрено обязательными нормами права.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">5. Уход за изделием</h2>
              <p className="mt-2">
                Покупатель обязуется соблюдать рекомендации по уходу за изделием (температурный
                режим, режим стирки, сушка, глажка). Продавец не несет ответственность за дефекты
                товара, возникшие вследствие нарушения правил ухода или использования изделия не по
                назначению.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">6. Ограничение ответственности</h2>
              <p className="mt-2">
                В максимально допустимом законом объеме продавец не отвечает за косвенные убытки,
                упущенную выгоду, а также за любой вред имуществу покупателя и третьих лиц,
                возникший из-за неправильной эксплуатации товара, несоблюдения инструкций по уходу
                или использования неподходящих режимов стирки/сушки.
              </p>
              <p className="mt-2">
                Продавец также не отвечает за сбои и задержки, вызванные работой служб доставки,
                платежных систем, хостинга, операторов связи и иными обстоятельствами вне разумного
                контроля продавца.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">7. Возврат и претензии</h2>
              <p className="mt-2">
                Претензии по качеству принимаются в разумный срок после получения заказа с фото
                подтверждением. Возврат товара надлежащего качества, изготовленного по
                индивидуальному заказу, осуществляется с учетом ограничений, установленных
                законодательством РФ.
              </p>
            </section>

            <section>
              <h2 className="font-semibold uppercase tracking-wide">8. Прочие условия</h2>
              <p className="mt-2">
                Ко всем отношениям сторон применяется право Российской Федерации. Если какое-либо
                условие оферты будет признано недействительным, остальные условия сохраняют силу.
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
