"use client";

/**
 * StudyExportButton — Génération de rapport PDF côté client
 *
 * Workflow :
 *   1. Capture du canvas WebGL Three.js  → canvas.toDataURL()
 *   2. Upload UploadThing              → URL hébergée (log seulement)
 *   3. html2canvas sur [data-pdf-scene] → capture DOM de la vue 3D
 *   4. jsPDF client-side               → mise en page 2 pages
 *   5. doc.save()                      → téléchargement navigateur
 */

import { useCallback, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadFiles } from "@/src/utils/uploadthing";

// ─── Helpers locaux ────────────────────────────────────────────────────────────

function fmtEur(v?: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return "–";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtNum(v?: number | null, suffix = ""): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "–";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v)}${suffix}`;
}

function riskLabel(level?: string | null): string {
  if (level === "HIGH")   return "Élevé ⚠";
  if (level === "MEDIUM") return "Modéré";
  if (level === "LOW")    return "Faible ✓";
  return "Inconnu";
}

/** Convertit un data URL en File pour UploadThing. */
function dataURLtoFile(dataurl: string, filename: string): File {
  const [meta, encoded] = dataurl.split(",");
  if (!meta || !encoded) throw new Error("Data URL invalide");
  const mimeMatch = meta.match(/^data:([^;]+);base64$/);
  if (!mimeMatch) throw new Error("MIME introuvable");
  const mime = mimeMatch[1]!;
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const ext   = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  return new File([bytes], `${filename}.${ext}`, { type: mime });
}

/** Emprise estimée selon la zone PLU. */
function coverageFor(zoningType?: string | null): number {
  if (!zoningType) return 0.5;
  if (zoningType.startsWith("U"))  return 0.6;
  if (zoningType.startsWith("AU")) return 0.5;
  return 0.3;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface StudyExportButtonProps {
  studyId: string;
  address: string;
  parcelAreaM2?: number | null;
  parcelIdu?: string | null;
  zoningType?: string | null;
  zoningLibelle?: string | null;
  maxHeightM?: number | null;
  dvfMedianValueEur?: number | null;
  dvfMedianPricePerM2Eur?: number | null;
  dvfMutationCount?: number | null;
  floodLevel?: string | null;
  clayLevel?: string | null;
  hazardCount?: number | null;
  promoterSurfacePlancherM2?: number | null;
  promoterCaEur?: number | null;
  promoterCoutConstructionEur?: number | null;
  promoterFraisAnnexesEur?: number | null;
  promoterPrixMaxTerrainEur?: number | null;
}

// ─── Helpers PDF ───────────────────────────────────────────────────────────────

type jsPDFType = import("jspdf").jsPDF;

const L = 14;          // left margin
const CW = 182;        // content width (210 - 2*14)

/**
 * Draws a two-column table row. Returns the new y cursor.
 */
function drawRow(
  doc: jsPDFType,
  y: number,
  key: string,
  value: string,
  header = false,
): number {
  const KW = 72;
  const VW = CW - KW;
  const RH = 9;

  if (header) {
    doc.setFillColor(15, 23, 42);           // slate-900
    doc.rect(L, y, KW + VW, RH, "F");
    doc.setTextColor(148, 163, 184);        // slate-400
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(key.toUpperCase(),   L + 3,      y + 5.8);
    doc.text(value.toUpperCase(), L + KW + 3, y + 5.8);
    return y + RH;
  }

  doc.setFillColor(248, 250, 252);          // slate-50
  doc.rect(L, y, KW, RH, "F");
  doc.setFillColor(255, 255, 255);
  doc.rect(L + KW, y, VW, RH, "F");
  doc.setDrawColor(226, 232, 240);          // slate-200
  doc.setLineWidth(0.2);
  doc.rect(L, y, KW, RH);
  doc.rect(L + KW, y, VW, RH);

  doc.setTextColor(51, 65, 85);            // slate-700
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(key, L + 3, y + 5.8);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);            // slate-900
  doc.text(value, L + KW + 3, y + 5.8);
  return y + RH;
}

/** Draws a labelled section separator. Returns new y. */
function sectionHeader(doc: jsPDFType, y: number, title: string): number {
  doc.setFillColor(241, 245, 249);          // slate-100
  doc.rect(L, y, CW, 7.5, "F");
  doc.setFillColor(16, 185, 129);           // emerald-500 accent
  doc.rect(L, y, 2.5, 7.5, "F");
  doc.setTextColor(71, 85, 105);            // slate-600
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(title.toUpperCase(), L + 6, y + 5.2);
  return y + 7.5;
}

/** Page footer strip. */
function drawFooter(doc: jsPDFType, page: number, total: number): void {
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 287, 210, 10, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);          // slate-500
  doc.text(
    "SAS PLU 3D – Document généré automatiquement, à vocation indicative.",
    L,
    293,
  );
  doc.text(`${page}/${total}`, 210 - L, 293, { align: "right" });
}

/**
 * Embeds an image (data URL) into the doc.
 * Scales to fit within maxW × maxH, centred horizontally.
 * Returns new y after the image.
 */
function embedImage(
  doc: jsPDFType,
  dataUrl: string,
  yStart: number,
  maxW: number,
  maxH: number,
): number {
  try {
    const props  = doc.getImageProperties(dataUrl);
    const ratio  = props.width / props.height;
    let imgW     = maxW;
    let imgH     = imgW / ratio;
    if (imgH > maxH) { imgH = maxH; imgW = imgH * ratio; }
    const imgX   = L + (maxW - imgW) / 2;
    doc.setDrawColor(51, 65, 85);
    doc.setLineWidth(0.3);
    doc.roundedRect(imgX - 1, yStart - 1, imgW + 2, imgH + 2, 2, 2);
    doc.addImage(dataUrl, "PNG", imgX, yStart, imgW, imgH);
    return yStart + imgH + 4;
  } catch {
    return yStart; // silent: image skipped
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function StudyExportButton(props: StudyExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const generateInvestorReport = useCallback(async () => {
    setIsExporting(true);
    try {
      // ── 1. Capture 3D WebGL canvas ────────────────────────────────────────
      const canvas       = document.querySelector("canvas") as HTMLCanvasElement | null;
      const sceneDataUrl = canvas?.toDataURL("image/png") ?? null;

      // ── 2. Upload 3D capture to UploadThing → hosted URL ─────────────────
      let sceneHostedUrl: string | null = null;
      if (sceneDataUrl) {
        try {
          const file     = dataURLtoFile(sceneDataUrl, `scene-${props.studyId}`);
          const uploaded = await uploadFiles({ endpoint: "sceneCaptureUploader", files: [file] });
          const first    = uploaded[0] as { url?: string; ufsUrl?: string } | undefined;
          sceneHostedUrl = first?.url ?? first?.ufsUrl ?? null;
          if (sceneHostedUrl) console.info("[export] 3D scene hosted:", sceneHostedUrl);
        } catch {
          // Upload facultatif — le PDF embarque le data URL directement
        }
      }

      // ── 3. html2canvas sur le container [data-pdf-scene] ─────────────────
      let mapDataUrl: string | null = null;
      try {
        const { default: html2canvas } = await import("html2canvas");
        const container = document.querySelector("[data-pdf-scene]") as HTMLElement | null;
        if (container) {
          const captured = await html2canvas(container, {
            useCORS:         true,
            allowTaint:      true,
            scale:           1.5,
            backgroundColor: "#020617",
            logging:         false,
          });
          mapDataUrl = captured.toDataURL("image/png");
        }
      } catch {
        // html2canvas est optionnel
      }

      // ── 4. Instanciation jsPDF ────────────────────────────────────────────
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ format: "a4", unit: "mm", orientation: "portrait" });

      const today = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date());

      // ════════════════════════════════ PAGE 1 ══════════════════════════════

      // Header banner
      doc.setFillColor(2, 6, 23);                   // slate-950
      doc.rect(0, 0, 210, 44, "F");
      doc.setFillColor(16, 185, 129);               // emerald-500 left bar
      doc.rect(0, 0, 3, 44, "F");

      doc.setTextColor(248, 250, 252);              // slate-50
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.text("RAPPORT D'ÉTUDE FONCIÈRE", L + 3, 15);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184);              // slate-400
      const maxAddrW = 210 - L * 2 - 36;
      const addrLines = doc.splitTextToSize(props.address, maxAddrW);
      doc.text(addrLines, L + 3, 23);

      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);              // slate-500
      doc.text(`ID étude : ${props.studyId.slice(0, 20)}…`, L + 3, 33);
      doc.text(`Édité le ${today}`, 210 - L, 33, { align: "right" });

      // Brand
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(16, 185, 129);
      doc.text("SAS PLU 3D", 210 - L, 15, { align: "right" });

      // ── Section Parcelle & PLU ────────────────────────────────────────────
      let y = 52;
      y = sectionHeader(doc, y, "Parcelle & Localisation (PLU)");
      y = drawRow(doc, y, "Contrainte", "Valeur", true);

      if (props.parcelAreaM2) {
        y = drawRow(doc, y, "Surface cadastrale", fmtNum(props.parcelAreaM2, " m²"));
      }
      if (props.parcelIdu) {
        y = drawRow(doc, y, "IDU cadastral", props.parcelIdu);
      }

      const zoneLabel = props.zoningLibelle
        ? `${props.zoningLibelle}${props.zoningType ? ` (${props.zoningType})` : ""}`
        : (props.zoningType ?? "Non renseigné");
      y = drawRow(doc, y, "Zone PLU", zoneLabel);

      if (props.maxHeightM) {
        y = drawRow(doc, y, "Hauteur max PLU", `${props.maxHeightM.toFixed(1)} m`);
      }

      const coverage  = coverageFor(props.zoningType);
      const floors    = props.maxHeightM ? Math.max(1, Math.floor(props.maxHeightM / 3)) : null;
      const sdpEstim  = props.parcelAreaM2 && floors
        ? Math.round(props.parcelAreaM2 * coverage * floors)
        : null;

      y = drawRow(doc, y, "Taux d'emprise estimé", `${Math.round(coverage * 100)} %`);
      if (floors)    y = drawRow(doc, y, "Niveaux estimés",     `${floors} niveau${floors > 1 ? "x" : ""}`);
      if (sdpEstim)  y = drawRow(doc, y, "SDP calculée (SFP)",  `${sdpEstim.toLocaleString("fr-FR")} m²`);

      y += 6;

      // ── Aperçu 3D ─────────────────────────────────────────────────────────
      if (sceneDataUrl) {
        y = sectionHeader(doc, y, "Aperçu 3D — Modélisation volumétrique");
        y += 2;
        const maxImgH = Math.min(120, 287 - y - 10);
        y = embedImage(doc, sceneDataUrl, y, CW, maxImgH);
      }

      drawFooter(doc, 1, 2);

      // ════════════════════════════════ PAGE 2 ══════════════════════════════
      doc.addPage();

      // Thin top strip
      doc.setFillColor(2, 6, 23);
      doc.rect(0, 0, 210, 13, "F");
      doc.setFillColor(16, 185, 129);
      doc.rect(0, 0, 3, 13, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text("RAPPORT D'ÉTUDE FONCIÈRE", L + 3, 8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      const addrShort = props.address.length > 60
        ? props.address.slice(0, 57) + "…"
        : props.address;
      doc.text(addrShort, 210 - L, 8.5, { align: "right" });

      y = 21;

      // ── Marché immobilier (DVF) ───────────────────────────────────────────
      y = sectionHeader(doc, y, "Marché Immobilier — DVF (Demandes de Valeurs Foncières)");
      y = drawRow(doc, y, "Indicateur", "Valeur", true);
      y = drawRow(doc, y, "Valeur médiane des transactions", fmtEur(props.dvfMedianValueEur));
      y = drawRow(
        doc, y, "Prix médian au m²",
        props.dvfMedianPricePerM2Eur
          ? `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(props.dvfMedianPricePerM2Eur)} €/m²`
          : "–",
      );
      y = drawRow(
        doc, y, "Nombre de mutations recensées",
        props.dvfMutationCount != null ? String(props.dvfMutationCount) : "–",
      );
      y += 6;

      // ── Risques naturels ──────────────────────────────────────────────────
      y = sectionHeader(doc, y, "Risques Naturels — Géorisques");
      y = drawRow(doc, y, "Aléa", "Niveau d'exposition", true);
      y = drawRow(doc, y, "Inondation (PPRI)", riskLabel(props.floodLevel));
      y = drawRow(doc, y, "Argiles — Retrait-gonflement (RGA)", riskLabel(props.clayLevel));
      if (props.hazardCount != null) {
        y = drawRow(doc, y, "Total aléas recensés", String(props.hazardCount));
      }
      y += 6;

      // ── Bilan Promoteur ───────────────────────────────────────────────────
      y = sectionHeader(doc, y, "Bilan Promoteur — Projection Financière");
      y = drawRow(doc, y, "Poste", "Valeur estimée", true);
      if (props.promoterSurfacePlancherM2) {
        y = drawRow(doc, y, "Surface de plancher (SDP)", fmtNum(props.promoterSurfacePlancherM2, " m²"));
      }
      y = drawRow(doc, y, "Chiffre d'affaires estimé", fmtEur(props.promoterCaEur));
      y = drawRow(doc, y, "Coût de construction", fmtEur(props.promoterCoutConstructionEur));
      y = drawRow(doc, y, "Frais annexes (notaire, taxes…)", fmtEur(props.promoterFraisAnnexesEur));
      y = drawRow(doc, y, "Prix max. d'acquisition terrain", fmtEur(props.promoterPrixMaxTerrainEur));
      y += 4;

      // Marge nette badge
      const ca    = props.promoterCaEur ?? 0;
      const costs = (props.promoterCoutConstructionEur ?? 0) + (props.promoterFraisAnnexesEur ?? 0);
      const marge = ca > 0 ? (ca - costs) / ca : null;

      if (marge !== null) {
        const isRisky = marge < 0.15;
        if (isRisky) {
          doc.setFillColor(254, 226, 226);  // red-100
        } else {
          doc.setFillColor(209, 250, 229);  // emerald-100
        }
        doc.roundedRect(L, y, CW, 17, 3, 3, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        if (isRisky) {
          doc.setTextColor(185, 28, 28);    // red-700
        } else {
          doc.setTextColor(6, 95, 70);      // emerald-800
        }
        doc.text(
          `${marge >= 0 ? "+" : ""}${(marge * 100).toFixed(1)} %`,
          L + 8,
          y + 11,
        );

        doc.setFontSize(9);
        if (isRisky) {
          doc.setTextColor(220, 38, 38);    // red-600
        } else {
          doc.setTextColor(16, 185, 129);   // emerald-500
        }
        doc.text(
          isRisky
            ? "Marge nette < 15 % — Projet risqué · révisez terrain ou construction"
            : "Marge nette · Opération viable ✓",
          L + 46,
          y + 11,
        );
        y += 23;
      }

      // ── html2canvas : vue volumétrique DOM ───────────────────────────────
      if (mapDataUrl && y < 260) {
        y = sectionHeader(doc, y, "Vue Volumétrique DOM — Contexte Parcellaire");
        y += 2;
        const maxMapH = Math.min(75, 287 - y - 8);
        if (maxMapH > 20) {
          y = embedImage(doc, mapDataUrl, y, CW, maxMapH);
        }
      }

      drawFooter(doc, 2, 2);

      // ── 5. Déclencher le téléchargement ──────────────────────────────────
      const safeId = props.studyId.replace(/[^a-z0-9]/gi, "-").slice(0, 20);
      doc.save(`rapport-etude-${safeId}.pdf`);

      toast.success("Rapport PDF téléchargé ✓");
    } catch (error) {
      console.error("[EXPORT_PDF_ERROR]", error);
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de la génération du rapport.",
      );
    } finally {
      setIsExporting(false);
    }
  }, [props]);

  return (
    <Button
      onClick={generateInvestorReport}
      disabled={isExporting}
      variant="outline"
      className="gap-2 border-slate-600/60 bg-slate-900/70 text-slate-200 hover:bg-slate-800 hover:text-white"
    >
      {isExporting ? (
        <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
      ) : (
        <FileDown className="h-4 w-4" />
      )}
      {isExporting ? "Génération…" : "Exporter le Rapport PDF"}
    </Button>
  );
}
