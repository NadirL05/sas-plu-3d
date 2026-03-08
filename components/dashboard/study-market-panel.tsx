"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Home, Loader2, MapPin } from "lucide-react";

import { fetchNearbySales, type NearbySale } from "@/src/lib/dvf-engine";

interface StudyMarketPanelProps {
  lat?: number | null;
  lon?: number | null;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" }).format(date);
}

export function StudyMarketPanel({ lat, lon }: StudyMarketPanelProps) {
  const [sales, setSales] = useState<NearbySale[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setIsLoading(true);
      setError(null);
    });

    fetchNearbySales(resolvedLat, resolvedLon)
      .then((rows) => {
        if (!active) return;
        setSales(rows);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Impossible de charger les ventes DVF.");
        setSales([]);
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [lat, lon]);

  const averagePricePerM2 = useMemo(() => {
    if (sales.length === 0) return null;
    const total = sales.reduce((sum, sale) => sum + sale.pricePerM2Eur, 0);
    return Math.round(total / sales.length);
  }, [sales]);

  const transactionsLast12Months = useMemo(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    return sales.filter((sale) => {
      const date = new Date(sale.date);
      return !Number.isNaN(date.getTime()) && date >= cutoff;
    }).length;
  }, [sales]);

  const latestSales = useMemo(
    () => [...sales].sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, 5),
    [sales]
  );

  const isMockSource = sales.length > 0 && sales.every((sale) => sale.source === "mock");

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="h-3.5 w-3.5 text-slate-500" />
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
          Marché Local
        </p>
      </div>

      <div className="space-y-5 rounded-2xl border border-border/70 bg-slate-950/80 p-5">
        {!Number.isFinite(lat) || !Number.isFinite(lon) ? (
          <p className="text-xs text-slate-500">
            Coordonnées indisponibles pour charger les transactions locales.
          </p>
        ) : isLoading ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="h-24 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
              <div className="h-24 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Chargement des ventes DVF...
            </div>
          </div>
        ) : error ? (
          <p className="text-xs text-red-300">{error}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-300/80">
                  Prix moyen (Ancien)
                </p>
                <p className="mt-2 text-3xl font-black leading-none text-emerald-300">
                  {averagePricePerM2 !== null
                    ? `${averagePricePerM2.toLocaleString("fr-FR")} €/m²`
                    : "-"}
                </p>
              </div>

              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-sky-300/80">
                  Transactions (12 derniers mois)
                </p>
                <p className="mt-2 text-3xl font-black leading-none text-sky-300">
                  {transactionsLast12Months.toLocaleString("fr-FR")}
                </p>
              </div>
            </div>

            {isMockSource ? (
              <p className="text-[11px] text-amber-300/80">
                Données API DVF indisponibles en direct: affichage d&apos;un jeu mock réaliste (MVP).
              </p>
            ) : null}

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center gap-2">
                <BarChart3 className="h-3.5 w-3.5 text-slate-400" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
                  5 dernières ventes autour de la parcelle
                </p>
              </div>

              <div className="max-h-64 overflow-auto rounded-lg border border-white/[0.06]">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-900/95 text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Date</th>
                      <th className="px-3 py-2 font-semibold">Type</th>
                      <th className="px-3 py-2 font-semibold">Surface</th>
                      <th className="px-3 py-2 font-semibold">Prix</th>
                      <th className="px-3 py-2 font-semibold">Prix/m²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestSales.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                          Aucune mutation exploitable trouvée.
                        </td>
                      </tr>
                    ) : (
                      latestSales.map((sale) => (
                        <tr key={sale.id} className="border-t border-white/[0.06] text-slate-200">
                          <td className="px-3 py-2">{formatDate(sale.date)}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px]">
                              <Home className="h-3 w-3" />
                              {sale.type}
                            </span>
                          </td>
                          <td className="px-3 py-2">{sale.surfaceM2.toLocaleString("fr-FR")} m²</td>
                          <td className="px-3 py-2 font-semibold text-white">
                            {formatCurrency(sale.priceEur)}
                          </td>
                          <td className="px-3 py-2 font-semibold text-emerald-300">
                            {sale.pricePerM2Eur.toLocaleString("fr-FR")} €/m²
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

