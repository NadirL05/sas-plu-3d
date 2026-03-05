import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { db, DB_AVAILABLE } from "@/src/db";
import { feasibilityScenario, feasibilityStudy } from "@/src/db/schema";
import {
  computeProfitabilityScore,
  type DvfSummary,
  type ParcelPolygon,
  type PromoterBalance,
} from "@/src/lib/plu-engine";

export const runtime = "nodejs";

interface ScenarioPayload {
  name: string;
  coveragePct: number;
  maxHeightM: number;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!DB_AVAILABLE || !db) {
    return NextResponse.json(
      { error: "DB_UNAVAILABLE", message: "Base de données non configurée." },
      { status: 503 },
    );
  }

  const { id: studyId } = await context.params;
  if (!studyId) {
    return NextResponse.json(
      { error: "INVALID_STUDY_ID", message: "Identifiant d'étude manquant." },
      { status: 400 },
    );
  }

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[feasibility.scenario] session fallback invite", error);
  }

  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Utilisateur non authentifié." },
      { status: 401 },
    );
  }

  let payload: ScenarioPayload;
  try {
    payload = (await request.json()) as ScenarioPayload;
  } catch {
    return NextResponse.json(
      { error: "INVALID_PAYLOAD", message: "Payload JSON invalide." },
      { status: 400 },
    );
  }

  const name = payload.name?.trim();
  const coveragePct = Number(payload.coveragePct);
  const maxHeightM = Number(payload.maxHeightM);

  if (!name || name.length < 2) {
    return NextResponse.json(
      { error: "INVALID_NAME", message: "Le nom du scénario doit contenir au moins 2 caractères." },
      { status: 400 },
    );
  }

  if (!Number.isFinite(coveragePct) || coveragePct <= 0) {
    return NextResponse.json(
      {
        error: "INVALID_COVERAGE",
        message: "Le pourcentage d'emprise doit être un nombre strictement positif.",
      },
      { status: 400 },
    );
  }

  if (!Number.isFinite(maxHeightM) || maxHeightM <= 0) {
    return NextResponse.json(
      {
        error: "INVALID_HEIGHT",
        message: "La hauteur maximale doit être un nombre strictement positif.",
      },
      { status: 400 },
    );
  }

  const [study] = await db
    .select()
    .from(feasibilityStudy)
    .where(and(eq(feasibilityStudy.id, studyId), eq(feasibilityStudy.userId, userId)))
    .limit(1);

  if (!study) {
    return NextResponse.json(
      {
        error: "STUDY_NOT_FOUND",
        message: "Étude introuvable ou n'appartenant pas à l'utilisateur courant.",
      },
      { status: 404 },
    );
  }

  const baseParcel = study.parcel as ParcelPolygon | null;
  const baseDvf = study.dvfSummary as DvfSummary | null;

  const parcelAreaM2 = baseParcel?.areaM2 ?? null;
  const medianDvfValueEur = baseDvf?.medianValueEur ?? null;
  const medianSalePricePerM2Eur = baseDvf?.medianPricePerM2Eur ?? null;

  const promoterBalance: PromoterBalance | null = computeProfitabilityScore({
    parcelAreaM2,
    coveragePct,
    maxHeightM,
    medianDvfValueEur,
    medianSalePricePerM2Eur,
  });

  if (!promoterBalance) {
    return NextResponse.json(
      {
        error: "UNCOMPUTABLE_SCENARIO",
        message:
          "Impossible de calculer un bilan promoteur pour ce scénario (surface ou DVF insuffisantes).",
      },
      { status: 400 },
    );
  }

  try {
    const [inserted] = await db
      .insert(feasibilityScenario)
      .values({
        feasibilityStudyId: study.id,
        name,
        coveragePct: Math.round(coveragePct),
        maxHeightM: Math.round(maxHeightM),
        promoterBalance,
      })
      .returning({
        id: feasibilityScenario.id,
        name: feasibilityScenario.name,
        coveragePct: feasibilityScenario.coveragePct,
        maxHeightM: feasibilityScenario.maxHeightM,
        promoterBalance: feasibilityScenario.promoterBalance,
        createdAt: feasibilityScenario.createdAt,
      });

    return NextResponse.json(inserted, { status: 201 });
  } catch (error) {
    console.error("[feasibility.scenario] failed to insert scenario", error);
    return NextResponse.json(
      {
        error: "PERSISTENCE_ERROR",
        message: "Impossible d'enregistrer le scénario de faisabilité.",
      },
      { status: 500 },
    );
  }
}

