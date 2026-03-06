/**
 * OSM Engine — récupération des bâtiments voisins via l'API Overpass
 *
 * Stratégie :
 *  1. Query Overpass pour tous les `way["building"]` dans un rayon donné
 *  2. Extraction de la hauteur depuis tags.height ou tags["building:levels"]
 *  3. Retour des anneaux polygonaux en [lon, lat] prêts pour la projection
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NearbyBuilding {
  /** Identifiant unique (préfixé "osm-" + OSM way id). */
  id: string;
  /**
   * Anneau extérieur du polygone du bâtiment en coordonnées WGS84.
   * Format : tableau de paires [lon, lat].
   */
  ring: [number, number][];
  /** Hauteur estimée en mètres. */
  heightM: number;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_HEIGHT_M = 6;          // 2 étages si aucune donnée dispo
const LEVELS_TO_METERS = 3;          // 1 niveau ≈ 3 m
const MAX_BUILDINGS = 80;            // plafond de performance WebGL
const FETCH_TIMEOUT_MS = 14_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function estimateHeight(tags: Record<string, string | undefined>): number {
  // Priorité 1 : tag height (peut valoir "12", "12.5", "12 m")
  const rawHeight = tags["height"] ?? tags["building:height"];
  if (rawHeight) {
    const parsed = parseFloat(rawHeight);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  // Priorité 2 : tag building:levels
  const rawLevels = tags["building:levels"];
  if (rawLevels) {
    const parsed = parseInt(rawLevels, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed * LEVELS_TO_METERS;
  }

  return DEFAULT_HEIGHT_M;
}

// ─── API principale ───────────────────────────────────────────────────────────

/**
 * Récupère les bâtiments OSM dans un rayon donné autour du point (lat, lon).
 *
 * @param lat     Latitude du centre (coordonnées WGS84)
 * @param lon     Longitude du centre (coordonnées WGS84)
 * @param radius  Rayon de recherche en mètres (défaut 150)
 * @returns       Liste de bâtiments avec anneau polygonal et hauteur
 */
export async function fetchNearbyBuildings(
  lat: number,
  lon: number,
  radius = 150
): Promise<NearbyBuilding[]> {
  // Overpass QL : tous les ways tagués "building" dans le rayon, avec géométrie complète
  const query = `[out:json][timeout:12];way["building"](around:${radius},${lat},${lon});out geom;`;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`[osm-engine] Overpass API a répondu ${res.status}`);
  }

  type OsmElement = {
    type: string;
    id: number;
    tags?: Record<string, string>;
    geometry?: Array<{ lat: number; lon: number }>;
  };

  const { elements = [] } = (await res.json()) as { elements: OsmElement[] };

  const buildings: NearbyBuilding[] = [];

  for (const el of elements) {
    // Garder uniquement les ways avec au moins 4 nœuds (polygone fermé min.)
    if (el.type !== "way" || !el.geometry || el.geometry.length < 4) continue;

    const ring: [number, number][] = el.geometry.map(
      ({ lon, lat }) => [lon, lat] as [number, number]
    );

    buildings.push({
      id: `osm-${el.id}`,
      ring,
      heightM: estimateHeight(el.tags ?? {}),
    });

    // Limitation de performance : on s'arrête au plafond
    if (buildings.length >= MAX_BUILDINGS) break;
  }

  return buildings;
}
