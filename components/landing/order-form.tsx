"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import Image from "next/image";
import { DogoodButton } from "@/components/ui/dogood-button";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Section, SectionHeading } from "@/components/ui/section";
import {
  catalogDesignTemplates,
  deliveryMethods,
  printStyles,
  shelters,
} from "@/lib/landing-data";

const fieldClass =
  "mt-1 w-full rounded-2xl border border-fuchsia-200 bg-white px-4 py-3 text-sm text-foreground outline-none transition-shadow placeholder:text-neutral-500 focus:border-dogood-pink focus:ring-2 focus:ring-dogood-pink/25";

const labelClass =
  "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

const MAX_PHOTOS_PER_LINE = 8;

function PhotoThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [previewBroken, setPreviewBroken] = useState(false);

  // Нельзя держать blob URL в useMemo: в dev Strict Mode эффект отзывает URL, а мемо отдаёт старый (битый) адрес.
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setPreviewBroken(false);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-fuchsia-200 bg-fuchsia-50/40">
      {previewBroken ? (
        <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] leading-tight text-muted-foreground">
          {file.name.slice(0, 12)}…
        </div>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: превью; next/image с blob часто ломается
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setPreviewBroken(true)}
        />
      ) : (
        <div
          className="h-full w-full animate-pulse bg-fuchsia-100/60"
          aria-hidden
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-fuchsia-200 bg-white/95 text-sm font-bold text-neutral-800 shadow-sm hover:bg-fuchsia-50"
        aria-label="Удалить это фото"
      >
        ×
      </button>
    </div>
  );
}

export type OrderLineState = {
  id: string;
  sameAsPrevious: boolean;
  dogName: string;
  breed: string;
  printStyle: string;
  color: string;
};

function createLine(): OrderLineState {
  return {
    id: typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random()),
    sameAsPrevious: false,
    dogName: "",
    breed: "",
    printStyle: printStyles[0]!.value,
    color: "white",
  };
}

function getStyleFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const style = new URLSearchParams(window.location.search).get("style");
  return printStyles.some((s) => s.value === style) ? style : null;
}

