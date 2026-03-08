/**
 * DVF Engine — Récupération des ventes immobilières autour d'une parcelle.
 *
 * MVP:
 * - Tente un appel vers une API publique (CQuest/Etalab compatible).
 * - Si indisponible côté client (CORS, endpoint down, format inconnu),
 *   bascule automatiquement sur un dataset mock réaliste (2 dernières années).
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
  source: "dvf-api" | "mock";
}

type UnknownRecord = Record<string, unknown>;

const CQUEST_BASE_URL = "https://api.cquest.org/dvf";
const FETCH_TIMEOUT_MS = 8_000;
const MAX_API_SALES = 60;

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

function getRecordCoordinates(record: UnknownRecord): { lat: number; lon: number } | null {
  const lat = parseNumberish(record.lat ?? record.latitude ?? record.y);
  const lon = parseNumberish(record.lon ?? record.lng ?? record.longitude ?? record.x);
  if (lat !== null && lon !== null) return { lat, lon };

  const geometry = (record.geometry ?? null) as UnknownRecord | null;
  const coords = Array.isArray(geometry?.coordinates)
    ? (geometry?.coordinates as unknown[])
    : null;

  if (coords && coords.length >= 2) {
    const maybeLon = parseNumberish(coords[0]);
    const maybeLat = parseNumberish(coords[1]);
    if (maybeLat !== null && maybeLon !== null) {
      return { lat: maybeLat, lon: maybeLon };
    }
  }

  return null;
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
    container.mutations,
    container.features,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const obj = item as UnknownRecord;
          if (obj.properties && typeof obj.properties === "object") {
            return {
              ...(obj.properties as UnknownRecord),
              geometry: obj.geometry,
            };
          }
          return obj;
        })
        .filter((item): item is UnknownRecord => item !== null);
    }
  }

  return [];
}

function normalizeRecord(
  record: UnknownRecord,
  index: number,
  centerLat: number,
  centerLon: number,
  radiusMeters: number,
  cutoffDate: Date
): NearbySale | null {
  const date =
    parseDate(record.date_mutation) ??
    parseDate(record.dateMutation) ??
    parseDate(record.mutation_date) ??
    parseDate(record.date);
  if (!date || date < cutoffDate) return null;

  const price =
    parseNumberish(record.valeur_fonciere) ??
    parseNumberish(record.valeur) ??
    parseNumberish(record.prix) ??
    parseNumberish(record.price);

  const surface =
    parseNumberish(record.surface_reelle_bati) ??
    parseNumberish(record.surface_bati) ??
    parseNumberish(record.surface_terrain) ??
    parseNumberish(record.surface) ??
    parseNumberish(record.surface_habitable);

  if (price === null || surface === null || price <= 0 || surface <= 0) return null;

  const pricePerM2 = price / surface;
  if (pricePerM2 < 500 || pricePerM2 > 20_000) return null;

  const coords = getRecordCoordinates(record);
  const distance = coords
    ? haversineMeters(centerLat, centerLon, coords.lat, coords.lon)
    : Number.NaN;
  if (Number.isFinite(distance) && distance > radiusMeters * 1.6) return null;

  return {
    id:
      String(record.id_mutation ?? record.id ?? record.id_parcelle ?? "sale") +
      `-${date.getTime()}-${index}`,
    date: date.toISOString(),
    type: normalizeType(record.type_local ?? record.type_bien ?? record.type),
    surfaceM2: Math.round(surface),
    priceEur: Math.round(price),
    pricePerM2Eur: Math.round(pricePerM2),
    distanceM: Number.isFinite(distance) ? Math.round(distance) : Math.round(radiusMeters * 0.7),
    source: "dvf-api",
  };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function fetchFromPublicApi(
  lat: number,
  lon: number,
  radiusMeters: number
): Promise<NearbySale[]> {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 2);

  const endpointCandidates = [
    `${CQUEST_BASE_URL}?lat=${lat}&lon=${lon}&dist=${radiusMeters}`,
    `${CQUEST_BASE_URL}?lat=${lat}&lon=${lon}&radius=${radiusMeters}`,
    `${CQUEST_BASE_URL}?lat=${lat}&lon=${lon}&rayon=${radiusMeters}`,
  ];

  for (const url of endpointCandidates) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) continue;

      const payload = (await response.json()) as unknown;
      const records = extractRecords(payload);
      if (records.length === 0) continue;

      const normalized = records
        .map((record, index) => normalizeRecord(record, index, lat, lon, radiusMeters, cutoffDate))
        .filter((sale): sale is NearbySale => sale !== null)
        .sort((a, b) => +new Date(b.date) - +new Date(a.date))
        .slice(0, MAX_API_SALES);

      if (normalized.length >= 4) {
        return normalized;
      }
    } catch {
      // On teste le prochain endpoint.
    }
  }

  return [];
}

function createSeed(lat: number, lon: number): number {
  const latPart = Math.round((lat + 90) * 10_000);
  const lonPart = Math.round((lon + 180) * 10_000);
  return (latPart * 73856093 + lonPart * 19349663) >>> 0;
}

function seededRandom(seedRef: { value: number }): number {
  seedRef.value = (1664525 * seedRef.value + 1013904223) % 4294967296;
  return seedRef.value / 4294967296;
}

function generateMockSales(lat: number, lon: number, radiusMeters: number): NearbySale[] {
  const seedRef = { value: createSeed(lat, lon) };
  const now = new Date();
  const total = 18;

  // Palette réaliste selon secteur (France métropolitaine).
  const locationFactor =
    3_200 + Math.abs(Math.sin((lat + lon) * 3.1)) * 2_400 + Math.abs(Math.cos(lat * 2.4)) * 700;

  const sales: NearbySale[] = [];

  for (let i = 0; i < total; i += 1) {
    const isApartment = seededRandom(seedRef) > 0.38;
    const surface = isApartment
      ? 28 + Math.round(seededRandom(seedRef) * 72)
      : 70 + Math.round(seededRandom(seedRef) * 140);

    const typeMultiplier = isApartment ? 1.05 : 0.93;
    const marketNoise = 0.84 + seededRandom(seedRef) * 0.36;
    const pricePerM2 = Math.round(locationFactor * typeMultiplier * marketNoise);
    const price = Math.round(surface * pricePerM2);

    const daysAgo = Math.floor(seededRandom(seedRef) * 720); // 2 ans
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);

    const distanceM = Math.round(35 + seededRandom(seedRef) * Math.max(60, radiusMeters - 20));

    sales.push({
      id: `mock-${i + 1}-${date.getTime()}`,
      date: date.toISOString(),
      type: isApartment ? "Appartement" : "Maison",
      surfaceM2: surface,
      priceEur: price,
      pricePerM2Eur: pricePerM2,
      distanceM,
      source: "mock",
    });
  }

  return sales.sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

export async function fetchNearbySales(
  lat: number,
  lon: number,
  radiusMeters = 500
): Promise<NearbySale[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const apiSales = await fetchFromPublicApi(lat, lon, radiusMeters);
  if (apiSales.length > 0) return apiSales;

  return generateMockSales(lat, lon, radiusMeters);
}

