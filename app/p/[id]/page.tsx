import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/src/db";
import { feasibilityStudy, projects } from "@/src/db/schema";
import type {
  ZoneUrba,
  AddressSuggestion,
  ParcelPolygon,
  DvfSummary,
  GeorisquesSummary,
  PromoterBalance,
} from "@/src/lib/plu-engine";
import type { ParcelSceneData } from "@/components/three/ParcelScene";
import { ParcelScene } from "@/components/three/ParcelScene";

const DEFAULT_MAX_HEIGHT_BY_ZONE: Record<string, number> = {
  U: 12,
  AU: 10,
  N: 6,
  A: 6,
};

type DealRoomPageProps = {
  params: { id: string };
};

function buildParcelSceneDataFromMetadata(
  zone: ZoneUrba | null,
  address: Pick<AddressSuggestion, "lon" | "lat"> | null
): ParcelSceneData | null {
  if (!address) return null;
  const maxHeight =
    zone && zone.typezone
      ? DEFAULT_MAX_HEIGHT_BY_ZONE[zone.typezone] ?? 8
      : DEFAULT_MAX_HEIGHT_BY_ZONE.U;

  return {
    maxHeight,
    zoneType: zone?.typezone,
    footprint: undefined,
    parcelPolygon: undefined,
    parcelCenter: { lon: address.lon, lat: address.lat },
    parcelAreaM2: undefined,
  };
}

