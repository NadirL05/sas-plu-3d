import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { db, DB_AVAILABLE } from "@/src/db";
import { feasibilityStudy } from "@/src/db/schema";
import { getZoneUrba, getParcelPolygon } from "@/src/lib/plu-engine";

export const runtime = "nodejs";

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

  const [zone, parcel] = await Promise.all([
    getZoneUrba(lon, lat).catch((error) => {
      console.warn("[reanalyze] getZoneUrba failed", error);
      return null;
    }),
    getParcelPolygon(lon, lat).catch((error) => {
      console.warn("[reanalyze] parcel lookup failed", error);
      return null;
    }),
  ]);

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
