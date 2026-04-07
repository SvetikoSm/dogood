import { NextResponse } from "next/server";

export async function POST(
  _request: Request,
  _context: { params: Promise<{ orderId: string }> },
) {
  return NextResponse.json(
    { ok: false, error: "not_implemented" },
    { status: 501 },
  );
}
