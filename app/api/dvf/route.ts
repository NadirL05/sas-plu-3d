import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const CQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_RADIUS = 500;
const MIN_RADIUS = 50;
const MAX_RADIUS = 5_000;

function parseNumberParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const lat = parseNumberParam(params.get("lat"));
  const lon = parseNumberParam(params.get("lon"));
  const radiusParam = parseNumberParam(params.get("radius"));

  if (lat === null || lon === null) {
    return NextResponse.json(
      { error: "INVALID_COORDS", message: "Paramètres lat/lon invalides." },
      { status: 400 }
    );
  }

  const radius = Math.min(
    MAX_RADIUS,
    Math.max(MIN_RADIUS, radiusParam ?? DEFAULT_RADIUS)
  );

  const upstreamUrl = `https://api.cquest.org/dvf?lat=${lat}&lon=${lon}&dist=${radius}`;

  try {
    const response = await fetch(upstreamUrl, {
      signal: AbortSignal.timeout(CQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "UPSTREAM_ERROR",
          message: `CQuest a répondu ${response.status}.`,
        },
        { status: 502 }
      );
    }

    const payload = (await response.json()) as unknown;

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");

    return NextResponse.json(
      {
        error: isTimeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE",
        message: isTimeout
          ? "Le service CQuest est trop lent à répondre."
          : "Impossible de joindre le service CQuest.",
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
