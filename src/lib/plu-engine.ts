import { neon } from "@neondatabase/serverless";
import { getCache, setCache } from "./redis";

/**
 * PLU Engine – extraction robuste des données d'urbanisme
 *
 * 1. Géocodage via l'API Adresse (api-adresse.data.gouv.fr)
 * 2. Zonage GPU via PostGIS local (plu_zones)
 * 3. Parcelle cadastrale via l'API Cadastre (Etalab)
 */

// ─── Client PostGIS (Neon HTTP, sans WebSocket) ────────────────────────────────

let _neonSql: ReturnType<typeof neon> | null = null;

function getNeonSql(): ReturnType<typeof neon> | null {
  if (_neonSql) return _neonSql;
  const url = (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.NEON_DATABASE_URL ??
    ""
  ).trim();
  if (!url) return null;
  _neonSql = neon(url);
  return _neonSql;
}
export async function lookupZoneFromDatabase(
  lon: number,
  lat: number
): Promise<{ libelle: string; typezone: string; urlfic?: string } | null> {
  const sql = getNeonSql();
  if (!sql) return null;

  try {
    type ZoneRow = {
      libelle: string | null;
      typezone: string | null;
      urlfic: string | null;
    };

    const rows = (await sql`
      SELECT libelle, typezone, urlfic
      FROM plu_zones
      WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
      LIMIT 1
    `) as ZoneRow[];

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      libelle: row.libelle ?? "N/A",
      typezone: row.typezone ?? "N/A",
      urlfic: row.urlfic ?? undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("plu_zones") && !msg.includes("does not exist")) {
      console.warn("[plu-engine][lookupZoneFromDatabase] Erreur inattendue:", msg);
    }
    return null;
  }
}

/**
 * Recherche la zone PLU dans la table PostGIS locale `plu_zones`.
 * Ultra-rapide (~2–5 ms) grâce à l'index spatial GIST.
 * Retourne null si la table est vide ou si la commune n'a pas été importée.
 */
async function getZoneUrbaFromPostGIS(lon: number, lat: number): Promise<ZoneUrba | null> {
  const zone = await lookupZoneFromDatabase(lon, lat);
  if (!zone) return null;

  return {
    libelle: zone.libelle,
    typezone: zone.typezone,
    commune: "N/A",
    urlfic: zone.urlfic,
  };
}

// ─── Types publics ────────────────────────────────────────────────────────────

export interface AddressSuggestion {
  label: string;
  lon: number;
  lat: number;
  inseeCode: string;
  city: string;
  postcode: string;
  score: number;
}

export interface ZoneUrba {
  /** Libellé de la zone, ex: "UA", "1AU", "N", "A" */
  libelle: string;
  /** Catégorie de zone: U (Urbaine), AU (À Urbaniser), N (Naturelle), A (Agricole) */
  typezone: string;
  /** Nom de la commune */
  commune: string;
  /** Nom du fichier PLU */
  nomfic?: string;
  /** URL vers le document PLU */
  urlfic?: string;
  /** Date d'approbation du PLU */
  datappro?: string;
}

export type ParcelGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

export interface ParcelPolygon {
  /** Identifiant cadastral de la parcelle (si disponible). */
  id?: string;
  /** Code INSEE de la commune de la parcelle (si disponible). */
  codeInsee?: string;
  /** Identifiant cadastral IDU complet (si disponible). */
  idu?: string;
  /** Code section cadastrale compatible DVF (ex: 000AB). */
  sectionCode?: string;
  /** Géométrie GeoJSON de la parcelle (WGS84). */
  geometry: ParcelGeometry;
  /** Surface de la parcelle en m² (source cadastrale ou calculée). */
  areaM2: number;
  /** Source de la surface utilisée dans areaM2. */
  areaSource: "cadastre" | "computed";
}

