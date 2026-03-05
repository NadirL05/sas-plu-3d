import { neon } from "@neondatabase/serverless";

const DEPT = process.argv[2] ?? "13";
const DATA_GOUV_DATASETS_API = "https://www.data.gouv.fr/api/1/datasets/";

interface DataGouvResource {
  title?: string | null;
  format?: string | null;
  mime?: string | null;
  url?: string | null;
  latest?: string | null;
}

interface DataGouvDataset {
  title?: string | null;
  resources?: DataGouvResource[];
}

interface DataGouvSearchResponse {
  data?: DataGouvDataset[];
}

interface GeoJsonFeature {
  geometry?: {
    type?: string;
    coordinates?: unknown;
  } | null;
  properties?: Record<string, unknown>;
}

interface GeoJsonFeatureCollection {
  features?: GeoJsonFeature[];
}

function normalizeString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return null;
}

function buildWfsFallbackUrl(dept: string): string {
  return (
    "https://data.geopf.fr/wfs/ows" +
    "?SERVICE=WFS" +
    "&VERSION=2.0.0" +
    "&REQUEST=GetFeature" +
    "&TYPENAMES=wfs_du:zone_urba" +
    "&outputFormat=application/json" +
    "&count=50000" +
    `&CQL_FILTER=${encodeURIComponent(`(insee LIKE '${dept}%' OR nomfic LIKE '${dept}%')`)}`
  );
}

function looksLikeGeoJsonResource(resource: DataGouvResource): boolean {
  const format = (resource.format ?? "").toLowerCase();
  const mime = (resource.mime ?? "").toLowerCase();
  const title = (resource.title ?? "").toLowerCase();
  const candidate = (resource.latest ?? resource.url ?? "").toLowerCase();

  return (
    format.includes("geojson") ||
    mime.includes("geo+json") ||
    title.includes("geojson") ||
    candidate.includes("geojson") ||
    candidate.includes("outputformat=application/json")
  );
}

function hasDepartmentHint(text: string, dept: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes(` ${dept}`) ||
    lower.includes(`-${dept}`) ||
    lower.includes(`/${dept}`) ||
    lower.includes("bouches-du-rhone") ||
    lower.includes("bouches du rhone")
  );
}

async function discoverGeoJsonUrlFromDataGouv(dept: string): Promise<string> {
  const queries = [
    `PLU Géoportail de l'Urbanisme GeoJSON ${dept}`,
    `PLU zone urba GeoJSON ${dept}`,
    "PLU Géoportail de l'Urbanisme GeoJSON",
  ];

  let fallbackCandidate: string | null = null;

  for (const query of queries) {
    const url = `${DATA_GOUV_DATASETS_API}?q=${encodeURIComponent(query)}&page_size=40`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) continue;

    const payload = (await response.json()) as DataGouvSearchResponse;
    const datasets = payload.data ?? [];

    for (const dataset of datasets) {
      const resources = dataset.resources ?? [];
      const datasetTitle = normalizeString(dataset.title) ?? "";

      for (const resource of resources) {
        if (!looksLikeGeoJsonResource(resource)) continue;

        const candidate = normalizeString(resource.latest) ?? normalizeString(resource.url);
        if (!candidate) continue;

        const title = normalizeString(resource.title) ?? "";
        const deptHint = hasDepartmentHint(`${datasetTitle} ${title} ${candidate}`, dept);

        if (deptHint) {
          return candidate;
        }

        if (!fallbackCandidate) {
          fallbackCandidate = candidate;
        }
      }
    }
  }

  if (fallbackCandidate) {
    return fallbackCandidate;
  }

  throw new Error("Aucune ressource GeoJSON PLU exploitable trouvée via Data.gouv.");
}

function pickStringProperty(properties: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeString(properties[key]);
    if (value) return value;
  }
  return null;
}

function extractCodeCommune(properties: Record<string, unknown>, dept: string): string | null {
  const direct = pickStringProperty(properties, [
    "insee",
    "INSEE",
    "code_insee",
    "codeInsee",
    "code_commune",
    "CODE_COMMUNE",
  ]);

  if (direct && /^\d{5}$/.test(direct) && direct.startsWith(dept)) {
    return direct;
  }

  const nomfic = pickStringProperty(properties, ["nomfic", "NOMFIC"]);
  if (nomfic) {
    const prefixed = nomfic.match(/^(\d{5})/);
    if (prefixed && prefixed[1].startsWith(dept)) {
      return prefixed[1];
    }

    const anywhere = nomfic.match(/\b(\d{5})\b/);
    if (anywhere && anywhere[1].startsWith(dept)) {
      return anywhere[1];
    }
  }

  return null;
}

