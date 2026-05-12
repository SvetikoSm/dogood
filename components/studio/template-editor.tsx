"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { StudioTemplate } from "@/lib/studio/db/schema";

function filePreviewUrl(studioRelativePath: string) {
  const p = studioRelativePath.trim();
  if (!p) return null;
  return `/api/studio/file?path=${encodeURIComponent(p)}`;
}

export function TemplateEditor({ template }: { template: StudioTemplate }) {
  const router = useRouter();
  const [name, setName] = useState(template.name);
  const [designTemplatePath, setDesignTemplatePath] = useState(template.designTemplatePath);
  const [textStyleRefPath, setTextStyleRefPath] = useState(template.textStyleRefPath);
  const [petStyleRefPathsJson, setPetStyleRefPathsJson] = useState(
    template.petStyleRefPathsJson || "[]",
  );
  const [compositionNotes, setCompositionNotes] = useState(template.compositionNotes ?? "");
  const [replacementRulesJson, setReplacementRulesJson] = useState(template.replacementRulesJson);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const petRefs: string[] = useMemo(() => {
    try {
      const a = JSON.parse(petStyleRefPathsJson) as unknown;
      return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }, [petStyleRefPathsJson]);

  async function save() {
    setMsg(null);
    let parsedPet: unknown;
    try {
      parsedPet = JSON.parse(petStyleRefPathsJson);
    } catch {
      setMsg("Pet style refs: невалидный JSON (нужен массив строк путей).");
      return;
    }
    if (!Array.isArray(parsedPet) || !parsedPet.every((x) => typeof x === "string")) {
      setMsg("Pet style refs: JSON должен быть массивом строк, например [\"templates/speed/a.png\"]");
      return;
    }
    try {
      JSON.parse(replacementRulesJson);
    } catch {
      setMsg("Replacement rules: невалидный JSON.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch(`/api/studio/templates/${encodeURIComponent(template.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          designTemplatePath,
          textStyleRefPath,
          petStyleRefPathsJson,
          compositionNotes,
          replacementRulesJson,
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setMsg(j.error || "Save failed");
        return;
      }
      setMsg("Сохранено");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
      <h2 className="font-medium text-lg text-violet-300">
        <span className="font-mono text-sm text-zinc-500">{template.slug}</span> — референсы и макет
      </h2>
      <p className="mt-2 text-sm text-zinc-500">
        Положи файлы на диск под{" "}
        <code className="rounded bg-zinc-950 px-1 text-zinc-300">data/studio/</code>, пути ниже —
        относительно этой папки (как в сиде: <code className="text-zinc-400">templates/speed/…</code>
        ).
      </p>

      <label className="mt-4 block text-sm">
        <span className="text-zinc-400">Название в UI</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
        />
      </label>

      <label className="mt-3 block text-sm">
        <span className="text-zinc-400">Макет дизайна (полный принт / шаблон)</span>
        <input
          value={designTemplatePath}
          onChange={(e) => setDesignTemplatePath(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"
        />
      </label>
      {filePreviewUrl(designTemplatePath) ? (
        <a
          href={filePreviewUrl(designTemplatePath)!}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-violet-400 text-xs underline"
        >
          открыть превью
        </a>
      ) : null}

      <label className="mt-3 block text-sm">
        <span className="text-zinc-400">Референс стиля текста (имя на футболке)</span>
        <input
          value={textStyleRefPath}
          onChange={(e) => setTextStyleRefPath(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"
        />
      </label>
      {filePreviewUrl(textStyleRefPath) ? (
        <a
          href={filePreviewUrl(textStyleRefPath)!}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-violet-400 text-xs underline"
        >
          открыть превью
        </a>
      ) : null}

      <label className="mt-3 block text-sm">
        <span className="text-zinc-400">
          Референсы стиля собаки (JSON-массив путей, 2–3 картинки)
        </span>
        <textarea
          value={petStyleRefPathsJson}
          onChange={(e) => setPetStyleRefPathsJson(e.target.value)}
          rows={5}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs"
          placeholder='["templates/speed/pet_ref_1.png","templates/speed/pet_ref_2.png"]'
        />
      </label>
      {petRefs.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {petRefs.map((p) => {
            const u = filePreviewUrl(p);
            return u ? (
              <a
                key={p}
                href={u}
                target="_blank"
                rel="noreferrer"
                className="inline-block overflow-hidden rounded border border-zinc-700"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="h-16 w-16 object-cover" />
              </a>
            ) : null;
          })}
        </div>
      ) : null}

      <label className="mt-4 block text-sm">
        <span className="text-zinc-500">Replacement rules JSON</span>
        <textarea
          value={replacementRulesJson}
          onChange={(e) => setReplacementRulesJson(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs"
        />
      </label>
      <label className="mt-3 block text-sm">
        <span className="text-zinc-500">Заметки к финальной сборке (дизайн 3 и т.д.)</span>
        <textarea
          value={compositionNotes}
          onChange={(e) => setCompositionNotes(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-sm"
        />
      </label>
      {msg ? <p className="mt-2 text-sm text-violet-300">{msg}</p> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => void save()}
        className="mt-3 rounded-lg bg-violet-700 px-4 py-2 text-sm hover:bg-violet-600 disabled:opacity-50"
      >
        {pending ? "Сохранение…" : "Сохранить"}
      </button>
    </section>
  );
}
