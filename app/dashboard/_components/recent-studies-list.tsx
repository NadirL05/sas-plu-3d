"use client";

import { useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { formatCurrency, formatDate, zoneBadgeClasses } from "@/src/lib/format";

type StudyRow = {
  id: string;
  address: string;
  createdAt: Date | string | null;
  zoning: unknown;
  promoterBalance: unknown;
  status: "PENDING" | "GO" | "NO_GO";
};

const statusLabel: Record<StudyRow["status"], string> = {
  GO: "✅ GO",
  NO_GO: "❌ NO GO",
  PENDING: "🔍 En étude",
};

export function RecentStudiesList({ studies }: { studies: StudyRow[] }) {
  const router = useRouter();

  if (!studies.length) {
    return (
      <Card className="border-border/70 bg-slate-950/70 text-slate-50">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Études récentes</CardTitle>
          <CardDescription className="text-xs text-slate-400">
            Lancez une première analyse pour voir apparaître vos études ici.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border/70 bg-slate-950/70 text-slate-50">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Études récentes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {studies.map((study) => {
          const zoning = study.zoning as
            | { libelle?: string | null; typezone?: string | null }
            | null;
          const promoter = study.promoterBalance as
            | { prixMaxTerrainEur?: number | null }
            | null;
          const prixMax = promoter?.prixMaxTerrainEur ?? null;

          return (
            <button
              key={study.id}
              type="button"
              onClick={() => router.push(`/dashboard/study/${study.id}`)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2 text-left transition-colors hover:border-emerald-500/40 hover:bg-slate-900/70"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-xs font-medium text-slate-100">
                  {study.address}
                </p>
                <p className="text-[11px] text-slate-400">
                  {formatDate(study.createdAt)} •{" "}
                  <span className={zoneBadgeClasses(zoning?.typezone)}>
                    {zoning?.libelle ?? zoning?.typezone ?? "N/A"}
                  </span>
                </p>
              </div>
              <div className="ml-4 shrink-0 text-right">
                <p className="text-[11px] text-slate-400">Prix max terrain</p>
                <p
                  className={`text-sm font-semibold ${
                    typeof prixMax === "number" && prixMax > 0
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {formatCurrency(prixMax)}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {statusLabel[study.status]}
                </p>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

