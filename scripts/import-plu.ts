/**
 * scripts/import-plu.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Import des zones PLU du GPU (Géoportail de l'Urbanisme) dans PostGIS (Neon).
 *
 * Stratégie :
 *   1. Crée l'extension PostGIS et la table `plu_zones` si elles n'existent pas.
 *   2. Télécharge les features `wfs_du:zone_urba` depuis le WFS de la Géoplateforme
 *      avec pagination (count=500 par page) pour un département donné.
 *   3. Insère chaque feature dans `plu_zones` via ST_Multi(ST_GeomFromGeoJSON()).
 *
 * Usage :
 *   DATABASE_URL="postgres://..." npx tsx scripts/import-plu.ts [DEPT_CODE]
 *
 * Exemples :
 *   npx tsx scripts/import-plu.ts 13      # Bouches-du-Rhône
 *   npx tsx scripts/import-plu.ts 69      # Rhône (Lyon)
 *   npx tsx scripts/import-plu.ts         # défaut : 13
 *
 * Prérequis : DATABASE_URL dans .env.local ou en variable d'environnement.
 */

import { neon } from "@neondatabase/serverless";

// ─── Config ────────────────────────────────────────────────────────────────────

const DEPT = process.argv[2] ?? "13";
const WFS_BASE = "https://data.geopf.fr/wfs/ows";
const WFS_LAYER = "wfs_du:zone_urba";
const PAGE_SIZE = 2000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWfsUrl(startIndex: number): string {
  // URLSearchParams encode les caractères spéciaux (:, /) ce que le WFS GPU rejette
  // → on construit l'URL manuellement pour préserver wfs_du:zone_urba et application/json
  // Certaines features ont insee vide mais nomfic préfixé par le code commune/département.
  const cqlFilter = encodeURIComponent(`(insee LIKE '${DEPT}%' OR nomfic LIKE '${DEPT}%')`);
  return (
    `${WFS_BASE}` +
    `?SERVICE=WFS` +
    `&VERSION=2.0.0` +
    `&REQUEST=GetFeature` +
    `&TYPENAMES=${WFS_LAYER}` +
    `&outputFormat=application/json` +
    `&count=${PAGE_SIZE}` +
    // startIndex=0 retourne HTTP 400 sur le WFS GPU — on l'omet pour la première page
    (startIndex > 0 ? `&startIndex=${startIndex}` : ``) +
    `&CQL_FILTER=${cqlFilter}`
  );
}

interface WfsFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: unknown;
  } | null;
  properties: Record<string, string | number | null | undefined>;
}

async function fetchPage(startIndex: number): Promise<WfsFeature[]> {
  const url = buildWfsUrl(startIndex);
  console.log(`  → Téléchargement page startIndex=${startIndex}…`);

  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    // Le WFS GPU peut répondre 400 sur certains startIndex élevés selon le filtre.
    // On considère alors qu'on a atteint la fin de pagination.
    if (res.status === 400 && startIndex > 0) {
      console.warn(`  ⚠ WFS HTTP 400 sur startIndex=${startIndex}, fin de pagination.`);
      return [];
    }
    throw new Error(`WFS HTTP ${res.status}: ${res.statusText}\n  URL: ${url}`);
  }

  const data = (await res.json()) as { features?: WfsFeature[] };
  return data.features ?? [];
}

// ─── Setup de la base ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setupDatabase(sql: any): Promise<void> {
  console.log("\n[1/3] Activation de PostGIS et création de la table plu_zones…");

  // PostGIS est pré-installé sur Neon — on l'active si ce n'est pas fait
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  await sql`
    CREATE TABLE IF NOT EXISTS plu_zones (
      id            BIGSERIAL PRIMARY KEY,
      code_commune  TEXT        NOT NULL,
      libelle       TEXT,
      typezone      TEXT,
      urlfic        TEXT,
      geom          GEOMETRY(MULTIPOLYGON, 4326) NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS plu_zones_geom_idx
    ON plu_zones USING GIST (geom)
  `;

  // Index B-Tree sur code_commune pour les lookups INSEE
  await sql`
    CREATE INDEX IF NOT EXISTS plu_zones_code_commune_idx
    ON plu_zones (code_commune)
  `;

  console.log("  ✓ Table plu_zones prête (PostGIS activé, index GIST créé).");
}

