import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, lt, ne } from "drizzle-orm";

import { appendOrderRow } from "@/lib/ops/sheet-repository";
import { isMoyNalogEnabled, registerFairIncome } from "@/lib/payments/moy-nalog";
import { createPayment, isYookassaEnabled } from "@/lib/payments/yookassa";
import { getStudioDb, schema } from "@/lib/studio/db";
import type { StudioFairStep } from "@/lib/studio/db/schema";
import { isStudioMockMode } from "@/lib/studio/env";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";
import { getEnvRaw } from "@/lib/studio/runtime-env";
import { inferPetNameScript } from "@/lib/studio/script-detect";
import {
  clientBotToken,
  clientSend,
  clientSendPhoto,
  type InlineKeyboard,
} from "@/lib/studio/telegram/client-bot";
import { downloadTelegramFileToOrder } from "@/lib/studio/telegram/download-photo";
import { sendStudioAlert } from "@/lib/studio/telegram/review-bot";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FairResult = { handled: boolean; triggerTick?: boolean };

/* ---------------- session helpers ---------------- */

async function getFairByChatId(chatId: string) {
  const db = getStudioDb();
  const rows = await db
    .select()
    .from(schema.studioFairOrders)
    .where(eq(schema.studioFairOrders.chatId, chatId))
    .orderBy(desc(schema.studioFairOrders.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function updateFair(
  id: string,
  patch: Partial<typeof schema.studioFairOrders.$inferInsert>,
): Promise<void> {
  const db = getStudioDb();
  await db
    .update(schema.studioFairOrders)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.studioFairOrders.id, id));
}

async function countFairPhotos(orderId: string): Promise<number> {
  const db = getStudioDb();
  const rows = await db
    .select({ id: schema.studioOrderPhotos.id })
    .from(schema.studioOrderPhotos)
    .where(eq(schema.studioOrderPhotos.orderId, orderId));
  return rows.length;
}

async function createFairSession(chatId: string): Promise<void> {
  const db = getStudioDb();
  const orderId = randomUUID();
  const sheetOrderId = `fair-${Date.now()}`;
  await db.insert(schema.studioOrders).values({
    id: orderId,
    sheetOrderId,
    customerName: "ярмарка",
    petNameRaw: "",
    petNameScript: "unknown",
    designSlug: "life",
    status: "draft",
    mode: "fair",
    sheetPayloadJson: JSON.stringify({ fair: true }),
  });
  await db.insert(schema.studioFairOrders).values({
    id: randomUUID(),
    orderId,
    chatId,
    step: "awaiting_photo",
  });
}

/**
 * Steps reached only after a mockup was actually delivered — the "one free
 * mockup per account" limit is enforced against these, not against a bare
 * /start with no session yet.
 */
const FAIR_LIMIT_STEPS = new Set<string>([
  "awaiting_payment",
  "paid_awaiting_size",
  "awaiting_fio",
  "awaiting_phone",
  "awaiting_delivery",
  "awaiting_pvz",
  "done",
]);

function stepReminder(step: StudioFairStep | string): string {
  switch (step) {
    case "awaiting_photo":
      return "Пришлите, пожалуйста, фото вашей собаки 📸";
    case "awaiting_pet_name":
      return "Напишите, пожалуйста, кличку питомца — точно так, как нужно на футболке.";
    case "awaiting_email":
      return "Жду ваш email 📧";
    case "generating":
      return "Макет уже готовится ⏳ Пришлю сюда, как будет готово.";
    case "awaiting_payment":
      return "Оплатите футболку кнопкой в сообщении выше 👆, или подойдите к нашему стенду.";
    case "paid_awaiting_size":
      return "Выберите размер кнопкой в сообщении выше 👆";
    case "awaiting_fio":
      return "Напишите, пожалуйста, ФИО получателя полностью.";
    case "awaiting_phone":
      return "Напишите, пожалуйста, номер телефона получателя.";
    case "awaiting_delivery":
      return "Выберите службу доставки кнопкой выше 👆";
    case "awaiting_pvz":
      return "Пришлите, пожалуйста, адрес пункта выдачи одним сообщением.";
    case "done":
      return "Ваш заказ уже оформлен 🎉 Если есть вопросы — подойдите к нашему стенду.";
    default:
      return "Секунду, сейчас разберёмся 🙏";
  }
}

function sizeKeyboard(): InlineKeyboard {
  const sizes = ["XS", "S", "M", "L", "XL", "XXL"];
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < sizes.length; i += 3) {
    rows.push(sizes.slice(i, i + 3).map((s) => ({ text: s, callback_data: `fs:${s}` })));
  }
  return { inline_keyboard: rows };
}

function deliveryKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Яндекс Доставка", callback_data: "fd:yandex" },
        { text: "СДЭК", callback_data: "fd:cdek" },
      ],
    ],
  };
}

/* ---------------- inbound: /start, photo, text, buttons ---------------- */

/**
 * Public: `/start`. Does NOT create a session — the session (and the free
 * mockup slot it uses) is only claimed once a photo actually arrives
 * (handleFairPhoto). A bare /start is always safe to repeat.
 */
export async function handleFairCommand(chatId: string, text: string): Promise<FairResult> {
  if (!/^\/start(@\w+)?\b/.test(text.trim())) return { handled: false };

  const existing = await getFairByChatId(chatId);
  if (existing) {
    if (FAIR_LIMIT_STEPS.has(existing.step)) {
      await clientSend(
        chatId,
        "Похоже, вы уже получали макет с этого аккаунта — бесплатный макет доступен один раз 🙏\nЕсли хотите ещё один, подойдите к нашему стенду!",
      );
      return { handled: true };
    }
    // Mid-intake, no mockup delivered yet — just pick up where we left off.
    await clientSend(chatId, stepReminder(existing.step));
    return { handled: true };
  }

  const privacyUrl = `${getEnvRaw("NEXT_PUBLIC_SITE_URL")?.trim() || "https://dogood-brand.ru"}/legal/privacy`;
  await clientSend(
    chatId,
    [
      "Привет! 🐾 Я — бот DoGood.",
      "Нарисую вашего питомца в стиле «Life is Better» — бесплатно, прямо на ярмарке.",
      "",
      `Отправляя фото, вы соглашаетесь на обработку персональных данных: ${privacyUrl}`,
      "",
      "Пришлите, пожалуйста, фото вашей собаки 📸",
    ].join("\n"),
  );
  return { handled: true };
}

export async function handleFairPhoto(chatId: string, fileId: string): Promise<FairResult> {
  let fair = await getFairByChatId(chatId);

  if (fair && FAIR_LIMIT_STEPS.has(fair.step)) {
    await clientSend(chatId, stepReminder(fair.step));
    return { handled: true };
  }

  if (!fair) {
    // First photo claims the free-mockup slot — /start alone does not.
    await createFairSession(chatId);
    fair = await getFairByChatId(chatId);
    if (!fair) return { handled: false };
  } else if (fair.step !== "awaiting_photo" && fair.step !== "awaiting_pet_name") {
    await clientSend(chatId, stepReminder(fair.step));
    return { handled: true };
  }

  const t = clientBotToken();
  if (!t) return { handled: true };

  const n = await countFairPhotos(fair.orderId);
  const ok = await downloadTelegramFileToOrder(t, fair.orderId, fileId, n);
  if (!ok) {
    await clientSend(chatId, "Не удалось сохранить фото, попробуйте ещё раз 🙏");
    return { handled: true };
  }

  if (fair.step === "awaiting_photo") {
    await updateFair(fair.id, { step: "awaiting_pet_name" });
    await clientSend(chatId, "Отлично! 🐶 Теперь напишите кличку питомца — точно так, как нужно на футболке.");
  } else {
    await clientSend(chatId, "Фото добавлено 📸 Можно ещё, или напишите кличку.");
  }
  return { handled: true };
}

