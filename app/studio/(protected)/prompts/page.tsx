import Link from "next/link";

import { getStudioDb, schema } from "@/lib/studio/db";

export default async function StudioPromptsPage() {
  const db = getStudioDb();
  const prompts = await db.select().from(schema.studioPromptDefinitions);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Prompt library</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Defaults ship with the repo; edits are stored in SQLite. Use{" "}
          <Link href="/studio/prompt-lab" className="text-violet-400 underline">
            Prompt Lab
          </Link>{" "}
          for ad-hoc experiments.
        </p>
      </div>
      <ul className="space-y-2 text-sm">
        {prompts.map((p) => (
          <li key={p.key}>
            <Link
              href={`/studio/prompts/${encodeURIComponent(p.key)}`}
              className="text-violet-400 hover:underline"
            >
              {p.title}
            </Link>
            <span className="ml-2 font-mono text-xs text-zinc-500">{p.key}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
