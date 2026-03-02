"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, Folder, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Recherche", icon: Search },
  { href: "/dashboard/projects", label: "Mes Projets", icon: Folder },
  { href: "/dashboard/billing", label: "Facturation", icon: CreditCard },
];

interface SidebarNavProps {
  iconOnly?: boolean;
}

export function SidebarNav({ iconOnly = false }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-col flex-1", iconOnly ? "items-center gap-3" : "gap-1")}>
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);
        const Icon = item.icon;

        if (iconOnly) {
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className={cn(
                "group relative inline-flex h-12 w-12 items-center justify-center rounded-2xl transition-all",
                isActive
                  ? "text-white"
                  : "text-slate-500 hover:text-slate-100"
              )}
            >
              {isActive ? (
                <>
                  <span className="absolute inset-0 rounded-2xl bg-primary/20" />
                  <span className="absolute inset-0 rounded-[1.4rem] bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.78),transparent_60%)] blur-xl opacity-85" />
                </>
              ) : null}
              <Icon
                className={cn(
                  "relative z-10 h-6 w-6",
                  isActive ? "animate-pulse" : ""
                )}
              />
              <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md border border-white/10 bg-slate-950/95 px-2.5 py-1 text-xs font-medium text-slate-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {item.label}
              </span>
            </Link>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-slate-400 hover:text-slate-100 hover:bg-white/5"
            )}
          >
            <Icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