export async function handleFairText(chatId: string, text: string): Promise<FairResult> {
  const fair = await getFairByChatId(chatId);
  if (!fair) return { handled: false };
  const t = text.trim();

  switch (fair.step) {
    case "awaiting_photo":
      await clientSend(chatId, "Сначала пришлите, пожалуйста, фото собаки 📸");
      return { handled: true };

    case "awaiting_pet_name": {
      if (!t) {
        await clientSend(chatId, "Кличка не может быть пустой, напишите ещё раз.");
        return { handled: true };
      }
      await getStudioDb()
        .update(schema.studioOrders)
        .set({ petNameRaw: t, petNameScript: inferPetNameScript(t), updatedAt: new Date() })
        .where(eq(schema.studioOrders.id, fair.orderId));
      await updateFair(fair.id, { petName: t, step: "awaiting_email" });
      await clientSend(chatId, `Кличка «${t}» 🐾 Теперь напишите ваш email — пришлём туда макет.`);
      return { handled: true };
    }

    case "awaiting_email": {
      if (!EMAIL_RE.test(t)) {
        await clientSend(chatId, "Похоже, это не email. Напишите, пожалуйста, в формате name@example.com");
        return { handled: true };
      }
      await updateFair(fair.id, { email: t, step: "generating" });
      await getStudioDb()
        .update(schema.studioOrders)
        .set({ status: "assets_loaded", updatedAt: new Date() })
        .where(eq(schema.studioOrders.id, fair.orderId));
      await clientSend(chatId, "Принято! ⏳ Готовлю макет — обычно это несколько минут, пришлю сюда, как будет готово.");
      await sendStudioAlert(`🎪 Новая заявка с ярмарки: кличка «${fair.petName}», email ${t}. Генерация запущена.`);
      return { handled: true, triggerTick: true };
    }

    case "awaiting_fio": {
      if (!t) {
        await clientSend(chatId, "Напишите, пожалуйста, ФИО получателя полностью.");
        return { handled: true };
      }
      await updateFair(fair.id, { fio: t, step: "awaiting_phone" });
      await clientSend(chatId, "Теперь укажите номер телефона получателя 📱");
      return { handled: true };
    }

    case "awaiting_phone": {
      const digits = t.replace(/[^\d]/g, "");
      if (digits.length < 10) {
        await clientSend(chatId, "Похоже на неполный номер. Напишите телефон ещё раз, например +7 900 123-45-67");
        return { handled: true };
      }
      await updateFair(fair.id, { phone: t, step: "awaiting_delivery" });
      await clientSend(
        chatId,
        [
          "Как удобнее получить футболку?",
          "",
          "Карты пунктов выдачи:",
          "Яндекс Доставка: https://dostavka.yandex.ru/pickup-point/",
          "СДЭК: https://www.cdek.ru/ru/offices/",
        ].join("\n"),
        deliveryKeyboard(),
      );
      return { handled: true };
    }

    case "awaiting_pvz": {
      if (!t) {
        await clientSend(chatId, "Пришлите, пожалуйста, адрес пункта выдачи.");
        return { handled: true };
      }
      await updateFair(fair.id, { pvz: t, step: "done" });
      await finalizeFairOrder(fair.id);
      await clientSend(
        chatId,
        "Спасибо! 🎉 Заказ оформлен, футболку доставим на выбранный пункт выдачи. Хорошего дня на ярмарке! 🐾",
      );
      return { handled: true };
    }

    default:
      await clientSend(chatId, stepReminder(fair.step));
      return { handled: true };
  }
}

export async function handleFairCallback(chatId: string, data: string): Promise<FairResult> {
  const fair = await getFairByChatId(chatId);
  if (!fair) return { handled: false };

  const size = data.match(/^fs:(.+)$/);
  if (size) {
    if (fair.step !== "paid_awaiting_size") {
      await clientSend(chatId, stepReminder(fair.step));
      return { handled: true };
    }
    await updateFair(fair.id, { size: size[1], step: "awaiting_fio" });
    await clientSend(chatId, `Размер: ${size[1]} ✅\nНапишите, пожалуйста, ФИО получателя полностью.`);
    return { handled: true };
  }

  const delivery = data.match(/^fd:(yandex|cdek)$/);
  if (delivery) {
    if (fair.step !== "awaiting_delivery") {
      await clientSend(chatId, stepReminder(fair.step));
      return { handled: true };
    }
    await updateFair(fair.id, { deliveryService: delivery[1], step: "awaiting_pvz" });
    await clientSend(chatId, "Пришлите, пожалуйста, адрес пункта выдачи одним сообщением 📍");
    return { handled: true };
  }

  return { handled: false };
}

