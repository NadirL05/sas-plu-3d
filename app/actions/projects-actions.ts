"use server";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/src/lib/auth";
import { db } from "@/src/db";
import { projects } from "@/src/db/schema";

interface ProjectActionResult {
  success: boolean;
  error?: string;
}

async function getCurrentUserId() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    return session?.user?.id ?? null;
  } catch (error) {
    console.warn("[projects.actions] session fallback invite", error);
    return null;
  }
}

export async function deleteProjectAction(projectId: string): Promise<ProjectActionResult> {
  const userId = await getCurrentUserId();

  if (!userId) {
    return { success: false, error: "Vous devez être connecté." };
  }
  if (!db) {
    return { success: false, error: "Base de donnees indisponible (mode invite)." };
  }

  try {
    const deleted = await db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning({ id: projects.id });

    if (!deleted.length) {
      return { success: false, error: "Projet introuvable ou non autorisé." };
    }

    revalidatePath("/dashboard/projects");
    return { success: true };
  } catch (error) {
    console.error("[deleteProjectAction]", error);
    return { success: false, error: "Suppression impossible." };
  }
}

export async function setProjectPriorityAction(
  projectId: string,
  isPriority: boolean
): Promise<ProjectActionResult> {
  const userId = await getCurrentUserId();

  if (!userId) {
    return { success: false, error: "Vous devez être connecté." };
  }
  if (!db) {
    return { success: false, error: "Base de donnees indisponible (mode invite)." };
  }

  try {
    const updated = await db
      .update(projects)
      .set({ isPriority, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning({ id: projects.id });

    if (!updated.length) {
      return { success: false, error: "Projet introuvable ou non autorisé." };
    }

    revalidatePath("/dashboard/projects");
    return { success: true };
  } catch (error) {
    console.error("[setProjectPriorityAction]", error);
    return { success: false, error: "Mise à jour impossible." };
  }
}
