export default async function OrderReviewPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return (
    <main className="p-8">
      <p className="text-muted-foreground">Заявка {orderId}</p>
    </main>
  );
}
