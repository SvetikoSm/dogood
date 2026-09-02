import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";

/**
 * Telegram redelivers an update whenever the poller fails to confirm its
 * offset (curl timeout, app restart, two pollers racing). Without a guard the
 * same photo/callback is handled twice and the client sees duplicate replies.
 *
 * We reuse the locks table: the first claim for an update_id wins and the row
 * stays "locked" for the retention window, so any replay inside it is dropped.
 */
const UPDATE_RETENTION_MS = 6 * 60 * 60 * 1000;

export async function claimTelegramUpdate(bot: string, updateId: number | undefined): Promise<boolean> {
  if (typeof updateId !== "number" || !Number.isFinite(updateId)) return true;
  const name = `tg_update:${bot}:${updateId}`;
  const db = getStudioDb();
  const now = new Date();
  await db
    .insert(schema.studioLocks)
    .values({ name, lockedUntil: new Date(0) })
    .onConflictDoNothing();
  const res = await db
    .update(schema.studioLocks)
    .set({ lockedUntil: new Date(now.getTime() + UPDATE_RETENTION_MS) })
    .where(and(eq(schema.studioLocks.name, name), lt(schema.studioLocks.lockedUntil, now)));
  return (res.rowsAffected ?? 0) > 0;
}
