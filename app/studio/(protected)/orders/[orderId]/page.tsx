import { notFound } from "next/navigation";

import { desc, eq } from "drizzle-orm";

import { OrderWorkbench } from "@/components/studio/order-workbench";
import { getStudioDb, schema } from "@/lib/studio/db";

type PageProps = { params: Promise<{ orderId: string }> };

export default async function StudioOrderDetailPage(props: PageProps) {
  const { orderId } = await props.params;
  const db = getStudioDb();
  const [order] = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  if (!order) notFound();

  const photos = await db
    .select({
      id: schema.studioOrderPhotos.id,
      localRelativePath: schema.studioOrderPhotos.localRelativePath,
      originalName: schema.studioOrderPhotos.originalName,
    })
    .from(schema.studioOrderPhotos)
    .where(eq(schema.studioOrderPhotos.orderId, orderId));

  const steps = await db
    .select()
    .from(schema.studioStepRuns)
    .where(eq(schema.studioStepRuns.orderId, orderId))
    .orderBy(desc(schema.studioStepRuns.createdAt));

  return (
    <OrderWorkbench
      orderId={orderId}
      order={{
        id: order.id,
        sheetOrderId: order.sheetOrderId,
        customerName: order.customerName,
        petNameRaw: order.petNameRaw,
        petNameScript: order.petNameScript,
        designSlug: order.designSlug,
        status: order.status,
        lastError: order.lastError,
        approvedDogArtifactPath: order.approvedDogArtifactPath,
        approvedTextArtifactPath: order.approvedTextArtifactPath,
        approvedFinalArtifactPath: order.approvedFinalArtifactPath,
      }}
      photos={photos}
      steps={steps.map((s) => ({
        id: s.id,
        stage: s.stage,
        stepKey: s.stepKey,
        attempt: s.attempt,
        status: s.status,
        error: s.error,
        outputArtifactPath: s.outputArtifactPath,
        llmOutputJson: s.llmOutputJson,
        rawLlmResponseText: s.rawLlmResponseText,
        promptBundleJson: s.promptBundleJson,
        createdAt: s.createdAt,
      }))}
    />
  );
}
