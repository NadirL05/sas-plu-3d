export function formatCurrency(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value?: number | null, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDate(value?: string | Date | null): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fr-FR").format(date);
}

export function zoneBadgeClasses(typezone?: string | null): string {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border";
  switch (typezone) {
    case "U":
      return `${base} bg-sky-500/15 text-sky-300 border-sky-400/40`;
    case "AU":
      return `${base} bg-amber-500/15 text-amber-300 border-amber-400/40`;
    case "N":
      return `${base} bg-emerald-500/15 text-emerald-300 border-emerald-400/40`;
    case "A":
      return `${base} bg-yellow-500/15 text-yellow-200 border-yellow-400/40`;
    default:
      return `${base} bg-slate-700/60 text-slate-200 border-slate-500/40`;
  }
}

