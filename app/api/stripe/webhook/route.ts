import { NextRequest } from "next/server";
import { auth } from "@/src/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const targetUrl = new URL(request.url);
  targetUrl.pathname = "/api/auth/stripe/webhook";

  const proxiedRequest = new Request(targetUrl.toString(), {
    method: "POST",
    headers: new Headers(request.headers),
    body: rawBody,
  });

  try {
    return await auth.handler(proxiedRequest);
  } catch (error) {
    console.error("[stripe.webhook]", error);
    return new Response(
      JSON.stringify({ success: false, error: "Webhook handling failed." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
