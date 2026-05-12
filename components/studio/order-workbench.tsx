"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { STUDIO_STEP_KEYS, type StudioStepKey } from "@/lib/studio/step-keys";

type Row = {
  id: string;
  sheetOrderId: string;
  customerName: string;
  petNameRaw: string;
  petNameScript: string;
  designSlug: string;
  status: string;
  lastError: string;
  approvedDogArtifactPath: string;
  approvedTextArtifactPath: string;
  approvedFinalArtifactPath: string;
};

type Photo = {
  id: string;
  localRelativePath: string;
  originalName: string;
};

type Step = {
  id: string;
  stage: string;
  stepKey: string;
  attempt: number;
  status: string;
  error: string;
  outputArtifactPath: string;
  llmOutputJson: string;
  rawLlmResponseText: string;
  promptBundleJson: string;
  createdAt: string | Date | null;
};

function fileUrl(rel: string) {
  return `/api/studio/file?path=${encodeURIComponent(rel)}`;
}

const DOG_STEPS: { key: StudioStepKey; label: string }[] = [
  { key: STUDIO_STEP_KEYS.DOG_LLM_INITIAL_PROMPT, label: "1 · LLM → dog image prompt" },
  { key: STUDIO_STEP_KEYS.DOG_IMG_V1, label: "2 · Image gen v1" },
  { key: STUDIO_STEP_KEYS.DOG_LLM_CRITIQUE, label: "3 · LLM critique" },
  { key: STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION, label: "4 · Image correction" },
  { key: STUDIO_STEP_KEYS.DOG_LLM_IDENTITY_PROMPT, label: "5 · LLM identity prompt" },
  { key: STUDIO_STEP_KEYS.DOG_IMG_V3_IDENTITY, label: "6 · Image identity pass" },
];

const TEXT_STEPS: { key: StudioStepKey; label: string }[] = [
  { key: STUDIO_STEP_KEYS.TEXT_LLM_STYLE_PROMPT, label: "1 · LLM → text prompt" },
  { key: STUDIO_STEP_KEYS.TEXT_IMG_V1, label: "2 · Text image v1" },
  { key: STUDIO_STEP_KEYS.TEXT_LLM_CRITIQUE, label: "3 · LLM critique" },
  { key: STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION, label: "4 · Text correction" },
];

const FINAL_STEPS: { key: StudioStepKey; label: string }[] = [
  { key: STUDIO_STEP_KEYS.FINAL_IMG_V1, label: "1 · Compose final v1" },
  { key: STUDIO_STEP_KEYS.FINAL_LLM_CRITIQUE, label: "2 · LLM critique" },
  { key: STUDIO_STEP_KEYS.FINAL_IMG_V2_CORRECTION, label: "3 · Final correction" },
];