export interface DvfSummary {
  /** Code INSEE de la commune interrogée. */
  inseeCode: string;
  /** Code de section utilisé pour la requête DVF. */
  sectionCode: string;
  /** Nombre de mutations trouvées sur la section. */
  mutationCount: number;
  /** Valeur foncière médiane (EUR), si calculable. */
  medianValueEur: number | null;
  /** Valeur foncière moyenne (EUR), si calculable. */
  averageValueEur: number | null;
  /** Prix de vente médian au m² bâti (EUR/m²), si calculable depuis DVF. */
  medianPricePerM2Eur?: number | null;
  /** Prix de vente moyen au m² bâti (EUR/m²), si calculable depuis DVF. */
  averagePricePerM2Eur?: number | null;
  /** Date de mutation la plus récente (YYYY-MM-DD), si disponible. */
  latestMutationDate: string | null;
  /** Source de données utilisée. */
  source: "dvf-etalab";
  /** Portée spatiale des données: section cadastrale ou commune entière. */
  scope?: "section" | "commune";
  /** Historique annuel des valeurs médianes DVF. */
  dvfHistory?: { year: string; price: number }[];
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export interface GeorisquesSummary {
  /** Inondation potentielle détectée autour du point. */
  floodRisk: boolean;
  /** Niveau de risque inondation. */
  floodLevel: RiskLevel;
  /** Exposition argile potentielle détectée autour du point. */
  clayRisk: boolean;
  /** Niveau de risque argile (retrait-gonflement). */
  clayLevel: RiskLevel;
  /** Nombre d'aléas/objets risques retournés par la source. */
  hazardCount: number;
  /** Source de données utilisée. */
  source: "georisques";
  /** Indique si les données proviennent d'un fallback statistique. */
  isFallback?: boolean;
  /** Métadonnées brutes pour les messages utilisateur. */
  inondationMeta?: { niveau: string; source: string };
  argileMeta?: { niveau: string; source: string };
  /** Vue agrégée pour compatibilité avec d'autres consommateurs. */
  inondation?: { niveau: string; source: string };
  argile?: { niveau: string; source: string };
}

export interface PromoterBalance {
  /** Surface de plancher théorique (m²). */
  surfacePlancherM2: number;
  /** Chiffre d'affaires potentiel (EUR). */
  chiffreAffairesEstimeEur: number;
  /** Coût de construction (EUR), calculé avec un coût €/m² paramétrable. */
  coutConstructionEur: number;
  /** Frais annexes (EUR), 15% du CA. */
  fraisAnnexesEur: number;
  /** Prix maximum recommandé pour le terrain (EUR) après marge cible de 10%. */
  prixMaxTerrainEur: number;
}

export interface PLUResult {
  address: AddressSuggestion;
  zone: ZoneUrba | null;
  parcel: ParcelPolygon | null;
}

/** Erreur typée pour distinguer les erreurs PLU des erreurs génériques. */
export class PLUEngineError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "GEOCODE_FAILED"
      | "WFS_FAILED"
      | "INVALID_COORDS"
      | "TIMEOUT"
      | "CADASTRE_FAILED"
  ) {
    super(message);
    this.name = "PLUEngineError";
  }
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const ADRESSE_API = "https://api-adresse.data.gouv.fr/search/";

const CADASTRE_API_URL = "https://apicarto.ign.fr/api/cadastre/parcelle";
const IGN_WFS_GPU_URL = "https://data.geopf.fr/wfs/ows";
const IGN_SPOOFED_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const DVF_API_BASE_URL = "http://api.cquest.org/dvf";
const DVF_API_FALLBACK_URL = "https://app.dvf.etalab.gouv.fr/api/mutations3";
const GEORISQUES_API_BASE_URL = "https://georisques.gouv.fr/api/v1";

/** Délai maximum en ms avant d'abandonner une requête externe. */
const FETCH_TIMEOUT_MS = 8_000;
const DVF_TIMEOUT_MS = 3_000;
const DVF_MAX_RETRIES = 0;
const GEORISQUES_TIMEOUT_MS = 7_000;
const GEORISQUES_MAX_RETRIES = 2;
const EARTH_RADIUS_M = 6_378_137;
const DEFAULT_CONSTRUCTION_COST_EUR_PER_M2 = 1_300;
const MIN_CONSTRUCTION_COST_EUR_PER_M2 = 600;
const MAX_CONSTRUCTION_COST_EUR_PER_M2 = 4_500;

// ─── Utilitaire interne ───────────────────────────────────────────────────────

