/**
 * scripts/import-plu-13.ts
 *
 * Import des zones PLU du département 13 dans PostGIS (Neon).
 * Le script tente d'abord de découvrir une ressource GeoJSON via l'API Data.gouv,
 * puis applique un fallback sur l'URL WFS GeoJSON déjà éprouvée si besoin.
 */

import { neon } from "@neondatabase/serverless";

const DEPT = "13";
const DATA_GOUV_API = "https://www.data.gouv.fr/api/1/datasets/";
const FALLBACK_GEOJSON_URL =
  "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=wfs_du:zone_urba&outputFormat=application/json&count=20000&CQL_FILTER=(insee%20LIKE%20'13%25'%20OR%20nomfic%20LIKE%20'13%25')";

interface DataGouvResource {
  format?: string | null;
  title?: string | null;
  latest?: string | null;
  url?: string | null;
}

interface DataGouvDataset {
  title?: string | null;
  resources?: DataGouvResource[];
}

interface WfsFeature {
  geometry: {
    type: string;
    coordinates: unknown;
  } | null;
  properties: Record<string, unknown>;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function discoverGeoJsonUrlFromDataGouv(): Promise<string> {
  const query = encodeURIComponent("PLU Géoportail de l'Urbanisme Bouches-du-Rhône GeoJSON");
  const url = `${DATA_GOUV_API}?q=${query}&page_size=20`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Data.gouv API HTTP ${res.status} (${res.statusText})`);
  }

  const json = (await res.json()) as { data?: DataGouvDataset[] };
  const datasets = json.data ?? [];

  for (const dataset of datasets) {
    const resources = dataset.resources ?? [];

    for (const resource of resources) {
      const format = (resource.format ?? "").toLowerCase();
      const title = (resource.title ?? "").toLowerCase();
      const candidate = normalizeString(resource.latest) ?? normalizeString(resource.url);

      if (!candidate) continue;

      const looksGeoJson =
        format.includes("geojson") ||
        title.includes("geojson") ||
        candidate.toLowerCase().includes("geojson");

      const looksDept13 =
        title.includes("bouches") || title.includes("13") || candidate.includes("13");

      if (looksGeoJson && looksDept13) {
        return candidate;
      }
    }
  }

  throw new Error("Aucune ressource GeoJSON département 13 trouvée via Data.gouv API.");
}

async function ensureSchema(sql: ReturnType<typeof neon<false, false>>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  await sql`
    CREATE TABLE IF NOT EXISTS plu_zones (
      id BIGSERIAL PRIMARY KEY,
      code_commune TEXT NOT NULL,
      libelle TEXT,
      typezone TEXT,
      urlfic TEXT,
      geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS plu_zones_geom_idx
    ON plu_zones USING GIST (geom)
  `;
}

async function main(): Promise<void> {
  try {
    const { config } = await import("dotenv");
    config({ path: ".env.local" });
  } catch {
    // ignore
  }

  const databaseUrl = (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.NEON_DATABASE_URL ??
    ""
  ).trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL introuvable.");
  }

  const sql = neon(databaseUrl);

  await ensureSchema(sql);

  let geoJsonUrl = FALLBACK_GEOJSON_URL;
  try {
    geoJsonUrl = await discoverGeoJsonUrlFromDataGouv();
    console.log(`[import-plu-13] Data.gouv resource trouvée: ${geoJsonUrl}`);
  } catch (error) {
    console.warn(
      `[import-plu-13] Discovery Data.gouv indisponible, fallback WFS: ${(error as Error).message}`
    );
    console.log(`[import-plu-13] URL fallback: ${geoJsonUrl}`);
  }

  const response = await fetch(geoJsonUrl, {
    signal: AbortSignal.timeout(120_000),
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Téléchargement GeoJSON impossible (${response.status} ${response.statusText})`);
  }

  const payload = (await response.json()) as { features?: WfsFeature[] };
  const features = payload.features ?? [];

  if (features.length === 0) {
    throw new Error("Aucune feature GeoJSON à importer.");
  }

  await sql`DELETE FROM plu_zones WHERE code_commune LIKE ${`${DEPT}%`}`;

  let inserted = 0;
  let skipped = 0;

  for (const feature of features) {
    if (!feature.geometry) {
      skipped += 1;
      continue;
    }

    const properties = feature.properties ?? {};

    const codeCommune = normalizeString(properties.insee) ?? normalizeString(properties.code_commune);
    const libelle = normalizeString(properties.libelle);
    const typezone = normalizeString(properties.typezone);
    const urlfic = normalizeString(properties.urlfic);

    if (!codeCommune || !codeCommune.startsWith(DEPT)) {
      skipped += 1;
      continue;
    }

    const geom = JSON.stringify(feature.geometry);

    try {
      await sql`
        INSERT INTO plu_zones (code_commune, libelle, typezone, urlfic, geom)
        VALUES (
          ${codeCommune},
          ${libelle},
          ${typezone},
          ${urlfic},
          ST_Multi(ST_GeomFromGeoJSON(${geom}))
        )
      `;
      inserted += 1;
    } catch {
      skipped += 1;
    }
  }

  console.log(`[import-plu-13] Import terminé. Inserted=${inserted} Skipped=${skipped}`);
}

main().catch((error) => {
  console.error("[import-plu-13] Erreur fatale:", error);
  process.exit(1);
});

