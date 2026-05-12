import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";

import { PromptDetailForm } from "@/components/studio/prompt-detail-form";
import { getStudioDb, schema } from "@/lib/studio/db";

type Props = { params: Promise<{ key: string }> };

export default async function StudioPromptDetailPage(props: Props) {
  const { key } = await props.params;
  const db = getStudioDb();
  const [row] = await db
    .select()
    .from(schema.studioPromptDefinitions)
    .where(eq(schema.studioPromptDefinitions.key, key))
    .limit(1);
  if (!row) notFound();
  return (
    <div className="space-y-6">
      <h1 className="font-semibold text-2xl tracking-tight">{row.title}</h1>
      <p className="font-mono text-xs text-zinc-500">{row.key}</p>
      <PromptDetailForm promptKey={row.key} title={row.title} body={row.body} />
    </div>
  );
}