/**
 * fetch() avec AbortController pour éviter les requêtes infinies
 * sur des API externes potentiellement lentes (GPU WFS en particulier).
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new PLUEngineError(
        `Délai dépassé (${timeoutMs}ms) lors de la requête vers ${url}`,
        "TIMEOUT"
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIgnWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  let lastError: unknown = null;

  for (let i = 0; i <= maxRetries; i += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(options.headers ?? {});
    headers.set("User-Agent", IGN_SPOOFED_USER_AGENT);
    headers.set("Accept", "application/json");

    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (res.status >= 500 && i < maxRetries) {
        await delay(1000 * Math.pow(2, i));
        continue;
      }

      return res;
    } catch (error) {
      lastError = error;
      if (i < maxRetries) {
        await delay(1000 * Math.pow(2, i));
        continue;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new PLUEngineError(
          `Délai dépassé (${timeoutMs}ms) lors de la requête IGN vers ${url}`,
          "TIMEOUT"
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`Échec de la requête IGN: ${url}`);
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkFetchError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("fetch failed") || message.includes("network");
}

function isFiniteCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pickStringProperty(
  properties: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | null {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.replace(",", "."))
        : Number.NaN;
  return Number.isFinite(num) ? num : null;
}

function pickFirstFiniteNumber(
  row: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = toFiniteNumber(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function clampConstructionCost(value: number): number {
  return Math.min(
    MAX_CONSTRUCTION_COST_EUR_PER_M2,
    Math.max(MIN_CONSTRUCTION_COST_EUR_PER_M2, value)
  );
}

function resolveConstructionCostEurPerM2(override?: number | null): number {
  const directValue =
    typeof override === "number" && Number.isFinite(override) && override > 0
      ? override
      : null;
  if (directValue !== null) {
    return clampConstructionCost(directValue);
  }

  const envValue = toFiniteNumber(process.env.NEXT_PUBLIC_DEFAULT_CONSTRUCTION_COST_EUR_PER_M2);
  if (typeof envValue === "number" && envValue > 0) {
    return clampConstructionCost(envValue);
  }

  return DEFAULT_CONSTRUCTION_COST_EUR_PER_M2;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function riskLevelRank(level: RiskLevel): number {
  if (level === "HIGH") return 3;
  if (level === "MEDIUM") return 2;
  if (level === "LOW") return 1;
  return 0;
}

function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return riskLevelRank(a) >= riskLevelRank(b) ? a : b;
}

function parseRiskLevel(value: unknown): RiskLevel {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 3) return "HIGH";
    if (value >= 2) return "MEDIUM";
    if (value >= 1) return "LOW";
    return "UNKNOWN";
  }

  if (typeof value !== "string") return "UNKNOWN";
  const normalized = normalizeText(value.trim());
  if (!normalized) return "UNKNOWN";

  if (
    normalized.includes("fort") ||
    normalized.includes("eleve") ||
    normalized.includes("high") ||
    normalized === "3"
  ) {
    return "HIGH";
  }
  if (
    normalized.includes("moyen") ||
    normalized.includes("modere") ||
    normalized.includes("medium") ||
    normalized === "2"
  ) {
    return "MEDIUM";
  }
  if (
    normalized.includes("faible") ||
    normalized.includes("bas") ||
    normalized.includes("low") ||
    normalized === "1"
  ) {
    return "LOW";
  }

  return "UNKNOWN";
}

function detectKeywordPresence(data: unknown, keywords: string[]): boolean {
  if (!data || typeof data !== "object") return false;
  const payload = normalizeText(JSON.stringify(data));
  return keywords.some((keyword) => payload.includes(normalizeText(keyword)));
}

function detectHazardCount(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const root = data as Record<string, unknown>;
  const keys = ["data", "items", "features", "resultats", "results"] as const;

  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value.length;
  }
  return 0;
}

function detectRiskLevelFromData(data: unknown, keys: string[]): RiskLevel {
  if (!data || typeof data !== "object") return "UNKNOWN";
  const root = data as Record<string, unknown>;
  let bestLevel: RiskLevel = "UNKNOWN";

  for (const key of keys) {
    const parsed = parseRiskLevel(root[key]);
    bestLevel = maxRiskLevel(bestLevel, parsed);
  }

  const listKeys = ["data", "items", "features", "resultats", "results"] as const;
  for (const listKey of listKeys) {
    const value = root[listKey];
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      for (const key of keys) {
        bestLevel = maxRiskLevel(bestLevel, parseRiskLevel(record[key]));
      }
      const props = record.properties;
      if (props && typeof props === "object") {
        const propRecord = props as Record<string, unknown>;
        for (const key of keys) {
          bestLevel = maxRiskLevel(bestLevel, parseRiskLevel(propRecord[key]));
        }
      }
    }
  }

  return bestLevel;
}

/**
 * Bilan promoteur IA : calcule un équilibre simple promoteur
 * à partir de la surface de plancher théorique et de la valeur DVF.
 */
export function computeProfitabilityScore(params: {
  parcelAreaM2?: number | null;
  coveragePct?: number | null;
  maxHeightM?: number | null;
  medianDvfValueEur?: number | null;
  medianSalePricePerM2Eur?: number | null;
  constructionCostEurPerM2?: number | null;
}): PromoterBalance | null {
  const parcelAreaM2 = params.parcelAreaM2 ?? null;
  const coveragePct = params.coveragePct ?? 50;
  const maxHeightM = params.maxHeightM ?? null;
  const medianDvfValueEur = params.medianDvfValueEur ?? null;
  const medianSalePricePerM2Eur = params.medianSalePricePerM2Eur ?? null;
  const constructionCostEurPerM2 = resolveConstructionCostEurPerM2(
    params.constructionCostEurPerM2
  );

  if (
    !parcelAreaM2 ||
    parcelAreaM2 <= 0 ||
    ((!medianDvfValueEur || medianDvfValueEur <= 0) &&
      (!medianSalePricePerM2Eur || medianSalePricePerM2Eur <= 0))
  ) {
    return null;
  }

  const clampedCoveragePct = Math.min(95, Math.max(15, coveragePct));
  const theoreticalLevels = Math.max(
    1,
    Math.min(10, Math.floor((maxHeightM && maxHeightM > 0 ? maxHeightM : 12) / 3))
  );
  const footprintM2 = parcelAreaM2 * (clampedCoveragePct / 100);
  const surfacePlancherM2 = footprintM2 * theoreticalLevels;

  // Prix de vente local: on privilégie le vrai prix au m² bâti issu de DVF.
  // Fallback historique si indisponible: valeur médiane DVF / surface de parcelle.
  const localPricePerM2 =
    medianSalePricePerM2Eur && medianSalePricePerM2Eur > 0
      ? medianSalePricePerM2Eur
      : (medianDvfValueEur as number) / parcelAreaM2;
  const chiffreAffairesEstimeEur = surfacePlancherM2 * localPricePerM2;

  const coutConstructionEur = surfacePlancherM2 * constructionCostEurPerM2;
  const fraisAnnexesEur = chiffreAffairesEstimeEur * 0.15;
  const margeCibleEur = chiffreAffairesEstimeEur * 0.1;

  const prixMaxTerrainEur =
    chiffreAffairesEstimeEur - coutConstructionEur - fraisAnnexesEur - margeCibleEur;

  return {
    surfacePlancherM2,
    chiffreAffairesEstimeEur,
    coutConstructionEur,
    fraisAnnexesEur,
    prixMaxTerrainEur,
  };
}

