import Link from "next/link";
import { revalidatePath } from "next/cache";

import { desc } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
import { syncStudioOrdersFromGoogleSheet } from "@/lib/studio/google/sync-orders-from-sheet";

async function syncOrdersFromSheetAction() {
  "use server";
  await syncStudioOrdersFromGoogleSheet();
  revalidatePath("/studio/orders");
}

export default async function StudioOrdersPage() {
  const db = getStudioDb();
  const orders = await db
    .select({
      id: schema.studioOrders.id,
      sheetOrderId: schema.studioOrders.sheetOrderId,
      customerName: schema.studioOrders.customerName,
      petNameRaw: schema.studioOrders.petNameRaw,
      designSlug: schema.studioOrders.designSlug,
      status: schema.studioOrders.status,
      updatedAt: schema.studioOrders.updatedAt,
    })
    .from(schema.studioOrders)
    .orderBy(desc(schema.studioOrders.updatedAt));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Orders</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Sync from Google Sheets, then open an order to run the pipeline.
          </p>
        </div>
        <form action={syncOrdersFromSheetAction}>
          <button
            type="submit"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800"
          >
            Sync from Google Sheet
          </button>
        </form>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/50 text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Order ID</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Pet name</th>
              <th className="px-3 py-2 font-medium">Design</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-zinc-800/80 hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <Link className="text-violet-400 hover:underline" href={`/studio/orders/${o.id}`}>
                    {o.sheetOrderId}
                  </Link>
                </td>
                <td className="px-3 py-2 text-zinc-300">{o.customerName || "—"}</td>
                <td className="px-3 py-2 text-zinc-200">{o.petNameRaw || "—"}</td>
                <td className="px-3 py-2 text-zinc-400">{o.designSlug}</td>
                <td className="px-3 py-2 text-zinc-400">{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
