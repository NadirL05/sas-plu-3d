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

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 flex-1">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);
        const Icon = item.icon;

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
