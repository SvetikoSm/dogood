import { NextResponse } from "next/server";

type DeliveryMethod = "wb" | "cdek";

const carrierLabels: Record<DeliveryMethod, string> = {
  wb: "Wildberries",
  cdek: "СДЭК",
};

/** Москва — базовый (более низкий) ориентир; регионы и «дальний» — дороже. */
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
    wb: { moscow: 180, regional: 290, far: 490 },
    cdek: { moscow: 260, regional: 420, far: 690 },
  };
  return {
    priceRub: matrix[method][zone],
    etaDays: method === "cdek" ? "1-2 дня" : "2-4 дней",
    carrierLabel: carrierLabels[method],
    zoneLabel: "",
    note:
      "Стоимость доставки на сайте указана приблизительно. Точный тариф зависит от выбранной службы (Wildberries/СДЭК) и оплачивается получателем при получении.",
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
    (method !== "cdek" && method !== "wb")
  ) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    quote: getQuote(address, method),
  });
}
