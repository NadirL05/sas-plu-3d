"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ZoneUrba, PromoterBalance } from "@/src/lib/plu-engine";

type FeasibilityStatus = "PENDING" | "GO" | "NO_GO";

type PipelineStudy = {
  id: string;
  address: string;
  createdAt: string | null;
  zoning: ZoneUrba | null;
  promoterBalance: PromoterBalance | null;
  status: FeasibilityStatus;
  note: string | null;
};

interface ProjectPipelineTableProps {
  projectName: string;
  studies: PipelineStudy[];
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

function formatCurrency(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "-";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function statusLabel(status: FeasibilityStatus): string {
  if (status === "GO") return "GO";
  if (status === "NO_GO") return "NO GO";
  return "EN ÉTUDE";
}

export function ProjectPipelineTable({ projectName, studies }: ProjectPipelineTableProps) {
  const [rows, setRows] = useState<PipelineStudy[]>(studies);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFieldChange = (
    id: string,
    field: "status" | "note",
    value: FeasibilityStatus | string,
  ) => {
    setRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, [field]: value } : row,
      ),
    );
  };

  const handleSave = async (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;

    setSavingId(id);
    setError(null);

    try {
      const response = await fetch(`/api/feasibility/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: row.status,
          note: row.note ?? "",
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | { id?: string; status?: FeasibilityStatus; note?: string; error?: string; message?: string }
        | null;

      if (!response.ok || !data || data.error) {
        const message =
          data?.message ??
          "Impossible de mettre à jour cette étude. Merci de réessayer plus tard.";
        setError(message);
        setSavingId(null);
        return;
      }

      setRows((current) =>
        current.map((rowItem) =>
          rowItem.id === id
            ? {
                ...rowItem,
                status: data.status ?? rowItem.status,
                note: data.note ?? rowItem.note,
              }
            : rowItem,
        ),
      );

      setSavingId(null);
    } catch (err) {
      console.error("[ProjectPipelineTable] update error", err);
      setError("Connexion au service impossible. Vérifiez votre réseau et réessayez.");
      setSavingId(null);
    }
  };

  return (
    <Card className="border-border/70 bg-slate-950/80 text-slate-50">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Pipeline du projet</CardTitle>
        <CardDescription className="text-xs text-slate-400">
          Toutes les études de faisabilité associées à <span className="font-medium">{projectName}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error ? <p className="text-xs text-amber-300">{error}</p> : null}

        {rows.length === 0 ? (
          <p className="text-xs text-slate-500">
            Aucune étude de faisabilité enregistrée pour ce projet pour le moment.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid gap-2 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 md:grid-cols-[2fr,1fr,1fr,1.5fr,auto]"
              >
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-slate-100 line-clamp-2">
                    {row.address}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {formatDate(row.createdAt)} · Zone{" "}
                    <span className="font-mono">
                      {row.zoning?.typezone ?? row.zoning?.libelle ?? "N/A"}
                    </span>
                  </p>
                </div>

                <div className="flex flex-col justify-center">
                  <p className="text-[11px] text-slate-400">Prix max terrain</p>
                  <p
                    className={`text-sm font-semibold ${
                      row.promoterBalance && row.promoterBalance.prixMaxTerrainEur > 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {formatCurrency(row.promoterBalance?.prixMaxTerrainEur)}
                  </p>
                </div>

                <div className="flex flex-col justify-center">
                  <p className="text-[11px] text-slate-400">Statut</p>
                  <select
                    value={row.status}
                    onChange={(event) =>
                      handleFieldChange(row.id, "status", event.target.value as FeasibilityStatus)
                    }
                    disabled={savingId === row.id}
                    className="mt-0.5 h-8 rounded-md border border-slate-800 bg-slate-950/70 px-2 text-xs text-slate-100"
                  >
                    <option value="PENDING">{statusLabel("PENDING")}</option>
                    <option value="GO">{statusLabel("GO")}</option>
                    <option value="NO_GO">{statusLabel("NO_GO")}</option>
                  </select>
                </div>

                <div className="flex flex-col justify-center">
                  <p className="text-[11px] text-slate-400">Note (raison)</p>
                  <Input
                    value={row.note ?? ""}
                    onChange={(e) => handleFieldChange(row.id, "note", e.target.value)}
                    placeholder="Raison du GO / NO GO"
                    className="mt-0.5 h-8 bg-slate-950/70 text-xs text-slate-100 placeholder:text-slate-500"
                    disabled={savingId === row.id}
                  />
                </div>

                <div className="flex items-center justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={savingId === row.id}
                    onClick={() => handleSave(row.id)}
                    className="h-8 gap-1.5 text-xs"
                  >
                    {savingId === row.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Sauvegarde...
                      </>
                    ) : (
                      "Enregistrer"
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