/* ---------------- outbound hooks: final approved, payment succeeded ---------------- */

/**
 * Called by human-actions.approveFinalStage once a fair order's mockup is
 * approved: hand the mockup + payment link to the client. driveFileId is the
 * already-uploaded Drive artifact (empty string if the upload failed).
 */
export async function handleFairFinalApproved(orderId: string, driveFileId: string): Promise<void> {
  const db = getStudioDb();
  const [fair] = await db
    .select()
    .from(schema.studioFairOrders)
    .where(eq(schema.studioFairOrders.orderId, orderId))
    .limit(1);
  if (!fair) return;
  const [order] = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  if (!order) return;

  const makeupUrl = driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : "";
  const priceRub = Number(getEnvRaw("FAIR_TSHIRT_PRICE_RUB")?.trim() || "0") || 0;

  let paymentUrl = "";
  let paymentId = "";
  let paymentStatus = "";
  if ((isStudioMockMode() || isYookassaEnabled()) && priceRub > 0) {
    const r = await createPayment({
      amountRub: priceRub,
      description: `Футболка DoGood — ${order.petNameRaw || "питомец"}`,
      metadata: { fairOrderId: fair.id },
      email: fair.email,
    });
    if (r.ok) {
      paymentId = r.payment.id;
      paymentUrl = r.payment.confirmation?.confirmation_url ?? "";
      paymentStatus = "pending";
    } else {
      console.error("[fair-flow] createPayment failed:", r.error);
      await sendStudioAlert(`⚠️ Не удалось создать платёж ЮKassa для ${order.sheetOrderId}: ${r.error}`);
    }
  }

  await db
    .update(schema.studioFairOrders)
    .set({
      makeupUrl,
      paymentId,
      paymentUrl,
      paymentStatus,
      amountRub: String(priceRub),
      step: "awaiting_payment",
      updatedAt: new Date(),
    })
    .where(eq(schema.studioFairOrders.id, fair.id));

  const offerText = [
    `🎉 Готово! Вот ваш макет с «${order.petNameRaw}» — забирайте, он ваш.`,
    "",
    "Понравился? Можем напечатать его на футболке 👕",
    "Оформите сегодня на мероприятии — и 15% прибыли уйдёт в приют 🐾",
    "",
    priceRub > 0
      ? `Цена — ${priceRub} ₽, доставка Яндексом или СДЭК оплачивается при получении.`
      : "",
    paymentUrl
      ? "Жмите кнопку ниже, это займёт минуту 💛"
      : "Оплата временно недоступна — подойдите к нашему стенду, поможем оформить вручную 🙏",
  ]
    .filter(Boolean)
    .join("\n");

  const keyboard: InlineKeyboard | undefined = paymentUrl
    ? { inline_keyboard: [[{ text: "💳 Оплатить футболку", url: paymentUrl }]] }
    : undefined;

  if (order.approvedFinalArtifactPath) {
    const abs = absoluteFromStudioRelative(order.approvedFinalArtifactPath);
    const sent = await clientSendPhoto(fair.chatId, abs, offerText, keyboard);
    if (!sent.ok) {
      console.error("[fair-flow] sendPhoto failed:", sent.error);
      await clientSend(fair.chatId, offerText, keyboard);
    }
  } else {
    await clientSend(fair.chatId, offerText, keyboard);
  }
}

export async function getFairOrderByPaymentId(paymentId: string) {
  const db = getStudioDb();
  const rows = await db
    .select()
    .from(schema.studioFairOrders)
    .where(eq(schema.studioFairOrders.paymentId, paymentId))
    .limit(1);
  return rows[0] ?? null;
}