async function fetchJsonWithRetry(
  url: string,
  timeoutMs: number,
  maxRetries: number
): Promise<unknown> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, { cache: "no-store" }, timeoutMs);
      if (!res.ok) {
        if (attempt < maxRetries && (res.status >= 500 || res.status === 429)) {
          await delay(400 * (attempt + 1));
          continue;
        }
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      const isTimeout = error instanceof PLUEngineError && error.code === "TIMEOUT";
      const isNetworkError = isNetworkFetchError(error);
      const hasRetry = attempt < maxRetries;

      if ((isTimeout || isNetworkError) && hasRetry) {
        await delay(400 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  throw lastError ?? new Error("Requête externe en échec");
}

function toMeters(lon: number, lat: number, refLatRad: number): [number, number] {
  const rad = Math.PI / 180;
  const x = lon * rad * EARTH_RADIUS_M * Math.cos(refLatRad);
  const y = lat * rad * EARTH_RADIUS_M;
  return [x, y];
}

function ringAreaM2(ring: number[][]): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0;

  const validPoints = ring.filter(
    (point) =>
      Array.isArray(point) &&
      point.length >= 2 &&
      isFiniteCoord(point[0]) &&
      isFiniteCoord(point[1])
  );
  if (validPoints.length < 3) return 0;

  const refLat =
    validPoints.reduce((sum, point) => sum + point[1], 0) / validPoints.length;
  const refLatRad = (refLat * Math.PI) / 180;
  const projected = validPoints.map(([lon, lat]) => toMeters(lon, lat, refLatRad));

  let area2 = 0;
  for (let i = 0; i < projected.length; i += 1) {
    const [x1, y1] = projected[i];
    const [x2, y2] = projected[(i + 1) % projected.length];
    area2 += x1 * y2 - x2 * y1;
  }
  return Math.abs(area2) / 2;
}

function polygonAreaM2(coords: number[][][]): number {
  if (!Array.isArray(coords) || coords.length === 0) return 0;
  const [outerRing, ...holes] = coords;
  const outer = ringAreaM2(outerRing);
  const inner = holes.reduce((sum, hole) => sum + ringAreaM2(hole), 0);
  return Math.max(0, outer - inner);
}

function geometryAreaM2(geometry: ParcelGeometry): number {
  if (geometry.type === "Polygon") {
    return polygonAreaM2(geometry.coordinates as number[][][]);
  }

  const polygons = geometry.coordinates as number[][][][];
  return polygons.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0);
}

function isParcelGeometry(value: unknown): value is ParcelGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as { type?: string; coordinates?: unknown };
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return false;
  return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0;
}

// ─── Géocodage ────────────────────────────────────────────────────────────────

/**
 * Convertit une chaîne de texte en liste de suggestions d'adresses géocodées.
 * Appel direct à l'API Adresse (CORS activé côté serveur gouvernemental).
 *
 * @param query - Texte de l'adresse à rechercher (min. 3 caractères)
 * @param limit - Nombre maximum de résultats (défaut : 5)
 */
export async function searchAddresses(
  query: string,
  limit = 5
): Promise<AddressSuggestion[]> {
  const trimmed = query?.trim();
  if (!trimmed || trimmed.length < 3) return [];

  const url = `${ADRESSE_API}?q=${encodeURIComponent(trimmed)}&limit=${limit}`;

  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) {
    throw new PLUEngineError(
      `API Adresse a répondu avec ${res.status} ${res.statusText}`,
      "GEOCODE_FAILED"
    );
  }

  const data = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.features ?? []).map((f: any): AddressSuggestion => ({
    label: f.properties.label,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    inseeCode: f.properties.citycode ?? "",
    city: f.properties.city ?? "",
    postcode: f.properties.postcode ?? "",
    score: f.properties.score ?? 0,
  }));
}

// ─── Zonage GPU ───────────────────────────────────────────────────────────────

/**
 * Recherche la zone d'urbanisme via PostGIS, puis fallback WFS IGN.
 * @param lon - Longitude (WGS84)
 * @param lat - Latitude (WGS84)
 */
