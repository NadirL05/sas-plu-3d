import { and, eq, gte, sql } from "drizzle-orm";
import { db, DB_AVAILABLE } from "@/src/db";
import { feasibilityStudy, projects, subscription, user } from "@/src/db/schema";

export type PlanName = "FREE" | "PRO";

export interface FeasibilityQuota {
  canCreate: boolean;
  limit: number;
  remaining: number;
  plan: PlanName;
}

const FREE_LIMIT = 5;
const PRO_LIMIT = 200;
const ROLLING_WINDOW_DAYS = 30;

export async function getFeasibilityQuota(userId: string): Promise<FeasibilityQuota> {
  if (!DB_AVAILABLE || !db) {
    // Si la base n'est pas disponible, on empêche la création plutôt que de laisser passer.
    return {
      canCreate: false,
      limit: 0,
      remaining: 0,
      plan: "FREE",
    };
  }

  const [userRow] = await db
    .select({
      id: user.id,
      role: user.role,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  let plan: PlanName = "FREE";

  if (userRow) {
    const [activeSubscription] = await db
      .select({
        id: subscription.id,
        status: subscription.status,
        plan: subscription.plan,
      })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, userRow.id),
          eq(subscription.status, "active"),
        ),
      )
      .limit(1);

    if (activeSubscription) {
      plan = "PRO";
    } else if (userRow.role && userRow.role.toUpperCase() === "PRO") {
      // Filet de sécurité si le rôle a été promu manuellement.
      plan = "PRO";
    }
  }

  const limit = plan === "PRO" ? PRO_LIMIT : FREE_LIMIT;

  const now = new Date();
  const windowStart = new Date(now.getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [countRow] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(feasibilityStudy)
    .innerJoin(projects, eq(feasibilityStudy.projectId, projects.id))
    .where(
      and(
        eq(projects.userId, userId),
        gte(feasibilityStudy.createdAt, windowStart),
      ),
    );

  const used = Number(countRow?.count ?? 0);
  const remaining = Math.max(limit - used, 0);

  return {
    canCreate: used < limit,
    limit,
    remaining,
    plan,
  };
}

