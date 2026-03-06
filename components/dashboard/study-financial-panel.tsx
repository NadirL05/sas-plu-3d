"use client";

/**
 * StudyFinancialPanel — Bilan Promoteur interactif
 *
 * Panneau Client Component monté sur la page d'étude.
 * Calcule en temps réel : SDP → CA → Coût total → Marge nette.
 * Seuil de risque : marge < 15 % → affichage rouge + avertissement.
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

/** Emprise au sol estimée selon le type de zone PLU. */
function coverageFor(zoningType?: string | null): number {
  if (!zoningType) return 0.5;
  if (zoningType.startsWith("U"))  return 0.6;  // zone urbaine dense
  if (zoningType.startsWith("AU")) return 0.5;  // zone à urbaniser
  return 0.3;                                    // N / A
}

/** Hauteur PLU par défaut si non fournie par le scénario. */
function defaultHeight(zoningType?: string | null): number {
  if (!zoningType) return 9;
  if (zoningType.startsWith("U"))  return 12;
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

// ─── Component ────────────────────────────────────────────────────────────────

export function StudyFinancialPanel({
  parcelAreaM2,
  zoningType,
  maxHeightM,
}: StudyFinancialPanelProps) {
  // ── Inputs utilisateur ─────────────────────────────────────────────────────
  const [landPriceStr,    setLandPriceStr]    = useState("");
  const [constructStr,    setConstructStr]    = useState("1800");
  const [salePriceStr,    setSalePriceStr]    = useState("4500");

  // ── Logique SDP ────────────────────────────────────────────────────────────
  const coverageRatio = coverageFor(zoningType);
  const maxHeight     = maxHeightM ?? defaultHeight(zoningType);
  const floors        = Math.max(1, Math.floor(maxHeight / 3));

  // SDP = emprise × étages (ex : 500 m² × 60 % × 4 niveaux = 1 200 m²)
  const sdpM2 =
    parcelAreaM2 && parcelAreaM2 > 0
      ? Math.round(parcelAreaM2 * coverageRatio * floors)
      : null;

  // ── Calculs financiers ─────────────────────────────────────────────────────
  const landPrice    = parseFloat(landPriceStr.replace(/\s/g, "")) || 0;
  const constructCost = parseFloat(constructStr) || 1800;
  const salePrice    = parseFloat(salePriceStr)  || 4500;

  const ca        = sdpM2 ? sdpM2 * salePrice : null;
  const totalCost = sdpM2 ? landPrice + sdpM2 * constructCost : null;

  // Marge nette = (CA – coûts totaux) / CA
  const netMargin =
    ca && ca > 0 && totalCost !== null ? (ca - totalCost) / ca : null;
  const isRisky = netMargin !== null && netMargin < 0.15;

  // ── Libellé type constructif ────────────────────────────────────────────────
  const buildingLabel =
    zoningType?.startsWith("U")
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

      <div className="rounded-2xl border border-border/70 bg-slate-950/80 p-5 space-y-5">

        {/* ── 3 inputs ── */}
        <div className="grid gap-3 sm:grid-cols-3">

          {/* Prix terrain */}
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
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-7 pr-3 text-xs font-semibold text-white placeholder:text-slate-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
              />
            </div>
          </div>

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
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-7 pr-3 text-xs font-semibold text-white placeholder:text-slate-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
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
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-7 pr-3 text-xs font-semibold text-white placeholder:text-slate-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
              />
            </div>
          </div>
        </div>

        {sdpM2 ? (
          <div className="space-y-3">
            {/* ── Métriques SDP / CA / Coût ── */}
            <div className="grid gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500">
                  SDP estimée
                </p>
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
                  Coût total
                </p>
                <p className="mt-1 text-2xl font-black leading-none text-white">
                  {fmt(totalCost)}
                </p>
                <p className="mt-1 text-[10px] text-slate-600">
                  terrain&nbsp;+&nbsp;travaux
                </p>
              </div>
            </div>

            {/* ── Marge nette ── */}
            {netMargin !== null ? (
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
            ) : null}
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
