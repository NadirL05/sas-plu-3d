import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { urlfic } = await req.json();

    if (!urlfic) {
      return NextResponse.json({ error: "Aucun lien PDF fourni." }, { status: 400 });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Tu es un expert en urbanisme réglementaire français. L'utilisateur te fournit un lien vers un règlement PLU : ${urlfic}. Ton objectif est d'extraire les règles de constructibilité de la zone concernée. Tu dois OBLIGATOIREMENT répondre avec un objet JSON strict contenant ces 3 clés : - "ces" (Coefficient d'Emprise au Sol, ex: "40%" ou "Non réglementé") - "retrait" (Règles d'implantation par rapport aux limites, ex: "4 mètres" ou "L=H/2") - "espacesVerts" (Obligation de pleine terre, ex: "30% de la parcelle")`,
        },
        {
          role: "user",
          content: "Analyse ce document réglementaire et donne-moi les 3 règles principales.",
        },
      ],
    });

    const extractedData = JSON.parse(response.choices[0].message.content || "{}");

    return NextResponse.json({
      ces: extractedData.ces || "Non spécifié",
      retrait: extractedData.retrait || "Non spécifié",
      espacesVerts: extractedData.espacesVerts || "Non spécifié",
    });
  } catch (error) {
    console.error("[API PLU Analyze] Erreur OpenAI:", error);
    return NextResponse.json({ error: "L'analyse IA a échoué." }, { status: 500 });
  }
}
