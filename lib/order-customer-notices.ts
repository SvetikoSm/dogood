/** Тексты только для покупателя — без технических деталей и DriveApp. */

export function customerNoticeWhenPhotosMissing(orderId: string): string {
  return `Заявка принята (номер ${orderId}). Если что-то с фото — мы напишем вам на почту в течение 1–2 дней, ничего отправлять повторно не нужно.`;
}

export function customerNoticeWhenPhotosPartial(
  orderId: string,
  uploaded: number,
  total: number,
): string {
  if (uploaded >= total) return customerNoticeWhenPhotosOk(orderId);
  return `Заявка принята (номер ${orderId}). Часть фото мы уже получили; при необходимости уточним по почте.`;
}

export function customerNoticeWhenPhotosOk(orderId: string): string {
  return `Заявка принята! Номер: ${orderId}. Макет и оплата — на почту в течение 1–2 дней.`;
}