// ─── Import d'une page de features ────────────────────────────────────────────

async function importFeatures(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any,
  features: WfsFeature[]
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const feature of features) {
    if (!feature.geometry) {
      skipped++;
      continue;
    }

    const p = feature.properties;
    const codeCommune = String(p.insee ?? "").trim();
    const libelle = String(p.libelle ?? "").trim() || null;
    const typezone = String(p.typezone ?? "").trim() || null;
    const urlfic = String(p.urlfic ?? "").trim() || null;

    if (!codeCommune) {
      skipped++;
      continue;
    }

    const geomJson = JSON.stringify(feature.geometry);

    try {
      await sql`
        INSERT INTO plu_zones (code_commune, libelle, typezone, urlfic, geom)
        VALUES (
          ${codeCommune},
          ${libelle},
          ${typezone},
          ${urlfic},
          ST_Multi(ST_GeomFromGeoJSON(${geomJson}))
        )
        ON CONFLICT DO NOTHING
      `;
      inserted++;
    } catch (err) {
      console.warn(`  ⚠ Géométrie invalide pour insee=${codeCommune}:`, (err as Error).message);
      skipped++;
    }
  }

  return { inserted, skipped };
}

// ─── Point d'entrée ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Charge .env.local si disponible
  try {
    const { config } = await import("dotenv");
    config({ path: ".env.local" });
  } catch {
    // dotenv non installé – ok si DATABASE_URL est déjà dans l'environnement
  }

  const databaseUrl = (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.NEON_DATABASE_URL ??
    ""
  ).trim();

  if (!databaseUrl) {
    console.error(
      "❌ DATABASE_URL introuvable.\n" +
        "   Ajoutez-la dans .env.local ou passez-la en variable d'environnement :\n" +
        "   DATABASE_URL='postgres://...' npx tsx scripts/import-plu.ts"
    );
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log(`\n🗺  Import PLU – département ${DEPT} (Géoportail de l'Urbanisme → PostGIS Neon)`);
  console.log("═".repeat(70));

  // 1. Setup
  await setupDatabase(sql);

  // 2. Téléchargement paginé
  console.log(`\n[2/3] Téléchargement des zones WFS (layer: ${WFS_LAYER})…`);
  let totalInserted = 0;
  let totalSkipped = 0;
  let startIndex = 0;
  let pageCount = 0;

  while (true) {
    const features = await fetchPage(startIndex);
    pageCount++;

    if (features.length === 0) {
      console.log(`  → Page vide (startIndex=${startIndex}) — fin de la pagination.`);
      break;
    }

    console.log(`  → ${features.length} features reçus (page ${pageCount})`);

    // 3. Insertion
    const { inserted, skipped } = await importFeatures(sql, features);
    totalInserted += inserted;
    totalSkipped += skipped;

    console.log(`     ✓ Insérés: ${inserted}  |  Ignorés: ${skipped}`);

    if (features.length < PAGE_SIZE) {
      // Dernière page
      break;
    }

    startIndex += PAGE_SIZE;
  }

  // Résumé
  console.log("\n[3/3] Import terminé.");
  console.log("═".repeat(70));
  console.log(`✅ Total inséré : ${totalInserted} zones`);
  console.log(`⚠  Total ignoré : ${totalSkipped} zones (géométrie nulle ou invalide)`);
  console.log(`\nProchain test :`);
  console.log(
    `  Cherchez "13 Allée du Prado, Marseille" dans l'app — la requête SQL`
  );
  console.log(`  devrait répondre en <5ms au lieu de ~300ms (WFS).`);
}

main().catch((err) => {
  console.error("\n❌ Erreur fatale :", err);
  process.exit(1);
});
