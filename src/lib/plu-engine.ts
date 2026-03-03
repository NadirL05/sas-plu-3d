/**
 * PLU Engine – extraction robuste des données d'urbanisme
 *
 * 1. Géocodage via l'API Adresse (api-adresse.data.gouv.fr)
 * 2. Zonage GPU via le WFS du Géoportail de l'Urbanisme (IGN)
 * 3. Parcelle cadastrale via l'API Cadastre (Etalab)
 */

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
  /** Coût de construction (EUR), par défaut 1 800 €/m². */
  coutConstructionEur: number;
  /** Frais annexes (EUR), 15% du CA. */
  fraisAnnexesEur: number;
  /** Prix maximum recommandé pour le terrain (EUR) après marge cible de 15%. */
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

/**
 * Endpoint WFS public du Géoportail de l'Urbanisme (IGN).
 * Clé "essentiels" : accès gratuit, sans authentification.
 */
const GPU_WFS_URL = "https://data.geopf.fr/wfs/ows";
const GPU_WFS_VERSION = "2.0.0";
const GPU_WFS_TYPENAMES = ["wfs_du:zone_urba"] as const;
const CADASTRE_API_URL = "https://apicarto.ign.fr/api/cadastre/parcelle";
const DVF_API_BASE_URL = "http://api.cquest.org/dvf";
const DVF_API_FALLBACK_URL = "https://app.dvf.etalab.gouv.fr/api/mutations3";
const GEORISQUES_API_BASE_URL = "https://georisques.gouv.fr/api/v1";

/** Délai maximum en ms avant d'abandonner une requête externe. */
const FETCH_TIMEOUT_MS = 8_000;
const WFS_TIMEOUT_MS = 12_000;
const WFS_MAX_RETRIES = 3;
const WFS_RETRY_DELAY_MS = 180;
const DVF_TIMEOUT_MS = 3_000;
const DVF_MAX_RETRIES = 0;
const GEORISQUES_TIMEOUT_MS = 7_000;
const GEORISQUES_MAX_RETRIES = 2;
const EARTH_RADIUS_M = 6_378_137;
const DVF_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const dvfRowsCache = new Map<
  string,
  { expiresAt: number; rows: Array<Record<string, unknown>>; scope: "section" | "commune" }
>();

const georisquesCache = new Map<
  string,
  { expiresAt: number; summary: GeorisquesSummary | null }
>();

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

