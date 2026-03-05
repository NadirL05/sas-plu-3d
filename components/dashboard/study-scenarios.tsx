"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlusCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { PromoterBalance } from "@/src/lib/plu-engine";

type Scenario = {
  id: string;
  name: string;
  coveragePct: number;
  maxHeightM: number;
  promoterBalance: PromoterBalance | null;
  createdAt?: string | null;
};

interface StudyScenariosSectionProps {
  studyId: string;
  initialScenarios: Scenario[];
}

function formatCurrency(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "-";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function StudyScenariosSection({
  studyId,
  initialScenarios,
}: StudyScenariosSectionProps) {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<Scenario[]>(initialScenarios ?? []);
  const [name, setName] = useState("");
  const [coveragePct, setCoveragePct] = useState<string>("");
  const [maxHeightM, setMaxHeightM] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const coverageValue = Number(coveragePct);
    const heightValue = Number(maxHeightM);

    if (!trimmedName || trimmedName.length < 2) {
      setError("Le nom du scénario doit contenir au moins 2 caractères.");
      return;
    }

    if (!Number.isFinite(coverageValue) || coverageValue <= 0) {
      setError("L'emprise doit être un nombre strictement positif.");
      return;
    }

    if (!Number.isFinite(heightValue) || heightValue <= 0) {
      setError("La hauteur doit être un nombre strictement positif.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/feasibility/${studyId}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          coveragePct: coverageValue,
          maxHeightM: heightValue,
        }),
      });

      const data = (await response.json().catch(() => null)) as (Scenario & {
        error?: string;
        message?: string;
      }) | null;

      if (!response.ok || !data || data.error) {
        const message =
          data?.message ??
          (response.status === 500
            ? "Création du scénario impossible pour le moment. Merci de réessayer plus tard."
            : "Une erreur inattendue est survenue lors de la création du scénario.");
        setError(message);
        setIsSubmitting(false);
        return;
      }

      setScenarios((prev) => [data, ...prev]);
      setName("");
      setCoveragePct("");
      setMaxHeightM("");
      setIsSubmitting(false);
      router.refresh();
    } catch (err) {
      console.error("[StudyScenariosSection] submit error", err);
      setError("Connexion au service impossible. Vérifiez votre réseau et réessayez.");
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border-border/70 bg-slate-950/80 text-slate-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
            <PlusCircle className="h-3.5 w-3.5" />
          </span>
          Scénarios de faisabilité
        </CardTitle>
        <CardDescription className="text-xs text-slate-400">
          Comparez plusieurs variantes (emprise, hauteur) sur la même parcelle pour affiner votre
          stratégie d&apos;acquisition.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <form
          onSubmit={handleSubmit}
          className="grid gap-2 rounded-xl bg-slate-900/60 p-3 ring-1 ring-slate-800/70 md:grid-cols-[2fr,1fr,1fr,auto]"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='Nom du scénario (ex: "R+3 – 50% emprise")'
            className="h-9 bg-slate-950/60 text-xs text-slate-100 placeholder:text-slate-500"
            disabled={isSubmitting}
          />
          <Input
            value={coveragePct}
            onChange={(e) => setCoveragePct(e.target.value)}
            placeholder="% emprise"
            className="h-9 bg-slate-950/60 text-xs text-slate-100 placeholder:text-slate-500"
            disabled={isSubmitting}
          />
          <Input
            value={maxHeightM}
            onChange={(e) => setMaxHeightM(e.target.value)}
            placeholder="Hauteur max (m)"
            className="h-9 bg-slate-950/60 text-xs text-slate-100 placeholder:text-slate-500"
            disabled={isSubmitting}
          />
          <Button
            type="submit"
            size="sm"
            disabled={isSubmitting}
            className="h-9 gap-2 bg-sky-500 text-slate-950 hover:bg-sky-400"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Calcul...
              </>
            ) : (
              "Ajouter"
            )}
          </Button>
        </form>

        <p className="text-[11px] text-slate-500">
          Astuce : commencez par des hypothèses réalistes (40-60% d&apos;emprise, 9-12 m), puis
          augmentez progressivement.
        </p>

        {error ? <p className="text-xs text-amber-300">{error}</p> : null}

        {scenarios.length > 0 ? (
          <div className="space-y-1.5">
            {scenarios.map((scenario) => (
              (() => {
                const prixMax = scenario.promoterBalance?.prixMaxTerrainEur ?? null;
                const isDeficit =
                  typeof prixMax === "number" && Number.isFinite(prixMax) && prixMax < 0;

                return (
                  <div
                    key={scenario.id}
                    className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2"
                  >
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-slate-100">{scenario.name}</p>
                      <p className="text-[11px] text-slate-400">
                        Emprise {scenario.coveragePct}% · Hauteur {scenario.maxHeightM} m
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-400">
                        {isDeficit ? "Projet non rentable" : "Prix max terrain"}
                      </p>
                      <p className={`text-sm font-semibold ${isDeficit ? "text-red-400" : "text-emerald-400"}`}>
                        {isDeficit
                          ? `Déficit estimé: ${formatCurrency(Math.abs(prixMax))}`
                          : formatCurrency(prixMax)}
                      </p>
                    </div>
                  </div>
                );
              })()
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Aucun scénario ajouté pour le moment. Utilisez le formulaire ci-dessus pour créer vos
            premières variantes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

