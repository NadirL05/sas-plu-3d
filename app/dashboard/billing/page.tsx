import Link from "next/link";
import { headers } from "next/headers";
import { CreditCard, ShieldCheck, Sparkles } from "lucide-react";
import { auth } from "@/src/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckoutButton } from "./_components/checkout-button";

export const metadata = {
  title: "Billing - SAS PLU 3D",
  description: "Gestion du plan FREE/PRO et abonnement Stripe.",
};

type BillingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const checkoutState = Array.isArray(resolvedSearchParams.checkout)
    ? resolvedSearchParams.checkout[0]
    : resolvedSearchParams.checkout;

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[billing.page] session fallback invite", error);
  }

  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="glass ultra-fine-border rounded-xl p-6 space-y-4">
          <h1 className="text-lg font-semibold">Connexion requise</h1>
          <p className="text-sm text-muted-foreground">
            Vous devez être connecté pour accéder à la facturation.
          </p>
          <Button asChild>
            <Link href="/dashboard">Retour au dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  let activeSubscriptions: Awaited<ReturnType<typeof auth.api.listActiveSubscriptions>> = [];
  try {
    activeSubscriptions = await auth.api.listActiveSubscriptions({
      headers: await headers(),
    });
  } catch (error) {
    console.warn("[billing.page] subscriptions fallback []", error);
  }

  const mainSubscription = activeSubscriptions[0];
  const isPro =
    mainSubscription?.status === "active" || mainSubscription?.status === "trialing";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Facturation</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Gérez votre abonnement Stripe et votre plan de compte.
        </p>
      </header>

      {checkoutState === "success" ? (
        <div className="glass ultra-fine-border rounded-lg px-4 py-3 text-sm border-l-4 border-l-emerald-500">
          Paiement confirmé. Votre statut PRO sera actif après réception du webhook Stripe.
        </div>
      ) : null}

      {checkoutState === "cancel" ? (
        <div className="glass ultra-fine-border rounded-lg px-4 py-3 text-sm border-l-4 border-l-zinc-500">
          Paiement annulé.
        </div>
      ) : null}

      <div className="glass ultra-fine-border rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Plan actuel</h2>
          <Badge variant={isPro ? "default" : "outline"}>{isPro ? "PRO" : "FREE"}</Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg ultra-fine-border bg-white/5 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Compte</p>
            <p className="mt-1 text-sm font-medium">{session.user.email}</p>
          </div>
          <div className="rounded-lg ultra-fine-border bg-white/5 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Accès</p>
            <p className="mt-1 text-sm font-medium">
              {isPro ? "Abonnement actif" : "Limité à 3 projets"}
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-lg ultra-fine-border bg-white/5 p-4 text-sm">
          <p className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            Statut Better-Auth calculé via `auth.api.listActiveSubscriptions`
          </p>
          <p>
            Plan Stripe: <span className="font-medium">{mainSubscription?.plan ?? "Aucun"}</span>
          </p>
          <p>
            Statut Stripe:{" "}
            <span className="font-medium">{mainSubscription?.status ?? "inactive"}</span>
          </p>
          <p>
            Période:{" "}
            <span className="font-medium">
              {mainSubscription?.periodStart?.toLocaleDateString("fr-FR") ?? "-"} {"->"}{" "}
              {mainSubscription?.periodEnd?.toLocaleDateString("fr-FR") ?? "-"}
            </span>
          </p>
        </div>

        {!isPro ? (
          <div className="flex items-center justify-between gap-3 rounded-lg ultra-fine-border bg-primary/10 p-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Plan PRO - 49EUR/mois
              </p>
              <p className="text-xs text-muted-foreground">
                Projets illimités et fonctionnalités avancées.
              </p>
            </div>
            <CheckoutButton />
          </div>
        ) : null}
      </div>
    </div>
  );
}