export function OrderWorkbench({
  orderId,
  order,
  photos,
  steps,
}: {
  orderId: string;
  order: Row;
  photos: Photo[];
  steps: Step[];
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function runStep(stepKey: StudioStepKey) {
    setMsg(null);
    setBusy(stepKey);
    try {
      const res = await fetch(`/api/studio/orders/${orderId}/steps/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepKey }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setMsg(j.error || "Step failed");
        return;
      }
      setMsg(`OK — step ${stepKey}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function post(path: string, body?: object) {
    setMsg(null);
    setBusy(path);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : "{}",
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setMsg(j.error || "Request failed");
        return;
      }
      setMsg("OK");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-2">
        <h1 className="font-semibold text-2xl tracking-tight">{order.sheetOrderId}</h1>
        <p className="text-sm text-zinc-400">
          Status: <span className="text-zinc-200">{order.status}</span> · Template{" "}
          <span className="text-zinc-200">{order.designSlug}</span>
        </p>
        {order.lastError ? (
          <p className="rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-red-200 text-sm">
            {order.lastError}
          </p>
        ) : null}
        {msg ? <p className="text-sm text-violet-300">{msg}</p> : null}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Customer & pet</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Customer</dt>
            <dd>{order.customerName || "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Pet name (exact)</dt>
            <dd className="font-mono text-zinc-100">{order.petNameRaw || "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Script hint</dt>
            <dd>{order.petNameScript}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Pet photos</h2>
        {photos.length === 0 ? (
          <p className="text-sm text-zinc-500">No cached photos — run Drive fetch.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {photos.map((p) => (
              <a
                key={p.id}
                href={fileUrl(p.localRelativePath)}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg border border-zinc-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(p.localRelativePath)}
                  alt={p.originalName}
                  className="h-28 w-28 object-cover"
                />
              </a>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={!!busy}
          onClick={() => runStep(STUDIO_STEP_KEYS.FETCH_DRIVE_PHOTOS)}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50"
        >
          {busy === STUDIO_STEP_KEYS.FETCH_DRIVE_PHOTOS
            ? "Fetching…"
            : "Fetch / refresh photos from Drive"}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Stage A — Dog illustration</h2>
        <div className="flex flex-col gap-2">
          {DOG_STEPS.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={!!busy}
              onClick={() => runStep(s.key)}
              className="rounded-lg border border-zinc-800 px-3 py-2 text-left text-sm hover:bg-zinc-900 disabled:opacity-50"
            >
              {busy === s.key ? "Running…" : s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => post(`/api/studio/orders/${orderId}/approve-dog`)}
            className="rounded-lg bg-emerald-800 px-3 py-2 text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            Approve dog stage
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => {
              const note = window.prompt("Rejection note (optional)") ?? "";
              void post(`/api/studio/orders/${orderId}/reject-dog`, { note });
            }}
            className="rounded-lg bg-red-900/60 px-3 py-2 text-sm hover:bg-red-800 disabled:opacity-50"
          >
            Reject dog stage
          </button>
        </div>
        {order.approvedDogArtifactPath ? (
          <p className="text-xs text-zinc-500">
            Approved dog artifact:{" "}
            <a className="text-violet-400 underline" href={fileUrl(order.approvedDogArtifactPath)}>
              open
            </a>
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Stage B — Pet name artwork</h2>
        <div className="flex flex-col gap-2">
          {TEXT_STEPS.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={!!busy}
              onClick={() => runStep(s.key)}
              className="rounded-lg border border-zinc-800 px-3 py-2 text-left text-sm hover:bg-zinc-900 disabled:opacity-50"
            >
              {busy === s.key ? "Running…" : s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => post(`/api/studio/orders/${orderId}/approve-text`)}
            className="rounded-lg bg-emerald-800 px-3 py-2 text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            Approve text stage
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => {
              const note = window.prompt("Rejection note (optional)") ?? "";
              void post(`/api/studio/orders/${orderId}/reject-text`, { note });
            }}
            className="rounded-lg bg-red-900/60 px-3 py-2 text-sm hover:bg-red-800 disabled:opacity-50"
          >
            Reject text stage
          </button>
        </div>
        {order.approvedTextArtifactPath ? (
          <p className="text-xs text-zinc-500">
            Approved text:{" "}
            <a className="text-violet-400 underline" href={fileUrl(order.approvedTextArtifactPath)}>
              open
            </a>
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Stage C — Final composition</h2>
        <div className="flex flex-col gap-2">
          {FINAL_STEPS.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={!!busy}
              onClick={() => runStep(s.key)}
              className="rounded-lg border border-zinc-800 px-3 py-2 text-left text-sm hover:bg-zinc-900 disabled:opacity-50"
            >
              {busy === s.key ? "Running…" : s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => post(`/api/studio/orders/${orderId}/approve-final`)}
            className="rounded-lg bg-emerald-800 px-3 py-2 text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            Approve final — mark complete
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => {
              const note = window.prompt("Rejection note (optional)") ?? "";
              void post(`/api/studio/orders/${orderId}/reject-final`, { note });
            }}
            className="rounded-lg bg-red-900/60 px-3 py-2 text-sm hover:bg-red-800 disabled:opacity-50"
          >
            Reject final
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-lg">Timeline</h2>
        <ul className="space-y-2 text-sm">
          {steps.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 px-3 py-2"
            >
              <div className="flex flex-wrap gap-2 text-zinc-300">
                <span className="font-mono text-xs text-violet-400">{s.stepKey}</span>
                <span className="text-zinc-500">·</span>
                <span>{s.status}</span>
                {s.attempt > 1 ? <span className="text-zinc-500">attempt {s.attempt}</span> : null}
              </div>
              {s.error ? <p className="mt-1 text-red-300 text-xs">{s.error}</p> : null}
              {s.outputArtifactPath ? (
                <a
                  className="mt-1 inline-block text-violet-400 text-xs underline"
                  href={fileUrl(s.outputArtifactPath)}
                  target="_blank"
                  rel="noreferrer"
                >
                  artifact
                </a>
              ) : null}
              {s.llmOutputJson ? (
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-zinc-950 p-2 text-xs text-zinc-400">
                  {s.llmOutputJson.slice(0, 4000)}
                  {s.llmOutputJson.length > 4000 ? "…" : ""}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
