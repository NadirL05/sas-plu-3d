import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface UploadScenePayload {
  projectId: string;
  imageDataUrl: string;
}

function extractDataUrl(input: string): { mime: string; base64: string } | null {
  const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

function getUploadUrlFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (typeof data.url === "string") return data.url;

  const file = data.file;
  if (file && typeof file === "object" && typeof (file as { url?: unknown }).url === "string") {
    return (file as { url: string }).url;
  }

  const files = data.files;
  if (Array.isArray(files) && files.length > 0) {
    const first = files[0];
    if (first && typeof first === "object" && typeof (first as { url?: unknown }).url === "string") {
      return (first as { url: string }).url;
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  let payload: UploadScenePayload;

  try {
    payload = (await request.json()) as UploadScenePayload;
  } catch {
    return NextResponse.json({ error: "Payload JSON invalide." }, { status: 400 });
  }

  if (!payload?.projectId || !payload?.imageDataUrl) {
    return NextResponse.json(
      { error: "projectId et imageDataUrl sont requis." },
      { status: 400 }
    );
  }

  const uploadUrl =
    process.env.UPLOADTHING_SCENE_UPLOAD_URL ??
    process.env.UPLOADTHING_UPLOAD_URL ??
    "";
  const uploadToken =
    process.env.UPLOADTHING_TOKEN ?? process.env.UPLOADTHING_API_KEY ?? "";

  if (!uploadUrl) {
    return NextResponse.json(
      {
        error:
          "Service d'upload externe non configuré. Ajoutez UPLOADTHING_SCENE_UPLOAD_URL dans .env.local.",
      },
      { status: 503 }
    );
  }

  const parsed = extractDataUrl(payload.imageDataUrl);
  if (!parsed) {
    return NextResponse.json({ error: "Format imageDataUrl invalide." }, { status: 400 });
  }

  const binary = Buffer.from(parsed.base64, "base64");
  const extension = parsed.mime.includes("jpeg") ? "jpg" : "png";
  const filename = `scene-${payload.projectId}.${extension}`;

  const formData = new FormData();
  formData.append("file", new Blob([binary], { type: parsed.mime }), filename);
  formData.append("projectId", payload.projectId);
  formData.append("filename", filename);

  const headers: Record<string, string> = {};
  if (uploadToken) {
    headers.Authorization = `Bearer ${uploadToken}`;
    headers["x-uploadthing-api-key"] = uploadToken;
  }

  try {
    const upstream = await fetch(uploadUrl, {
      method: "POST",
      headers,
      body: formData,
      cache: "no-store",
    });

    const upstreamJson = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error:
            (upstreamJson as { error?: string } | null)?.error ??
            `Upload externe en échec (${upstream.status}).`,
        },
        { status: 502 }
      );
    }

    const url = getUploadUrlFromPayload(upstreamJson);
    if (!url) {
      return NextResponse.json(
        { error: "Upload externe réussi mais URL de fichier absente." },
        { status: 502 }
      );
    }

    return NextResponse.json({ url });
  } catch (error) {
    console.error("[upload-scene]", error);
    return NextResponse.json(
      { error: "Erreur réseau lors de l'envoi vers le service externe." },
      { status: 502 }
    );
  }
}
