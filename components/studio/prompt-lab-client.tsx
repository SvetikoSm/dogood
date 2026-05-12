"use client";

import { useState } from "react";

export function PromptLabClient() {
  const [system, setSystem] = useState("You return JSON only.");
  const [user, setUser] = useState('{"instruction":"ping"}');
  const [model, setModel] = useState("");
  const [images, setImages] = useState("");
  const [out, setOut] = useState<string>("");
  const [pending, setPending] = useState(false);

  async function run() {
    setOut("");
    setPending(true);
    try {
      const imageDataUrls = images
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/studio/prompt-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system,
          user,
          model: model.trim() || undefined,
          imageDataUrls: imageDataUrls.length ? imageDataUrls : undefined,
        }),
      });
      const text = await res.text();
      setOut(text);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="text-zinc-500">Model override (optional)</span>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. google/gemini-2.5-flash-preview-05-20"
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"
        />
      </label>
      <label className="block text-sm">
        <span className="text-zinc-500">System</span>
        <textarea
          value={system}
          onChange={(e) => setSystem(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="text-zinc-500">User</span>
        <textarea
          value={user}
          onChange={(e) => setUser(e.target.value)}
          rows={8}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs"
        />
      </label>
      <label className="block text-sm">
        <span className="text-zinc-500">Image data URLs (one per line, optional)</span>
        <textarea
          value={images}
          onChange={(e) => setImages(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs"
        />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => void run()}
        className="rounded-lg bg-violet-700 px-4 py-2 text-sm hover:bg-violet-600 disabled:opacity-50"
      >
        {pending ? "Running…" : "Run"}
      </button>
      {out ? (
        <pre className="max-h-[480px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-xs text-zinc-300">
          {out}
        </pre>
      ) : null}
    </div>
  );
}
