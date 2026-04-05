export type PendingReviewPayload = {
  orderId: string;
  customerName?: string;
  /** Абсолютный URL карточки в review UI (когда появится маршрут) */
  reviewUrl?: string;
  attempt?: number;
};