async function ensureSpatialSchema(sql: ReturnType<typeof neon<false, false>>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  await sql`
    CREATE TABLE IF NOT EXISTS plu_zones (
      id SERIAL PRIMARY KEY,
      code_commune VARCHAR NOT NULL,
      libelle VARCHAR,
      typezone VARCHAR,
      urlfic TEXT,
      geom GEOMETRY(MultiPolygon, 4326) NOT NULL
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
  await ensureSpatialSchema(sql);

  let geoJsonUrl = buildWfsFallbackUrl(DEPT);
  try {
    geoJsonUrl = await discoverGeoJsonUrlFromDataGouv(DEPT);
    console.log(`[import-plu-geojson] Data.gouv URL trouvée: ${geoJsonUrl}`);
  } catch (error) {
    console.warn(
      `[import-plu-geojson] Discovery Data.gouv indisponible, fallback WFS: ${(error as Error).message}`
    );
    console.log(`[import-plu-geojson] URL fallback: ${geoJsonUrl}`);
  }

  const response = await fetch(geoJsonUrl, {
    signal: AbortSignal.timeout(180_000),
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Téléchargement GeoJSON impossible (${response.status} ${response.statusText})`);
  }

  const payload = (await response.json()) as GeoJsonFeatureCollection;
  const features = payload.features ?? [];

  if (features.length === 0) {
    throw new Error("Aucune feature GeoJSON à importer.");
  }

  await sql`DELETE FROM plu_zones WHERE code_commune LIKE ${`${DEPT}%`}`;

  let inserted = 0;
  let skipped = 0;
  const reasons: Record<string, number> = {
    missing_geometry: 0,
    missing_properties: 0,
    unsupported_geometry: 0,
    missing_code_commune: 0,
    wrong_department: 0,
    insert_error: 0,
  };

  for (const feature of features) {
    if (!feature.geometry) {
      skipped += 1;
      reasons.missing_geometry += 1;
      continue;
    }

    if (!feature.properties) {
      skipped += 1;
      reasons.missing_properties += 1;
      continue;
    }

    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") {
      skipped += 1;
      reasons.unsupported_geometry += 1;
      continue;
    }

    const codeCommune = extractCodeCommune(feature.properties, DEPT);

    if (!codeCommune) {
      skipped += 1;
      reasons.missing_code_commune += 1;
      continue;
    }

    if (!codeCommune.startsWith(DEPT)) {
      skipped += 1;
      reasons.wrong_department += 1;
      continue;
    }

    const libelle = pickStringProperty(feature.properties, [
      "libelle",
      "LIBELLE",
      "zone",
      "libelle_zone",
    ]);
    const typezone = pickStringProperty(feature.properties, ["typezone", "TYPEZONE", "type_zone"]);
    const urlfic = pickStringProperty(feature.properties, ["urlfic", "URLFIC", "url_document"]);

    const geomGeoJson = JSON.stringify(feature.geometry);

    try {
      await sql`
        INSERT INTO plu_zones (code_commune, libelle, typezone, urlfic, geom)
        VALUES (
          ${codeCommune},
          ${libelle},
          ${typezone},
          ${urlfic},
          ST_Multi(ST_GeomFromGeoJSON(${geomGeoJson}))
        )
      `;
      inserted += 1;
    } catch (error) {
      skipped += 1;
      reasons.insert_error += 1;
      if (reasons.insert_error <= 5) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[import-plu-geojson] Insert error (sample ${reasons.insert_error}): ${message}`);
      }
    }
  }

  console.log(`[import-plu-geojson] Import terminé. Département=${DEPT}`);
  console.log(`[import-plu-geojson] Inserted=${inserted} Skipped=${skipped}`);
  console.log(`[import-plu-geojson] Skip reasons=${JSON.stringify(reasons)}`);
}

main().catch((error) => {
  console.error("[import-plu-geojson] Erreur fatale:", error);
  process.exit(1);
});

