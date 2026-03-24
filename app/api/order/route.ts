import { NextResponse } from "next/server";

/**
 * Заглушка приёма заявок. На проде замените на запись в БД, CRM или очередь.
 * В dev смотрите вывод в терминале `next dev`.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const payload: Record<string, string> = {};

  formData.forEach((value, key) => {
    if (value instanceof File) {
      payload[key] = `File(${value.name}, ${value.size} bytes)`;
    } else {
      payload[key] = String(value);
    }
  });

  console.log("[api/order] incoming:", payload);

  return NextResponse.json({ ok: true, received: Object.keys(payload) });
}
