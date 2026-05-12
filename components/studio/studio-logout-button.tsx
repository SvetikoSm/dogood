"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StudioLogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await fetch("/api/studio/auth/logout", { method: "POST" });
          router.push("/studio/login");
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
      className="text-zinc-500 text-xs hover:text-zinc-300 disabled:opacity-50"
    >
      {pending ? "…" : "Log out"}
    </button>
  );
}
