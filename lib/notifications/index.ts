import type { PendingReviewPayload } from "@/lib/notifications/types";
import { sendTelegramText } from "@/lib/notifications/telegram";

/**
 * Центральная точка для операционных уведомлений.
 * Глобальный выключатель + отдельные флаги каналов (env), чтобы не размазывать if по коду.
 */

function parseBool(v: string | undefined, defaultTrue: boolean): boolean {
  if (v === undefined || v === "") return defaultTrue;
  const s = v.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(s)) return false;
  if (["1", "true", "yes", "on"].includes(s)) return true;
  return defaultTrue;
}

function notificationsGloballyEnabled(): boolean {
  return parseBool(process.env.OPS_NOTIFICATIONS_ENABLED, true);
}

function logChannelEnabled(): boolean {
  return parseBool(process.env.OPS_NOTIFY_LOG, false);
}

function telegramChannelEnabled(): boolean {
  return parseBool(process.env.OPS_NOTIFY_TELEGRAM, false);
}

function formatPendingReviewMessage(p: PendingReviewPayload): string {
  const lines = [
    "DoGood: заказ на проверке (PENDING_REVIEW)",
    `Order: ${p.orderId}`,
  ];
  if (p.customerName) lines.push(`Клиент: ${p.customerName}`);
  if (p.attempt != null) lines.push(`Попытка: ${p.attempt}`);
  if (p.reviewUrl) lines.push(`Открыть: ${p.reviewUrl}`);
  return lines.join("\n");
}

/**
 * Вызывать после перевода заказа в PENDING_REVIEW (и сохранения в Sheets).
 * Ошибки каналов не бросаем наружу — только логируем, чтобы не ломать основной поток.
 */
export async function notifyPendingReview(payload: PendingReviewPayload): Promise<void> {
  if (!notificationsGloballyEnabled()) return;

  const text = formatPendingReviewMessage(payload);

  if (logChannelEnabled()) {
    console.info("[notifications]", text.replace(/\n/g, " | "));
  }

  if (telegramChannelEnabled()) {
    const r = await sendTelegramText(text);
    if (!r.ok) {
      console.error("[notifications] telegram failed:", r.error);
    }
  }
}