export async function getZoneUrba(
  lon: number,
  lat: number
): Promise<ZoneUrba | null> {
  if (!isFinite(lon) || !isFinite(lat)) {
    throw new PLUEngineError(
      `Coordonnées invalides : lon=${lon}, lat=${lat}`,
      "INVALID_COORDS"
    );
  }

  const postgisResult = await getZoneUrbaFromPostGIS(lon, lat);
  if (postgisResult) {
    return postgisResult;
  }

  const cqlFilter = `INTERSECTS(the_geom,POINT(${lon} ${lat}))`;
  const wfsUrl =
    `${IGN_WFS_GPU_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=wfs_du:zone_urba&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326` +
    `&COUNT=1&CQL_FILTER=${encodeURIComponent(cqlFilter)}`;

  try {
    const res = await fetchIgnWithRetry(
      wfsUrl,
      { cache: "no-store" },
      3,
      FETCH_TIMEOUT_MS
    );

    if (!res.ok) {
      throw new PLUEngineError(
        `WFS IGN a répondu avec ${res.status} ${res.statusText}`,
        "WFS_FAILED"
      );
    }

    const data = (await res.json()) as {
      features?: Array<{ properties?: Record<string, unknown> }>;
    };
    const properties = data.features?.[0]?.properties;
    if (!properties || typeof properties !== "object") {
      console.warn(`[plu-engine][WFS] Aucune zone IGN trouvée pour (${lon}, ${lat}).`);
      return null;
    }

    const libelle =
      pickStringProperty(properties, ["libelle", "LIBELLE", "zone", "libelle_zone"]) ??
      "N/A";
    const typezone =
      pickStringProperty(properties, ["typezone", "TYPEZONE", "type_zone"]) ?? libelle;
    const commune =
      pickStringProperty(properties, ["commune", "nom_com", "code_insee", "insee"]) ??
      "N/A";
    const nomfic = pickStringProperty(properties, ["nomfic", "nom_fic"]);
    const urlfic = pickStringProperty(properties, ["urlfic", "url_fic", "url_document"]);
    const datappro = pickStringProperty(properties, ["datappro", "date_appro"]);

    return {
      libelle,
      typezone,
      commune,
      nomfic: nomfic ?? undefined,
      urlfic: urlfic ?? undefined,
      datappro: datappro ?? undefined,
    };
  } catch (error) {
    if (error instanceof PLUEngineError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PLUEngineError(`Échec du fallback WFS IGN: ${message}`, "WFS_FAILED");
  }
}

// ─── Parcelle cadastrale ─────────────────────────────────────────────────────

/**
 * Retourne le polygone cadastral contenant un point GPS.
 *
 * L'API retourne une FeatureCollection GeoJSON. On conserve la première parcelle
 * englobant le point et on calcule sa surface au sol en m².
 */
export async function getParcelPolygon(
  lon: number,
  lat: number
): Promise<ParcelPolygon | null> {
  if (!isFinite(lon) || !isFinite(lat)) {
    throw new PLUEngineError(
      `Coordonnées invalides : lon=${lon}, lat=${lat}`,
      "INVALID_COORDS"
    );
  }

  const geom = encodeURIComponent(
    JSON.stringify({ type: "Point", coordinates: [lon, lat] })
  );
  const url = `${CADASTRE_API_URL}?geom=${geom}`;

  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) {
    throw new PLUEngineError(
      `API Cadastre a répondu avec ${res.status} ${res.statusText}`,
      "CADASTRE_FAILED"
    );
  }

  const data = await res.json();
  if (!Array.isArray(data?.features) || data.features.length === 0) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feature: Record<string, any> = data.features[0] ?? {};
  if (!isParcelGeometry(feature.geometry)) return null;

  const geometry = feature.geometry;
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const computedArea = geometryAreaM2(geometry);
  const contenance = Number(properties.contenance);
  const codeInsee = pickStringProperty(properties, ["code_insee", "insee", "INSEE"]);
  const idu = pickStringProperty(properties, ["idu", "IDU"]);
  const sectionCode =
    idu && idu.length >= 10 ? idu.slice(5, 10) : pickStringProperty(properties, ["section"]);

  if (!Number.isFinite(computedArea) || computedArea <= 0) return null;

  if (Number.isFinite(contenance) && contenance > 0) {
    return {
      id: feature.id ? String(feature.id) : undefined,
      codeInsee: codeInsee ?? undefined,
      idu: idu ?? undefined,
      sectionCode: sectionCode ?? undefined,
      geometry,
      areaM2: contenance,
      areaSource: "cadastre",
    };
  }

  return {
    id: feature.id ? String(feature.id) : undefined,
    codeInsee: codeInsee ?? undefined,
    idu: idu ?? undefined,
    sectionCode: sectionCode ?? undefined,
    geometry,
    areaM2: computedArea,
    areaSource: "computed",
  };
}

/**
 * Récupère un résumé DVF (valeurs foncières) autour d'une parcelle:
 * 1) identifie la parcelle par point (cadastre IGN),
 * 2) interroge les mutations DVF de la section cadastrale.
 */
