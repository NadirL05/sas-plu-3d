import { NextResponse } from "next/server";

type AnalyzePluPdfBody = {
  urlfic?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as AnalyzePluPdfBody | null;
    const urlfic = body?.urlfic;

    if (!urlfic || typeof urlfic !== "string") {
      return NextResponse.json(
        { error: "Paramètre 'urlfic' requis." },
        { status: 400 }
      );
    }

    // Simulation d'un temps de traitement IA (~3 secondes)
    await sleep(3000);

    return NextResponse.json({
      ces: "40%",
      retrait: "4m",
      espacesVerts: "30%",
    });
  } catch (error) {
    console.error("[plu/analyze-pdf] error", error);
    return NextResponse.json(
      { error: "Analyse du PDF impossible pour le moment." },
      { status: 500 }
    );
  }
}

