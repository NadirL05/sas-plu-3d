/**
 * PLU Engine – extraction robuste des données d'urbanisme
 *
 * 1. Géocodage via l'API Adresse (api-adresse.data.gouv.fr)
 * 2. Zonage GPU via le WFS du Géoportail de l'Urbanisme (IGN)
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

export interface PLUResult {
  address: AddressSuggestion;
  zone: ZoneUrba | null;
}

/** Erreur typée pour distinguer les erreurs PLU des erreurs génériques. */
export class PLUEngineError extends Error {
  constructor(
    message: string,
    public readonly code: "GEOCODE_FAILED" | "WFS_FAILED" | "INVALID_COORDS" | "TIMEOUT"
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
const GPU_WFS_URL = "https://wxs.ign.fr/essentiels/geoportail/wfs";

/** Délai maximum en ms avant d'abandonner une requête externe. */
const FETCH_TIMEOUT_MS = 8_000;

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

  const params = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: "ms:zone_urba",
    outputFormat: "application/json",
    CQL_FILTER: `INTERSECTS(the_geom,POINT(${lon} ${lat}))`,
    maxFeatures: "1",
  });

  const res = await fetchWithTimeout(
    `${GPU_WFS_URL}?${params.toString()}`,
    { cache: "no-store" }
  );

  if (!res.ok) {
    throw new PLUEngineError(
      `GPU WFS a répondu avec ${res.status} ${res.statusText}`,
      "WFS_FAILED"
    );
  }

  const data = await res.json();

  if (!data.features || data.features.length === 0) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: Record<string, any> = data.features[0].properties ?? {};

  // Plusieurs noms de propriétés possibles selon la version du WFS
  return {
    libelle:   p.libelle   ?? p.zone      ?? p.lib_zone ?? "N/A",
    typezone:  p.typezone  ?? p.type_zone ?? p.typezone ?? "N/A",
    commune:   p.commune   ?? p.nomcom    ?? p.libcom   ?? "N/A",
    nomfic:    p.nomfic    ?? undefined,
    urlfic:    p.urlfic    ?? undefined,
    datappro:  p.datappro  ?? undefined,
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
  const zone = await getZoneUrba(best.lon, best.lat);

  return { address: best, zone };
}
