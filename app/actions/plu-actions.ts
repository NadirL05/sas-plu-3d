"use server";

import { headers } from "next/headers";
import { count, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { db } from "@/src/db";
import { projects, user } from "@/src/db/schema";
import {
  getZoneUrba,
  getParcelPolygon,
  getDvfSummaryNearby,
  getGeorisquesNearby,
  PLUEngineError,
  type ZoneUrba,
  type ParcelPolygon,
  type DvfSummary,
  type GeorisquesSummary,
  type AddressSuggestion,
} from "@/src/lib/plu-engine";

// ─── Lookup zone (GPU WFS, côté serveur pour éviter les CORS) ─────────────────

export async function lookupZoneAction(
  lon: number,
  lat: number
): Promise<{ zone: ZoneUrba | null; parcel: ParcelPolygon | null }> {
  const zonePromise = getZoneUrba(lon, lat).catch((err) => {
    if (err instanceof TypeError) {
      console.warn("[lookupZoneAction][zone] fetch failed", err.message);
      return null;
    }

    if (
      err instanceof PLUEngineError &&
      (err.code === "TIMEOUT" || err.code === "WFS_FAILED")
    ) {
      // Le service IGN est souvent intermittent : on garde la suite du flux avec zone=null.
      console.warn("[lookupZoneAction][zone]", err.message);
      return null;
    }
    throw err;
  });
  const parcelPromise = getParcelPolygon(lon, lat).catch((err) => {
    // La parcelle n'est pas bloquante pour l'analyse PLU.
    console.error("[lookupZoneAction][parcel]", err);
    return null;
  });

  const [zone, parcel] = await Promise.all([zonePromise, parcelPromise]);
  return { zone, parcel };
}

export async function lookupDvfAction(
  lon: number,
  lat: number
): Promise<DvfSummary | null> {
  try {
    return await getDvfSummaryNearby(lon, lat);
  } catch (err) {
    if (err instanceof TypeError) {
      console.warn("[lookupDvfAction] fetch failed", err.message);
      return null;
    }

    if (
      err instanceof PLUEngineError &&
      (err.code === "TIMEOUT" || err.code === "CADASTRE_FAILED")
    ) {
      console.warn("[lookupDvfAction]", err.message);
      return null;
    }

    console.error("[lookupDvfAction] unexpected", err);
    return null;
  }
}

export async function lookupGeorisquesAction(
  lon: number,
  lat: number
): Promise<GeorisquesSummary | null> {
  try {
    return await getGeorisquesNearby(lon, lat);
  } catch (err) {
    if (err instanceof TypeError) {
      console.warn("[lookupGeorisquesAction] fetch failed", err.message);
      return null;
    }

    if (
      err instanceof PLUEngineError &&
      (err.code === "TIMEOUT" || err.code === "INVALID_COORDS")
    ) {
      console.warn("[lookupGeorisquesAction]", err.message);
      return null;
    }

    console.error("[lookupGeorisquesAction] unexpected", err);
    return null;
  }
}

// ─── Sauvegarde du projet en base ─────────────────────────────────────────────

export interface SaveProjectPayload {
  address: AddressSuggestion;
  zone: ZoneUrba | null;
}

export interface SaveProjectResult {
  success: boolean;
  code?: "AUTH_REQUIRED" | "USER_NOT_FOUND" | "PROJECT_LIMIT_REACHED" | "SAVE_ERROR";
  error?: string;
}

export async function saveProjectAction(
  payload: SaveProjectPayload
): Promise<SaveProjectResult> {
  // Vérification de la session
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[saveProjectAction] session fallback invite", error);
  }

  if (!session?.user?.id) {
    return {
      success: false,
      code: "AUTH_REQUIRED",
      error: "Vous devez être connecté pour enregistrer un projet.",
    };
  }

  if (!db) {
    return {
      success: false,
      code: "SAVE_ERROR",
      error: "Base de donnees non configuree (mode invite).",
    };
  }

  try {
    const [currentUser] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);

    if (!currentUser) {
      return { success: false, code: "USER_NOT_FOUND", error: "Compte introuvable." };
    }

    if (currentUser.role === "FREE") {
      const [result] = await db
        .select({ total: count() })
        .from(projects)
        .where(eq(projects.userId, session.user.id));

      if ((result?.total ?? 0) >= 3) {
        return {
          success: false,
          code: "PROJECT_LIMIT_REACHED",
          error: "Limite atteinte, passez en PRO",
        };
      }
    }

    await db.insert(projects).values({
      name: payload.address.label,
      userId: session.user.id,
      metadata: {
        address: {
          label: payload.address.label,
          lon: payload.address.lon,
          lat: payload.address.lat,
          inseeCode: payload.address.inseeCode,
          city: payload.address.city,
          postcode: payload.address.postcode,
        },
        zone: payload.zone
          ? {
              libelle: payload.zone.libelle,
              typezone: payload.zone.typezone,
              commune: payload.zone.commune,
              nomfic: payload.zone.nomfic,
              urlfic: payload.zone.urlfic,
              datappro: payload.zone.datappro,
            }
          : null,
        savedAt: new Date().toISOString(),
      },
    });

    return { success: true };
  } catch (err) {
    console.error("[saveProjectAction]", err);
    return { success: false, code: "SAVE_ERROR", error: "Erreur lors de l'enregistrement." };
  }
}
