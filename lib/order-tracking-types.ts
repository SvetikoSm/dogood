/**
 * Структура `order.json` — удобна для трекинга в CRM / таблице / своей админке.
 */
export type OrderTrackingStatus =
  | "new"
  | "contacted"
  | "mockup_sent"
  | "approved"
  | "in_production"
  | "shipped"
  | "cancelled";

export type TrackedOrderLine = {
  /** 0 = первая футболка в заказе */
  lineIndex: number;
  dogName: string;
  breed: string;
  /** id стиля: life | speed | rainy */
  printStyle: string;
  printStyleLabel: string;
  color: string;
  sameAsPrevious: boolean;
  /** если «как на предыдущей» — откуда брать фото */
  mirrorPhotosFromLine: number | null;
  /** пути от корня папки заявки, например `uploads/0_items_0_photos__dog.jpg` */
  photoRelativePaths: string[];
};

export type TrackedOrder = {
  schemaVersion: 1;
  orderId: string;
  /** Меняйте вручную или скриптом при обработке заказа */
  status: OrderTrackingStatus;
  createdAt: string;
  updatedAt: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    promoCode: string | null;
  };
  delivery: {
    address: string;
    methodCode: string;
    methodLabel: string;
  };
  shelter: {
    id: string;
    name: string;
    city: string;
  };
  items: TrackedOrderLine[];
  comment: string;
  /** Все загруженные файлы (дублирует связь с items для аудита) */
  files: Array<{
    field: string;
    relativePath: string;
    originalName: string;
    sizeBytes: number;
    mimeType: string;
  }>;
};
