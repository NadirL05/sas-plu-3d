import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { auth } from "@/src/lib/auth";
import { db, DB_AVAILABLE } from "@/src/db";
import { feasibilityStudy } from "@/src/db/schema";

export const runtime = "nodejs";

interface SharePayload {
  enabled?: boolean;
  regenerate?: boolean;
}

function generatePublicShareId(): string {
  // Token court, non sensible, type nanoid-like pour URL publique.
  return randomBytes(16).toString("base64url");
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
    console.warn("[feasibility.share] session fallback invite", error);
  }

  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Utilisateur non authentifié." },
      { status: 401 },
    );
  }

  let payload: SharePayload;
  try {
    payload = (await request.json()) as SharePayload;
  } catch {
    return NextResponse.json(
      { error: "INVALID_PAYLOAD", message: "Payload JSON invalide." },
      { status: 400 },
    );
  }

  const hasEnabled = typeof payload.enabled === "boolean";
  const regenerate = payload.regenerate === true;

  if (!hasEnabled && !regenerate) {
    return NextResponse.json(
      {
        error: "NO_FIELDS",
        message: "Aucun champ à mettre à jour (enabled ou regenerate requis).",
      },
      { status: 400 },
    );
  }

  const [row] = await db
    .select({
      id: feasibilityStudy.id,
      publicShareId: feasibilityStudy.publicShareId,
      publicShareEnabled: feasibilityStudy.publicShareEnabled,
    })
    .from(feasibilityStudy)
    .where(and(eq(feasibilityStudy.id, studyId), eq(feasibilityStudy.userId, userId)))
    .limit(1);

  if (!row) {
    return NextResponse.json(
      {
        error: "STUDY_NOT_FOUND",
        message: "Étude introuvable ou n'appartenant pas à l'utilisateur courant.",
      },
      { status: 404 },
    );
  }

  let nextPublicShareId = row.publicShareId ?? null;
  let nextEnabled = row.publicShareEnabled;

  if (hasEnabled) {
    nextEnabled = payload.enabled as boolean;
  }

  if ((payload.enabled === true && !row.publicShareId) || regenerate) {
    nextPublicShareId = generatePublicShareId();
    nextEnabled = true;
  }

  try {
    const [updated] = await db
      .update(feasibilityStudy)
      .set({
        publicShareId: nextPublicShareId,
        publicShareEnabled: nextEnabled,
      })
      .where(eq(feasibilityStudy.id, row.id))
      .returning({
        id: feasibilityStudy.id,
        publicShareId: feasibilityStudy.publicShareId,
        publicShareEnabled: feasibilityStudy.publicShareEnabled,
      });

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    console.error("[feasibility.share] failed to update share settings", error);
    return NextResponse.json(
      {
        error: "PERSISTENCE_ERROR",
        message: "Impossible de mettre à jour le lien de partage public.",
      },
      { status: 500 },
    );
  }
}

