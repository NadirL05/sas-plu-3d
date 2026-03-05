import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { db, DB_AVAILABLE } from "@/src/db";
import { feasibilityStudy } from "@/src/db/schema";
import {
  lookupPLU,
  getDvfSummaryNearby,
  getGeorisquesNearby,
  computeProfitabilityScore,
  PLUEngineError,
  searchAddresses,
  getParcelPolygon,
  type DvfSummary,
  type GeorisquesSummary,
  type PromoterBalance,
} from "@/src/lib/plu-engine";

export const runtime = "nodejs";

interface FeasibilityPayload {
  address: string;
  projectId?: string;
}

export async function POST(request: NextRequest) {
  if (!DB_AVAILABLE || !db) {
    return NextResponse.json(
      { error: "DB_UNAVAILABLE", message: "Base de données non configurée." },
      { status: 503 },
    );
  }

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[feasibility] session fallback invite", error);
  }

  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Utilisateur non authentifié." },
      { status: 401 },
    );
  }

  let payload: FeasibilityPayload;
  try {
    payload = (await request.json()) as FeasibilityPayload;
  } catch {
    return NextResponse.json(
      { error: "INVALID_PAYLOAD", message: "Payload JSON invalide." },
      { status: 400 },
    );
  }

  const addressInput = payload.address?.trim();
  if (!addressInput || addressInput.length < 5) {
    return NextResponse.json(
      { error: "INVALID_ADDRESS", message: "Adresse manquante ou trop courte." },
      { status: 400 },
    );
  }

  let pluResult:
    | Awaited<ReturnType<typeof lookupPLU>>
    | {
        address: Awaited<ReturnType<typeof searchAddresses>>[number];
        zone: null;
        parcel: Awaited<ReturnType<typeof getParcelPolygon>>;
      }
    | null = null;

  try {
    pluResult = await lookupPLU(addressInput);
  } catch (error) {
    if (error instanceof PLUEngineError) {
      if (error.code === "GEOCODE_FAILED") {
        return NextResponse.json(
          { error: "GEOCODE_FAILED", message: "Service de géocodage indisponible." },
          { status: 502 },
        );
      }
      if (error.code === "INVALID_COORDS") {
        return NextResponse.json(
          { error: "INVALID_COORDS", message: "Coordonnées invalides pour cette adresse." },
          { status: 400 },
        );
      }
      if (error.code === "TIMEOUT") {
        return NextResponse.json(
          {
            error: "TIMEOUT",
            message: "Délai dépassé sur les services externes, réessayez.",
          },
          { status: 504 },
        );
      }
      if (error.code === "WFS_FAILED") {
        // Fallback : géocoder + récupérer la parcelle, mais sans zonage PLU.
        const suggestions = await searchAddresses(addressInput, 1);
        const best = suggestions[0];
        if (!best) {
          return NextResponse.json(
            {
              error: "ADDRESS_NOT_FOUND",
              message: "Aucune zone PLU trouvée pour cette adresse.",
            },
            { status: 404 },
          );
        }
        const parcel = await getParcelPolygon(best.lon, best.lat);
        pluResult = { address: best, zone: null, parcel };
      } else {
        return NextResponse.json(
          {
            error: "PLU_ENGINE_ERROR",
            code: error.code,
            message: error.message,
          },
          { status: 500 },
        );
      }
    } else {
      console.error("[feasibility][lookupPLU] unexpected", error);
      return NextResponse.json(
        {
          error: "PLU_ENGINE_ERROR",
          message:
            "Erreur inattendue lors de l'analyse PLU. Merci de réessayer dans quelques instants.",
        },
        { status: 500 },
      );
    }
  }

  if (!pluResult) {
    return NextResponse.json(
      {
        error: "ADDRESS_NOT_FOUND",
        message: "Aucune zone PLU trouvée pour cette adresse.",
      },
      { status: 404 },
    );
  }

  const { address, zone, parcel } = pluResult;
  const lon = address.lon;
  const lat = address.lat;

  try {
    const [dvf, risks] = (await Promise.all([
      getDvfSummaryNearby(lon, lat),
      getGeorisquesNearby(lon, lat),
    ])) as [DvfSummary | null, GeorisquesSummary | null];

    const promoterBalance: PromoterBalance | null = computeProfitabilityScore({
      parcelAreaM2: parcel?.areaM2 ?? null,
      coveragePct: 50,
      maxHeightM: null,
      medianDvfValueEur: dvf?.medianValueEur ?? null,
      medianSalePricePerM2Eur: dvf?.medianPricePerM2Eur ?? null,
    });

    const [study] = await db
      .insert(feasibilityStudy)
      .values({
        userId,
        projectId: payload.projectId ?? null,
        address: address.label,
        lon: String(address.lon),
        lat: String(address.lat),
        inseeCode: address.inseeCode || null,
        zoning: zone ?? null,
        parcel: parcel ?? null,
        dvfSummary: dvf ?? null,
        georisquesSummary: risks ?? null,
        promoterBalance: promoterBalance ?? null,
      })
      .returning();

    return NextResponse.json(
      {
        id: study.id,
        projectId: study.projectId,
        address,
        zoning: zone,
        parcel,
        dvf,
        risks,
        promoterBalance,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PLUEngineError && error.code === "TIMEOUT") {
      return NextResponse.json(
        {
          error: "TIMEOUT",
          message: "Délai dépassé sur les services externes, réessayez.",
        },
        { status: 504 },
      );
    }

    const isDbError =
      error instanceof Error &&
      (error.message.toLowerCase().includes("connection") ||
        error.message.toLowerCase().includes("econnrefused") ||
        error.message.toLowerCase().includes("relation"));

    if (isDbError) {
      console.error("[feasibility] DB insert failed", error);
      return NextResponse.json(
        {
          error: "DB_ERROR",
          message: "Impossible de sauvegarder l'étude.",
        },
        { status: 503 },
      );
    }

    console.error("[feasibility] unexpected error during DVF/Georisques/insert", error);
    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: "Erreur inattendue lors de la création de l'étude de faisabilité.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (!DB_AVAILABLE || !db) {
    return NextResponse.json(
      { error: "DB_UNAVAILABLE", message: "Base de données non configurée." },
      { status: 503 },
    );
  }

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[feasibility.list] session fallback invite", error);
  }

  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Utilisateur non authentifié." },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = Math.min(Number(limitParam ?? "20") || 20, 50);
  const projectId = searchParams.get("projectId") ?? null;

  const conditions = [eq(feasibilityStudy.userId, userId)];
  if (projectId) {
    conditions.push(eq(feasibilityStudy.projectId, projectId));
  }

  const studies = await db
    .select({
      id: feasibilityStudy.id,
      address: feasibilityStudy.address,
      inseeCode: feasibilityStudy.inseeCode,
      status: feasibilityStudy.status,
      note: feasibilityStudy.note,
      projectId: feasibilityStudy.projectId,
      zoning: feasibilityStudy.zoning,
      promoterBalance: feasibilityStudy.promoterBalance,
      createdAt: feasibilityStudy.createdAt,
    })
    .from(feasibilityStudy)
    .where(and(...conditions))
    .orderBy(desc(feasibilityStudy.createdAt))
    .limit(limit);

  return NextResponse.json({ studies }, { status: 200 });
}