/** Idempotent: safe to call twice for the same payment (webhook retry + poll fallback can both fire). */
export async function onFairPaymentSucceeded(fairOrderId: string): Promise<void> {
  const db = getStudioDb();
  // A single conditional UPDATE (instead of a separate SELECT-then-UPDATE)
  // closes the race between the YooKassa webhook and pollPendingFairPayments
  // firing for the same payment at nearly the same time — only one of them
  // can flip the row, so only one sends the "thanks for paying" message.
  const claimed = await db
    .update(schema.studioFairOrders)
    .set({ paymentStatus: "succeeded", step: "paid_awaiting_size", updatedAt: new Date() })
    .where(
      and(eq(schema.studioFairOrders.id, fairOrderId), ne(schema.studioFairOrders.paymentStatus, "succeeded")),
    )
    .returning();
  const fair = claimed[0];
  if (!fair) return; // already handled by another caller

  await clientSend(
    fair.chatId,
    "Спасибо за оплату! 🎉 Осталось несколько деталей для доставки.\n\nВыберите размер футболки:",
    sizeKeyboard(),
  );
  await sendStudioAlert(`💰 Оплата получена: ${fair.email || fair.chatId}, кличка «${fair.petName}».`);

  // Fiscal receipt is best-effort here: a failure is stored on the row and
  // retried from the cron tick, it must never break the payment flow.
  try {
    await sendFairReceipt(fair.id);
  } catch (e) {
    console.error("[fair-flow] sendFairReceipt", e);
  }
}

/* ---------------- fiscal receipt («Мой налог») ---------------- */

const MAX_RECEIPT_ATTEMPTS = 5;

/**
 * Register the paid sale in «Мой налог» and send the receipt link to the
 * client. Same claim-first pattern as finalizeFairOrder: a single conditional
 * UPDATE claims the receipt before any network call, so the YooKassa webhook,
 * the payment poller and the tick retry can all call this concurrently and
 * only one of them ever registers the income.
 */
export async function sendFairReceipt(fairId: string): Promise<boolean> {
  if (!isStudioMockMode() && !isMoyNalogEnabled()) return false;
  const db = getStudioDb();

  const claimed = await db
    .update(schema.studioFairOrders)
    .set({ receiptStatus: "sent", updatedAt: new Date() })
    .where(
      and(
        eq(schema.studioFairOrders.id, fairId),
        eq(schema.studioFairOrders.paymentStatus, "succeeded"),
        ne(schema.studioFairOrders.receiptStatus, "sent"),
      ),
    )
    .returning();
  const fair = claimed[0];
  if (!fair) return false; // not paid yet, or receipt already sent/claimed

  const amount = Number(fair.amountRub) || 0;
  if (amount <= 0) return false; // free order — nothing to fiscalize

  const r = await registerFairIncome({
    amountRub: amount,
    description: `Футболка DoGood — ${fair.petName || "питомец"}`,
  });

  if (!r.ok) {
    console.error("[fair-flow] moy-nalog receipt failed:", r.error);
    const attempts = fair.receiptAttempts + 1;
    // Roll back so the tick retry picks it up (bounded by MAX_RECEIPT_ATTEMPTS).
    await db
      .update(schema.studioFairOrders)
      .set({ receiptStatus: "failed", receiptAttempts: attempts, updatedAt: new Date() })
      .where(eq(schema.studioFairOrders.id, fair.id));
    // Alert on the first failure and once more when retries run out — not on
    // every retry, so a broken password doesn't spam the owner every minute.
    if (attempts === 1 || attempts === MAX_RECEIPT_ATTEMPTS) {
      await sendStudioAlert(
        `⚠️ Чек «Мой налог» не создан (попытка ${attempts}/${MAX_RECEIPT_ATTEMPTS}) для «${fair.petName}»: ${r.error}` +
          (attempts >= MAX_RECEIPT_ATTEMPTS ? "\nБольше не повторяю — оформите чек вручную в приложении." : ""),
      );
    }
    return false;
  }

  await db
    .update(schema.studioFairOrders)
    .set({ receiptUrl: r.receiptUrl, updatedAt: new Date() })
    .where(eq(schema.studioFairOrders.id, fair.id));
  await clientSend(fair.chatId, `🧾 Ваш чек об оплате: ${r.receiptUrl}`);
  return true;
}

