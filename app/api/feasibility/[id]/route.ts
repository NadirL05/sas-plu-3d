import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { db, DB_AVAILABLE } from "@/src/db";
import { feasibilityStudy } from "@/src/db/schema";

export const runtime = "nodejs";

type FeasibilityStatus = "PENDING" | "GO" | "NO_GO";

interface UpdateFeasibilityPayload {
  status?: FeasibilityStatus;
  note?: string;
}

export async function GET(
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
    console.warn("[feasibility.update] session fallback invite", error);
  }

  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Utilisateur non authentifié." },
      { status: 401 },
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

  return NextResponse.json(study, { status: 200 });
}

export async function PATCH(
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
    console.warn("[feasibility.update] session fallback invite", error);
  }

  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Utilisateur non authentifié." },
      { status: 401 },
    );
  }

  let payload: UpdateFeasibilityPayload;
  try {
    payload = (await request.json()) as UpdateFeasibilityPayload;
  } catch {
    return NextResponse.json(
      { error: "INVALID_PAYLOAD", message: "Payload JSON invalide." },
      { status: 400 },
    );
  }

  const hasStatus = typeof payload.status === "string";
  const hasNote = typeof payload.note === "string";

  if (!hasStatus && !hasNote) {
    return NextResponse.json(
      {
        error: "NO_FIELDS",
        message: "Aucun champ à mettre à jour (status ou note requis).",
      },
      { status: 400 },
    );
  }

  let nextStatus: FeasibilityStatus | undefined;
  if (hasStatus) {
    const allowed: FeasibilityStatus[] = ["PENDING", "GO", "NO_GO"];
    if (!allowed.includes(payload.status as FeasibilityStatus)) {
      return NextResponse.json(
        {
          error: "INVALID_STATUS",
          message: "Statut invalide. Utilisez PENDING, GO ou NO_GO.",
        },
        { status: 400 },
      );
    }
    nextStatus = payload.status as FeasibilityStatus;
  }

  let nextNote: string | undefined;
  if (hasNote) {
    const trimmed = (payload.note ?? "").trim();
    if (trimmed.length > 500) {
      return NextResponse.json(
        {
          error: "NOTE_TOO_LONG",
          message: "La note ne doit pas dépasser 500 caractères.",
        },
        { status: 400 },
      );
    }
    nextNote = trimmed;
  }

  try {
    const [updated] = await db
      .update(feasibilityStudy)
      .set({
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(hasNote ? { note: nextNote ?? null } : {}),
      })
      .where(and(eq(feasibilityStudy.id, studyId), eq(feasibilityStudy.userId, userId)))
      .returning({
        id: feasibilityStudy.id,
        status: feasibilityStudy.status,
        note: feasibilityStudy.note,
      });

    if (!updated) {
      return NextResponse.json(
        { error: "STUDY_NOT_FOUND", message: "Étude introuvable." },
        { status: 404 },
      );
    }

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    console.error("[feasibility.update] failed to update study", error);
    return NextResponse.json(
      {
        error: "PERSISTENCE_ERROR",
        message: "Impossible de mettre à jour cette étude.",
      },
      { status: 500 },
    );
  }
}

