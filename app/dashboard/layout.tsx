import type { ReactNode } from "react";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { db } from "@/src/db";
import { user } from "@/src/db/schema";
import { MobileSidebar } from "./_components/mobile-sidebar";
import { SidebarNav } from "./_components/sidebar-nav";

function getInitials(name?: string | null, email?: string | null) {
  const source = (name && name.trim()) || (email && email.trim()) || "User";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[dashboard.layout] session fallback invite", error);
  }
  const userId = session?.user?.id;

  const displayName =
    session?.user?.name?.trim() ||
    session?.user?.email?.split("@")[0] ||
    "Invité";
  const initials = getInitials(session?.user?.name, session?.user?.email);
  let role: "FREE" | "PRO" = "FREE";

  if (userId && db) {
    try {
      const [currentUser] = await db
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

      if (currentUser?.role === "PRO") {
        role = "PRO";
      }
    } catch (error) {
      console.warn("[dashboard.layout] role fallback FREE (db indisponible)", error);
    }
  }

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 overflow-hidden">
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-20 glass bg-background-dark/40 dark:bg-background-dark/30 shrink-0">
        <div className="w-full py-5 px-2 flex h-full flex-col items-center gap-6">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-[0_0_20px_rgba(60,60,246,0.35)]">
            <span className="text-lg font-bold">3D</span>
          </div>

          <SidebarNav iconOnly />

          <div className="mt-auto relative group">
            <div className="size-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs border border-white/10">
              {initials}
            </div>
            <div className="pointer-events-none absolute left-full ml-3 bottom-0 whitespace-nowrap rounded-md border border-white/10 bg-slate-950/95 px-2.5 py-1 text-xs font-medium text-slate-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              {displayName} · {role}
            </div>
          </div>
        </div>
      </aside>

      <div className="md:ml-20 min-h-screen flex flex-col">
        <MobileSidebar displayName={displayName} initials={initials} role={role} />
        <main className="flex-1 overflow-y-auto">
          <div className="min-h-full p-4 md:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
