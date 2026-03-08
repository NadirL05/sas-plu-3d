/**
 * DVF Engine — Ventes réelles via proxy API Next.js (/api/dvf).
 *
 * Aucun mock/fallback: uniquement des données d'État (CQuest via proxy backend).
 */

export type PropertyType = "Maison" | "Appartement";

export interface NearbySale {
  id: string;
  date: string;
  type: PropertyType;
  surfaceM2: number;
  priceEur: number;
  pricePerM2Eur: number;
  distanceM: number;
  source: "dvf-api";
}

type UnknownRecord = Record<string, unknown>;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_SALES = 80;

function parseNumberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value
      .replace(/\u00a0/g, " ")
      .replace(/\s/g, "")
      .replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeType(value: unknown): PropertyType {
  const raw = String(value ?? "").toLowerCase();
  if (raw.includes("appart")) return "Appartement";
  return "Maison";
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6_371_000 * c;
}

function extractRecords(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is UnknownRecord => !!item && typeof item === "object");
  }

  if (!payload || typeof payload !== "object") return [];
  const container = payload as UnknownRecord;

  const candidates = [
    container.results,
    container.records,
    container.items,
    container.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (item): item is UnknownRecord => !!item && typeof item === "object"
      );
    }
  }

  return [];
}

function getRecordCoordinates(record: UnknownRecord): { lat: number; lon: number } | null {
  const lat = parseNumberish(record.lat ?? record.latitude ?? record.y ?? record.lattitude);
  const lon = parseNumberish(record.lon ?? record.lng ?? record.longitude ?? record.x);

  if (lat !== null && lon !== null) return { lat, lon };

  const geopoint = record.geopoint;
  if (Array.isArray(geopoint) && geopoint.length >= 2) {
    const maybeLat = parseNumberish(geopoint[0]);
    const maybeLon = parseNumberish(geopoint[1]);
    if (maybeLat !== null && maybeLon !== null) {
      return { lat: maybeLat, lon: maybeLon };
    }
  }

  return null;
}

function isSaleMutation(record: UnknownRecord): boolean {
  const nature = String(record.nature_mutation ?? record.natureMutation ?? "").toLowerCase();
  return nature.includes("vente");
}

function normalizeRecord(
  record: UnknownRecord,
  index: number,
  centerLat: number,
  centerLon: number,
  radiusMeters: number,
  cutoffDate: Date
): NearbySale | null {
  if (!isSaleMutation(record)) return null;

  const date =
    parseDate(record.date_mutation) ??
    parseDate(record.dateMutation) ??
    parseDate(record.mutation_date) ??
    parseDate(record.date);
  if (!date || date < cutoffDate) return null;

  const price = parseNumberish(record.valeur_fonciere);
  const surface =
    parseNumberish(record.surface_reelle_bati) ??
    parseNumberish(record.surface_relle_bati) ??
    parseNumberish(record.surface_bati);

  if (price === null || surface === null || price <= 0 || surface <= 0) return null;

  const pricePerM2 = price / surface;
  if (!Number.isFinite(pricePerM2) || pricePerM2 <= 0) return null;

  const coords = getRecordCoordinates(record);
  const distanceM = coords
    ? Math.round(haversineMeters(centerLat, centerLon, coords.lat, coords.lon))
    : Math.round(radiusMeters * 0.7);

  return {
    id: String(record.id_mutation ?? record.id_parcelle ?? record.id ?? `dvf-${index}`),
    date: date.toISOString(),
    type: normalizeType(record.type_local ?? record.type_bien ?? record.type),
    surfaceM2: Math.round(surface),
    priceEur: Math.round(price),
    pricePerM2Eur: Math.round(pricePerM2),
    distanceM,
    source: "dvf-api",
  };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
}

export async function fetchNearbySales(
  lat: number,
  lon: number,
  radiusMeters = 500
): Promise<NearbySale[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius: String(radiusMeters),
  });

  try {
    const response = await fetchWithTimeout(`/api/dvf?${params.toString()}`);
    if (!response.ok) return [];

    const payload = (await response.json()) as unknown;
    const records = extractRecords(payload);
    if (records.length === 0) return [];

    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 2);

    return records
      .map((record, index) => normalizeRecord(record, index, lat, lon, radiusMeters, cutoffDate))
      .filter((sale): sale is NearbySale => sale !== null)
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, MAX_SALES);
  } catch {
    return [];
  }
}
