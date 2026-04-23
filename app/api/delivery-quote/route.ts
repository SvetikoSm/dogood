import { NextResponse } from "next/server";

type DeliveryMethod = "yandex" | "cdek";

const carrierLabels: Record<DeliveryMethod, string> = {
  yandex: "Яндекс Доставка",
  cdek: "СДЭК",
};

/** Москва — базовый ориентир; регионы и «дальний» — дороже. */
function detectZone(address: string): "moscow" | "regional" | "far" {
  const a = address.toLowerCase();
  if (a.includes("москва") || a.includes("moscow")) return "moscow";
  if (
    a.includes("владивосток") ||
    a.includes("хабаровск") ||
    a.includes("южно-сахалинск") ||
    a.includes("якутск") ||
    a.includes("камчат")
  ) {
    return "far";
  }
  return "regional";
}

function getQuote(address: string, method: DeliveryMethod) {
  const zone = detectZone(address);
  const matrix: Record<DeliveryMethod, Record<typeof zone, number>> = {
    yandex: { moscow: 250, regional: 350, far: 350 },
    cdek: { moscow: 400, regional: 400, far: 400 },
  };
  return {
    priceRub: matrix[method][zone],
    etaDays: method === "cdek" ? "2-4 дня" : "1-3 дня",
    carrierLabel: carrierLabels[method],
    zoneLabel: "",
    note:
      "Стоимость доставки на сайте указана приблизительно. Для Яндекс Доставки ориентир: 250 ₽ по Москве и 350 ₽ за пределами Москвы. Точный тариф зависит от выбранной службы (Яндекс Доставка/СДЭК) и оплачивается получателем при получении.",
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    address?: string;
    deliveryMethod?: DeliveryMethod | string;
  };

  const address = body.address?.trim();
  const method = body.deliveryMethod;
  if (
    !address ||
    !method ||
    (method !== "cdek" && method !== "yandex")
  ) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    quote: getQuote(address, method),
  });
}
