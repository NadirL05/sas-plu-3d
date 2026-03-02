"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { SidebarNav } from "./sidebar-nav";

interface MobileSidebarProps {
  displayName: string;
  initials: string;
  role: "FREE" | "PRO";
}

export function MobileSidebar({ displayName, initials, role }: MobileSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 glass ultra-fine-border border-b">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/5 text-slate-100 hover:bg-white/10"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <p className="text-sm font-semibold text-slate-100">SAS PLU 3D</p>
        <div className="h-9 w-9" />
      </div>

      {open ? (
        <div className="md:hidden fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-label="Fermer le menu"
          />

          <aside className="relative h-full w-64 glass ultra-fine-border border-r bg-background-dark p-6 flex flex-col gap-8">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <h1 className="text-primary text-lg font-bold tracking-tight">SAS PLU 3D</h1>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-widest">
                  Premium B2B SaaS
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/5 text-slate-200 hover:bg-white/10"
                aria-label="Fermer le menu"
              >
                <X className="h-4 w-4" />
              </button>
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
          </aside>
        </div>
      ) : null}
    </>
  );
}

