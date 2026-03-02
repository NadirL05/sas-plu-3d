"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
  MapPin,
  Building2,
  TreePine,
  Wheat,
  Search,
  Loader2,
  Save,
  CheckCircle,
  AlertCircle,
  Layers,
  Lock,
  FileDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { lookupZoneAction, saveProjectAction } from "@/app/actions/plu-actions";
import type { AddressSuggestion, ZoneUrba } from "@/src/lib/plu-engine";
import type { ParcelSceneData } from "@/components/three/ParcelScene";

const ParcelScene = dynamic(
  () => import("@/components/three/ParcelScene").then((m) => ({ default: m.ParcelScene })),
  { ssr: false, loading: () => <div className="w-full aspect-video rounded-lg border border-border bg-muted/50 animate-pulse" /> }
);

// ─── Zone type metadata ───────────────────────────────────────────────────────

const ZONE_TYPES: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ReactNode }
> = {
  U: {
    label: "Zone Urbaine",
    variant: "default",
    icon: <Building2 className="h-3 w-3" />,
  },
  AU: {
    label: "Zone à Urbaniser",
    variant: "secondary",
    icon: <Building2 className="h-3 w-3" />,
  },
  N: {
    label: "Zone Naturelle",
    variant: "outline",
    icon: <TreePine className="h-3 w-3" />,
  },
  A: {
    label: "Zone Agricole",
    variant: "outline",
    icon: <Wheat className="h-3 w-3" />,
  },
};

/** Hauteur max simulée par type de zone (m), en attendant données cadastrales. */
const DEFAULT_MAX_HEIGHT_BY_ZONE: Record<string, number> = {
  U: 12,
  AU: 10,
  N: 6,
  A: 6,
};

function buildParcelSceneData(zone: ZoneUrba | null | undefined): ParcelSceneData | null {
  if (!zone) return null;
  const maxHeight = DEFAULT_MAX_HEIGHT_BY_ZONE[zone.typezone] ?? 8;
  return { maxHeight, footprint: undefined };
}

// ─── Map placeholder ──────────────────────────────────────────────────────────

