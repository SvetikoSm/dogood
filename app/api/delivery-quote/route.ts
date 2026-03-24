import { NextResponse } from "next/server";

type DeliveryMethod = "wb" | "cdek" | "yandex";

const carrierLabels: Record<DeliveryMethod, string> = {
  wb: "Wildberries",
  cdek: "СДЭК",
  yandex: "Яндекс Доставка",
};

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
    yandex: { moscow: 320, regional: 560, far: 890 },
  };
  const eta: Record<typeof zone, string> = {
    moscow: "1-2 дня",
    regional: "2-5 дней",
    far: "5-9 дней",
  };
  return {
    priceRub: matrix[method][zone],
    etaDays: eta[zone],
    carrierLabel: carrierLabels[method],
    note:
      "Это предварительный расчет. Точная сумма зависит от тарифа службы, веса и формата выдачи.",
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    address?: string;
    deliveryMethod?: DeliveryMethod;
  };

  const address = body.address?.trim();
  const method = body.deliveryMethod;
  if (!address || !method || !(method in carrierLabels)) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    quote: getQuote(address, method),
  });
}
