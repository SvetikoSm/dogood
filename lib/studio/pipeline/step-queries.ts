import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
export async function latestSuccessfulStepRun(
  orderId: string,
  stepKeys: string[],
): Promise<typeof schema.studioStepRuns.$inferSelect | null> {
  if (!stepKeys.length) return null;
  const db = getStudioDb();
  const rows = await db
    .select()
    .from(schema.studioStepRuns)
    .where(
      and(
        eq(schema.studioStepRuns.orderId, orderId),
        inArray(schema.studioStepRuns.stepKey, stepKeys),
        eq(schema.studioStepRuns.status, "success"),
      ),
    )
    .orderBy(desc(schema.studioStepRuns.finishedAt))
    .limit(1);
  return rows[0] ?? null;
}
