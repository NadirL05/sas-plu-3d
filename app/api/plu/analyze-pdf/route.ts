import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { db } from "@/src/db";
import { pluAiCache } from "@/src/db/schema";

interface AnalyzePdfPayload {
  urlfic?: string;
}

interface PluAnalysisResult {
  ces: string;
  retrait: string;
  espacesVerts: string;
}

function asRuleText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text.length > 0 ? text : fallback;
}

function normalizeAnalysis(data: unknown): PluAnalysisResult {
  if (!data || typeof data !== "object") {
    return {
      ces: "Non spécifié",
      retrait: "Non spécifié",
      espacesVerts: "Non spécifié",
    };
  }

  const payload = data as Record<string, unknown>;

  return {
    ces: asRuleText(payload.ces, "Non spécifié"),
    retrait: asRuleText(payload.retrait, "Non spécifié"),
    espacesVerts: asRuleText(payload.espacesVerts, "Non spécifié"),
  };
}

async function getCachedAnalysis(urlfic: string): Promise<PluAnalysisResult | null> {
  if (!db) return null;

  try {
    const [cached] = await db
      .select({
        ces: pluAiCache.ces,
        retrait: pluAiCache.retrait,
        espacesVerts: pluAiCache.espacesVerts,
      })
      .from(pluAiCache)
      .where(eq(pluAiCache.urlfic, urlfic))
      .limit(1);

    return cached ?? null;
  } catch (error) {
    console.warn("[api/plu/analyze-pdf] Cache read failed, fallback OpenAI.", error);
    return null;
  }
}

async function saveAnalysisToCache(urlfic: string, analysis: PluAnalysisResult): Promise<void> {
  if (!db) return;

  try {
    await db
      .insert(pluAiCache)
      .values({
        urlfic,
        ces: analysis.ces,
        retrait: analysis.retrait,
        espacesVerts: analysis.espacesVerts,
      })
      .onConflictDoUpdate({
        target: pluAiCache.urlfic,
        set: {
          ces: analysis.ces,
          retrait: analysis.retrait,
          espacesVerts: analysis.espacesVerts,
        },
      });
  } catch (error) {
    console.warn("[api/plu/analyze-pdf] Cache write failed, response will still use OpenAI.", error);
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY non configurée." }, { status: 500 });
  }

  // Instantiated here (not at module scope) so the build phase never throws
  const openai = new OpenAI({ apiKey });

  let body: AnalyzePdfPayload;
  try {
    body = (await req.json()) as AnalyzePdfPayload;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const urlfic = body.urlfic?.trim();
  if (!urlfic) {
    return NextResponse.json({ error: "Aucun lien PDF fourni." }, { status: 400 });
  }

  try {
    const cached = await getCachedAnalysis(urlfic);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Tu es un expert en urbanisme. Analyse ce lien PDF : ${urlfic}. Extrais les règles de construction. Réponds UNIQUEMENT avec un objet JSON strict contenant les clés 'ces', 'retrait' et 'espacesVerts'.`,
        },
      ],
      max_tokens: 260,
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    let parsed: unknown = {};

    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }

    const analysis = normalizeAnalysis(parsed);
    await saveAnalysisToCache(urlfic, analysis);

    return NextResponse.json(analysis, { status: 200 });
  } catch (error) {
    console.error("[api/plu/analyze-pdf]", error);
    return NextResponse.json({ error: "L'analyse IA a échoué." }, { status: 500 });
  }
}
