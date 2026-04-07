export function Footer() {
  return (
    <footer
      id="contacts"
      className="border-t border-fuchsia-200/70 bg-white/75 text-neutral-700 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
        <div>
          <p className="font-display text-2xl font-bold uppercase tracking-[0.2em] text-fuchsia-700">
            DOGOOD
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-neutral-600">
            Футболки с портретом питомца и прозрачной поддержкой приютов.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-dogood-pink">
              Контакты
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a
                  className="transition-colors hover:text-dogood-pink"
                  href="https://t.me/DoGoodBrand"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Telegram · @DoGoodBrand
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-dogood-pink">
              Навигация
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a className="hover:text-dogood-pink" href="#catalog">
                  Каталог
                </a>
              </li>
              <li>
                <a className="hover:text-dogood-pink" href="#shelters">
                  Приюты
                </a>
              </li>
              <li>
                <a className="hover:text-dogood-pink" href="#order">
                  Заявка
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="border-t border-fuchsia-200/70 py-4 text-center text-xs text-neutral-500">
        © {new Date().getFullYear()} DOGOOD. Все права защищены.
      </div>
    </footer>
  );
}