export async function getDvfSummaryNearby(
  lon: number,
  lat: number
): Promise<DvfSummary | null> {
  try {
    if (!isFinite(lon) || !isFinite(lat)) {
      throw new PLUEngineError(
        `Coordonnées invalides : lon=${lon}, lat=${lat}`,
        "INVALID_COORDS"
      );
    }

    const geom = encodeURIComponent(
      JSON.stringify({ type: "Point", coordinates: [lon, lat] })
    );
    const cadastreUrl = `${CADASTRE_API_URL}?geom=${geom}`;
    let cadastreJson: { features?: Array<{ properties?: Record<string, unknown> }> };
    try {
      cadastreJson = (await fetchJsonWithRetry(
        cadastreUrl,
        FETCH_TIMEOUT_MS,
        DVF_MAX_RETRIES
      )) as { features?: Array<{ properties?: Record<string, unknown> }> };
    } catch (err) {
      console.warn(
        `[plu-engine] Timeout esquivé sur ${cadastreUrl}, passage au fallback.`,
        err
      );
      return {
        inseeCode: "",
        sectionCode: "",
        mutationCount: 0,
        medianValueEur: null,
        averageValueEur: null,
        latestMutationDate: null,
        source: "dvf-etalab",
        scope: "commune",
        dvfHistory: [],
      };
    }

    const properties = cadastreJson?.features?.[0]?.properties;
    if (!properties || typeof properties !== "object") {
      return {
        inseeCode: "",
        sectionCode: "",
        mutationCount: 0,
        medianValueEur: null,
        averageValueEur: null,
        latestMutationDate: null,
        source: "dvf-etalab",
        scope: "commune",
        dvfHistory: [],
      };
    }

    const inseeCodeValue = pickStringProperty(properties, ["code_insee", "insee", "INSEE"]);
    const idu = pickStringProperty(properties, ["idu", "IDU"]);
    const sectionCodeValue = idu && idu.length >= 10 ? idu.slice(5, 10) : null;

    if (!inseeCodeValue || !sectionCodeValue) {
      return {
        inseeCode: "",
        sectionCode: "",
        mutationCount: 0,
        medianValueEur: null,
        averageValueEur: null,
        latestMutationDate: null,
        source: "dvf-etalab",
        scope: "commune",
        dvfHistory: [],
      };
    }

    const inseeCode = inseeCodeValue;
    const sectionCode = sectionCodeValue;

    function parseDvfRows(payload: unknown): Array<Record<string, unknown>> {
      if (Array.isArray(payload)) {
        return payload.filter(
          (row): row is Record<string, unknown> => !!row && typeof row === "object"
        );
      }
      if (!payload || typeof payload !== "object") return [];
      const asObject = payload as Record<string, unknown>;
      if (Array.isArray(asObject.mutations)) {
        return asObject.mutations.filter(
          (row): row is Record<string, unknown> => !!row && typeof row === "object"
        );
      }
      if (Array.isArray(asObject.results)) {
        return asObject.results.filter(
          (row): row is Record<string, unknown> => !!row && typeof row === "object"
        );
      }
      return [];
    }

    function isServerError(error: unknown): boolean {
      if (!(error instanceof Error)) return false;
      return /HTTP\s5\d{2}/.test(error.message);
    }

    async function fetchDvfFor(
      scope: "section" | "commune"
    ): Promise<{ rows: Array<Record<string, unknown>>; scope: "section" | "commune" }> {
      const cacheKey =
        scope === "section"
          ? `dvf:section:${inseeCode}:${sectionCode}`
          : `dvf:commune:${inseeCode}`;

      const cached = await getCache<{
        rows: Array<Record<string, unknown>>;
        scope: "section" | "commune";
      }>(cacheKey);
      if (cached) {
        return { rows: cached.rows, scope: cached.scope };
      }

      const cquestUrl =
        scope === "section"
          ? `${DVF_API_BASE_URL}?section=${encodeURIComponent(
              `${inseeCode}${sectionCode}`
            )}`
          : `${DVF_API_BASE_URL}?code_commune=${encodeURIComponent(inseeCode)}`;

      // Fallback Etalab uniquement pour le scope "section"
      const etalabUrl =
        scope === "section"
          ? `${DVF_API_FALLBACK_URL}/${encodeURIComponent(
              inseeCode
            )}/${encodeURIComponent(sectionCode)}`
          : null;

      console.log(`[plu-engine][getDvfSummaryNearby] DVF URL (${scope}): ${cquestUrl}`);

      let rows: Array<Record<string, unknown>> = [];

      try {
        const cquestJson = await fetchJsonWithRetry(cquestUrl, DVF_TIMEOUT_MS, DVF_MAX_RETRIES);
        rows = parseDvfRows(cquestJson);
        if (rows.length > 0) {
          await setCache(cacheKey, { rows, scope }, 86_400);
          return { rows, scope };
        }
      } catch (error) {
        const isTimeout = error instanceof PLUEngineError && error.code === "TIMEOUT";
        if (isTimeout) {
          console.warn(`[plu-engine] Timeout esquivé sur ${cquestUrl}, passage au fallback.`);
        } else if (!isServerError(error)) {
          throw error;
        } else {
          console.warn(
            `[getDvfSummaryNearby] DVF ${scope} CQuest indisponible, fallback Etalab ou neutre`,
            error
          );
        }
      }

      // Si on est sur la commune, on ne tente pas Etalab (URL invalide), on retourne directement neutre.
      if (scope === "commune") {
        await setCache(cacheKey, { rows: [], scope }, 86_400);
        return { rows: [], scope };
      }

      if (etalabUrl) {
        try {
          console.log(
            `[plu-engine][getDvfSummaryNearby] DVF fallback URL (${scope}): ${etalabUrl}`
          );
          const etalabJson = await fetchJsonWithRetry(
            etalabUrl,
            DVF_TIMEOUT_MS,
            DVF_MAX_RETRIES
          );
          rows = parseDvfRows(etalabJson);
        } catch (error) {
          if (error instanceof PLUEngineError && error.code === "TIMEOUT") {
            console.warn(`[plu-engine] Timeout esquivé sur ${etalabUrl}, passage au fallback.`);
          } else {
            console.warn(`[getDvfSummaryNearby] DVF ${scope} fallback Etalab failed`, error);
          }
          rows = [];
        }
      }

      await setCache(cacheKey, { rows, scope }, 86_400);
      return { rows, scope };
    }

    let dvfRows: Array<Record<string, unknown>> = [];
    let scope: "section" | "commune" = "section";

    try {
      const result = await fetchDvfFor("section");
      dvfRows = result.rows;
      scope = result.scope;
    } catch (error) {
      console.warn("[getDvfSummaryNearby] DVF section fetch failed, trying commune", error);
    }

    if (dvfRows.length === 0) {
      try {
        const result = await fetchDvfFor("commune");
        dvfRows = result.rows;
        scope = result.scope;
      } catch (error) {
        console.warn("[getDvfSummaryNearby] DVF commune fetch failed", error);
      }
    }

    if (dvfRows.length === 0) {
      return {
        inseeCode,
        sectionCode,
        mutationCount: 0,
        medianValueEur: null,
        averageValueEur: null,
        medianPricePerM2Eur: null,
        averagePricePerM2Eur: null,
        latestMutationDate: null,
        source: "dvf-etalab",
        scope,
        dvfHistory: [],
      };
    }

    const values: number[] = [];
    const pricePerM2Values: number[] = [];
    let latestMutationDate: string | null = null;
    const yearlyValues: Record<string, number[]> = {};

    for (const row of dvfRows) {
      const value = toFiniteNumber(row.valeur_fonciere);
      if (value !== null) values.push(value);

      const builtSurfaceM2 = pickFirstFiniteNumber(row, [
        "surface_reelle_bati",
        "surface_bati",
        "surface_habitable",
        "sbati",
      ]);

      if (value !== null && builtSurfaceM2 !== null && builtSurfaceM2 > 8) {
        const unitPrice = value / builtSurfaceM2;
        // Filtre anti-outliers grossiers (prix/m² transactionnel).
        if (Number.isFinite(unitPrice) && unitPrice >= 300 && unitPrice <= 20_000) {
          pricePerM2Values.push(unitPrice);
        }
      }

      const date = pickStringProperty(row, ["date_mutation"]);
      if (date && (!latestMutationDate || date > latestMutationDate)) {
        latestMutationDate = date;
      }

      if (date && value !== null) {
        const yearMatch = date.match(/^(\d{4})/);
        const year = yearMatch ? yearMatch[1] : null;
        if (year) {
          if (!yearlyValues[year]) yearlyValues[year] = [];
          yearlyValues[year].push(value);
        }
      }
    }

    const avg =
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const avgPricePerM2 =
      pricePerM2Values.length > 0
        ? pricePerM2Values.reduce((sum, value) => sum + value, 0) / pricePerM2Values.length
        : null;

    const dvfHistory =
      Object.keys(yearlyValues).length > 0
        ? Object.keys(yearlyValues)
            .sort()
            .map((year) => ({
              year,
              price: median(yearlyValues[year]) ?? 0,
            }))
        : [];

    return {
      inseeCode,
      sectionCode,
      mutationCount: dvfRows.length,
      medianValueEur: median(values),
      averageValueEur: avg,
      medianPricePerM2Eur: median(pricePerM2Values),
      averagePricePerM2Eur: avgPricePerM2,
      latestMutationDate,
      source: "dvf-etalab",
      scope,
      dvfHistory,
    };
  } catch (error) {
    console.warn(
      "[getDvfSummaryNearby] unexpected error, returning empty DVF summary",
      error
    );
    return {
      inseeCode: "",
      sectionCode: "",
      mutationCount: 0,
      medianValueEur: null,
      averageValueEur: null,
      medianPricePerM2Eur: null,
      averagePricePerM2Eur: null,
      latestMutationDate: null,
      source: "dvf-etalab",
      scope: "commune",
      dvfHistory: [],
    };
  }
}

