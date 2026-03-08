import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { db } from "@/src/db";
import { feasibilityScenario, feasibilityStudy, projects } from "@/src/db/schema";
import type {
  AddressSuggestion,
  ZoneUrba,
  ParcelPolygon,
  DvfSummary,
  GeorisquesSummary,
  PromoterBalance,
} from "@/src/lib/plu-engine";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { StudyScenariosSection } from "@/components/dashboard/study-scenarios";
import { StudyShare } from "@/components/dashboard/study-share";
import { StudyParcelView } from "@/components/dashboard/study-parcel-view";
import { ReanalyzeButton } from "@/components/dashboard/reanalyze-button";
import { StudyFinancialPanel } from "@/components/dashboard/study-financial-panel";
import { StudyMarketPanel } from "@/components/dashboard/study-market-panel";
import { StudyAttractivenessPanel } from "@/components/dashboard/study-attractiveness-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StudyExportButton } from "@/components/dashboard/study-export-button";

function formatCurrency(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
  }).format(date);
}

function getRiskBadge(level?: GeorisquesSummary["floodLevel"]) {
  switch (level) {
    case "HIGH":
      return {
        label: "Élevé",
        className: "bg-red-500/15 text-red-300 border-red-400/40",
      };
    case "MEDIUM":
      return {
        label: "Modéré",
        className: "bg-amber-500/15 text-amber-300 border-amber-400/40",
      };
    case "LOW":
      return {
        label: "Faible",
        className: "bg-emerald-500/15 text-emerald-300 border-emerald-400/40",
      };
    default:
      return {
        label: "Inconnu",
        className: "bg-slate-700/60 text-slate-200 border-slate-500/40",
      };
  }
}

function coverageFor(zoningType?: string | null): number {
  if (!zoningType) return 0.5;
  if (zoningType.startsWith("U")) return 0.6;
  if (zoningType.startsWith("AU")) return 0.5;
  return 0.3;
}

function defaultHeight(zoningType?: string | null): number {
  if (!zoningType) return 9;
  if (zoningType.startsWith("U")) return 12;
  if (zoningType.startsWith("AU")) return 10;
  return 6;
}

function estimateSdpM2(
  parcelAreaM2?: number | null,
  zoningType?: string | null,
  maxHeightM?: number | null
): number | null {
  if (typeof parcelAreaM2 !== "number" || !Number.isFinite(parcelAreaM2) || parcelAreaM2 <= 0) {
    return null;
  }
  const coverageRatio = coverageFor(zoningType);
  const maxHeight = maxHeightM ?? defaultHeight(zoningType);
  const floors = Math.max(1, Math.floor(maxHeight / 3));
  return Math.round(parcelAreaM2 * coverageRatio * floors);
}

type StudyPageProps = {
  params: Promise<{ id: string }>;
};

