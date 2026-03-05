import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  jsonb,
  boolean,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import type {
  ZoneUrba,
  ParcelPolygon,
  DvfSummary,
  GeorisquesSummary,
  PromoterBalance,
} from "../lib/plu-engine";

// Tables better-auth
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: text("role").default("FREE").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  isPriority: boolean("is_priority").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

export const feasibilityStudy = pgTable(
  "feasibility_study",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Adresse
    address: text("address").notNull(),
    lon: text("lon").notNull(),
    lat: text("lat").notNull(),
    inseeCode: text("insee_code"),
    // Snapshots JSON des résultats APIs
    zoning: jsonb("zoning").$type<ZoneUrba | null>(),
    parcel: jsonb("parcel").$type<ParcelPolygon | null>(),
    dvfSummary: jsonb("dvf_summary").$type<DvfSummary | null>(),
    georisquesSummary: jsonb("georisques_summary").$type<GeorisquesSummary | null>(),
    promoterBalance: jsonb("promoter_balance").$type<PromoterBalance | null>(),
    // Champs produit
    status: text("status", { enum: ["PENDING", "GO", "NO_GO"] })
      .$type<"PENDING" | "GO" | "NO_GO">()
      .default("PENDING")
      .notNull(),
    note: text("note"),
    publicShareId: text("public_share_id").unique(),
    publicShareEnabled: boolean("public_share_enabled").default(false).notNull(),
    aiSummary: jsonb("ai_summary").$type<{
      synthesis: string;
      watchPoints: string[];
      recommendations: string[];
    } | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("feasibility_study_user_id_idx").on(table.userId),
    index("feasibility_study_project_id_idx").on(table.projectId),
    index("feasibility_study_public_share_id_idx").on(table.publicShareId),
  ],
);

export const feasibilityScenario = pgTable(
  "feasibility_scenario",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feasibilityStudyId: uuid("feasibility_study_id")
      .notNull()
      .references(() => feasibilityStudy.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    coveragePct: integer("coverage_pct").notNull(),
    maxHeightM: integer("max_height_m").notNull(),
    promoterBalance: jsonb("promoter_balance").$type<PromoterBalance | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("feasibility_scenario_study_id_idx").on(table.feasibilityStudyId)],
);

export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    plan: text("plan").notNull(),
    referenceId: text("reference_id").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").default("incomplete").notNull(),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    trialStart: timestamp("trial_start"),
    trialEnd: timestamp("trial_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    cancelAt: timestamp("cancel_at"),
    canceledAt: timestamp("canceled_at"),
    endedAt: timestamp("ended_at"),
    seats: integer("seats"),
    billingInterval: text("billing_interval"),
    stripeScheduleId: text("stripe_schedule_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("subscription_reference_id_idx").on(table.referenceId),
    index("subscription_stripe_customer_id_idx").on(table.stripeCustomerId),
    index("subscription_stripe_subscription_id_idx").on(table.stripeSubscriptionId),
  ],
);


export const pluAiCache = pgTable("plu_ai_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  urlfic: text("urlfic").notNull().unique(),
  ces: text("ces").notNull(),
  retrait: text("retrait").notNull(),
  espacesVerts: text("espaces_verts").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
// Relations
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  projects: many(projects),
  subscriptions: many(subscription),
  feasibilityStudies: many(feasibilityStudy),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(user, {
    fields: [projects.userId],
    references: [user.id],
  }),
  feasibilityStudies: many(feasibilityStudy),
}));

export const feasibilityStudyRelations = relations(feasibilityStudy, ({ one, many }) => ({
  project: one(projects, {
    fields: [feasibilityStudy.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [feasibilityStudy.userId],
    references: [user.id],
  }),
  scenarios: many(feasibilityScenario),
}));

export const feasibilityScenarioRelations = relations(feasibilityScenario, ({ one }) => ({
  study: one(feasibilityStudy, {
    fields: [feasibilityScenario.feasibilityStudyId],
    references: [feasibilityStudy.id],
  }),
}));

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  user: one(user, {
    fields: [subscription.referenceId],
    references: [user.id],
  }),
}));

// Objet schema global (tables + relations)
export const schema = {
  user,
  session,
  account,
  verification,
  projects,
  feasibilityStudy,
  feasibilityScenario,
  subscription,
  pluAiCache,
  userRelations,
  sessionRelations,
  accountRelations,
  projectsRelations,
  feasibilityStudyRelations,
  feasibilityScenarioRelations,
  subscriptionRelations,
};
