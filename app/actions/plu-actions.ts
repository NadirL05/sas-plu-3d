"use server";

import { headers } from "next/headers";
import { auth } from "@/src/lib/auth";
import { db } from "@/src/db";
import { projects } from "@/src/db/schema";
import {
  getZoneUrba,
  type ZoneUrba,
  type AddressSuggestion,
} from "@/src/lib/plu-engine";

// ─── Lookup zone (GPU WFS, côté serveur pour éviter les CORS) ─────────────────

export async function lookupZoneAction(
  lon: number,
  lat: number
): Promise<ZoneUrba | null> {
  return getZoneUrba(lon, lat);
}

// ─── Sauvegarde du projet en base ─────────────────────────────────────────────

export interface SaveProjectPayload {
  address: AddressSuggestion;
  zone: ZoneUrba | null;
}

export interface SaveProjectResult {
  success: boolean;
  error?: string;
}

export async function saveProjectAction(
  payload: SaveProjectPayload
): Promise<SaveProjectResult> {
  // Vérification de la session
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return { success: false, error: "Vous devez être connecté pour enregistrer un projet." };
  }

  try {
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
    return { success: false, error: "Erreur lors de l'enregistrement." };
  }
}
