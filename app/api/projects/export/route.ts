import { jsPDF } from "jspdf";
import { NextRequest, NextResponse } from "next/server";
import { getDvfSummaryNearby } from "@/src/lib/plu-engine";

export const runtime = "nodejs";

interface ExportPayload {
  projectId: string;
  address: {
    label: string;
    city?: string;
    postcode?: string;
    lat?: number;
    lon?: number;
  };
  plu: {
    zone: string;
    typezone?: string;
    maxHeight: number;
    footprint?: {
      width: number;
      depth: number;
    } | null;
  };
  analysisPrompt?: string;
  dvf?: {
    medianValueEur?: number | null;
    mutationCount?: number | null;
    source?: string | null;
  } | null;
  sceneImageUrl?: string | null;
  sceneImageDataUrl?: string | null;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 60);
}

function formatCurrencyEur(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "Non disponible";
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  if (!/^https?:\/\//.test(url)) return null;

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "image/png";
  if (!contentType.startsWith("image/")) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function drawTableRow(
  doc: jsPDF,
  y: number,
  key: string,
  value: string,
  options?: { header?: boolean }
): number {
  const startX = 14;
  const keyWidth = 58;
  const valueWidth = 124;
  const rowHeight = 10;
  const isHeader = options?.header ?? false;

  if (isHeader) {
    doc.setFillColor(39, 39, 42); // zinc-800
    doc.rect(startX, y, keyWidth + valueWidth, rowHeight, "F");
    doc.setTextColor(250, 250, 250);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Contrainte", startX + 3, y + 6.6);
    doc.text("Valeur", startX + keyWidth + 3, y + 6.6);
    return y + rowHeight;
  }

  doc.setFillColor(244, 244, 245); // zinc-100
  doc.rect(startX, y, keyWidth, rowHeight, "F");
  doc.setDrawColor(212, 212, 216); // zinc-300
  doc.rect(startX, y, keyWidth, rowHeight);
  doc.rect(startX + keyWidth, y, valueWidth, rowHeight);

  doc.setTextColor(39, 39, 42); // zinc-800
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(key, startX + 3, y + 6.6);

  doc.setFont("helvetica", "normal");
  doc.text(value, startX + keyWidth + 3, y + 6.6);
  return y + rowHeight;
}

export async function POST(request: NextRequest) {
  let payload: ExportPayload;

  try {
    payload = (await request.json()) as ExportPayload;
  } catch {
    return NextResponse.json(
      { error: "Payload JSON invalide." },
      { status: 400 }
    );
  }

  if (
    !payload?.projectId ||
    !payload?.address?.label ||
    !payload?.plu?.zone ||
    typeof payload?.plu?.maxHeight !== "number"
  ) {
    return NextResponse.json(
      { error: "Champs requis manquants: projectId, address.label, plu.zone, plu.maxHeight." },
      { status: 400 }
    );
  }

  let dvfMedianValueEur: number | null = null;
  let dvfMutationCount: number | null = null;
  let dvfSource = payload.dvf?.source ?? "DVF Etalab";

  if (
    typeof payload.dvf?.medianValueEur === "number" ||
    typeof payload.dvf?.mutationCount === "number"
  ) {
    dvfMedianValueEur =
      typeof payload.dvf?.medianValueEur === "number" ? payload.dvf.medianValueEur : null;
    dvfMutationCount =
      typeof payload.dvf?.mutationCount === "number" ? payload.dvf.mutationCount : null;
  } else if (typeof payload.address.lon === "number" && typeof payload.address.lat === "number") {
    try {
      const dvfSummary = await getDvfSummaryNearby(payload.address.lon, payload.address.lat);
      dvfMedianValueEur = dvfSummary?.medianValueEur ?? null;
      dvfMutationCount = dvfSummary?.mutationCount ?? null;
      dvfSource = dvfSummary?.source ?? dvfSource;
    } catch (error) {
      console.warn("[export.pdf][dvf] fallback unavailable", error);
    }
  }

  const doc = new jsPDF({ format: "a4", unit: "mm", orientation: "portrait" });

  // Header (palette Slate/Zinc)
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, 210, 34, "F");
  doc.setTextColor(248, 250, 252); // slate-50
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("SAS PLU 3D", 14, 13.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Projet #${payload.projectId}`, 14, 21);
  doc.text(`Adresse: ${payload.address.label}`, 14, 27);
  doc.text(`Édité le ${formatDate(new Date())}`, 196, 27, { align: "right" });

  let y = 44;

  doc.setTextColor(24, 24, 27); // zinc-900
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Récapitulatif des contraintes PLU", 14, y);
  y += 5;

  y = drawTableRow(doc, y, "", "", { header: true });
  const zoneValue = payload.plu.typezone
    ? `${payload.plu.zone} (${payload.plu.typezone})`
    : payload.plu.zone;
  y = drawTableRow(doc, y, "Zonage", zoneValue);
  y = drawTableRow(doc, y, "Hauteur max", `${payload.plu.maxHeight.toFixed(1)} m`);

  const footprint = payload.plu.footprint;
  const footprintValue = footprint
    ? `${footprint.width} m x ${footprint.depth} m (${(footprint.width * footprint.depth).toFixed(0)} m²)`
    : "Non renseignée";
  y = drawTableRow(doc, y, "Emprise au sol", footprintValue);
  y = drawTableRow(doc, y, "Prix median (DVF)", formatCurrencyEur(dvfMedianValueEur));
  y = drawTableRow(
    doc,
    y,
    "Nombre de ventes",
    typeof dvfMutationCount === "number" ? `${dvfMutationCount}` : "Non disponible"
  );
  y = drawTableRow(doc, y, "Source marche", dvfSource);

  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Analyse IA", 14, y);
  y += 4;

  const promptText =
    payload.analysisPrompt?.trim() ||
    "Aucun prompt de personnalisation n'a été saisi.";
  const promptLines = doc.splitTextToSize(promptText, 174);
  const promptBoxHeight = Math.max(26, promptLines.length * 5 + 8);

  doc.setFillColor(244, 244, 245); // zinc-100
  doc.setDrawColor(212, 212, 216); // zinc-300
  doc.roundedRect(14, y, 182, promptBoxHeight, 2, 2, "FD");
  doc.setTextColor(63, 63, 70); // zinc-700
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(promptLines, 18, y + 7);
  y += promptBoxHeight + 10;

  let sceneImageDataUrl = payload.sceneImageDataUrl ?? null;
  if (!sceneImageDataUrl && payload.sceneImageUrl) {
    try {
      sceneImageDataUrl = await fetchImageAsDataUrl(payload.sceneImageUrl);
    } catch (error) {
      console.error("[export.pdf][sceneImageUrl]", error);
    }
  }

  if (sceneImageDataUrl && sceneImageDataUrl.startsWith("data:image/")) {
    doc.setTextColor(24, 24, 27);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Aperçu 3D", 14, y);
    y += 3;

    try {
      const maxWidth = 182;
      const maxHeight = 297 - y - 16;
      const imageProps = doc.getImageProperties(sceneImageDataUrl);
      const ratio = imageProps.width / imageProps.height;

      let renderWidth = maxWidth;
      let renderHeight = renderWidth / ratio;
      if (renderHeight > maxHeight) {
        renderHeight = maxHeight;
        renderWidth = renderHeight * ratio;
      }

      const imageX = 14 + (maxWidth - renderWidth) / 2;
      const imageY = y + 4;
      doc.setDrawColor(161, 161, 170); // zinc-400
      doc.roundedRect(imageX - 1.5, imageY - 1.5, renderWidth + 3, renderHeight + 3, 2, 2);
      doc.addImage(sceneImageDataUrl, "PNG", imageX, imageY, renderWidth, renderHeight);
    } catch {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(82, 82, 91);
      doc.text("Capture 3D indisponible (format d'image non pris en charge).", 14, y + 8);
    }
  }

  const pdfBytes = Buffer.from(doc.output("arraybuffer"));
  const filename = `rapport-plu-${safeFilename(payload.projectId)}.pdf`;

  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
