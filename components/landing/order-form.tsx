"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { DogoodButton } from "@/components/ui/dogood-button";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Section, SectionHeading } from "@/components/ui/section";
import {
  blackShirtPrintColors,
  catalogDesignTemplates,
  deliveryMethods,
  printStyles,
  shirtColors,
  shirtGenders,
  shirtSizes,
  sheltersForOrderForm,
} from "@/lib/landing-data";
import { Image as ImageIcon } from "lucide-react";
import {
  compressImageForUpload,
  MAX_ORDER_UPLOAD_BYTES,
} from "@/lib/compress-order-image";

const fieldClass =
  "mt-1 w-full rounded-2xl border border-fuchsia-200 bg-white px-4 py-3 text-sm text-foreground outline-none transition-shadow placeholder:text-neutral-500 focus:border-dogood-pink focus:ring-2 focus:ring-dogood-pink/25";

const labelClass =
  "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

const MAX_PHOTOS_PER_LINE = 8;

type PhotoSlot = { id: string; file: File };

function newPhotoId(): string {
  return typeof crypto !== "undefined"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Быстрое превью выбранного файла (важно для мобильных). */
function PhotoThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [imgHidden, setImgHidden] = useState(false);
  const activeBlobRef = useRef<string | null>(null);

  function revokeActive() {
    if (activeBlobRef.current) {
      URL.revokeObjectURL(activeBlobRef.current);
      activeBlobRef.current = null;
    }
  }

  useEffect(() => {
    setImgHidden(false);
    revokeActive();

    try {
      const quick = URL.createObjectURL(file);
      activeBlobRef.current = quick;
      setUrl(quick);
    } catch {
      setUrl(null);
    }

    return () => {
      revokeActive();
      setUrl(null);
    };
  }, [file]);

  const label = (file.name || "фото").replace(/^.*[\\/]/, "").slice(0, 22);

  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-fuchsia-200 bg-fuchsia-50/40 shadow-sm">
      <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center gap-0.5 bg-gradient-to-b from-fuchsia-50 to-fuchsia-100/90 p-1">
        <ImageIcon className="h-7 w-7 shrink-0 text-fuchsia-500" aria-hidden />
        <span className="line-clamp-2 w-full max-w-[4.75rem] text-center text-[8px] font-medium leading-tight text-neutral-700">
          {label}
        </span>
      </div>
      {url && !imgHidden ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: превью
        <img
          src={url}
          alt=""
          className="absolute inset-0 z-10 h-full w-full object-cover"
          onError={() => setImgHidden(true)}
        />
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-fuchsia-200 bg-white/95 text-sm font-bold text-neutral-800 shadow-sm hover:bg-fuchsia-50"
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
  gender: string;
  size: string;
  color: string;
  printColor: string;
};

function createLine(): OrderLineState {
  return {
    id: typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random()),
    sameAsPrevious: false,
    dogName: "",
    breed: "",
    printStyle: printStyles[0]!.value,
    gender: shirtGenders[0]!.value,
    size: shirtSizes[1]!.value,
    color: "white",
    printColor: blackShirtPrintColors[0]!.value,
  };
}

function getStyleFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const style = new URLSearchParams(window.location.search).get("style");
  return printStyles.some((s) => s.value === style) ? style : null;
}

