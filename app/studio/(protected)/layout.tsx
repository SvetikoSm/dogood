import { redirect } from "next/navigation";

import { StudioNav } from "@/components/studio/studio-nav";
import { isStudioAuthenticated } from "@/lib/studio/session";

export const dynamic = "force-dynamic";

export default async function StudioProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isStudioAuthenticated())) {
    redirect("/studio/login");
  }
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <StudioNav />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