/**
 * Tick fallback: retry receipts that failed (Мой налог was down, wrong
 * password, etc.), bounded to MAX_RECEIPT_ATTEMPTS per order.
 */
export async function retryFailedFairReceipts(): Promise<number> {
  if (!isStudioMockMode() && !isMoyNalogEnabled()) return 0;
  const db = getStudioDb();
  const rows = await db
    .select({ id: schema.studioFairOrders.id })
    .from(schema.studioFairOrders)
    .where(
      and(
        eq(schema.studioFairOrders.paymentStatus, "succeeded"),
        eq(schema.studioFairOrders.receiptStatus, "failed"),
        lt(schema.studioFairOrders.receiptAttempts, MAX_RECEIPT_ATTEMPTS),
      ),
    );
  let sent = 0;
  for (const row of rows) {
    if (await sendFairReceipt(row.id)) sent += 1;
  }
  return sent;
}

/* ---------------- final sheet write ---------------- */

export async function finalizeFairOrder(fairId: string): Promise<void> {
  const db = getStudioDb();

  // Claim the write with a single conditional UPDATE before touching Google
  // at all. This closes the race between the questionnaire's own call and a
  // concurrent retryUnwrittenFairSheetRows() pass — only one caller's UPDATE
  // can match while the flag is still false, so only one ever calls
  // appendOrderRow / messages the owner for this order.
  const claimed = await db
    .update(schema.studioFairOrders)
    .set({ sheetRowWritten: true, updatedAt: new Date() })
    .where(and(eq(schema.studioFairOrders.id, fairId), eq(schema.studioFairOrders.sheetRowWritten, false)))
    .returning();
  const fair = claimed[0];
  if (!fair) return; // already written, or another caller just claimed it

  const [order] = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, fair.orderId))
    .limit(1);
  if (!order) return;

  const deliveryLabel = fair.deliveryService === "cdek" ? "СДЭК" : "Яндекс Доставка";
  const values: Record<string, string> = {
    Время: new Date().toLocaleString("ru-RU"),
    "Order ID": order.sheetOrderId,
    Имя: fair.fio,
    Email: fair.email,
    Телефон: fair.phone,
    Приют: "",
    Адрес: `${deliveryLabel}, ПВЗ: ${fair.pvz}`,
    Доставка: fair.deliveryService,
    Футболки: `Кличка: ${order.petNameRaw} | Размер: ${fair.size} | Стиль: Life is better`,
    Комментарий: `ЯРМАРКА • оплата ЮKassa ${fair.paymentId} • макет: ${fair.makeupUrl}`,
    "Папка с фото": "",
    "Кол-во файлов": "",
    style_id: "life",
    status: "APPROVED",
    generated_image_url: fair.makeupUrl,
    approved_image_url: fair.makeupUrl,
    dog_photo_urls: "",
  };

  if (isStudioMockMode()) {
    console.log("[fair-flow mock] would appendOrderRow:", JSON.stringify(values));
  } else {
    const r = await appendOrderRow(values);
    if (!r.ok) {
      console.error("[fair-flow] appendOrderRow failed:", r.error);
      // Roll back the claim so retryUnwrittenFairSheetRows picks it up again.
      await db
        .update(schema.studioFairOrders)
        .set({ sheetRowWritten: false, updatedAt: new Date() })
        .where(eq(schema.studioFairOrders.id, fair.id));
      await sendStudioAlert(`⚠️ Не удалось записать ярмарочный заказ ${order.sheetOrderId} в таблицу: ${r.error}`);
      return;
    }
  }
  await sendStudioAlert(
    `✅ Ярмарочный заказ записан в таблицу: ${order.sheetOrderId}, кличка «${order.petNameRaw}», ${fair.fio}, ${fair.phone}, ${deliveryLabel}.`,
  );
}

