import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { db, DB_AVAILABLE } from "@/src/db";
import { feasibilityStudy } from "@/src/db/schema";
import { getZoneUrba, getParcelPolygon } from "@/src/lib/plu-engine";

export const runtime = "nodejs";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) {
      throw new Error(`WFS HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function pickStringProperty(
  properties: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function buildGpuFileUrl(documentId: string, filename: string): string {
  return `https://www.geoportail-urbanisme.gouv.fr/api/document/${encodeURIComponent(
    documentId,
  )}/files/${encodeURIComponent(filename)}`;
}

function parseZoneFromWfsPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as { features?: Array<{ properties?: Record<string, unknown> }> };
  const properties = data.features?.[0]?.properties;
  if (!properties || typeof properties !== "object") return null;

  const nomfic = pickStringProperty(properties, ["nomfic", "NOMFIC"]);
  const urlfic =
    pickStringProperty(properties, ["urlfic", "URLFIC"]) ??
    (() => {
      const gpuDocId = pickStringProperty(properties, ["gpu_doc_id", "GPU_DOC_ID"]);
      if (!gpuDocId || !nomfic) return undefined;
      return buildGpuFileUrl(gpuDocId, nomfic);
    })();

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
      pickStringProperty(properties, ["typezone", "TYPEZONE", "type_zone", "TYPE_ZONE"]) ?? "N/A",
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
    nomfic,
    urlfic,
    datappro: pickStringProperty(properties, ["datappro", "DATAPPRO"]),
  };
}

async function fetchZoneEmergency(lon: number, lat: number) {
  const base = "https://data.geopf.fr/wfs/ows";

  const latLonParams = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName: "wfs_du:zone_urba",
    outputFormat: "application/json",
    CQL_FILTER: `INTERSECTS(the_geom,POINT(${lat} ${lon}))`,
    maxFeatures: "1",
  });

  const lonLatParams = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName: "wfs_du:zone_urba",
    outputFormat: "application/json",
    CQL_FILTER: `INTERSECTS(the_geom,POINT(${lon} ${lat}))`,
    maxFeatures: "1",
  });

  const candidates = [
    `${base}?${latLonParams.toString()}`,
    `${base}?${lonLatParams.toString()}`,
  ];

  let lastError: unknown = null;

  for (const url of candidates) {
    try {
      const json = await fetchJsonWithTimeout(url, 15_000);
      const zone = parseZoneFromWfsPayload(json);
      if (zone) return zone;
    } catch (error) {
      lastError = error;
      console.warn("[reanalyze][fetchZoneEmergency] WFS failed", url, error);
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!DB_AVAILABLE || !db) {
    return NextResponse.json(
      { error: "DB_UNAVAILABLE", message: "Base de données non configurée." },
      { status: 503 },
    );
  }

  const { id: studyId } = await context.params;

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[reanalyze] session fallback", error);
  }

  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Utilisateur non authentifié." },
      { status: 401 },
    );
  }

  const [study] = await db
    .select({
      id: feasibilityStudy.id,
      lon: feasibilityStudy.lon,
      lat: feasibilityStudy.lat,
      zoning: feasibilityStudy.zoning,
    })
    .from(feasibilityStudy)
    .where(and(eq(feasibilityStudy.id, studyId), eq(feasibilityStudy.userId, userId)))
    .limit(1);

  if (!study) {
    return NextResponse.json(
      { error: "STUDY_NOT_FOUND", message: "Étude introuvable." },
      { status: 404 },
    );
  }

  const lon = Number(study.lon);
  const lat = Number(study.lat);

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json(
      { error: "INVALID_COORDS", message: "Coordonnées de l'étude invalides." },
      { status: 400 },
    );
  }

  const parcelPromise = getParcelPolygon(lon, lat).catch((error) => {
    console.warn("[reanalyze] parcel lookup failed", error);
    return null;
  });

  let zone = null;
  let zoneError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      zone = await getZoneUrba(lon, lat);
      if (zone) break;
    } catch (error) {
      zoneError = error;
      console.warn(`[reanalyze] getZoneUrba failed (attempt ${attempt + 1}/3)`, error);
    }
    if (attempt < 2) await delay(250 * (attempt + 1));
  }

  if (!zone) {
    try {
      zone = await fetchZoneEmergency(lon, lat);
    } catch (error) {
      zoneError = error;
    }
  }

  if (!zone && zoneError) {
    return NextResponse.json(
      {
        error: "ZONE_LOOKUP_FAILED",
        message: "Service PLU temporairement indisponible. Réessayez dans quelques secondes.",
      },
      { status: 502 },
    );
  }

  const parcel = await parcelPromise;
  const currentZoning = (study.zoning ?? null) as Record<string, unknown> | null;

  await db
    .update(feasibilityStudy)
    .set({
      zoning: (zone ?? currentZoning ?? null) as Record<string, unknown> | null,
      parcel: parcel ?? null,
    })
    .where(and(eq(feasibilityStudy.id, studyId), eq(feasibilityStudy.userId, userId)));

  return NextResponse.json({ zoning: zone, parcel }, { status: 200 });
}
