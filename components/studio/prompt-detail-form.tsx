"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PromptDetailForm(props: { promptKey: string; title: string; body: string }) {
  const router = useRouter();
  const [title, setTitle] = useState(props.title);
  const [body, setBody] = useState(props.body);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setMsg(null);
    setPending(true);
    try {
      const res = await fetch(`/api/studio/prompts/${encodeURIComponent(props.promptKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setMsg(j.error || "Save failed");
        return;
      }
      setMsg("Saved");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="text-zinc-500">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="text-zinc-500">Body</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={22}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs leading-relaxed"
        />
      </label>
      {msg ? <p className="text-sm text-violet-300">{msg}</p> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => void save()}
        className="rounded-lg bg-violet-700 px-4 py-2 text-sm hover:bg-violet-600 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