function buildZoneWfsUrl(typeName: string, lon: number, lat: number): string {
  const params = new URLSearchParams({
    service: "WFS",
    version: GPU_WFS_VERSION,
    request: "GetFeature",
    typeName,
    outputFormat: "application/json",
    CQL_FILTER: `INTERSECTS(the_geom,POINT(${lon} ${lat}))`,
    maxFeatures: "1",
  });

  return `${GPU_WFS_URL}?${params.toString()}`;
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
}): PromoterBalance | null {
  const parcelAreaM2 = params.parcelAreaM2 ?? null;
  const coveragePct = params.coveragePct ?? 50;
  const maxHeightM = params.maxHeightM ?? null;
  const medianDvfValueEur = params.medianDvfValueEur ?? null;

  if (
    !parcelAreaM2 ||
    parcelAreaM2 <= 0 ||
    !medianDvfValueEur ||
    medianDvfValueEur <= 0
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

  // Hypothèse: la valeur DVF médiane donnée correspond à la valeur d'une mutation
  // rapportée à la surface du terrain; on ramène cela à un prix €/m² de plancher.
  const localPricePerM2 = medianDvfValueEur / parcelAreaM2;
  const chiffreAffairesEstimeEur = surfacePlancherM2 * localPricePerM2;

  const coutConstructionM2 = 1_800;
  const coutConstructionEur = surfacePlancherM2 * coutConstructionM2;
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
 * Interroge le WFS du GPU pour trouver la zone d'urbanisme à un point GPS.
 * Filtre spatial CQL : INTERSECTS(the_geom, POINT(lon lat))
 *
 * @param lon - Longitude (WGS84, plage valide : -5.5 à 9.6 pour la France métropolitaine)
 * @param lat - Latitude  (WGS84, plage valide : 41 à 51.2 pour la France métropolitaine)
 */
export async function getZoneUrba(
  lon: number,
  lat: number
): Promise<ZoneUrba | null> {
  // Validation basique des coordonnées (France métropolitaine + outremer)
  if (!isFinite(lon) || !isFinite(lat)) {
    throw new PLUEngineError(
      `Coordonnées invalides : lon=${lon}, lat=${lat}`,
      "INVALID_COORDS"
    );
  }

  let lastError: unknown = null;
  let lastFailedWfsUrl: string | null = null;

  for (const typeName of GPU_WFS_TYPENAMES) {
    const requestUrl = buildZoneWfsUrl(typeName, lon, lat);
    console.log(`[plu-engine][getZoneUrba] WFS URL: ${requestUrl}`);
    lastFailedWfsUrl = requestUrl;

    for (let attempt = 0; attempt <= WFS_MAX_RETRIES; attempt += 1) {
      try {
        const res = await fetchWithTimeout(requestUrl, { cache: "no-store" }, WFS_TIMEOUT_MS);

        if (!res.ok) {
          if (attempt < WFS_MAX_RETRIES && (res.status >= 500 || res.status === 429)) {
            await delay(WFS_RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
          throw new PLUEngineError(
            `GPU WFS a répondu avec ${res.status} ${res.statusText} (${typeName})`,
            "WFS_FAILED"
          );
        }

        const data = await res.json();
        if (!Array.isArray(data?.features) || data.features.length === 0) {
          break;
        }

        const properties = (data.features[0]?.properties ?? {}) as Record<string, unknown>;

        // Géoplateforme / WFS + variantes CNIG (casse / alias).
        return {
          libelle:
            pickStringProperty(properties, [
              "libelle",
              "LIBELLE",
              "libelong",
              "LIBELONG",
              "zone",
              "lib_zone",
            ]) ?? "N/A",
          typezone:
            pickStringProperty(properties, ["typezone", "TYPEZONE", "type_zone", "TYPE_ZONE"]) ??
            "N/A",
          commune:
            pickStringProperty(properties, [
              "commune",
              "COMMUNE",
              "nomcom",
              "NOMCOM",
              "libcom",
              "LIBCOM",
              "nom_commune",
              "NOM_COMMUNE",
              "insee",
              "INSEE",
            ]) ?? "N/A",
          nomfic: pickStringProperty(properties, ["nomfic", "NOMFIC"]),
          urlfic: pickStringProperty(properties, ["urlfic", "URLFIC"]),
          datappro: pickStringProperty(properties, ["datappro", "DATAPPRO"]),
        };
      } catch (error) {
        lastError = error;
        const isTimeout = error instanceof PLUEngineError && error.code === "TIMEOUT";
        const isNetworkError = isNetworkFetchError(error);
        const hasRetry = attempt < WFS_MAX_RETRIES;

        if ((isTimeout || isNetworkError) && hasRetry) {
          await delay(WFS_RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        break;
      }
    }
  }

  if (lastError instanceof PLUEngineError && lastError.code === "TIMEOUT") {
    console.warn(
      `[plu-engine] Timeout esquivé sur ${lastFailedWfsUrl ?? "WFS"}, passage au fallback.`
    );
    return null;
  }
  if (lastError instanceof PLUEngineError) {
    throw lastError;
  }
  if (lastError && isNetworkFetchError(lastError)) {
    if (lastFailedWfsUrl) {
      console.warn(
        `[plu-engine][getZoneUrba] Echec WFS (URL testable): ${lastFailedWfsUrl}`,
        lastError
      );
    }
    const detail = lastError instanceof Error ? lastError.message : "fetch failed";
    throw new PLUEngineError(`Erreur réseau GPU WFS (${detail})`, "WFS_FAILED");
  }
  if (lastError) {
    if (lastFailedWfsUrl) {
      console.warn(
        `[plu-engine][getZoneUrba] Echec WFS (URL testable): ${lastFailedWfsUrl}`,
        lastError
      );
    }
    throw new PLUEngineError("Erreur inconnue lors de l'appel au GPU WFS.", "WFS_FAILED");
  }

  return null;
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
      `[plu-engine] Timeout esquivé sur ${cadastreUrl}, passage au fallback.`
    );
    return null;
  }

  const properties = cadastreJson?.features?.[0]?.properties;
  if (!properties || typeof properties !== "object") return null;

  const inseeCode = pickStringProperty(properties, ["code_insee", "insee", "INSEE"]);
  const idu = pickStringProperty(properties, ["idu", "IDU"]);
  const sectionCode = idu && idu.length >= 10 ? idu.slice(5, 10) : null;

  if (!inseeCode || !sectionCode) return null;

  function parseDvfRows(payload: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) {
      return payload.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
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
        ? `section:${inseeCode}:${sectionCode}`
        : `commune:${inseeCode}`;
    const cached = dvfRowsCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return { rows: cached.rows, scope: cached.scope };
    }

    const cquestUrl =
      scope === "section"
        ? `${DVF_API_BASE_URL}?section=${encodeURIComponent(
            `${inseeCode}000${sectionCode}`
          )}`
        : `${DVF_API_BASE_URL}?code_commune=${encodeURIComponent(inseeCode)}`;

    const etalabUrl =
      scope === "section"
        ? `${DVF_API_FALLBACK_URL}/${encodeURIComponent(inseeCode)}/${encodeURIComponent(
            sectionCode
          )}`
        : `${DVF_API_FALLBACK_URL}/${encodeURIComponent(inseeCode)}`;

    console.log(`[plu-engine][getDvfSummaryNearby] DVF URL (${scope}): ${cquestUrl}`);

    let rows: Array<Record<string, unknown>> = [];

    try {
      const cquestJson = await fetchJsonWithRetry(cquestUrl, DVF_TIMEOUT_MS, DVF_MAX_RETRIES);
      rows = parseDvfRows(cquestJson);
      if (rows.length > 0) {
        dvfRowsCache.set(cacheKey, {
          rows,
          scope,
          expiresAt: now + DVF_CACHE_TTL_MS,
        });
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
          `[getDvfSummaryNearby] DVF ${scope} CQuest indisponible, fallback Etalab`,
          error
        );
      }
    }

    try {
      console.log(`[plu-engine][getDvfSummaryNearby] DVF fallback URL (${scope}): ${etalabUrl}`);
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

    dvfRowsCache.set(cacheKey, {
      rows,
      scope,
      expiresAt: now + DVF_CACHE_TTL_MS,
    });
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
      latestMutationDate: null,
      source: "dvf-etalab",
      scope,
    };
  }

  const values: number[] = [];
  let latestMutationDate: string | null = null;
  const yearlyValues: Record<string, number[]> = {};

  for (const row of dvfRows) {
    const value = toFiniteNumber(row.valeur_fonciere);
    if (value !== null) values.push(value);

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
    latestMutationDate,
    source: "dvf-etalab",
    scope,
    dvfHistory,
  };
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
    const cacheKey = `${lon.toFixed(5)},${lat.toFixed(5)}`;
    const cached = georisquesCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.summary;
    }
    if (!isFinite(lon) || !isFinite(lat)) {
      throw new PLUEngineError(
        `Coordonnées invalides : lon=${lon}, lat=${lat}`,
        "INVALID_COORDS"
      );
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
          "[plu-engine][getGeorisquesNearby] all Georisques calls failed, using statistical fallback",
          lastError
        );
      }

      const summary: GeorisquesSummary = {
        floodRisk: true,
        floodLevel: "MEDIUM",
        clayRisk: true,
        clayLevel: "MEDIUM",
        hazardCount: 0,
        source: "georisques",
        isFallback: true,
        inondationMeta: { niveau: "Moyen", source: "Données statistiques" },
        argileMeta: { niveau: "Moyen", source: "Données statistiques" },
        inondation: { niveau: "Moyen", source: "Données statistiques" },
        argile: { niveau: "Moyen", source: "Données statistiques" },
      };
      georisquesCache.set(cacheKey, {
        summary,
        expiresAt: now + DVF_CACHE_TTL_MS,
      });
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
    georisquesCache.set(cacheKey, {
      summary,
      expiresAt: Date.now() + DVF_CACHE_TTL_MS,
    });
    return summary;
  } catch (error) {
    if (error instanceof PLUEngineError && error.code === "TIMEOUT") {
      console.warn(`[plu-engine] Timeout esquivé sur cadastre/georisques, passage au fallback.`);
    } else {
      console.warn(
        "[plu-engine][getGeorisquesNearby] unexpected error, returning statistical fallback",
        error
      );
    }
    const summary: GeorisquesSummary = {
      floodRisk: true,
      floodLevel: "MEDIUM",
      clayRisk: true,
      clayLevel: "MEDIUM",
      hazardCount: 0,
      source: "georisques",
      isFallback: true,
      inondationMeta: { niveau: "Moyen", source: "Données statistiques" },
      argileMeta: { niveau: "Moyen", source: "Données statistiques" },
      inondation: { niveau: "Moyen", source: "Données statistiques" },
      argile: { niveau: "Moyen", source: "Données statistiques" },
    };
    georisquesCache.set(`${lon.toFixed(5)},${lat.toFixed(5)}`, {
      summary,
      expiresAt: Date.now() + DVF_CACHE_TTL_MS,
    });
    return summary;
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
