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
const DVF_API_BASE_URL = "https://app.dvf.etalab.gouv.fr/api/mutations3";

/** Délai maximum en ms avant d'abandonner une requête externe. */
const FETCH_TIMEOUT_MS = 8_000;
const WFS_TIMEOUT_MS = 12_000;
const WFS_MAX_RETRIES = 2;
const DVF_TIMEOUT_MS = 10_000;
const DVF_MAX_RETRIES = 1;
const EARTH_RADIUS_M = 6_378_137;

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

  for (const typeName of GPU_WFS_TYPENAMES) {
    const requestUrl = buildZoneWfsUrl(typeName, lon, lat);
    console.log(`[plu-engine][getZoneUrba] WFS URL: ${requestUrl}`);

    for (let attempt = 0; attempt <= WFS_MAX_RETRIES; attempt += 1) {
      try {
        const res = await fetchWithTimeout(requestUrl, { cache: "no-store" }, WFS_TIMEOUT_MS);

        if (!res.ok) {
          if (attempt < WFS_MAX_RETRIES && (res.status >= 500 || res.status === 429)) {
            await delay(400 * (attempt + 1));
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
          await delay(400 * (attempt + 1));
          continue;
        }
        break;
      }
    }
  }

  if (lastError instanceof PLUEngineError) {
    throw lastError;
  }
  if (lastError && isNetworkFetchError(lastError)) {
    const detail = lastError instanceof Error ? lastError.message : "fetch failed";
    throw new PLUEngineError(`Erreur réseau GPU WFS (${detail})`, "WFS_FAILED");
  }
  if (lastError) {
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
  const cadastreJson = (await fetchJsonWithRetry(
    cadastreUrl,
    FETCH_TIMEOUT_MS,
    DVF_MAX_RETRIES
  )) as { features?: Array<{ properties?: Record<string, unknown> }> };

  const properties = cadastreJson?.features?.[0]?.properties;
  if (!properties || typeof properties !== "object") return null;

  const inseeCode = pickStringProperty(properties, ["code_insee", "insee", "INSEE"]);
  const idu = pickStringProperty(properties, ["idu", "IDU"]);
  const sectionCode = idu && idu.length >= 10 ? idu.slice(5, 10) : null;

  if (!inseeCode || !sectionCode) return null;

  const dvfUrl = `${DVF_API_BASE_URL}/${encodeURIComponent(inseeCode)}/${encodeURIComponent(
    sectionCode
  )}`;
  console.log(`[plu-engine][getDvfSummaryNearby] DVF URL: ${dvfUrl}`);

  const dvfJson = (await fetchJsonWithRetry(dvfUrl, DVF_TIMEOUT_MS, DVF_MAX_RETRIES)) as {
    mutations?: Array<Record<string, unknown>>;
  };
  const rows = Array.isArray(dvfJson?.mutations) ? dvfJson.mutations : [];
  if (rows.length === 0) {
    return {
      inseeCode,
      sectionCode,
      mutationCount: 0,
      medianValueEur: null,
      averageValueEur: null,
      latestMutationDate: null,
      source: "dvf-etalab",
    };
  }

  const values: number[] = [];
  let latestMutationDate: string | null = null;

  for (const row of rows) {
    const value = toFiniteNumber(row.valeur_fonciere);
    if (value !== null) values.push(value);

    const date = pickStringProperty(row, ["date_mutation"]);
    if (date && (!latestMutationDate || date > latestMutationDate)) {
      latestMutationDate = date;
    }
  }

  const avg =
    values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  return {
    inseeCode,
    sectionCode,
    mutationCount: rows.length,
    medianValueEur: median(values),
    averageValueEur: avg,
    latestMutationDate,
    source: "dvf-etalab",
  };
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
