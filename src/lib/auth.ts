import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { stripe } from "@better-auth/stripe";
import { dash } from "@better-auth/infra";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { DB_AVAILABLE, db } from "@/src/db";
import * as schema from "@/src/db/schema";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? "";
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const stripeProPriceId = process.env.STRIPE_PRO_PRICE_ID ?? "";
const DEFAULT_BASE_URL = "http://localhost:3000";

function normalizeOrigin(value: string | undefined | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalizedValue =
    /^https?:\/\//i.test(trimmed)
      ? trimmed
      : trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1")
      ? `http://${trimmed}`
      : `https://${trimmed}`;

  try {
    return new URL(normalizedValue).origin;
  } catch {
    return null;
  }
}

function buildTrustedOrigins() {
  const origins = new Set<string>();

  const candidates = [
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
    DEFAULT_BASE_URL,
    "http://127.0.0.1:3000",
  ];

  for (const candidate of candidates) {
    const origin = normalizeOrigin(candidate);
    if (origin) origins.add(origin);
  }

  return Array.from(origins);
}

const authBaseURL =
  normalizeOrigin(process.env.BETTER_AUTH_URL) ??
  normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL) ??
  normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
  normalizeOrigin(process.env.VERCEL_URL) ??
  DEFAULT_BASE_URL;

export const STRIPE_BILLING_ENABLED =
  DB_AVAILABLE &&
  stripeSecretKey.length > 0 &&
  stripeWebhookSecret.length > 0 &&
  stripeProPriceId.length > 0;

async function setUserRole(referenceId: string, role: "FREE" | "PRO") {
  if (!db) return;

  await db
    .update(schema.user)
    .set({ role, updatedAt: new Date() })
    .where(eq(schema.user.id, referenceId));
}

const stripePlugins = STRIPE_BILLING_ENABLED
  ? [
      stripe({
        stripeClient: new Stripe(stripeSecretKey),
        stripeWebhookSecret,
        subscription: {
          enabled: true,
          plans: [
            {
              name: "pro",
              priceId: stripeProPriceId,
              limits: {
                projects: "unlimited",
              },
            },
          ],
          onSubscriptionComplete: async ({ subscription }) => {
            await setUserRole(subscription.referenceId, "PRO");
          },
          onSubscriptionUpdate: async ({ subscription }) => {
            const isActive = subscription.status === "active" || subscription.status === "trialing";
            await setUserRole(subscription.referenceId, isActive ? "PRO" : "FREE");
          },
          onSubscriptionDeleted: async ({ subscription }) => {
            await setUserRole(subscription.referenceId, "FREE");
          },
        },
      }),
    ]
  : [];

if (!STRIPE_BILLING_ENABLED) {
  console.warn(
    "[auth] Stripe billing is disabled. Configure DB + STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET + STRIPE_PRO_PRICE_ID."
  );
}

const guestAuth = {
  api: {
    async getSession() {
      return null;
    },
    async listActiveSubscriptions() {
      return [];
    },
  },
};

export const auth = db
  ? betterAuth({
      baseURL: authBaseURL,
      trustedOrigins: buildTrustedOrigins(),
      database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
          user: schema.user,
          session: schema.session,
          account: schema.account,
          verification: schema.verification,
          subscription: schema.subscription,
        },
      }),
      emailAndPassword: {
        enabled: true,
      },
      plugins: [...stripePlugins, dash()],
    })
  : (guestAuth as unknown as ReturnType<typeof betterAuth>);
