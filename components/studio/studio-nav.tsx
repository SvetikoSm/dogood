import Link from "next/link";

import { StudioLogoutButton } from "@/components/studio/studio-logout-button";

const links = [
  { href: "/studio/orders", label: "Orders" },
  { href: "/studio/templates", label: "Templates" },
  { href: "/studio/prompts", label: "Prompts" },
  { href: "/studio/prompt-lab", label: "Prompt Lab" },
  { href: "/studio/settings", label: "Settings" },
] as const;

export function StudioNav() {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/90">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/studio/orders" className="font-semibold text-violet-300 tracking-tight">
          DoGood Studio
        </Link>
        <nav className="flex flex-wrap gap-3 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-zinc-400 hover:text-zinc-100 hover:underline"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <StudioLogoutButton />
        </div>
      </div>
    </header>
  );
}