export function OrderForm() {
  const SHIRT_PRICE_RUB = 3999;
  const NETWORK_HINT_THRESHOLD = 2;
  const FETCH_TIMEOUT_MS = 12000;
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
    zoneLabel: string;
    note: string;
  } | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState<Record<string, number>>({});
  const [lightboxSrc, setLightboxSrc] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lines, setLines] = useState<OrderLineState[]>([createLine()]);
  /** Фото по строкам заказа; стабильный id — чтобы React не терял слот при одинаковых именах с телефона */
  const [linePhotos, setLinePhotos] = useState<PhotoSlot[][]>([[]]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  /** Предупреждение после успешного HTTP, если Google-вебхук не настроен (dev) */
  const [doneGoogleNotice, setDoneGoogleNotice] = useState<string | null>(null);
  const [networkIssueCount, setNetworkIssueCount] = useState(0);
  const [networkHintClosed, setNetworkHintClosed] = useState(false);
  const showNetworkHint =
    networkIssueCount >= NETWORK_HINT_THRESHOLD && !networkHintClosed;

  function noteNetworkIssue() {
    setNetworkIssueCount((n) => n + 1);
  }

  function clearNetworkIssue() {
    setNetworkIssueCount(0);
    setNetworkHintClosed(false);
  }

  async function fetchWithTimeout(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

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
          ...Array.from({ length: lines.length - prev.length }, () => [] as PhotoSlot[]),
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

  const removeLine = (index: number) => {
    if (index === 0) return;
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    setLinePhotos((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );
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
      const res = await fetchWithTimeout("/api/delivery-quote", {
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
          zoneLabel: string;
          note: string;
        };
      };
      setDeliveryQuote(data.quote);
      setDeliveryCalcState("idle");
      clearNetworkIssue();
    } catch {
      setDeliveryCalcState("error");
      setDeliveryQuote(null);
      noteNetworkIssue();
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPhotoError(null);
    setSubmitError(null);
    setDoneGoogleNotice(null);

    setStatus("sending");
    const form = e.currentTarget;

    let compressedByLine: File[][];
    try {
      const compressedCache = new Map<File, File>();
      async function compressOne(f: File): Promise<File> {
        const hit = compressedCache.get(f);
        if (hit) return hit;
        const c = await compressImageForUpload(f);
        compressedCache.set(f, c);
        return c;
      }

      compressedByLine = [];
      for (let i = 0; i < lines.length; i++) {
        const locked = i > 0 && lines[i]!.sameAsPrevious;
      const src = locked ? (linePhotos[i - 1] ?? []) : (linePhotos[i] ?? []);
      compressedByLine.push(
        await Promise.all(src.map((slot) => compressOne(slot.file))),
      );
      }

      let totalBytes = 0;
      for (const arr of compressedByLine) {
        for (const f of arr) totalBytes += f.size;
      }
      if (totalBytes > MAX_ORDER_UPLOAD_BYTES) {
        setPhotoError(
          `Суммарный размер фото всё ещё слишком большой (~${Math.max(1, Math.round(totalBytes / 1024 / 1024))} МБ). Удалите лишние снимки или в настройках камеры выберите меньшее качество.`,
        );
        setStatus("idle");
        return;
      }
    } catch (err) {
      setStatus("error");
      setSubmitError(
        err instanceof Error
          ? `Не удалось подготовить фото: ${err.message}`
          : "Не удалось подготовить фото к отправке. Попробуйте другие файлы.",
      );
      setLastOrderId(null);
      return;
    }

    const formData = new FormData(form);

    for (let i = 0; i < lines.length; i++) {
      const prepared = compressedByLine[i] ?? [];
      if (!prepared.length) {
        // Фолбэк: если клиентский стейт фото не обновился, оставляем нативные файлы из формы.
        continue;
      }
      formData.delete(`items[${i}][photos]`);
      for (const file of prepared) {
        formData.append(`items[${i}][photos]`, file);
      }
    }

    try {
      const res = await fetchWithTimeout("/api/order", {
        method: "POST",
        body: formData,
      });
      const raw = await res.text();
      let data: {
        orderId?: string;
        detail?: string;
        googleWebhook?: "skipped" | "ok" | "error";
        googleWebhookError?: string;
      } = {};
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        /* не JSON */
      }
      if (!res.ok) {
        const looksLikeNetlifyCrash =
          /Internal Error/i.test(raw) ||
          raw.trimStart().startsWith("<!DOCTYPE");
        const hint =
          res.status === 413
            ? "Файлы слишком большие для сервера (попробуйте фото меньшего размера)."
            : looksLikeNetlifyCrash || res.status === 500
              ? "Сервер не обработал заявку (часто из‑за тяжёлых фото или сети). Попробуйте меньше снимков или другое фото."
              : (data.detail ?? raw.slice(0, 200)) || `Ошибка ${res.status}`;
        setSubmitError(hint);
        setStatus("error");
        setLastOrderId(null);
        return;
      }

      if (data.googleWebhook === "error") {
        const detail = data.googleWebhookError?.trim();
        setSubmitError(
          detail
            ? `Данные не дошли до Google (таблица/Диск). Заявка на сайте: ${data.orderId ?? "—"}. ${detail.slice(0, 280)}${detail.length > 280 ? "…" : ""} Сохраните номер и напишите нам — или отправьте форму ещё раз.`
            : `Не удалось отправить заявку в Google. Номер на сайте: ${data.orderId ?? "—"}. Попробуйте позже или свяжитесь с нами.`,
        );
        setLastOrderId(data.orderId ?? null);
        setStatus("error");
        return;
      }

      setLastOrderId(data.orderId ?? null);
      if (data.googleWebhook === "skipped") {
        setDoneGoogleNotice(
          "Отправка в Google Таблицу и Диск на сервере не настроена — заявка принята только на стороне сайта. Сохраните номер и напишите нам.",
        );
      } else {
        setDoneGoogleNotice(null);
      }
      setStatus("done");
      clearNetworkIssue();
      form.reset();
      setLines([createLine()]);
      setLinePhotos([[]]);
    } catch {
      setStatus("error");
      setSubmitError("Сеть или сервер недоступны. Попробуйте позже.");
      setLastOrderId(null);
      noteNetworkIssue();
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
        description="Заполните форму: принт по фото вашего питомца (собака, кошка и не только). В течение 1–2 дней свяжемся, пришлём макет и данные по оплате."
      />

      <form
        onSubmit={handleSubmit}
        className="mx-auto mt-8 max-w-2xl space-y-8 rounded-3xl border border-fuchsia-200 bg-white/85 p-6 shadow-[0_20px_60px_rgba(168,85,247,0.14)] sm:p-8"
      >
        {showNetworkHint ? (
          <div
            className="flex items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
          >
            <p className="leading-relaxed">
              Похоже, соединение нестабильно. Если у вас включён VPN, попробуйте выключить его.
            </p>
            <button
              type="button"
              onClick={() => setNetworkHintClosed(true)}
              className="shrink-0 rounded-full border border-amber-300 bg-white px-2 py-0.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
              aria-label="Закрыть предупреждение о соединении"
            >
              Закрыть
            </button>
          </div>
        ) : null}

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
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
                    Футболка {index + 1}
                  </h3>
                  {index > 0 ? (
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="text-xs font-semibold uppercase tracking-wide text-muted-foreground underline decoration-fuchsia-300 underline-offset-2 transition-colors hover:text-red-600 hover:decoration-red-400"
                    >
                      Удалить эту футболку
                    </button>
                  ) : null}
                </div>
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
                          gender: prev.gender,
                          size: prev.size,
                          color: prev.color,
                          printColor: prev.printColor,
                        });
                      } else {
                        updateLine(index, { sameAsPrevious: false });
                      }
                    }}
                    className="rounded border-fuchsia-200"
                  />
                  Как на предыдущей футболке (кличка, порода, стиль, пол, размер, цвет, фото)
                </label>
              ) : null}

              <div>
                <label className={labelClass}>
                  Фото питомца (собака, кошка и др.) — желательно мордочку и во весь рост
                </label>
                {!locked ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(linePhotos[index] ?? []).map((slot) => (
                        <PhotoThumb
                          key={slot.id}
                          file={slot.file}
                          onRemove={() =>
                            setLinePhotos((prev) => {
                              const next = prev.map((a) => [...a]);
                              next[index] = (next[index] ?? []).filter(
                                (s) => s.id !== slot.id,
                              );
                              return next;
                            })
                          }
                        />
                      ))}
                    </div>
                    <input
                      id={`photo-pick-${line.id}`}
                      name={`items[${index}][photos]`}
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      onChange={(ev) => {
                        const picked = ev.target.files;
                        if (!picked?.length) return;
                        setLinePhotos((prev) => {
                          const next = prev.map((a) => [...a]);
                          const cur = next[index] ?? [];
                          const added: PhotoSlot[] = Array.from(picked).map(
                            (f) => ({ id: newPhotoId(), file: f }),
                          );
                          const merged = [...cur, ...added].slice(
                            0,
                            MAX_PHOTOS_PER_LINE,
                          );
                          next[index] = merged;
                          return next;
                        });
                      }}
                    />
                    {/* label + htmlFor: на iOS Safari программный input.click() часто блокируется */}
                    <label
                      htmlFor={`photo-pick-${line.id}`}
                      className={`${fieldClass} inline-flex w-full cursor-pointer items-center justify-center text-center text-sm font-medium text-fuchsia-800`}
                    >
                      + добавить фото
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Выбрано фото: {(linePhotos[index] ?? []).length}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Превью картинки иногда не отображается, но мы все равно увидим ваши файлы
                    </p>
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
                      placeholder="Как хотите: на русском или английском"
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
                      породы или вида, если визуала мало.
                    </p>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <p className={labelClass}>Пол (линия футболки)</p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {shirtGenders.map((g) => (
                          <label
                            key={g.value}
                            onClick={() => updateLine(index, { gender: g.value })}
                            className={`flex cursor-pointer items-center gap-2 rounded-2xl border px-4 py-3 text-sm transition ${
                              line.gender === g.value
                                ? "border-dogood-pink bg-fuchsia-50 ring-2 ring-dogood-pink/25"
                                : "border-fuchsia-200 bg-white hover:border-fuchsia-300"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`items[${index}][gender]`}
                              value={g.value}
                              checked={line.gender === g.value}
                              onChange={() => updateLine(index, { gender: g.value })}
                              className="sr-only"
                            />
                            {g.label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className={labelClass}>Размер</p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {shirtSizes.map((s) => (
                          <label
                            key={s.value}
                            onClick={() => updateLine(index, { size: s.value })}
                            className={`flex cursor-pointer items-center gap-2 rounded-2xl border px-4 py-3 text-sm transition ${
                              line.size === s.value
                                ? "border-dogood-pink bg-fuchsia-50 ring-2 ring-dogood-pink/25"
                                : "border-fuchsia-200 bg-white hover:border-fuchsia-300"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`items[${index}][size]`}
                              value={s.value}
                              checked={line.size === s.value}
                              onChange={() => updateLine(index, { size: s.value })}
                              className="sr-only"
                            />
                            {s.label}
                          </label>
                        ))}
                      </div>
                    </div>
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
                              onClick={() => updateLine(index, { printStyle: s.value })}
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
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={previewSrc}
                                  alt={s.label}
                                  className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                                  onError={() => {
                                    setPreviewAttempt((prev) => {
                                      const current = prev[s.value] ?? 0;
                                      const next = Math.min(current + 1, variants.length - 1);
                                      return { ...prev, [s.value]: next };
                                    });
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    updateLine(index, { printStyle: s.value });
                                    setLightboxSrc(previewSrc);
                                    setLightboxOpen(true);
                                  }}
                                  className="absolute bottom-1.5 right-1.5 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-fuchsia-700 shadow-sm"
                                  aria-label={`Открыть ${s.label} на весь экран`}
                                >
                                  Увеличить
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
                    <p className={labelClass}>Цвет футболки</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {shirtColors.map((c) => (
                        <label
                          key={c.value}
                          onClick={() => updateLine(index, { color: c.value })}
                          className={`flex cursor-pointer items-center gap-2 rounded-2xl border px-4 py-3 text-sm transition ${
                            line.color === c.value
                              ? "border-dogood-pink bg-fuchsia-50 ring-2 ring-dogood-pink/25"
                              : "border-fuchsia-200 bg-white hover:border-fuchsia-300"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`items[${index}][color]`}
                            value={c.value}
                            checked={line.color === c.value}
                            onChange={() => updateLine(index, { color: c.value })}
                            className="sr-only"
                          />
                          <span
                            className={`h-4 w-4 rounded-full border-2 ${
                              c.value === "black"
                                ? "border-neutral-600 bg-neutral-900"
                                : "border-fuchsia-300 bg-white"
                            }`}
                            aria-hidden
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                    {line.printStyle === "rainy" ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        С этим стилем советуем белый цвет футболки.
                      </p>
                    ) : null}
                  </div>
                  {line.printStyle === "rainy" && line.color === "black" ? (
                    <div>
                      <p className={labelClass}>Цвет принта на чёрной футболке</p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {blackShirtPrintColors.map((c) => (
                          <label
                            key={c.value}
                            onClick={() => updateLine(index, { printColor: c.value })}
                            className={`flex cursor-pointer items-center gap-2 rounded-2xl border px-4 py-3 text-sm transition ${
                              line.printColor === c.value
                                ? "border-dogood-pink bg-fuchsia-50 ring-2 ring-dogood-pink/25"
                                : "border-fuchsia-200 bg-white hover:border-fuchsia-300"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`items[${index}][printColor]`}
                              value={c.value}
                              checked={line.printColor === c.value}
                              onChange={() => updateLine(index, { printColor: c.value })}
                              className="sr-only"
                            />
                            {c.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <input
                      type="hidden"
                      name={`items[${index}][printColor]`}
                      value=""
                    />
                  )}
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
                    name={`items[${index}][gender]`}
                    value={prev!.gender}
                  />
                  <input
                    type="hidden"
                    name={`items[${index}][size]`}
                    value={prev!.size}
                  />
                  <input
                    type="hidden"
                    name={`items[${index}][printColor]`}
                    value={prev!.printColor}
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
            {sheltersForOrderForm.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-6 border-t border-fuchsia-200 pt-6">
          <h3 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
            Контакты
          </h3>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`${baseId}-lastname`}>
                Фамилия (обязательно)
              </label>
              <input
                id={`${baseId}-lastname`}
                name="lastName"
                required
                autoComplete="family-name"
                className={fieldClass}
                placeholder="Фамилия"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${baseId}-firstname`}>
                Имя (обязательно)
              </label>
              <input
                id={`${baseId}-firstname`}
                name="firstName"
                required
                autoComplete="given-name"
                className={fieldClass}
                placeholder="Имя"
              />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor={`${baseId}-patronymic`}>
              Отчество (необязательно)
            </label>
            <input
              id={`${baseId}-patronymic`}
              name="patronymic"
              autoComplete="additional-name"
              className={fieldClass}
              placeholder="Отчество"
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`${baseId}-email`}>
                Email (обязательно)
              </label>
              <input
                id={`${baseId}-email`}
                name="email"
                type="email"
                required
                autoComplete="email"
                className={fieldClass}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${baseId}-phone`}>
                Телефон (обязательно)
              </label>
              <input
                id={`${baseId}-phone`}
                name="phone"
                type="tel"
                required
                autoComplete="tel"
                className={fieldClass}
                placeholder="+7 …"
              />
            </div>
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
              <strong className="text-foreground">Доставка по всей России</strong>. Стоимость
              согласно тарифам курьерских служб.
            </p>
            <p className="mt-2">
              Доставка до <strong className="text-foreground">пункта выдачи</strong> выбранной
              службы. <strong className="text-foreground">Оплата доставки при получении</strong>.
            </p>
            <p className="mt-2">
              <strong className="text-foreground">Стоимость доставки на сайте указана приблизительно.</strong>
            </p>
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
          <div>
            <label className={labelClass} htmlFor={`${baseId}-address`}>
              Адрес пункта выдачи
            </label>
            <textarea
              id={`${baseId}-address`}
              name="address"
              required
              rows={4}
              className={fieldClass}
              placeholder="Укажите адрес удобного пункта выдачи выбранной службы доставки"
            />
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
              <div className="min-w-0 flex-1 space-y-1 text-sm text-foreground">
                <p>
                  {deliveryQuote.carrierLabel}:{" "}
                  <span className="font-semibold">
                    ~{deliveryQuote.priceRub.toLocaleString("ru-RU")} ₽
                  </span>{" "}
                  · {deliveryQuote.etaDays}
                </p>
              </div>
            ) : null}
            {deliveryCalcState === "error" ? (
              <p className="text-sm text-red-500">
                Укажите адрес пункта выдачи и выберите службу доставки.
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
              placeholder="Любые пожелания по заказу"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Если питомец экзотичный, напишите об этом здесь — посмотрим, что можно
              сделать.
            </p>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-4 text-sm text-muted-foreground">
          <label className="flex cursor-pointer items-start gap-2 text-foreground">
            <input
              type="checkbox"
              name="consentPersonalData"
              value="yes"
              required
              className="mt-0.5 rounded border-fuchsia-200"
            />
            <span>
              Согласен(на) на обработку персональных данных согласно{" "}
              <Link
                href="/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-fuchsia-300 underline-offset-2 hover:text-fuchsia-700"
              >
                Политике обработки ПДн
              </Link>
              .
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-foreground">
            <input
              type="checkbox"
              name="consentTerms"
              value="yes"
              required
              className="mt-0.5 rounded border-fuchsia-200"
            />
            <span>
              Подтверждаю, что ознакомлен(а) и согласен(на) с{" "}
              <Link
                href="/legal/offer"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-fuchsia-300 underline-offset-2 hover:text-fuchsia-700"
              >
                Публичной офертой и условиями заказа
              </Link>
              , включая правила ухода за изделием и ограничения ответственности.
            </span>
          </label>
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
            <p>Спасибо за заказ!</p>
            <p className="text-muted-foreground">
              Мы вышлем макет и детали по оплате вам на почту в течение 1-2 дней.
            </p>
            {doneGoogleNotice ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
                {doneGoogleNotice}
              </p>
            ) : null}
            {lastOrderId ? (
              <p className="text-xs text-muted-foreground">
                Номер заявки:{" "}
                <span className="font-mono text-foreground">{lastOrderId}</span>
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