export default async function DealRoomPage({ params }: DealRoomPageProps) {
  if (!db) {
    return (
      <div className="min-h-screen bg-background-dark text-slate-100">
        <header className="border-b border-white/10 bg-black/70 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 text-xs">
            <span className="text-slate-400">
              Étude foncière propulsée par{" "}
              <span className="font-semibold text-white">SAS PLU 3D</span>
            </span>
            <Link
              href="/"
              className="text-emerald-400 hover:text-emerald-300 text-xs font-semibold"
            >
              Créer mon compte
            </Link>
          </div>
        </header>
        <main className="mx-auto flex max-w-5xl flex-col items-center justify-center px-4 py-16 text-center">
          <p className="text-sm text-slate-400">
            La base de données n&apos;est pas configurée. Les Deal Rooms publiques sont
            désactivées en mode démo.
          </p>
        </main>
      </div>
    );
  }

  const id = params.id;

  // 1) Tenter de résoudre un partage public d'étude de faisabilité via publicShareId.
  const [publicStudyRow] = await db
    .select({
      id: feasibilityStudy.id,
      address: feasibilityStudy.address,
      lon: feasibilityStudy.lon,
      lat: feasibilityStudy.lat,
      inseeCode: feasibilityStudy.inseeCode,
      zoning: feasibilityStudy.zoning,
      parcel: feasibilityStudy.parcel,
      dvfSummary: feasibilityStudy.dvfSummary,
      georisquesSummary: feasibilityStudy.georisquesSummary,
      promoterBalance: feasibilityStudy.promoterBalance,
      publicShareEnabled: feasibilityStudy.publicShareEnabled,
    })
    .from(feasibilityStudy)
    .where(and(eq(feasibilityStudy.publicShareId, id), eq(feasibilityStudy.publicShareEnabled, true)))
    .limit(1);

  if (publicStudyRow) {
    const zoning = publicStudyRow.zoning as ZoneUrba | null;
    const parcel = publicStudyRow.parcel as ParcelPolygon | null;
    const dvf = publicStudyRow.dvfSummary as DvfSummary | null;
    const risks = publicStudyRow.georisquesSummary as GeorisquesSummary | null;
    const promoter = publicStudyRow.promoterBalance as PromoterBalance | null;

    const address: AddressSuggestion = {
      label: publicStudyRow.address,
      lon: Number(publicStudyRow.lon ?? 0),
      lat: Number(publicStudyRow.lat ?? 0),
      inseeCode: publicStudyRow.inseeCode ?? "",
      city: "",
      postcode: "",
      score: 1,
    };

    return (
      <div className="min-h-screen bg-background-dark text-slate-100">
        <header className="border-b border-white/10 bg-black/70 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 text-xs">
            <span className="text-slate-400">
              Étude de faisabilité partagée via{" "}
              <span className="font-semibold text-white">SAS PLU 3D</span>
            </span>
            <Link
              href="/"
              className="text-emerald-400 hover:text-emerald-300 text-xs font-semibold"
            >
              Créer mon compte
            </Link>
          </div>
        </header>
        <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-8 md:py-10">
          <section className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
              Étude de faisabilité • Lien public
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
              {address.label}
            </h1>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.08] bg-slate-950/80 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Adresse & localisation
              </p>
              <p className="mt-2 text-sm font-medium text-slate-100">{address.label}</p>
              <p className="mt-1 text-xs text-slate-400">
                Coordonnées :{" "}
                <span className="font-mono text-slate-200">
                  {Number.isFinite(address.lat) && Number.isFinite(address.lon)
                    ? `${address.lat.toFixed(5)}, ${address.lon.toFixed(5)}`
                    : "Non disponibles"}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Code INSEE :{" "}
                <span className="font-mono text-slate-200">
                  {address.inseeCode || "Non renseigné"}
                </span>
              </p>
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-slate-950/80 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Urbanisme (PLU)
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Zonage :{" "}
                <span className="font-semibold text-slate-100">
                  {zoning?.libelle ?? zoning?.typezone ?? "Non renseigné"}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Type de zone :{" "}
                <span className="font-mono text-slate-200">
                  {zoning?.typezone ?? "Non renseigné"}
                </span>
              </p>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.08] bg-slate-950/80 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Parcelle cadastrale
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Surface :{" "}
                <span className="font-semibold text-slate-100">
                  {parcel?.areaM2 ? `${parcel.areaM2.toFixed(1)} m²` : "Non renseignée"}
                </span>
              </p>
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-slate-950/80 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Bilan promoteur (synthèse)
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Prix d&apos;achat max terrain :{" "}
                <span
                  className={`font-semibold ${
                    promoter && promoter.prixMaxTerrainEur > 0
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {promoter
                    ? new Intl.NumberFormat("fr-FR", {
                        style: "currency",
                        currency: "EUR",
                        maximumFractionDigits: 0,
                      }).format(promoter.prixMaxTerrainEur)
                    : "-"}
                </span>
              </p>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // 2) Sinon, fallback sur la Deal Room projet historique (partage par projet).

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      metadata: projects.metadata,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (!project) {
    notFound();
  }

  const metadata = (project.metadata ?? null) as Record<string, unknown> | null;
  const addressMeta = (metadata?.address ?? null) as Record<string, unknown> | null;
  const zoneMeta = (metadata?.zone ?? null) as Record<string, unknown> | null;

  const address: AddressSuggestion | null = addressMeta
    ? {
        label:
          typeof addressMeta.label === "string"
            ? addressMeta.label
            : project.name,
        lon: typeof addressMeta.lon === "number" ? addressMeta.lon : 2.3522,
        lat: typeof addressMeta.lat === "number" ? addressMeta.lat : 48.8566,
        inseeCode:
          typeof addressMeta.inseeCode === "string"
            ? addressMeta.inseeCode
            : "",
        city:
          typeof addressMeta.city === "string" ? addressMeta.city : "Ville",
        postcode:
          typeof addressMeta.postcode === "string"
            ? addressMeta.postcode
            : "",
        score: 1,
      }
    : null;

  const zone: ZoneUrba | null = zoneMeta
    ? {
        libelle:
          typeof zoneMeta.libelle === "string"
            ? zoneMeta.libelle
            : "Zone PLU",
        typezone:
          typeof zoneMeta.typezone === "string"
            ? zoneMeta.typezone
            : "U",
        commune:
          typeof zoneMeta.commune === "string"
            ? zoneMeta.commune
            : "",
        nomfic:
          typeof zoneMeta.nomfic === "string" ? zoneMeta.nomfic : undefined,
        urlfic:
          typeof zoneMeta.urlfic === "string" ? zoneMeta.urlfic : undefined,
        datappro:
          typeof zoneMeta.datappro === "string"
            ? zoneMeta.datappro
            : undefined,
      }
    : null;

  const parcelSceneData = buildParcelSceneDataFromMetadata(
    zone,
    address ? { lon: address.lon, lat: address.lat } : null
  );

  return (
    <div className="min-h-screen bg-background-dark text-slate-100">
      <header className="border-b border-white/10 bg-black/70 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 text-xs">
          <span className="text-slate-400">
            Étude foncière propulsée par{" "}
            <span className="font-semibold text-white">SAS PLU 3D</span>
          </span>
          <Link
            href="/"
            className="text-emerald-400 hover:text-emerald-300 text-xs font-semibold"
          >
            Créer mon compte
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 md:py-10">
        <section className="rounded-3xl border border-white/[0.08] bg-slate-950/70 p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Deal Room • Étude foncière partagée
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                {project.name}
              </h1>
              <p className="text-sm text-slate-400">
                {address?.city} {address?.postcode
                  ? `• ${address.postcode}`
                  : ""}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-300">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                ZONAGE PLU
              </p>
              <p className="mt-1 text-sm font-black tracking-tight text-white">
                {zone?.libelle ?? zone?.typezone ?? "Non renseignée"}
              </p>
              {zone?.commune ? (
                <p className="mt-1 text-[11px] text-slate-400">
                  Commune : {zone.commune}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-white/[0.08] bg-slate-950/80 p-3">
            {parcelSceneData ? (
              <div className="h-[420px] w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-slate-950/80">
                <ParcelScene
                  pluData={parcelSceneData}
                  fillContainer
                  sunTime={14}
                  className="h-full w-full rounded-none border-0 bg-transparent"
                  hidePromptInput
                />
              </div>
            ) : (
              <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-400">
                Données de géolocalisation manquantes pour cette étude.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

