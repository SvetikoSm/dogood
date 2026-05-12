"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StudioLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setPending(true);
    try {
      const res = await fetch("/api/studio/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        devHint?: string;
        lengthExpected?: number;
        lengthReceived?: number;
      };
      if (!res.ok || !j.ok) {
        const extra =
          typeof j.lengthExpected === "number" && typeof j.lengthReceived === "number"
            ? ` (ожидалось символов: ${j.lengthExpected}, введено: ${j.lengthReceived})`
            : "";
        setErr([j.error || "Login failed", j.devHint, extra].filter(Boolean).join(" "));
        return;
      }
      router.push("/studio/orders");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm">
        <span className="text-zinc-400">Пароль</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
        />
      </label>
      {err ? <p className="text-red-400 text-sm">{err}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-violet-600 py-2 font-medium text-sm text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {pending ? "Вход…" : "Войти"}
      </button>
    </form>
  );
}