export function OrderForm() {
  const SHIRT_PRICE_RUB = 3999;
  const baseId = useId();
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );
  const [deliveryCalcState, setDeliveryCalcState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [deliveryQuote, setDeliveryQuote] = useState<{
    priceRub: number;
    etaDays: string;
    carrierLabel: string;
    note: string;
  } | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState<Record<string, number>>({});
  const [lightboxSrc, setLightboxSrc] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lines, setLines] = useState<OrderLineState[]>([createLine()]);
  /** Фото по строкам заказа; для «как на предыдущей» при отправке копируются с предыдущей строки */
  const [linePhotos, setLinePhotos] = useState<File[][]>([[]]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [lastGoogleWebhook, setLastGoogleWebhook] = useState<
    "skipped" | "ok" | "error" | null
  >(null);

  useEffect(() => {
    const styleFromUrl = getStyleFromUrl();
    if (!styleFromUrl) return;
    setLines((prev) =>
      prev.map((line, idx) =>
        idx === 0 ? { ...line, printStyle: styleFromUrl } : line,
      ),
    );
  }, []);

  useEffect(() => {
    setLinePhotos((prev) => {
      if (prev.length === lines.length) return prev;
      if (prev.length < lines.length) {
        return [
          ...prev,
          ...Array.from({ length: lines.length - prev.length }, () => [] as File[]),
        ];
      }
      return prev.slice(0, lines.length);
    });
  }, [lines.length]);

  const fallbackPreviewByStyle = catalogDesignTemplates.reduce<
    Record<string, string>
  >((acc, item) => {
    acc[item.id] = item.gallery[0] ?? item.imageMain;
    return acc;
  }, {});

  const previewCandidatesByStyle = printStyles.reduce<Record<string, string[]>>(
    (acc, style) => {
      acc[style.value] = [
        `/order-form-styles/${style.value}/2.jpg`,
        `/order-form-styles/${style.value}/2.jpeg`,
        `/order-form-styles/${style.value}/2.png`,
        `/order-form-styles/${style.value}/2.webp`,
        `/products/${style.value}/2.jpg`,
        `/products/${style.value}/2.jpeg`,
        `/products/${style.value}/2.png`,
        `/products/${style.value}/2.webp`,
        fallbackPreviewByStyle[style.value] ?? "",
      ].filter(Boolean);
      return acc;
    },
    {},
  );

  const updateLine = useCallback(
    (index: number, patch: Partial<OrderLineState>) => {
      setLines((prev) =>
        prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
      );
    },
    [],
  );

  const addLine = () => {
    setLines((prev) => [...prev, createLine()]);
    setLinePhotos((prev) => [...prev, []]);
  };

  async function handleDeliveryEstimate() {
    const addressInput = document.getElementById(
      `${baseId}-address`,
    ) as HTMLTextAreaElement | null;
    const methodInput = document.getElementById(
      `${baseId}-delivery`,
    ) as HTMLSelectElement | null;

    const address = addressInput?.value.trim() ?? "";
    const deliveryMethod = methodInput?.value ?? "";

    if (!address || !deliveryMethod) {
      setDeliveryCalcState("error");
      setDeliveryQuote(null);
      return;
    }

    setDeliveryCalcState("loading");
    setDeliveryQuote(null);

    try {
      const res = await fetch("/api/delivery-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, deliveryMethod }),
      });
      if (!res.ok) throw new Error("delivery quote failed");
      const data = (await res.json()) as {
        ok: true;
        quote: {
          priceRub: number;
          etaDays: string;
          carrierLabel: string;
          note: string;
        };
      };
      setDeliveryQuote(data.quote);
      setDeliveryCalcState("idle");
    } catch {
      setDeliveryCalcState("error");
      setDeliveryQuote(null);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPhotoError(null);
    setSubmitError(null);

    for (let i = 0; i < lines.length; i++) {
      const locked = i > 0 && lines[i]!.sameAsPrevious;
      if (locked) continue;
      const photos = linePhotos[i] ?? [];
      if (photos.length < 1) {
        setPhotoError(`Добавьте хотя бы одно фото собаки для футболки ${i + 1}.`);
        return;
      }
    }

    setStatus("sending");
    const form = e.currentTarget;
    const formData = new FormData(form);

    for (let i = 0; i < lines.length; i++) {
      formData.delete(`items[${i}][photos]`);
    }
    for (let i = 0; i < lines.length; i++) {
      const locked = i > 0 && lines[i]!.sameAsPrevious;
      const src = locked ? (linePhotos[i - 1] ?? []) : (linePhotos[i] ?? []);
      for (const file of src) {
        formData.append(`items[${i}][photos]`, file);
      }
    }

    try {
      const res = await fetch("/api/order", {
        method: "POST",
        body: formData,
      });
      const raw = await res.text();
      let data: {
        orderId?: string;
        googleWebhook?: "skipped" | "ok" | "error";
        detail?: string;
      } = {};
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        /* не JSON */
      }
      if (!res.ok) {
        const hint =
          res.status === 413
            ? "Файлы слишком большие для сервера (попробуйте фото меньшего размера)."
            : (data.detail ?? raw.slice(0, 200)) || `Ошибка ${res.status}`;
        setSubmitError(hint);
        setStatus("error");
        setLastOrderId(null);
        setLastGoogleWebhook(null);
        return;
      }
      setLastOrderId(data.orderId ?? null);
      setLastGoogleWebhook(data.googleWebhook ?? "skipped");
      setStatus("done");
      form.reset();
      setLines([createLine()]);
      setLinePhotos([[]]);
    } catch {
      setStatus("error");
      setSubmitError("Сеть или сервер недоступны. Попробуйте позже.");
      setLastOrderId(null);
      setLastGoogleWebhook(null);
    }
  }

  return (
    <Section
      id="order"
      useSpotlight
      surfaceClassName="bg-transparent"
    >
      <SectionHeading
        eyebrow="заявка"
        title="Соберём заказ вместе"
        description="Заполните форму и прикрепите фото собаки — в течение 1–2 дней свяжемся с вами, пришлём макет футболки и данные по оплате."
      />

      <form
        onSubmit={handleSubmit}
        className="mx-auto mt-8 max-w-2xl space-y-8 rounded-3xl border border-fuchsia-200 bg-white/85 p-6 shadow-[0_20px_60px_rgba(168,85,247,0.14)] sm:p-8"
      >
        <div>
          <h3 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
            Заказ футболки
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Стоимость одной футболки:{" "}
            <span className="font-semibold text-foreground">
              {SHIRT_PRICE_RUB.toLocaleString("ru-RU")} ₽
            </span>
            .
          </p>
        </div>

        {lines.map((line, index) => {
          const prev = index > 0 ? lines[index - 1] : null;
          const locked = index > 0 && line.sameAsPrevious && prev;

          return (
            <div
              key={line.id}
              className="space-y-4 border-t border-fuchsia-200 pt-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
                  Футболка {index + 1}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Унисекс, one size — единый оверсайд-крой.
                </p>
              </div>

              {index > 0 ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={line.sameAsPrevious}
                    onChange={(ev) => {
                      const checked = ev.target.checked;
                      if (checked && prev) {
                        updateLine(index, {
                          sameAsPrevious: true,
                          dogName: prev.dogName,
                          breed: prev.breed,
                          printStyle: prev.printStyle,
                          color: prev.color,
                        });
                      } else {
                        updateLine(index, { sameAsPrevious: false });
                      }
                    }}
                    className="rounded border-fuchsia-200"
                  />
                  Как на предыдущей футболке (кличка, порода, стиль, фото)
                </label>
              ) : null}

              <div>
                <label className={labelClass}>
                  Фото собаки (от 1 файла, лучше несколько — можно удалить лишнее)
                </label>
                {!locked ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(linePhotos[index] ?? []).map((file, pi) => (
                        <PhotoThumb
                          key={`${file.name}-${file.size}-${file.lastModified}-${pi}`}
                          file={file}
                          onRemove={() =>
                            setLinePhotos((prev) => {
                              const next = prev.map((a) => [...a]);
                              next[index] = (next[index] ?? []).filter((_, j) => j !== pi);
                              return next;
                            })
                          }
                        />
                      ))}
                    </div>
                    <input
                      id={`photo-pick-${line.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      tabIndex={-1}
                      className="sr-only"
                      aria-hidden
                      onChange={(ev) => {
                        const picked = ev.target.files;
                        if (!picked?.length) return;
                        setLinePhotos((prev) => {
                          const next = prev.map((a) => [...a]);
                          const cur = next[index] ?? [];
                          const merged = [...cur, ...Array.from(picked)].slice(
                            0,
                            MAX_PHOTOS_PER_LINE,
                          );
                          next[index] = merged;
                          return next;
                        });
                        ev.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`Выбрать фото для футболки ${index + 1}`}
                      className={`${fieldClass} inline-flex w-full cursor-pointer items-center justify-center text-center text-sm font-medium text-fuchsia-800`}
                      onClick={() =>
                        document.getElementById(`photo-pick-${line.id}`)?.click()
                      }
                    >
                      + добавить фото (
                      {(linePhotos[index] ?? []).length}/{MAX_PHOTOS_PER_LINE}, минимум 1)
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="hidden"
                      name={`items[${index}][mirrorPhotosFrom]`}
                      value={String(index - 1)}
                    />
                    <p className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 px-4 py-3 text-sm text-muted-foreground">
                      Используем те же фото, что и в позиции {index}.
                    </p>
                  </>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Заказ можно оформить с одним фото. Если есть ещё кадры — лучше: желательно мордочка и
                  снимок в полный рост.
                </p>
              </div>

              {!locked ? (
                <>
                  <div>
                    <label
                      className={labelClass}
                      htmlFor={`${baseId}-dog-${index}`}
                    >
                      Кличка на футболке
                    </label>
                    <input
                      id={`${baseId}-dog-${index}`}
                      name={`items[${index}][dogName]`}
                      required
                      value={line.dogName}
                      onChange={(e) =>
                        updateLine(index, { dogName: e.target.value })
                      }
                      className={fieldClass}
                      placeholder="Как хотите видеть на вещи"
                    />
                  </div>

                  <div>
                    <label
                      className={labelClass}
                      htmlFor={`${baseId}-breed-${index}`}
                    >
                      Порода
                    </label>
                    <input
                      id={`${baseId}-breed-${index}`}
                      name={`items[${index}][breed]`}
                      value={line.breed}
                      onChange={(e) =>
                        updateLine(index, { breed: e.target.value })
                      }
                      className={fieldClass}
                      placeholder="Необязательно"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Необязательно, но так мы ориентируемся на типичные черты
                      породы, если визуала мало.
                    </p>
                  </div>

                  <div className="grid gap-5">
                    <div>
                      <p className={labelClass}>Стиль принта</p>
                      <div className="mt-2 grid grid-cols-3 gap-2 sm:gap-3">
                        {printStyles.map((s) => {
                          const selected = line.printStyle === s.value;
                          const variants = previewCandidatesByStyle[s.value] ?? [];
                          const idx = previewAttempt[s.value] ?? 0;
                          const previewSrc = variants[Math.min(idx, variants.length - 1)] ?? "";
                          return (
                            <label
                              key={s.value}
                              className={`cursor-pointer rounded-2xl border bg-white p-2 transition ${
                                selected
                                  ? "border-dogood-pink ring-2 ring-dogood-pink/30"
                                  : "border-fuchsia-200 hover:border-fuchsia-300"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`items[${index}][printStyle]`}
                                value={s.value}
                                checked={selected}
                                onChange={(e) =>
                                  updateLine(index, { printStyle: e.target.value })
                                }
                                className="sr-only"
                              />
                              <div className="relative mb-2 aspect-square overflow-hidden rounded-xl">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    updateLine(index, { printStyle: s.value });
                                    setLightboxSrc(previewSrc);
                                    setLightboxOpen(true);
                                  }}
                                  className="relative block h-full w-full"
                                  aria-label={`Открыть ${s.label} на весь экран`}
                                >
                                  <Image
                                    src={previewSrc}
                                    alt={s.label}
                                    fill
                                    sizes="(max-width: 640px) 100vw, 33vw"
                                    className="object-cover transition-transform duration-300 hover:scale-105"
                                    unoptimized
                                    onError={() => {
                                      setPreviewAttempt((prev) => {
                                        const current = prev[s.value] ?? 0;
                                        const next = Math.min(current + 1, variants.length - 1);
                                        return { ...prev, [s.value]: next };
                                      });
                                    }}
                                  />
                                </button>
                              </div>
                              <span className="block text-center text-[10px] font-semibold leading-tight text-fuchsia-700 sm:text-[11px]">
                                {s.label}
                              </span>
                              <div className="mt-1 flex items-center justify-center">
                                <span
                                  className={`h-3.5 w-3.5 rounded-full border transition ${
                                    selected
                                      ? "border-dogood-pink bg-dogood-pink"
                                      : "border-fuchsia-300 bg-white"
                                  }`}
                                  aria-hidden
                                />
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Цвет футболки</label>
                    <input
                      type="hidden"
                      name={`items[${index}][color]`}
                      value="white"
                    />
                    <p className="mt-2 rounded-2xl border border-fuchsia-200 bg-fuchsia-50/70 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                      Сейчас доступны классические белые футболки. Скоро расширим
                      ассортимент. Если вам нужна черная футболка, напишите нам в
                      контакты — подумаем, что сможем сделать индивидуально.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <input
                    type="hidden"
                    name={`items[${index}][dogName]`}
                    value={prev!.dogName}
                  />
                  <input
                    type="hidden"
                    name={`items[${index}][breed]`}
                    value={prev!.breed}
                  />
                  <input
                    type="hidden"
                    name={`items[${index}][printStyle]`}
                    value={prev!.printStyle}
                  />
                  <input
                    type="hidden"
                    name={`items[${index}][color]`}
                    value={prev!.color}
                  />
                  <input
                    type="hidden"
                    name={`items[${index}][sameAsPrevious]`}
                    value="true"
                  />
                </>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={addLine}
          className="w-full rounded-2xl border border-dashed border-fuchsia-200 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:border-dogood-pink hover:text-dogood-pink"
        >
          + добавить ещё одну футболку
        </button>

        <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 px-4 py-3 text-sm text-muted-foreground">
          Итого за футболки:{" "}
          <span className="font-semibold text-foreground">
            {(lines.length * SHIRT_PRICE_RUB).toLocaleString("ru-RU")} ₽
          </span>
        </div>

        <div className="border-t border-fuchsia-200 pt-6">
          <label className={labelClass} htmlFor={`${baseId}-shelter`}>
            Приют (обязательно)
          </label>
          <select
            id={`${baseId}-shelter`}
            name="shelterId"
            required
            className={fieldClass}
          >
            {shelters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.city}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            20% прибыли от заказа направим в выбранный вами приют из списка ниже.
          </p>
        </div>

        <div className="space-y-6 border-t border-fuchsia-200 pt-6">
          <h3 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
            Контакты
          </h3>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`${baseId}-name`}>
                Имя
              </label>
              <input
                id={`${baseId}-name`}
                name="name"
                required
                className={fieldClass}
                placeholder="Как к вам обращаться"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${baseId}-email`}>
                Email
              </label>
              <input
                id={`${baseId}-email`}
                name="email"
                type="email"
                required
                className={fieldClass}
                placeholder="you@example.com"
              />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor={`${baseId}-phone`}>
              Телефон
            </label>
            <input
              id={`${baseId}-phone`}
              name="phone"
              type="tel"
              required
              className={fieldClass}
              placeholder="+7 …"
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${baseId}-promo`}>
              Промокод (необязательно)
            </label>
            <input
              id={`${baseId}-promo`}
              name="promoCode"
              className={fieldClass}
              placeholder="Введите промокод, если есть"
            />
          </div>
        </div>

        <div className="space-y-4 border-t border-fuchsia-200 pt-6">
          <h3 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
            Доставка
          </h3>
          <div className="rounded-2xl border border-fuchsia-200 bg-white/80 p-4 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Стоимость доставки на сайте:</strong>{" "}
              в форме можно рассчитать ориентировочную сумму по адресу и выбранной
              службе. Финальная оплата доставки происходит при получении по
              правилам перевозчика.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Отправка из Москвы; доставка оплачивается заказчиком, тариф
            определяет выбранная служба.
          </p>
          <div>
            <label className={labelClass} htmlFor={`${baseId}-address`}>
              Адрес доставки
            </label>
            <textarea
              id={`${baseId}-address`}
              name="address"
              required
              rows={3}
              className={fieldClass}
              placeholder="Город, улица, дом, квартира / пункт выдачи"
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${baseId}-delivery`}>
              Способ доставки
            </label>
            <select
              id={`${baseId}-delivery`}
              name="deliveryMethod"
              required
              className={fieldClass}
            >
              {deliveryMethods.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDeliveryEstimate}
              className="rounded-full border border-fuchsia-300 bg-fuchsia-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-fuchsia-700 transition hover:bg-fuchsia-100"
            >
              {deliveryCalcState === "loading"
                ? "считаем..."
                : "рассчитать доставку"}
            </button>
            {deliveryQuote ? (
              <p className="text-sm text-foreground">
                {deliveryQuote.carrierLabel}:{" "}
                <span className="font-semibold">
                  {deliveryQuote.priceRub.toLocaleString("ru-RU")} ₽
                </span>{" "}
                · {deliveryQuote.etaDays}
              </p>
            ) : null}
            {deliveryCalcState === "error" ? (
              <p className="text-sm text-red-500">
                Укажите адрес и службу доставки, чтобы рассчитать стоимость.
              </p>
            ) : null}
          </div>
          {deliveryQuote ? (
            <p className="text-xs text-muted-foreground">{deliveryQuote.note}</p>
          ) : null}
          <div>
            <label className={labelClass} htmlFor={`${baseId}-comment`}>
              Комментарий
            </label>
            <textarea
              id={`${baseId}-comment`}
              name="comment"
              rows={2}
              className={fieldClass}
              placeholder="Пожелания по срокам или доставке"
            />
          </div>
        </div>

        {photoError ? (
          <p className="text-center text-sm font-medium text-red-500">{photoError}</p>
        ) : null}
        {submitError ? (
          <p className="text-center text-sm font-medium text-red-500">{submitError}</p>
        ) : null}

        <DogoodButton
          variant="primary"
          type="submit"
          className="w-full py-4 text-base"
          disabled={status === "sending"}
        >
          {status === "sending" ? "отправляем…" : "отправить заявку"}
        </DogoodButton>
        {status === "done" ? (
          <div className="space-y-2 text-center text-sm font-medium text-neutral-700">
            <p>Спасибо! Заявка принята.</p>
            <p className="text-muted-foreground">
              В течение <strong className="text-foreground">1–2 дней</strong> свяжемся с вами, пришлём
              макет и данные по оплате.
            </p>
            {lastOrderId ? (
              <p className="text-xs text-muted-foreground">
                Сохраните номер заявки:{" "}
                <span className="font-mono text-foreground">{lastOrderId}</span>
              </p>
            ) : null}
            {lastGoogleWebhook === "error" ? (
              <p className="text-xs text-amber-700">
                Если за 2 дня ответа не будет — напишите нам через контакты внизу страницы, укажите
                номер заявки.
              </p>
            ) : null}
          </div>
        ) : null}
        {status === "error" && !submitError ? (
          <p className="text-center text-sm font-medium text-red-400">
            Не удалось отправить. Попробуйте ещё раз чуть позже.
          </p>
        ) : null}
      </form>
      <ImageLightbox
        open={lightboxOpen}
        src={lightboxSrc}
        alt="Стиль принта"
        onClose={() => setLightboxOpen(false)}
      />
    </Section>
  );
}
