"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bus,
  GraduationCap,
  Loader2,
  ShoppingBasket,
  Sparkles,
  Building2,
} from "lucide-react";

import { fetchNearbyPOIs, type NearbyPOISummary } from "@/src/lib/osm-engine";

interface StudyAttractivenessPanelProps {
  lat?: number | null;
  lon?: number | null;
  sdp?: number | null;
}

type HousingType = "T1" | "T2" | "T3" | "T4";
type HousingMix = Record<HousingType, number>;

const HOUSING_TYPES: HousingType[] = ["T1", "T2", "T3", "T4"];
const AVERAGE_SURFACES_M2: Record<HousingType, number> = {
  T1: 30,
  T2: 45,
  T3: 65,
  T4: 85,
};
const DEFAULT_MIX: HousingMix = {
  T1: 20,
  T2: 35,
  T3: 30,
  T4: 15,
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rebalanceMix(current: HousingMix, target: HousingType, targetValue: number): HousingMix {
  const next: HousingMix = { ...current, [target]: clampPercent(targetValue) };
  const otherTypes = HOUSING_TYPES.filter((type) => type !== target);
  const remaining = 100 - next[target];

  if (remaining <= 0) {
    for (const type of otherTypes) next[type] = 0;
    return next;
  }

  const otherTotal = otherTypes.reduce((sum, type) => sum + current[type], 0);

  if (otherTotal <= 0) {
    let assigned = 0;
    for (let i = 0; i < otherTypes.length; i += 1) {
      const type = otherTypes[i];
      if (i === otherTypes.length - 1) {
        next[type] = remaining - assigned;
      } else {
        const value = Math.floor(remaining / otherTypes.length);
        next[type] = value;
        assigned += value;
      }
    }
    return next;
  }

  let assigned = 0;
  for (let i = 0; i < otherTypes.length; i += 1) {
    const type = otherTypes[i];
    if (i === otherTypes.length - 1) {
      next[type] = remaining - assigned;
    } else {
      const value = Math.floor((current[type] / otherTotal) * remaining);
      next[type] = value;
      assigned += value;
    }
  }

  return next;
}

export function StudyAttractivenessPanel({ lat, lon, sdp }: StudyAttractivenessPanelProps) {
  const [poi, setPoi] = useState<NearbyPOISummary | null>(null);
  const [isLoadingPoi, setIsLoadingPoi] = useState(false);
  const [poiError, setPoiError] = useState<string | null>(null);
  const [mix, setMix] = useState<HousingMix>(DEFAULT_MIX);

  useEffect(() => {
    if (
      typeof lat !== "number" ||
      !Number.isFinite(lat) ||
      typeof lon !== "number" ||
      !Number.isFinite(lon)
    ) {
      return;
    }

    const resolvedLat = lat;
    const resolvedLon = lon;
    let active = true;

    queueMicrotask(() => {
      if (!active) return;
      setIsLoadingPoi(true);
      setPoiError(null);
    });

    fetchNearbyPOIs(resolvedLat, resolvedLon)
      .then((summary) => {
        if (!active) return;
        setPoi(summary);
      })
      .catch((error) => {
        if (!active) return;
        setPoiError(error instanceof Error ? error.message : "Impossible de charger les POI.");
        setPoi(null);
      })
      .finally(() => {
        if (!active) return;
        setIsLoadingPoi(false);
      });

    return () => {
      active = false;
    };
  }, [lat, lon]);

  const neighborhoodLabel = useMemo(() => {
    if (!poi) return "Analyse du quartier en attente.";
    if (poi.transit > 5 && poi.shops >= 6) return "Quartier bien desservi et commerçant.";
    if (poi.transit > 5) return "Quartier bien desservi.";
    if (poi.transit <= 2 && poi.schools <= 1 && poi.shops <= 2) return "Zone résidentielle isolée.";
    if (poi.schools >= 3) return "Quartier familial avec équipements scolaires.";
    return "Attractivité locale modérée.";
  }, [poi]);

  const resolvedSdp =
    typeof sdp === "number" && Number.isFinite(sdp) && sdp > 0 ? Math.round(sdp) : 0;

  const unitsByType = useMemo(() => {
    const result: Record<HousingType, { pct: number; areaM2: number; units: number }> = {
      T1: { pct: mix.T1, areaM2: 0, units: 0 },
      T2: { pct: mix.T2, areaM2: 0, units: 0 },
      T3: { pct: mix.T3, areaM2: 0, units: 0 },
      T4: { pct: mix.T4, areaM2: 0, units: 0 },
    };

    for (const type of HOUSING_TYPES) {
      const area = resolvedSdp * (mix[type] / 100);
      const units = Math.floor(area / AVERAGE_SURFACES_M2[type]);
      result[type] = {
        pct: mix[type],
        areaM2: Math.round(area),
        units,
      };
    }

    return result;
  }, [mix, resolvedSdp]);

  const totalUnits = useMemo(
    () => HOUSING_TYPES.reduce((sum, type) => sum + unitsByType[type].units, 0),
    [unitsByType]
  );

  const programSentence = useMemo(() => {
    const chunks = HOUSING_TYPES.filter((type) => unitsByType[type].units > 0).map(
      (type) => `${unitsByType[type].units} ${type}`
    );
    if (chunks.length === 0) {
      return "Avec cette SDP, la programmation est trop contrainte pour générer des logements entiers.";
    }
    return `Vous pouvez construire environ ${chunks.join(", ")}.`;
  }, [unitsByType]);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-slate-500" />
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
          Programme & Quartier
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-border/70 bg-slate-950/80 p-5">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
            Attractivité du quartier
          </p>

          {!Number.isFinite(lat) || !Number.isFinite(lon) ? (
            <p className="text-xs text-slate-500">Coordonnées indisponibles pour analyser les POI.</p>
          ) : isLoadingPoi ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analyse des points d&apos;intérêt...
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-300/80">
                    <Bus className="h-3.5 w-3.5" />
                    Transports
                  </p>
                  <p className="mt-2 text-2xl font-black text-cyan-300">{poi?.transit ?? 0}</p>
                </div>

                <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-violet-300/80">
                    <GraduationCap className="h-3.5 w-3.5" />
                    Écoles
                  </p>
                  <p className="mt-2 text-2xl font-black text-violet-300">{poi?.schools ?? 0}</p>
                </div>

                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-300/80">
                    <ShoppingBasket className="h-3.5 w-3.5" />
                    Commerces
                  </p>
                  <p className="mt-2 text-2xl font-black text-amber-300">{poi?.shops ?? 0}</p>
                </div>
              </div>

              <p className="text-xs text-slate-300">{neighborhoodLabel}</p>
              {poiError ? <p className="text-xs text-red-300">{poiError}</p> : null}
            </>
          )}
        </div>

        <div className="space-y-3 border-t border-white/10 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
            Programmation (Scénario Logement)
          </p>

          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="text-xs text-slate-400">SDP totale disponible</span>
            <span className="text-lg font-black text-white">
              {resolvedSdp > 0 ? `${resolvedSdp.toLocaleString("fr-FR")} m²` : "-"}
            </span>
          </div>

          <div className="space-y-2">
            {HOUSING_TYPES.map((type) => (
              <div key={type} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-300">
                  <span>
                    {type} · {AVERAGE_SURFACES_M2[type]} m² moyen
                  </span>
                  <span className="font-semibold text-white">{mix[type]}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={mix[type]}
                    onChange={(event) => {
                      const nextValue = Number.parseInt(event.target.value, 10);
                      setMix((prev) => rebalanceMix(prev, type, nextValue));
                    }}
                    className="w-full accent-emerald-400"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={mix[type]}
                    onChange={(event) => {
                      const nextValue = Number.parseInt(event.target.value, 10);
                      setMix((prev) => rebalanceMix(prev, type, nextValue));
                    }}
                    className="w-16 rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-white"
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-slate-400">
            Répartition totale: {HOUSING_TYPES.reduce((sum, type) => sum + mix[type], 0)}%
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {HOUSING_TYPES.map((type) => (
              <div key={`result-${type}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{type}</p>
                <p className="mt-1 text-lg font-black text-white">{unitsByType[type].units} logements</p>
                <p className="text-[11px] text-slate-500">{unitsByType[type].areaM2.toLocaleString("fr-FR")} m² affectés</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-300/80">
              <Building2 className="h-3.5 w-3.5" />
              Synthèse programme
            </p>
            <p className="mt-1 text-sm text-emerald-100">{programSentence}</p>
            <p className="mt-1 text-[11px] text-emerald-200/80">
              Total estimatif: {totalUnits.toLocaleString("fr-FR")} logements
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