function MapPlaceholder({ address }: { address: AddressSuggestion | null }) {
  return (
    <div className="relative w-full aspect-video rounded-xl border border-border bg-muted overflow-hidden">
      {/* SVG grid pattern */}
      <svg
        className="absolute inset-0 w-full h-full text-border opacity-50"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="plu-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.75"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#plu-grid)" />
      </svg>

      {address ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          {/* Pulse ring */}
          <div className="relative">
            <span className="absolute inline-flex h-10 w-10 animate-ping rounded-full bg-primary/20" />
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 border border-primary/30">
              <MapPin className="h-5 w-5 text-primary" />
            </div>
          </div>

          {/* Coordinates card */}
          <div className="bg-background/90 backdrop-blur-sm rounded-lg border border-border px-5 py-3 text-center shadow-sm">
            <p className="font-mono text-xs text-muted-foreground tracking-wider">
              {address.lat.toFixed(6)}° N &nbsp;·&nbsp; {address.lon.toFixed(6)}° E
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground truncate max-w-xs">
              {address.city}
            </p>
            {address.postcode && (
              <p className="text-xs text-muted-foreground">{address.postcode}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <MapPin className="h-7 w-7 opacity-25" />
          <p className="text-sm opacity-50">Sélectionnez une adresse</p>
        </div>
      )}
    </div>
  );
}

// ─── Zone info panel ──────────────────────────────────────────────────────────

function ZonePanel({
  zone,
  isLoading,
}: {
  zone: ZoneUrba | null | undefined;
  isLoading: boolean;
}) {
  const meta = zone?.typezone ? ZONE_TYPES[zone.typezone] : null;

  return (
    <Card className="flex-1">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          Informations PLU
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : zone ? (
          <>
            {/* Zone name */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Zone
              </p>
              <p className="text-3xl font-bold text-foreground tracking-tight">
                {zone.libelle}
              </p>
            </div>

            {/* Zone type */}
            {meta && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Type
                </p>
                <Badge variant={meta.variant} className="gap-1.5 text-xs font-medium">
                  {meta.icon}
                  {meta.label}
                </Badge>
              </div>
            )}

            {/* Commune */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Commune
              </p>
              <p className="text-sm font-medium text-foreground">{zone.commune}</p>
            </div>

            {/* Approval date */}
            {zone.datappro && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Approbation
                </p>
                <p className="text-sm text-foreground">{zone.datappro}</p>
              </div>
            )}

            {/* PLU document */}
            {zone.urlfic && (
              <a
                href={zone.urlfic}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                Consulter le document PLU →
              </a>
            )}
          </>
        ) : zone === null ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <AlertCircle className="h-5 w-5 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              Aucune zone PLU trouvée pour cette adresse.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Recherchez une adresse pour voir le zonage.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface PLUDashboardProps {
  /** Pré-résolu côté serveur pour éviter un aller-retour client. */
  isAuthenticated?: boolean;
}

export function PLUDashboard({ isAuthenticated = false }: PLUDashboardProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingZone, setIsLoadingZone] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  // undefined = pas encore cherché, null = pas de zone, ZoneUrba = trouvée
  const [zone, setZone] = useState<ZoneUrba | null | undefined>(undefined);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [scenePrompt, setScenePrompt] = useState("");
  const [captureScene, setCaptureScene] = useState<(() => string | null) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Recherche d'adresse avec debounce ────────────────────────────────────────

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      setSaveState("idle");

      if (value.trim().length < 3) {
        setSuggestions([]);
        setShowDropdown(false);
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(async () => {
        setIsSearching(true);
        try {
          // api-adresse.data.gouv.fr supporte CORS — appel direct depuis le navigateur
          const res = await fetch(
            `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(value.trim())}&limit=5`
          );
          const data = await res.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const results: AddressSuggestion[] = (data.features ?? []).map((f: any) => ({
            label: f.properties.label,
            lon: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
            inseeCode: f.properties.citycode ?? "",
            city: f.properties.city ?? "",
            postcode: f.properties.postcode ?? "",
            score: f.properties.score ?? 0,
          }));
          setSuggestions(results);
          setShowDropdown(results.length > 0);
        } catch {
          setSuggestions([]);
          setShowDropdown(false);
        } finally {
          setIsSearching(false);
        }
      }, 350);
    },
    []
  );

  // ── Sélection d'adresse → lookup GPU ─────────────────────────────────────────

  const handleSelect = useCallback(async (suggestion: AddressSuggestion) => {
    setSelectedAddress(suggestion);
    setQuery(suggestion.label);
    setShowDropdown(false);
    setSuggestions([]);
    setZone(undefined);
    setSaveState("idle");
    setIsLoadingZone(true);

    try {
      const zoneData = await lookupZoneAction(suggestion.lon, suggestion.lat);
      setZone(zoneData);
      toast.success("Données PLU récupérées");
    } catch (error: unknown) {
      setZone(null);

      const errorCode =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: string }).code ?? "UNKNOWN_ERROR")
          : "UNKNOWN_ERROR";

      const errorMessages: Record<string, string> = {
        TIMEOUT:
          "Le serveur d'urbanisme (IGN) est trop lent à répondre. Réessayez dans un instant.",
        WFS_FAILED:
          "Impossible de récupérer le zonage sur cette parcelle. Le service est peut-être en maintenance.",
        GEOCODE_FAILED: "L'adresse n'a pas pu être localisée précisément.",
        INVALID_COORDS: "Les coordonnées de recherche sont invalides.",
      };

      toast.error(errorMessages[errorCode] || "Une erreur inattendue est survenue");
      console.error(`[PLU_ERROR_${errorCode}]`, error);
    } finally {
      setIsLoadingZone(false);
    }
  }, []);

  // ── Enregistrement du projet ──────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!selectedAddress) return;
    setIsSaving(true);

    const result = await saveProjectAction({
      address: selectedAddress,
      zone: zone ?? null,
    });

    setIsSaving(false);
    setSaveState(result.success ? "saved" : "error");
  }, [selectedAddress, zone]);

  const handleExportReport = useCallback(async () => {
    if (!selectedAddress || !zone) return;

    const parcelData = buildParcelSceneData(zone);
    if (!parcelData) {
      toast.error("Impossible de générer un rapport sans données PLU.");
      return;
    }

    setIsExporting(true);

    try {
      const sceneImageDataUrl = captureScene?.() ?? null;
      const projectId = `${selectedAddress.inseeCode || "projet"}-${Date.now()}`;

      const response = await fetch("/api/projects/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          address: {
            label: selectedAddress.label,
            city: selectedAddress.city,
            postcode: selectedAddress.postcode,
            lat: selectedAddress.lat,
            lon: selectedAddress.lon,
          },
          plu: {
            zone: zone.libelle,
            typezone: zone.typezone,
            maxHeight: parcelData.maxHeight,
            footprint: parcelData.footprint ?? null,
          },
          analysisPrompt: scenePrompt,
          sceneImageDataUrl,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Échec de la génération PDF.");
      }

      const blob = await response.blob();
      const fileUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = `rapport-plu-${projectId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(fileUrl);

      toast.success("Rapport PDF téléchargé");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur lors de l'export du rapport.";
      toast.error(message);
      console.error("[EXPORT_REPORT_ERROR]", error);
    } finally {
      setIsExporting(false);
    }
  }, [captureScene, scenePrompt, selectedAddress, zone]);

  // ─────────────────────────────────────────────────────────────────────────────

  const parcelSceneData = buildParcelSceneData(zone);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
      {/* ── Colonne gauche : recherche + carte ── */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        {/* Recherche d'adresse */}
        <div className="relative">
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
            <Input
              type="text"
              value={query}
              onChange={handleQueryChange}
              onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Rechercher une adresse française..."
              className="pl-9 pr-9"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Dropdown de suggestions */}
          {showDropdown && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  // onMouseDown se déclenche avant onBlur — empêche la fermeture prématurée
                  onMouseDown={() => handleSelect(s)}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-2.5 text-sm text-left",
                    "hover:bg-accent hover:text-accent-foreground transition-colors",
                    "border-b border-border last:border-0"
                  )}
                >
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Carte placeholder */}
        <MapPlaceholder address={selectedAddress} />

        {/* Visualisation 3D du potentiel PLU */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Potentiel 3D</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedAddress && zone ? (
              <ParcelScene
                pluData={parcelSceneData}
                className="w-full aspect-video rounded-lg border border-border overflow-hidden"
                onPromptChange={setScenePrompt}
                onCaptureReady={(capture) => setCaptureScene(() => capture)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-12 rounded-lg border border-dashed border-border bg-muted/30 text-center">
                <p className="text-sm text-muted-foreground">
                  Sélectionnez une adresse pour visualiser le potentiel 3D
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Colonne droite : panneau zone + sauvegarde ── */}
      <div className="flex flex-col gap-4">
        <ZonePanel zone={zone} isLoading={isLoadingZone} />

        {selectedAddress && (
          <div className="flex flex-col gap-2">
            {isAuthenticated ? (
              <Button
                onClick={handleSave}
                disabled={isSaving || saveState === "saved"}
                variant={saveState === "saved" ? "outline" : "default"}
                className={cn(
                  "w-full gap-2",
                  saveState === "saved" && "border-green-500/30 text-green-500"
                )}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enregistrement…
                  </>
                ) : saveState === "saved" ? (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    Projet enregistré
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Enregistrer le projet
                  </>
                )}
              </Button>
            ) : (
              <Button variant="outline" disabled className="w-full gap-2 opacity-60">
                <Lock className="h-4 w-4" />
                Connectez-vous pour enregistrer
              </Button>
            )}

            {saveState === "error" && (
              <p className="text-xs text-destructive text-center flex items-center justify-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Erreur lors de l&apos;enregistrement.
              </p>
            )}

            <Button
              onClick={handleExportReport}
              disabled={!zone || isLoadingZone || isExporting}
              variant="outline"
              className="w-full gap-2"
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Génération du rapport…
                </>
              ) : (
                <>
                  <FileDown className="h-4 w-4" />
                  Télécharger le Rapport
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