/**
 * Retry sheet writes for paid, completed fair orders whose row never landed
 * (e.g. appendOrderRow failed because Google was briefly unavailable). Safe
 * to call every tick — finalizeFairOrder is itself idempotent on
 * sheetRowWritten.
 */
export async function retryUnwrittenFairSheetRows(): Promise<number> {
  const db = getStudioDb();
  const rows = await db
    .select({ id: schema.studioFairOrders.id })
    .from(schema.studioFairOrders)
    .where(
      and(
        eq(schema.studioFairOrders.paymentStatus, "succeeded"),
        eq(schema.studioFairOrders.step, "done"),
        eq(schema.studioFairOrders.sheetRowWritten, false),
      ),
    );
  let written = 0;
  for (const row of rows) {
    const before = await db
      .select({ sheetRowWritten: schema.studioFairOrders.sheetRowWritten })
      .from(schema.studioFairOrders)
      .where(eq(schema.studioFairOrders.id, row.id))
      .limit(1);
    await finalizeFairOrder(row.id);
    const after = await db
      .select({ sheetRowWritten: schema.studioFairOrders.sheetRowWritten })
      .from(schema.studioFairOrders)
      .where(eq(schema.studioFairOrders.id, row.id))
      .limit(1);
    if (!before[0]?.sheetRowWritten && after[0]?.sheetRowWritten) written += 1;
  }
  return written;
}

/* ---------------- owner manual controls (/fair, /fair_reset, /fair_resend) ---------------- */

export type ActiveFairOrderSummary = {
  chatId: string;
  petName: string;
  step: string;
  paymentStatus: string;
  sheetOrderId: string;
};

/** For the owner's `/fair` command — orders still in flight, newest first. */
export async function listActiveFairOrders(limit = 20): Promise<ActiveFairOrderSummary[]> {
  const db = getStudioDb();
  const rows = await db
    .select()
    .from(schema.studioFairOrders)
    .where(ne(schema.studioFairOrders.step, "done"))
    .orderBy(desc(schema.studioFairOrders.createdAt))
    .limit(limit);

  const out: ActiveFairOrderSummary[] = [];
  for (const row of rows) {
    const [order] = await db
      .select({ sheetOrderId: schema.studioOrders.sheetOrderId })
      .from(schema.studioOrders)
      .where(eq(schema.studioOrders.id, row.orderId))
      .limit(1);
    out.push({
      chatId: row.chatId,
      petName: row.petName || "(без клички)",
      step: row.step,
      paymentStatus: row.paymentStatus || "—",
      sheetOrderId: order?.sheetOrderId ?? "?",
    });
  }
  return out;
}

/** `/fair_reset <chatId>` — let the owner free up a stuck session (never one already paid). */
export async function resetFairSession(chatId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const fair = await getFairByChatId(chatId);
  if (!fair) return { ok: false, error: "нет активной сессии для этого chatId" };
  if (fair.paymentStatus === "succeeded") {
    return { ok: false, error: "заказ уже оплачен, сброс запрещён — используйте /fair_resend" };
  }
  const db = getStudioDb();
  await db.delete(schema.studioFairOrders).where(eq(schema.studioFairOrders.id, fair.id));
  await db.delete(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, fair.orderId));
  await db.delete(schema.studioOrderPhotos).where(eq(schema.studioOrderPhotos.orderId, fair.orderId));
  await db.delete(schema.studioOrders).where(eq(schema.studioOrders.id, fair.orderId));
  return { ok: true };
}

/** `/fair_resend <chatId>` — re-run the mockup+payment handoff (e.g. createPayment failed the first time). */
export async function resendFairOffer(chatId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const fair = await getFairByChatId(chatId);
  if (!fair) return { ok: false, error: "нет сессии для этого chatId" };
  const driveFileIdMatch = fair.makeupUrl.match(/\/d\/([^/]+)\//);
  await handleFairFinalApproved(fair.orderId, driveFileIdMatch?.[1] ?? "");
  return { ok: true };
}
