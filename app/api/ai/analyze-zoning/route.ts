import OpenAI from "openai";
import { NextResponse } from "next/server";

export interface AnalyzeZoningResult {
  recommendedHeight: number;
  roofType: "flat" | "sloped";
  hasCommercialGround: boolean;
  aiFeedback: string;
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY non configurée." }, { status: 500 });
  }

  // Instantiated here (not at module scope) so the build phase never throws
  const openai = new OpenAI({ apiKey });

  let prompt: string;
  let currentMaxHeight: number;
  let parcelArea: number | undefined;

  try {
    const body = await req.json();
    prompt = body.prompt;
    currentMaxHeight = body.currentMaxHeight;
    parcelArea = body.parcelArea;
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  if (!prompt || typeof currentMaxHeight !== "number") {
    return NextResponse.json({ error: "prompt et currentMaxHeight sont requis." }, { status: 400 });
  }

  const systemPrompt = `Tu es un architecte expert. Traduis la demande de l'utilisateur en paramètres JSON stricts pour notre moteur 3D. Les contraintes du PLU sont : Hauteur max ${currentMaxHeight}m, Surface ${parcelArea ?? "inconnue"}m². Renvoie UNIQUEMENT ce format JSON exact : { "recommendedHeight": number, "roofType": "flat" | "sloped", "hasCommercialGround": boolean, "aiFeedback": string (une courte phrase d'explication) }.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 200,
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(content) as AnalyzeZoningResult;

    // S'assurer que la hauteur recommandée ne dépasse pas la contrainte PLU
    if (typeof data.recommendedHeight === "number") {
      data.recommendedHeight = Math.min(data.recommendedHeight, currentMaxHeight);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[analyze-zoning]", error);
    return NextResponse.json({ error: "Erreur lors de l'appel OpenAI." }, { status: 500 });
  }
}