/**
 * Récupère un résumé "Sécurité & Risques" autour d'un point.
 *
 * Note: la structure de réponse Georisques peut varier selon les endpoints.
 * On applique donc un parsing défensif pour extraire inondation + argile.
 */
export async function getGeorisquesNearby(
  lon: number,
  lat: number
): Promise<GeorisquesSummary | null> {
  try {
    if (!isFinite(lon) || !isFinite(lat)) {
      throw new PLUEngineError(
        `Coordonnées invalides : lon=${lon}, lat=${lat}`,
        "INVALID_COORDS"
      );
    }

    const roundedLon = Number(lon.toFixed(4));
    const roundedLat = Number(lat.toFixed(4));
    const cacheKey = `georisques:${roundedLon}:${roundedLat}`;

    const cached = await getCache<GeorisquesSummary | null>(cacheKey);
    if (cached) {
      return cached;
    }

    // On récupère d'abord le code INSEE via le cadastre pour alimenter l'endpoint GASPAR.
    const geom = encodeURIComponent(
      JSON.stringify({ type: "Point", coordinates: [lon, lat] })
    );
    const cadastreUrl = `${CADASTRE_API_URL}?geom=${geom}`;
    const cadastreJson = (await fetchJsonWithRetry(
      cadastreUrl,
      FETCH_TIMEOUT_MS,
      DVF_MAX_RETRIES
    )) as { features?: Array<{ properties?: Record<string, unknown> }> };

    const properties = cadastreJson?.features?.[0]?.properties;
    let inseeCode = properties
      ? pickStringProperty(
          properties,
          ["code_insee", "insee", "INSEE"]
        )
      : null;

    if (!inseeCode) {
      try {
        const geoRes = await fetch(
          `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`
        );
        if (geoRes.ok) {
          const geoData = (await geoRes.json()) as {
            features?: Array<{ properties?: { citycode?: string } }>;
          };
          if (geoData?.features?.length) {
            const citycode = geoData.features[0]?.properties?.citycode;
            if (typeof citycode === "string" && citycode.trim().length > 0) {
              inseeCode = citycode.trim();
            }
          }
        }
      } catch (geoError) {
        console.warn(
          "[getGeorisquesNearby] Échec du reverse geocoding API Adresse",
          geoError
        );
      }
    }

    if (!inseeCode) {
      throw new PLUEngineError(
        "Impossible de déterminer le code INSEE pour la requête Géorisques.",
        "INVALID_COORDS"
      );
    }

    const candidateUrls = [
      `${GEORISQUES_API_BASE_URL}/gaspar/risques?code_insee=${encodeURIComponent(
        inseeCode
      )}`,
      `${GEORISQUES_API_BASE_URL}/rga?latlon=${lon},${lat}`,
    ];

    let lastError: unknown = null;
    let floodLevel: RiskLevel = "UNKNOWN";
    let clayLevel: RiskLevel = "UNKNOWN";
    let floodRisk = false;
    let clayRisk = false;
    let hazardCount = 0;
    let successfulCalls = 0;

    for (const url of candidateUrls) {
      console.log(`[plu-engine][getGeorisquesNearby] Georisques URL: ${url}`);
      try {
        const json = await fetchJsonWithRetry(
          url,
          GEORISQUES_TIMEOUT_MS,
          GEORISQUES_MAX_RETRIES
        );
        successfulCalls += 1;
        hazardCount += detectHazardCount(json);

        const hasFlood = detectKeywordPresence(json, [
          "inondation",
          "inonde",
          "crue",
          "submersion",
        ]);
        const hasClay = detectKeywordPresence(json, [
          "argile",
          "retrait-gonflement",
          "gonflement",
          "rga",
        ]);

        const detectedFloodLevel = detectRiskLevelFromData(json, [
          "niveau_inondation",
          "risque_inondation",
          "inondation_niveau",
          "inondation",
        ]);
        const detectedClayLevel = detectRiskLevelFromData(json, [
          "niveau_argile",
          "risque_argile",
          "exposition_argile",
          "retrait_gonflement_argile",
          "argile",
        ]);

        floodRisk = floodRisk || hasFlood;
        clayRisk = clayRisk || hasClay;
        floodLevel = maxRiskLevel(floodLevel, detectedFloodLevel);
        clayLevel = maxRiskLevel(clayLevel, detectedClayLevel);
      } catch (error) {
        lastError = error;
        if (error instanceof PLUEngineError && error.code === "TIMEOUT") {
          console.warn(`[plu-engine] Timeout esquivé sur ${url}, passage au fallback.`);
        } else {
          console.warn(`[plu-engine][getGeorisquesNearby] Echec URL: ${url}`, error);
        }
      }
    }

    if (successfulCalls === 0) {
      if (lastError) {
        console.warn(
          "[plu-engine][getGeorisquesNearby] all Georisques calls failed, using neutral fallback",
          lastError
        );
      }

      const summary: GeorisquesSummary = {
        floodRisk: false,
        floodLevel: "UNKNOWN",
        clayRisk: false,
        clayLevel: "UNKNOWN",
        hazardCount: 0,
        source: "georisques",
        isFallback: true,
      };
      await setCache(cacheKey, summary, 3_600);
      return summary;
    }

    if (floodLevel === "UNKNOWN" && floodRisk) {
      floodLevel = "MEDIUM";
    }
    if (clayLevel === "UNKNOWN" && clayRisk) {
      clayLevel = "MEDIUM";
    }
    if (!floodRisk && floodLevel === "UNKNOWN") {
      floodLevel = "LOW";
    }
    if (!clayRisk && clayLevel === "UNKNOWN") {
      clayLevel = "LOW";
    }

    const summary: GeorisquesSummary = {
      floodRisk,
      floodLevel,
      clayRisk,
      clayLevel,
      hazardCount,
      source: "georisques",
      inondation: {
        niveau: floodLevel === "HIGH" ? "Élevé" : floodLevel === "LOW" ? "Faible" : "Moyen",
        source: "Géorisques GASPAR",
      },
      argile: {
        niveau: clayLevel === "HIGH" ? "Élevé" : clayLevel === "LOW" ? "Faible" : "Moyen",
        source: "Géorisques RGA",
      },
    };
    await setCache(cacheKey, summary, 3_600);
    return summary;
  } catch (error) {
    if (error instanceof PLUEngineError && error.code === "TIMEOUT") {
      console.warn(
        `[plu-engine] Timeout esquivé sur cadastre/georisques, retour d'un résumé neutre.`,
        error
      );
    } else {
      console.warn(
        "[plu-engine][getGeorisquesNearby] unexpected error, returning neutral fallback",
        error
      );
    }
    const fallback: GeorisquesSummary = {
      floodRisk: false,
      floodLevel: "UNKNOWN",
      clayRisk: false,
      clayLevel: "UNKNOWN",
      hazardCount: 0,
      source: "georisques",
      isFallback: true,
    };
    const roundedLon = Number(lon.toFixed(4));
    const roundedLat = Number(lat.toFixed(4));
    const cacheKey = `georisques:${roundedLon}:${roundedLat}`;
    await setCache(cacheKey, fallback, 3_600);
    return fallback;
  }
}

// ─── Lookup complet ───────────────────────────────────────────────────────────

/**
 * Point d'entrée principal : géocode une adresse puis interroge le GPU.
 * Retourne null pour la zone si aucune donnée PLU n'est disponible.
 */
export async function lookupPLU(address: string): Promise<PLUResult | null> {
  const suggestions = await searchAddresses(address, 1);
  if (suggestions.length === 0) return null;

  const best = suggestions[0];
  const [zone, parcel] = await Promise.all([
    getZoneUrba(best.lon, best.lat),
    getParcelPolygon(best.lon, best.lat),
  ]);

  return { address: best, zone, parcel };
}

