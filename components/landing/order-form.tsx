"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { DogoodButton } from "@/components/ui/dogood-button";
import { Section, SectionHeading } from "@/components/ui/section";
import {
  blackShirtPrintColors,
  printStyles,
  shirtGenders,
  shirtSizes,
} from "@/lib/landing-data";
import { Image as ImageIcon } from "lucide-react";
import {
  compressImageForUpload,
  MAX_ORDER_UPLOAD_BYTES,
} from "@/lib/compress-order-image";
import { convertHeicToJpegIfNeeded } from "@/lib/heic-to-jpeg-client";
import {
  reachYandexGoal,
  YM_GOAL_ORDER_SUBMIT,
} from "@/lib/analytics/yandex-metrika";

const fieldClass =
  "mt-1 w-full rounded-2xl border border-fuchsia-200 bg-white px-4 py-3 text-sm text-foreground outline-none transition-shadow placeholder:text-neutral-500 focus:border-dogood-pink focus:ring-2 focus:ring-dogood-pink/25";

const labelClass =
  "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

const MAX_PHOTOS_PER_LINE = 2;

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
    let cancelled = false;
    setImgHidden(false);
    revokeActive();

    (async () => {
      try {
        const forPreview = await convertHeicToJpegIfNeeded(file);
        if (cancelled) return;
        const quick = URL.createObjectURL(forPreview);
        activeBlobRef.current = quick;
        setUrl(quick);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();

    return () => {
      cancelled = true;
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
  const SHIRT_PRICE_RUB = 4900;
  const NETWORK_HINT_THRESHOLD = 2;
  const FETCH_TIMEOUT_MS = 12000;
  const ORDER_SUBMIT_TIMEOUT_MS = 90000;
  const baseId = useId();
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );
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
    timeoutMs = FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPhotoError(null);
    setSubmitError(null);
    setDoneGoogleNotice(null);

    setStatus("sending");
    const form = e.currentTarget;

    const compressedCache = new Map<File, File>();
    async function compressOne(f: File): Promise<File> {
      const hit = compressedCache.get(f);
      if (hit) return hit;
      const c = await compressImageForUpload(f);
      compressedCache.set(f, c);
      return c;
    }

    let compressedByLine: File[][];
    try {
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
      let prepared = compressedByLine[i] ?? [];
      if (!prepared.length) {
        // Фолбэк: стейт мог не обновиться (часто iOS), но файлы остались в <input type="file">.
        const input = document.getElementById(
          `photo-pick-${lines[i]!.id}`,
        ) as HTMLInputElement | null;
        const native = input?.files ? Array.from(input.files) : [];
        if (native.length) {
          prepared = await Promise.all(native.map((f) => compressOne(f)));
        }
      }
      if (!prepared.length) continue;
      formData.delete(`items[${i}][photos]`);
      for (const file of prepared) {
        formData.append(`items[${i}][photos]`, file);
      }
    }

    const hadPhotosForOrder =
      compressedByLine.some((a) => (a?.length ?? 0) > 0) ||
      linePhotos.some((slots) => (slots?.length ?? 0) > 0);

    reachYandexGoal(YM_GOAL_ORDER_SUBMIT);

    try {
      const res = await fetchWithTimeout(
        "/api/order",
        {
          method: "POST",
          body: formData,
        },
        ORDER_SUBMIT_TIMEOUT_MS,
      );
      const raw = await res.text();
      let data: {
        orderId?: string;
        detail?: string;
        googleWebhook?: "skipped" | "pending" | "ok" | "error";
        customerNotice?: string;
        googleWebhookWarning?: string;
        googleWebhookError?: string;
        driveApiPhotoUpload?: { uploaded?: number };
        filesPreparedForGoogle?: number;
        googleWebhookSummaries?: {
          withFiles?: {
            fileCount?: number;
            filesReceived?: number;
            duplicateSkipped?: boolean;
            driveError?: string | null;
            uploadErrors?: { field?: string; error?: string }[];
          };
        };
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

      setLastOrderId(data.orderId ?? null);

      const customerMsg = data.customerNotice?.trim();
      if (customerMsg) {
        setDoneGoogleNotice(customerMsg);
      } else if (data.googleWebhook === "skipped") {
        setDoneGoogleNotice(
          "Заявка принята. Сохраните номер — мы свяжемся с вами по почте.",
        );
      } else {
        setDoneGoogleNotice(null);
      }

      if (
        hadPhotosForOrder &&
        (data.driveApiPhotoUpload?.uploaded ?? 0) > 0
      ) {
        setDoneGoogleNotice(null);
      }

      setStatus("done");
      clearNetworkIssue();
      form.reset();
      setLines([createLine()]);
      setLinePhotos([[]]);
    } catch (err) {
      setStatus("error");
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      setSubmitError(
        timedOut
          ? "Сервер долго не отвечает. Заявка могла сохраниться — проверьте почту или попробуйте ещё раз через минуту."
          : "Сеть или сервер недоступны. Попробуйте позже.",
      );
      setLastOrderId(null);
      noteNetworkIssue();
    }
  }

  return (
    <Section id="order" surfaceClassName="bg-transparent">
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
                  Как на предыдущей футболке (кличка, стиль, пол, размер, цвет, фото)
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
                      onChange={async (ev) => {
                        const picked = ev.target.files;
                        if (!picked?.length) return;
                        const normalized = await Promise.all(
                          Array.from(picked).map((f) => convertHeicToJpegIfNeeded(f)),
                        );
                        setLinePhotos((prev) => {
                          const next = prev.map((a) => [...a]);
                          const cur = next[index] ?? [];
                          const added: PhotoSlot[] = normalized.map((f) => ({
                            id: newPhotoId(),
                            file: f,
                          }));
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
                      Кличка — на том языке, на котором хотите видеть её на футболке
                    </label>
                    <input
                      id={`${baseId}-dog-${index}`}
                      name={`items[${index}][dogName]`}
                      required
                      autoComplete="off"
                      value={line.dogName}
                      onChange={(e) =>
                        updateLine(index, { dogName: e.target.value })
                      }
                      className={fieldClass}
                      placeholder="Например: Макс, Барни или Luna"
                    />
                  </div>

                  <input
                    type="hidden"
                    name={`items[${index}][printStyle]`}
                    value="life"
                  />
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

        <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 px-4 py-3 text-sm text-muted-foreground">
          Итого за футболки:{" "}
          <span className="font-semibold text-foreground">
            {(lines.length * SHIRT_PRICE_RUB).toLocaleString("ru-RU")} ₽
          </span>
        </div>

        <div className="space-y-6 border-t border-fuchsia-200 pt-6">
          <h3 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
            Контакты
          </h3>
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
            <label className={labelClass} htmlFor={`${baseId}-comment`}>
              Комментарии
            </label>
            <textarea
              id={`${baseId}-comment`}
              name="comment"
              rows={3}
              className={`${fieldClass} min-h-[5.5rem] resize-y`}
              placeholder="Пожелания по заказу, срочность, особенности питомца"
            />
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
    </Section>
  );
}
