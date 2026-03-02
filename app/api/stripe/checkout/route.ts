import { NextRequest, NextResponse } from "next/server";
import { auth, STRIPE_BILLING_ENABLED } from "@/src/lib/auth";

export const runtime = "nodejs";

function getAppUrl(request: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    `${request.nextUrl.protocol}//${request.nextUrl.host}`
  );
}

export async function POST(request: NextRequest) {
  const stripeProPriceId = process.env.STRIPE_PRO_PRICE_ID ?? "";

  if (!stripeProPriceId) {
    return NextResponse.json(
      { error: "STRIPE_PRO_PRICE_ID est manquant dans .env.local." },
      { status: 503 }
    );
  }

  if (!STRIPE_BILLING_ENABLED) {
    return NextResponse.json(
      {
        error:
          "Stripe n'est pas configuré. Ajoutez STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET et STRIPE_PRO_PRICE_ID.",
      },
      { status: 503 }
    );
  }

  const appUrl = getAppUrl(request);

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({
      headers: request.headers,
    });
  } catch (error) {
    console.warn("[stripe.checkout] session fallback invite", error);
  }

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const upgradeSubscription = (auth.api as { upgradeSubscription?: typeof auth.api.upgradeSubscription })
      .upgradeSubscription;

    if (!upgradeSubscription) {
      return NextResponse.json(
        { error: "Endpoint upgradeSubscription indisponible (plugin Stripe non chargé)." },
        { status: 503 }
      );
    }

    const result = await upgradeSubscription({
      headers: request.headers,
      body: {
        plan: "pro",
        annual: false,
        successUrl: `${appUrl}/dashboard/billing?checkout=success`,
        cancelUrl: `${appUrl}/dashboard/billing?checkout=cancel`,
        disableRedirect: true,
      },
    });

    if ("url" in result && result.url) {
      return NextResponse.json({ url: result.url });
    }

    return NextResponse.json(
      { error: "Session Stripe créée sans URL de redirection." },
      { status: 500 }
    );
  } catch (error) {
    console.error("[stripe.checkout]", error);
    return NextResponse.json(
      {
        error:
          "Impossible de créer la session Stripe. Vérifiez STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET et STRIPE_PRO_PRICE_ID dans .env.local.",
      },
      { status: 500 }
    );
  }
}
