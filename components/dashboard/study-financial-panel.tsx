"use client";

/**
 * StudyFinancialPanel — Bilan Promoteur interactif
 *
 * Panneau Client Component monté sur la page d'étude.
 * Calcule en temps réel : SDP → CA → Coût total → Marge nette.
 * Intègre un mode "Compte à rebours" pour estimer le prix d'achat max terrain.
 */

import { useState } from "react";
import { AlertTriangle, Building2, Calculator, Euro, TrendingUp } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "–";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function parseNumber(value: string, fallback: number): number {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Emprise au sol estimée selon le type de zone PLU. */
function coverageFor(zoningType?: string | null): number {
  if (!zoningType) return 0.5;
  if (zoningType.startsWith("U")) return 0.6; // zone urbaine dense
  if (zoningType.startsWith("AU")) return 0.5; // zone à urbaniser
  return 0.3; // N / A
}

/** Hauteur PLU par défaut si non fournie par le scénario. */
function defaultHeight(zoningType?: string | null): number {
  if (!zoningType) return 9;
  if (zoningType.startsWith("U")) return 12;
  if (zoningType.startsWith("AU")) return 10;
  return 6;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StudyFinancialPanelProps {
  parcelAreaM2?: number | null;
  zoningType?: string | null;
  /** Hauteur maximale issue du premier scénario sauvegardé. */
  maxHeightM?: number | null;
}

type FinancialMode = "classic" | "reverse";

// ─── Component ────────────────────────────────────────────────────────────────

export function StudyFinancialPanel({
  parcelAreaM2,
  zoningType,
  maxHeightM,
}: StudyFinancialPanelProps) {
  const [mode, setMode] = useState<FinancialMode>("classic");

  // ── Inputs utilisateur ─────────────────────────────────────────────────────
  const [landPriceStr, setLandPriceStr] = useState("");
  const [constructStr, setConstructStr] = useState("1800");
  const [salePriceStr, setSalePriceStr] = useState("4500");
  const [targetMarginStr, setTargetMarginStr] = useState("15");

  // ── Logique SDP ────────────────────────────────────────────────────────────
  const coverageRatio = coverageFor(zoningType);
  const maxHeight = maxHeightM ?? defaultHeight(zoningType);
  const floors = Math.max(1, Math.floor(maxHeight / 3));

  // SDP = emprise × étages (ex : 500 m² × 60 % × 4 niveaux = 1 200 m²)
  const sdpM2 =
    parcelAreaM2 && parcelAreaM2 > 0
      ? Math.round(parcelAreaM2 * coverageRatio * floors)
      : null;

  // ── Calculs financiers ─────────────────────────────────────────────────────
  const landPrice = parseNumber(landPriceStr, 0);
  const constructCost = parseNumber(constructStr, 1800);
  const salePrice = parseNumber(salePriceStr, 4500);
  const targetMarginPct = parseNumber(targetMarginStr, 15);

  const ca = sdpM2 ? sdpM2 * salePrice : null;
  const constructionTotalCost = sdpM2 ? sdpM2 * constructCost : null;
  const totalCost =
    sdpM2 && constructionTotalCost !== null
      ? landPrice + constructionTotalCost
      : null;

  // Marge nette = (CA – coûts totaux) / CA
  const netMargin =
    ca !== null && ca > 0 && totalCost !== null ? (ca - totalCost) / ca : null;
  const isRisky = netMargin !== null && netMargin < 0.15;

  // Compte à rebours
  const marginEuro = ca !== null ? ca * (targetMarginPct / 100) : null;
  const maxLandPrice =
    ca !== null && constructionTotalCost !== null && marginEuro !== null
      ? ca - marginEuro - constructionTotalCost
      : null;

  // ── Libellé type constructif ────────────────────────────────────────────────
  const buildingLabel = zoningType?.startsWith("U")
    ? "collectif"
    : zoningType?.startsWith("AU")
      ? "mixte"
      : "individuel";

  // ─── JSX ──────────────────────────────────────────────────────────────────
  return (
    <section className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center gap-2">
        <Calculator className="h-3.5 w-3.5 text-slate-500" />
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
          Bilan Promoteur
        </p>
      </div>

      <div className="space-y-5 rounded-2xl border border-border/70 bg-slate-950/80 p-5">
        {/* ── Modes ── */}
        <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
          <button
            type="button"
            onClick={() => setMode("classic")}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${
              mode === "classic"
                ? "bg-white/10 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Bilan classique
          </button>
          <button
            type="button"
            onClick={() => setMode("reverse")}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${
              mode === "reverse"
                ? "bg-white/10 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Compte à rebours
          </button>
        </div>

        {/* ── 3 inputs ── */}
        <div className="grid gap-3 sm:grid-cols-3">
          {mode === "classic" ? (
            /* Prix terrain */
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                Prix d&apos;achat terrain (€)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
                  <Euro className="h-3 w-3 text-slate-500" />
                </span>
                <input
                  type="number"
                  min={0}
                  step={10000}
                  placeholder="350 000"
                  value={landPriceStr}
                  onChange={(e) => setLandPriceStr(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-7 pr-3 text-xs font-semibold text-white placeholder:text-slate-600 transition-all focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
            </div>
          ) : (
            /* Marge cible */
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                Marge cible (%)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
                  <TrendingUp className="h-3 w-3 text-slate-500" />
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={targetMarginStr}
                  onChange={(e) => setTargetMarginStr(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-7 pr-3 text-xs font-semibold text-white placeholder:text-slate-600 transition-all focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
            </div>
          )}

          {/* Coût de construction */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
              Coût construction (€/m²)
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
                <Building2 className="h-3 w-3 text-slate-500" />
              </span>
              <input
                type="number"
                min={0}
                step={100}
                value={constructStr}
                onChange={(e) => setConstructStr(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-7 pr-3 text-xs font-semibold text-white placeholder:text-slate-600 transition-all focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Prix de vente */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
              Prix de vente (€/m²)
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
                <TrendingUp className="h-3 w-3 text-slate-500" />
              </span>
              <input
                type="number"
                min={0}
                step={100}
                value={salePriceStr}
                onChange={(e) => setSalePriceStr(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-7 pr-3 text-xs font-semibold text-white placeholder:text-slate-600 transition-all focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
        </div>

        {sdpM2 ? (
          <div className="space-y-3">
            {/* ── Métriques SDP / CA / Coût ── */}
            <div className="grid gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500">SDP estimée</p>
                <p className="mt-1 text-2xl font-black leading-none text-white">
                  {sdpM2.toLocaleString("fr-FR")}&nbsp;m²
                </p>
                <p className="mt-1 text-[10px] text-slate-600">
                  {floors}&nbsp;étage{floors !== 1 ? "s" : ""}
                  &nbsp;·&nbsp;{Math.round(coverageRatio * 100)}%&nbsp;emprise
                  &nbsp;·&nbsp;{buildingLabel}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500">
                  Chiffre d&apos;affaires
                </p>
                <p className="mt-1 text-2xl font-black leading-none text-white">{fmt(ca)}</p>
                <p className="mt-1 text-[10px] text-slate-600">
                  {salePrice.toLocaleString("fr-FR")}&nbsp;€/m²
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500">
                  {mode === "classic" ? "Coût total" : "Coût travaux"}
                </p>
                <p className="mt-1 text-2xl font-black leading-none text-white">
                  {fmt(mode === "classic" ? totalCost : constructionTotalCost)}
                </p>
                <p className="mt-1 text-[10px] text-slate-600">
                  {mode === "classic"
                    ? "terrain + travaux"
                    : `${constructCost.toLocaleString("fr-FR")} €/m² × SDP`}
                </p>
              </div>
            </div>

            {mode === "classic" ? (
              /* ── Marge nette ── */
              netMargin !== null ? (
                isRisky ? (
                  /* ── Rouge : projet risqué ── */
                  <div className="flex items-start gap-4 rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-4 shadow-[0_0_36px_rgba(239,68,68,0.18)]">
                    <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-400" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-3xl font-black tracking-tight text-red-400">
                          {(netMargin * 100).toFixed(1)}%
                        </p>
                        <span className="rounded-full border border-red-400/30 bg-red-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-red-300">
                          Projet risqué
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-red-300/70">
                        Marge nette inférieure au seuil de 15 % — révisez le prix terrain ou le coût de construction.
                      </p>
                    </div>
                  </div>
                ) : (
                  /* ── Vert : opération viable ── */
                  <div className="flex items-start gap-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-4 shadow-[0_0_36px_rgba(16,185,129,0.18)]">
                    <TrendingUp className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
                    <div>
                      <p className="text-3xl font-black tracking-tight text-emerald-400">
                        +{(netMargin * 100).toFixed(1)}%
                      </p>
                      <p className="mt-1 text-[11px] text-emerald-300/70">
                        Marge nette · Opération viable ✓
                      </p>
                    </div>
                  </div>
                )
              ) : null
            ) : (
              /* ── Compte à rebours : offre achat maximale ── */
              maxLandPrice !== null ? (
                <div className="flex items-start gap-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-4 shadow-[0_0_36px_rgba(16,185,129,0.18)]">
                  <Euro className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300/80">
                      Offre d&apos;achat maximale
                    </p>
                    <p className="mt-1 text-3xl font-black tracking-tight text-emerald-400">
                      {fmt(maxLandPrice)}
                    </p>
                    <p className="mt-1 text-[11px] text-emerald-300/70">
                      Pour garantir vos {targetMarginPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}% de marge, vous ne devez pas acheter ce terrain plus de {fmt(maxLandPrice)}.
                    </p>
                  </div>
                </div>
              ) : null
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Surface de parcelle non disponible — impossible d&apos;estimer la SDP.
          </p>
        )}
      </div>
    </section>
  );
}