export default async function StudyPage({ params }: StudyPageProps) {
  if (!db) {
    notFound();
  }

  const { id } = await params;

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[study.page] session fallback invite", error);
  }
  const userId = session?.user?.id;
  if (!userId) {
    notFound();
  }

  const [row] = await db
    .select({
      study: feasibilityStudy,
      projectUserId: projects.userId,
      projectName: projects.name,
    })
    .from(feasibilityStudy)
    .leftJoin(projects, eq(feasibilityStudy.projectId, projects.id))
    .where(eq(feasibilityStudy.id, id))
    .limit(1);

  if (!row) {
    notFound();
  }

  // Vérifie l'ownership : via le projet (si lié) ou directement via study.userId
  const ownerId = row.projectUserId ?? row.study.userId;
  if (ownerId !== userId) {
    notFound();
  }

  const study = row.study;
  const projectName = row.projectName ?? study.address;

  const zoning = study.zoning as ZoneUrba | null;
  const parcel = study.parcel as ParcelPolygon | null;
  const dvf = study.dvfSummary as DvfSummary | null;
  const risks = study.georisquesSummary as GeorisquesSummary | null;
  const promoter = study.promoterBalance as PromoterBalance | null;

  const scenarios = await db
    .select({
      id: feasibilityScenario.id,
      name: feasibilityScenario.name,
      coveragePct: feasibilityScenario.coveragePct,
      maxHeightM: feasibilityScenario.maxHeightM,
      promoterBalance: feasibilityScenario.promoterBalance,
      createdAt: feasibilityScenario.createdAt,
    })
    .from(feasibilityScenario)
    .where(eq(feasibilityScenario.feasibilityStudyId, study.id))
    .orderBy(desc(feasibilityScenario.createdAt));

  const mappedScenarios = scenarios.map((scenario) => ({
    ...scenario,
    createdAt: scenario.createdAt ? scenario.createdAt.toISOString() : null,
  }));

  const addressSuggestion: AddressSuggestion = {
    label: study.address,
    lon: Number(study.lon ?? 0),
    lat: Number(study.lat ?? 0),
    inseeCode: study.inseeCode ?? "",
    city: "",
    postcode: "",
    score: 1,
  };

  const studyLat = Number(study.lat);
  const studyLon = Number(study.lon);
  const hasStudyCoords = Number.isFinite(studyLat) && Number.isFinite(studyLon);

  const estimatedSdp = estimateSdpM2(
    parcel?.areaM2 ?? null,
    zoning?.typezone ?? null,
    scenarios[0]?.maxHeightM ?? null
  );
  const programSdpM2 =
    typeof promoter?.surfacePlancherM2 === "number" && Number.isFinite(promoter.surfacePlancherM2)
      ? Math.round(promoter.surfacePlancherM2)
      : estimatedSdp;

  const inondationBadge = getRiskBadge(risks?.floodLevel);
  const argileBadge = getRiskBadge(risks?.clayLevel);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 md:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Étude de faisabilité
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
            {projectName}
          </h1>
          <p className="text-xs text-slate-500">
            ID étude : <span className="font-mono text-slate-300">{study.id}</span>
          </p>
        </div>

        <StudyExportButton
          studyId={study.id}
          address={study.address}
          parcelAreaM2={parcel?.areaM2 ?? null}
          parcelIdu={parcel?.idu ?? null}
          zoningType={zoning?.typezone ?? null}
          zoningLibelle={zoning?.libelle ?? null}
          maxHeightM={scenarios[0]?.maxHeightM ?? null}
          dvfMedianValueEur={dvf?.medianValueEur ?? null}
          dvfMedianPricePerM2Eur={dvf?.medianPricePerM2Eur ?? null}
          dvfMutationCount={dvf?.mutationCount ?? null}
          floodLevel={risks?.floodLevel ?? null}
          clayLevel={risks?.clayLevel ?? null}
          hazardCount={risks?.hazardCount ?? null}
          promoterSurfacePlancherM2={promoter?.surfacePlancherM2 ?? null}
          promoterCaEur={promoter?.chiffreAffairesEstimeEur ?? null}
          promoterCoutConstructionEur={promoter?.coutConstructionEur ?? null}
          promoterFraisAnnexesEur={promoter?.fraisAnnexesEur ?? null}
          promoterPrixMaxTerrainEur={promoter?.prixMaxTerrainEur ?? null}
        />
      </header>

      <StudyShare
        studyId={study.id}
        initialEnabled={study.publicShareEnabled}
        initialPublicShareId={study.publicShareId}
      />

      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">
          Modélisation 3D
        </p>
        <StudyParcelView
          maxHeight={scenarios[0]?.maxHeightM ?? 9}
          zoneType={zoning?.typezone ?? undefined}
          parcelPolygon={parcel?.geometry ?? undefined}
          parcelCenter={
            Number.isFinite(Number(study.lon)) && Number.isFinite(Number(study.lat))
              ? { lon: Number(study.lon), lat: Number(study.lat) }
              : undefined
          }
          parcelAreaM2={parcel?.areaM2 ?? undefined}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/70 bg-slate-950/80 text-slate-50">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Adresse &amp; localisation</CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Point d&apos;entrée de l&apos;analyse foncière.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium text-slate-100">{addressSuggestion.label}</p>
            <p className="text-xs text-slate-400">
              Code INSEE :{" "}
              <span className="font-mono text-slate-200">
                {addressSuggestion.inseeCode || "Non renseigné"}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Coordonnées :{" "}
              <span className="font-mono text-slate-200">
                {Number.isFinite(addressSuggestion.lat) &&
                Number.isFinite(addressSuggestion.lon)
                  ? `${addressSuggestion.lat.toFixed(5)}, ${addressSuggestion.lon.toFixed(5)}`
                  : "Non disponibles"}
              </span>
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-slate-950/80 text-slate-50">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Urbanisme (PLU)</CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Synthèse des règles principales issues du document d&apos;urbanisme.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-slate-400">
              Zonage :{" "}
              <span className="font-semibold text-slate-100">
                {zoning?.libelle ?? zoning?.typezone ?? "Non renseigné"}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Type de zone :{" "}
              <span className="font-mono text-slate-200">
                {zoning?.typezone ?? "Non renseigné"}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Date d&apos;approbation :{" "}
              <span className="text-slate-200">
                {zoning?.datappro ? formatDate(zoning.datappro) : "Non renseignée"}
              </span>
            </p>
            {zoning?.urlfic ? (
              <p className="text-xs text-slate-400">
                Document PLU :{" "}
                <a
                  href={zoning.urlfic}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 underline-offset-2 hover:underline"
                >
                  Ouvrir le règlement
                </a>
              </p>
            ) : null}
            {!zoning && <ReanalyzeButton studyId={study.id} />}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/70 bg-slate-950/80 text-slate-50">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Parcelle cadastrale</CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Données issues du cadastre ou calculées sur la géométrie.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-slate-400">
              Surface :{" "}
              <span className="font-semibold text-slate-100">
                {parcel?.areaM2 ? `${formatNumber(parcel.areaM2)} m²` : "Non renseignée"}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Source :{" "}
              <span className="text-slate-200">
                {parcel?.areaSource === "cadastre"
                  ? "Cadastre"
                  : parcel?.areaSource === "computed"
                    ? "Calculée"
                    : "Non renseignée"}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              IDU :{" "}
              <span className="font-mono text-slate-200">
                {parcel?.idu ?? "Non renseigné"}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Section :{" "}
              <span className="font-mono text-slate-200">
                {parcel?.sectionCode ?? "Non renseignée"}
              </span>
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-slate-950/80 text-slate-50">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Marché immobilier (DVF)</CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Synthèse des mutations foncières autour de la parcelle.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-slate-400">
              Valeur médiane :{" "}
              <span className="font-semibold text-slate-100">
                {formatCurrency(dvf?.medianValueEur)}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Valeur moyenne :{" "}
              <span className="font-semibold text-slate-100">
                {formatCurrency(dvf?.averageValueEur)}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Prix médian au m² :{" "}
              <span className="font-semibold text-slate-100">
                {typeof dvf?.medianPricePerM2Eur === "number" && Number.isFinite(dvf.medianPricePerM2Eur)
                  ? `${new Intl.NumberFormat("fr-FR", {
                      maximumFractionDigits: 0,
                    }).format(dvf.medianPricePerM2Eur)} €/m²`
                  : "Non disponible"}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Nombre de mutations :{" "}
              <span className="font-semibold text-slate-100">
                {typeof dvf?.mutationCount === "number" ? dvf.mutationCount : "-"}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Dernière mutation :{" "}
              <span className="text-slate-200">
                {dvf?.latestMutationDate ? formatDate(dvf.latestMutationDate) : "Non disponible"}
              </span>
            </p>
            {dvf?.dvfHistory && dvf.dvfHistory.length > 0 ? (
              <div className="mt-2 space-y-1 text-xs text-slate-400">
                <p className="font-semibold text-slate-300">Historique annuel (médian) :</p>
                <ul className="space-y-0.5">
                  {dvf.dvfHistory.map((entry) => (
                    <li key={entry.year} className="flex justify-between">
                      <span>{entry.year}</span>
                      <span className="font-mono text-slate-100">
                        {formatCurrency(entry.price)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/70 bg-slate-950/80 text-slate-50">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Risques (Géorisques)</CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Synthèse des principaux aléas identifiés par les services de l&apos;État.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-300">Inondation</span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${inondationBadge.className}`}
              >
                {inondationBadge.label}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-300">Argiles (RGA)</span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${argileBadge.className}`}
              >
                {argileBadge.label}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Nombre d&apos;aléas recensés :{" "}
              <span className="font-semibold text-slate-100">
                {typeof risks?.hazardCount === "number" ? risks.hazardCount : "-"}
              </span>
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-slate-950/80 text-slate-50">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Bilan promoteur</CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Projection financière basée sur la surface de plancher et les valeurs de marché.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-slate-400">
              Surface de plancher théorique :{" "}
              <span className="font-semibold text-slate-100">
                {promoter?.surfacePlancherM2
                  ? `${formatNumber(promoter.surfacePlancherM2)} m²`
                  : "Non calculée"}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              CA estimé :{" "}
              <span className="font-semibold text-slate-100">
                {formatCurrency(promoter?.chiffreAffairesEstimeEur)}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Coût travaux :{" "}
              <span className="font-semibold text-slate-100">
                {formatCurrency(promoter?.coutConstructionEur)}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              Frais annexes :{" "}
              <span className="font-semibold text-slate-100">
                {formatCurrency(promoter?.fraisAnnexesEur)}
              </span>
            </p>
            <p className="mt-3 text-xs text-slate-400">
              Prix d&apos;achat max terrain :{" "}
              <span
                className={`ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  promoter && promoter.prixMaxTerrainEur > 0
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-red-500/15 text-red-300"
                }`}
              >
                {formatCurrency(promoter?.prixMaxTerrainEur)}
              </span>
            </p>
          </CardContent>
        </Card>
      </section>
      <Tabs defaultValue="financial" className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl border border-border/70 bg-slate-950/80 p-1">
          <TabsTrigger
            value="financial"
            className="text-xs font-semibold data-[state=active]:bg-white/10 data-[state=active]:text-white"
          >
            Bilan
          </TabsTrigger>
          <TabsTrigger
            value="market"
            className="text-xs font-semibold data-[state=active]:bg-white/10 data-[state=active]:text-white"
          >
            Marché
          </TabsTrigger>
          <TabsTrigger
            value="attractiveness"
            className="text-xs font-semibold data-[state=active]:bg-white/10 data-[state=active]:text-white"
          >
            Programme & Quartier
          </TabsTrigger>
        </TabsList>

        <TabsContent value="financial" className="mt-2">
          <StudyFinancialPanel
            parcelAreaM2={parcel?.areaM2 ?? null}
            zoningType={zoning?.typezone ?? null}
            maxHeightM={scenarios[0]?.maxHeightM ?? null}
          />
        </TabsContent>

        <TabsContent value="market" className="mt-2">
          <StudyMarketPanel
            lat={hasStudyCoords ? studyLat : null}
            lon={hasStudyCoords ? studyLon : null}
          />
        </TabsContent>

        <TabsContent value="attractiveness" className="mt-2">
          <StudyAttractivenessPanel
            lat={hasStudyCoords ? studyLat : null}
            lon={hasStudyCoords ? studyLon : null}
            sdp={programSdpM2 ?? null}
          />
        </TabsContent>
      </Tabs>

      <StudyScenariosSection studyId={study.id} initialScenarios={mappedScenarios} />
    </main>
  );
}

