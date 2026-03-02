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
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-64 border-r ultra-fine-border glass bg-background-light/80 dark:bg-background-dark/80 shrink-0">
        <div className="p-6 flex h-full flex-col gap-8">
          <div className="flex flex-col">
            <h1 className="text-primary text-lg font-bold tracking-tight">SAS PLU 3D</h1>
            <p className="text-slate-500 text-xs font-medium uppercase tracking-widest">
              Premium B2B SaaS
            </p>
          </div>

          <SidebarNav />

          <div className="pt-6 border-t ultra-fine-border">
            <div className="flex items-center gap-3 px-2">
              <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
                {initials}
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-medium truncate">{displayName}</span>
                <span className="text-[10px] text-slate-500 truncate">{role}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="md:ml-64 min-h-screen flex flex-col">
        <MobileSidebar displayName={displayName} initials={initials} role={role} />
        <main className="flex-1 overflow-y-auto">
          <div className="min-h-full p-4 md:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
