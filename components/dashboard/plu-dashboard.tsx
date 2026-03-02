"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  Building2,
  CheckCircle,
  CreditCard,
  FileDown,
  Folder,
  Grid3X3,
  Layers3,
  Loader2,
  Minus,
  Plus,
  Save,
  Satellite,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { lookupDvfAction, lookupZoneAction, saveProjectAction } from "@/app/actions/plu-actions";
import type {
  AddressSuggestion,
  DvfSummary,
  ParcelPolygon,
  ZoneUrba,
} from "@/src/lib/plu-engine";
import type { ParcelSceneData } from "@/components/three/ParcelScene";

declare global {
  interface Window {
    mapboxgl?: {
      accessToken: string;
      Map: new (options: Record<string, unknown>) => {
        on: (event: string, cb: (...args: unknown[]) => void) => void;
        once: (event: string, cb: (...args: unknown[]) => void) => void;
        addControl: (control: unknown, position?: string) => void;
        getCenter: () => { lng: number; lat: number };
        flyTo: (options: Record<string, unknown>) => void;
        setStyle: (style: string) => void;
        zoomIn: (options?: Record<string, unknown>) => void;
        zoomOut: (options?: Record<string, unknown>) => void;
        remove: () => void;
      };
      NavigationControl: new () => unknown;
      Marker: new (options?: Record<string, unknown>) => {
        setLngLat: (coords: [number, number]) => unknown;
        addTo: (map: unknown) => unknown;
      };
    };
  }
}

const ParcelScene = dynamic(
  () =>
    import("@/components/three/ParcelScene").then((m) => ({
      default: m.ParcelScene,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full aspect-video rounded-xl bg-background-dark/70 animate-pulse" />
    ),
  }
);

const DEFAULT_MAX_HEIGHT_BY_ZONE: Record<string, number> = {
  U: 12,
  AU: 10,
  N: 6,
  A: 6,
};
const DEFAULT_MAP_CENTER = { lon: 2.3522, lat: 48.8566 };
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";
const MAP_STYLES = {
  topographic: "mapbox://styles/mapbox/outdoors-v12",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  wireframe: "mapbox://styles/mapbox/dark-v11",
} as const;

const MOCK_ZONE_DATA: { zone: ZoneUrba; maxHeight: number } = {
  zone: {
    libelle: "U",
    typezone: "U",
    commune: "Simulation",
    nomfic: "Mode simulation",
  },
  maxHeight: 12,
};

let mapboxLoaderPromise: Promise<void> | null = null;

function ensureMapboxLoaded(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Mapbox unavailable on server"));
  }
  if (window.mapboxgl) return Promise.resolve();
  if (mapboxLoaderPromise) return mapboxLoaderPromise;

  mapboxLoaderPromise = new Promise((resolve, reject) => {
    const cssHref = "https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css";
    const jsSrc = "https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js";

    if (!document.querySelector(`link[href="${cssHref}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssHref;
      document.head.appendChild(link);
    }

    const existingScript = document.querySelector(`script[src="${jsSrc}"]`);
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Mapbox script failed")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = jsSrc;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Mapbox script failed"));
    document.body.appendChild(script);
  });

  return mapboxLoaderPromise;
}

function buildSyntheticAddressSuggestion(lon: number, lat: number): AddressSuggestion {
  return {
    label: `Coordonnées ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    lon,
    lat,
    inseeCode: "",
    city: "",
    postcode: "",
    score: 1,
  };
}

function extractUploadedUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  const direct = data.url;
  if (typeof direct === "string" && /^https?:\/\//.test(direct)) return direct;

  const fileUrl = (data.file as Record<string, unknown> | undefined)?.url;
  if (typeof fileUrl === "string" && /^https?:\/\//.test(fileUrl)) return fileUrl;

  const files = data.files;
  if (Array.isArray(files) && files.length > 0) {
    const first = files[0] as Record<string, unknown>;
    if (typeof first?.url === "string" && /^https?:\/\//.test(first.url)) {
      return first.url;
    }
  }

  return null;
}

function buildParcelSceneData(
  zone: ZoneUrba | null | undefined,
  parcel: ParcelPolygon | null,
  address?: AddressSuggestion | null
): ParcelSceneData | null {
  if (!zone) return null;
  const maxHeight = DEFAULT_MAX_HEIGHT_BY_ZONE[zone.typezone] ?? 8;

  return {
    maxHeight,
    zoneType: zone.typezone,
    footprint: undefined,
    parcelPolygon: parcel?.geometry,
    parcelCenter: address ? { lon: address.lon, lat: address.lat } : undefined,
    parcelAreaM2: parcel?.areaM2,
  };
}

function formatArea(value?: number | null): string {
  if (typeof value !== "number" || value <= 0) return "-";
  return `${new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 1,
  }).format(value)} m²`;
}

function formatCurrency(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function getBuildabilityLabel(height: number | null): string {
  if (height === null) return "En attente";
  if (height >= 14) return "Excellent (A+)";
  if (height >= 10) return "Bon potentiel (A)";
  if (height >= 7) return "Potentiel modéré (B)";
  return "Potentiel limité (C)";
}

interface PLUDashboardProps {
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
  const [zone, setZone] = useState<ZoneUrba | null | undefined>(undefined);
  const [parcel, setParcel] = useState<ParcelPolygon | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [isLoadingDvf, setIsLoadingDvf] = useState(false);
  const [dvfSummary, setDvfSummary] = useState<DvfSummary | null>(null);
  const [scenePrompt, setScenePrompt] = useState("");
  const [captureScene, setCaptureScene] = useState<(() => string | null) | null>(null);
  const [mapCenter, setMapCenter] = useState(DEFAULT_MAP_CENTER);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapVisualMode, setMapVisualMode] =
    useState<keyof typeof MAP_STYLES>("topographic");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    once: (event: string, cb: (...args: unknown[]) => void) => void;
    addControl: (control: unknown, position?: string) => void;
    getCenter: () => { lng: number; lat: number };
    flyTo: (options: Record<string, unknown>) => void;
    setStyle: (style: string) => void;
    zoomIn: (options?: Record<string, unknown>) => void;
    zoomOut: (options?: Record<string, unknown>) => void;
    remove: () => void;
  } | null>(null);
  const mapMarkerRef = useRef<{
    setLngLat: (coords: [number, number]) => unknown;
    addTo: (map: unknown) => unknown;
  } | null>(null);
  const moveLookupDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextMoveLookupRef = useRef(false);
  const lookupRequestIdRef = useRef(0);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
        const res = await fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(
            value.trim()
          )}&limit=5`
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
  }, []);

  const runLookup = useCallback(async (suggestion: AddressSuggestion) => {
    const requestId = lookupRequestIdRef.current + 1;
    lookupRequestIdRef.current = requestId;

    setSelectedAddress(suggestion);
    setQuery(suggestion.label);
    setShowDropdown(false);
    setSuggestions([]);
    setZone(undefined);
    setParcel(null);
    setIsSimulationMode(false);
    setDvfSummary(null);
    setSaveState("idle");
    setIsLoadingZone(true);
    setIsLoadingDvf(true);

    const dvfPromise = lookupDvfAction(suggestion.lon, suggestion.lat).catch((error) => {
      console.warn("[DVF_LOOKUP_WARNING]", error);
      return null;
    });

    try {
      const lookupResult = await lookupZoneAction(suggestion.lon, suggestion.lat);
      if (requestId !== lookupRequestIdRef.current) return;
      const resolvedZone = lookupResult.zone ?? MOCK_ZONE_DATA.zone;
      const fallbackEnabled = !lookupResult.zone;

      setZone(resolvedZone);
      setParcel(lookupResult.parcel);
      setIsSimulationMode(fallbackEnabled);

      if (!fallbackEnabled) {
        toast.success("Données PLU récupérées");
      }
    } catch (error: unknown) {
      if (requestId !== lookupRequestIdRef.current) return;
      setZone(MOCK_ZONE_DATA.zone);
      setParcel(null);
      setIsSimulationMode(true);

      const errorCode =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: string }).code ?? "UNKNOWN_ERROR")
          : "UNKNOWN_ERROR";

      const errorMessages: Record<string, string> = {
        TIMEOUT: "Le serveur d'urbanisme (IGN) est trop lent à répondre.",
        WFS_FAILED:
          "Impossible de récupérer le zonage sur cette parcelle.",
        GEOCODE_FAILED: "L'adresse n'a pas pu être localisée précisément.",
        INVALID_COORDS: "Les coordonnées de recherche sont invalides.",
      };

      toast.warning(
        `${errorMessages[errorCode] || "Erreur de récupération PLU."} Mode simulation activé.`
      );
      console.error(`[PLU_ERROR_${errorCode}]`, error);
    } finally {
      if (requestId !== lookupRequestIdRef.current) return;
      setIsLoadingZone(false);
      const dvfResult = await dvfPromise;
      if (requestId !== lookupRequestIdRef.current) return;
      setDvfSummary(dvfResult);
      setIsLoadingDvf(false);
    }
  }, []);

  const handleSelect = useCallback(
    async (suggestion: AddressSuggestion) => {
      await runLookup(suggestion);
      setMapCenter({ lon: suggestion.lon, lat: suggestion.lat });
      if (mapRef.current) {
        suppressNextMoveLookupRef.current = true;
        mapRef.current.flyTo({
          center: [suggestion.lon, suggestion.lat],
          zoom: 18,
          duration: 900,
          essential: true,
        });
      }
      if (mapMarkerRef.current && mapRef.current) {
        mapMarkerRef.current.setLngLat([suggestion.lon, suggestion.lat]).addTo(mapRef.current);
      }
    },
    [runLookup]
  );

  const handleMapCoordinateSelect = useCallback(
    async (lon: number, lat: number) => {
      const syntheticSuggestion = buildSyntheticAddressSuggestion(lon, lat);
      await runLookup(syntheticSuggestion);
      setMapCenter({ lon, lat });
      if (mapMarkerRef.current && mapRef.current) {
        mapMarkerRef.current.setLngLat([lon, lat]).addTo(mapRef.current);
      }
    },
    [runLookup]
  );

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setMapError("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN manquant.");
      return;
    }
    if (!mapContainerRef.current || mapRef.current) return;

    let cancelled = false;

    ensureMapboxLoaded()
      .then(() => {
        if (cancelled || !window.mapboxgl || !mapContainerRef.current) return;

        window.mapboxgl.accessToken = MAPBOX_TOKEN;
        const map = new window.mapboxgl.Map({
          container: mapContainerRef.current,
          style: MAP_STYLES.topographic,
          center: [DEFAULT_MAP_CENTER.lon, DEFAULT_MAP_CENTER.lat],
          zoom: 14,
          pitch: 45,
          bearing: -17,
          antialias: true,
        });

        map.addControl(new window.mapboxgl.NavigationControl(), "top-right");
        mapRef.current = map;
        mapMarkerRef.current = new window.mapboxgl.Marker({ color: "#3c3cf6" })
          .setLngLat([DEFAULT_MAP_CENTER.lon, DEFAULT_MAP_CENTER.lat])
          .addTo(map);

        map.on("load", () => {
          setIsMapReady(true);
          setMapError(null);
        });

        map.on("moveend", () => {
          if (!mapRef.current) return;
          const center = mapRef.current.getCenter();
          const lon = Number(center.lng);
          const lat = Number(center.lat);
          setMapCenter({ lon, lat });
          if (mapMarkerRef.current) {
            mapMarkerRef.current.setLngLat([lon, lat]).addTo(mapRef.current);
          }

          if (suppressNextMoveLookupRef.current) {
            suppressNextMoveLookupRef.current = false;
            return;
          }

          if (moveLookupDebounceRef.current) clearTimeout(moveLookupDebounceRef.current);
          moveLookupDebounceRef.current = setTimeout(() => {
            void handleMapCoordinateSelect(lon, lat);
          }, 350);
        });

        map.on("click", (evt: unknown) => {
          const event = evt as { lngLat?: { lng: number; lat: number } };
          const lon = event.lngLat?.lng;
          const lat = event.lngLat?.lat;
          if (typeof lon !== "number" || typeof lat !== "number") return;
          if (mapMarkerRef.current && mapRef.current) {
            mapMarkerRef.current.setLngLat([lon, lat]).addTo(mapRef.current);
          }
          void handleMapCoordinateSelect(lon, lat);
        });
      })
      .catch((error) => {
        const message =
          error instanceof Error
            ? error.message
            : "Impossible de charger la carte interactive.";
        setMapError(message);
      });

    return () => {
      cancelled = true;
      if (moveLookupDebounceRef.current) {
        clearTimeout(moveLookupDebounceRef.current);
        moveLookupDebounceRef.current = null;
      }
      mapRef.current?.remove();
      mapRef.current = null;
      mapMarkerRef.current = null;
      setIsMapReady(false);
    };
  }, [handleMapCoordinateSelect]);

  useEffect(() => {
    if (!mapRef.current) return;
    setIsMapReady(false);
    mapRef.current.setStyle(MAP_STYLES[mapVisualMode]);
    mapRef.current.once("idle", () => setIsMapReady(true));
  }, [mapVisualMode]);

  const handleSave = useCallback(async () => {
    if (!selectedAddress) return;

    setIsSaving(true);
    const result = await saveProjectAction({
      address: selectedAddress,
      zone: zone ?? null,
    });
    setIsSaving(false);

    if (result.success) {
      setSaveState("saved");
      toast.success("Projet enregistré");
      return;
    }

    setSaveState("error");
    if (result.code === "PROJECT_LIMIT_REACHED") {
      toast.error("Limite atteinte, passez en PRO");
      return;
    }

    toast.error(result.error ?? "Erreur lors de l'enregistrement.");
  }, [selectedAddress, zone]);

  const uploadSceneCapture = useCallback(
    async (sceneImageDataUrl: string, projectId: string): Promise<string | null> => {
      const response = await fetch("/api/media/upload-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          imageDataUrl: sceneImageDataUrl,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Upload externe indisponible.");
      }

      const data = (await response.json()) as unknown;
      return extractUploadedUrl(data);
    },
    []
  );

  const handleExportReport = useCallback(async () => {
    if (!selectedAddress || !zone) return;

    const parcelData = buildParcelSceneData(zone, parcel, selectedAddress);
    if (!parcelData) {
      toast.error("Impossible de générer un rapport sans données PLU.");
      return;
    }

    setIsExporting(true);

    try {
      const sceneImageDataUrl = captureScene?.() ?? null;
      const projectId = `${selectedAddress.inseeCode || "projet"}-${Date.now()}`;
      let sceneImageUrl: string | null = null;

      if (sceneImageDataUrl) {
        try {
          sceneImageUrl = await uploadSceneCapture(sceneImageDataUrl, projectId);
        } catch (uploadError) {
          console.warn("[SCENE_UPLOAD_WARNING]", uploadError);
          toast.warning(
            "Upload externe indisponible, export PDF avec capture locale."
          );
        }
      }

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
          sceneImageUrl,
          sceneImageDataUrl: sceneImageUrl ? null : sceneImageDataUrl,
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
  }, [captureScene, parcel, scenePrompt, selectedAddress, uploadSceneCapture, zone]);

  const parcelSceneData = buildParcelSceneData(zone, parcel, selectedAddress);
  const maxHeight = zone
    ? zone.typezone === MOCK_ZONE_DATA.zone.typezone
      ? MOCK_ZONE_DATA.maxHeight
      : DEFAULT_MAX_HEIGHT_BY_ZONE[zone.typezone] ?? 8
    : null;
  const buildabilityLabel = getBuildabilityLabel(maxHeight);
  const mutationCount = dvfSummary?.mutationCount ?? 0;
  const dvfMomentumPct =
    mutationCount > 0 ? Math.min(9.9, Math.max(1.2, mutationCount / 55)) : null;
  const sparklineHeights = [30, 45, 40, 60, 55, 75, 90];

  return (
    <div className="w-full h-[calc(100vh-8rem)] min-h-[760px]">
      <div className="relative h-full overflow-hidden rounded-2xl glass-panel glow-border">
        <header className="absolute top-5 left-1/2 -translate-x-1/2 z-40 w-full max-w-xl px-4">
          <div className="glass-panel rounded-2xl flex items-center px-4 py-3">
            <Search className="mr-3 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              value={query}
              onChange={handleQueryChange}
              onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 120)}
              placeholder="Search parcels, architects, or PLU rules..."
              className="h-auto border-none bg-transparent px-0 py-0 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-0"
            />
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
          </div>

          {showDropdown ? (
            <div className="absolute top-full mt-2 w-full overflow-hidden rounded-xl glass-panel z-50">
              <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400 border-b ultra-fine-border">
                Suggestions
              </div>
              <div className="flex flex-col">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onMouseDown={() => handleSelect(s)}
                    className="flex items-center justify-between px-4 py-3 text-left text-sm text-slate-100 hover:bg-white/5 transition-colors"
                  >
                    <span className="truncate">{s.label}</span>
                    <span className="text-[10px] font-semibold text-primary/90 uppercase tracking-wide">
                      {s.postcode || s.city}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </header>

        <div className="flex h-full flex-col xl:flex-row">
          <section className="relative flex-1 overflow-hidden">
            <div className="absolute inset-0 bg-background-dark">
              {mapError ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-amber-200/90">
                  {mapError}
                </div>
              ) : (
                <>
                  <div ref={mapContainerRef} className="h-full w-full" />
                  <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_10%,rgba(11,11,20,0.45)_100%)]" />
                  {!isMapReady ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-background-dark/70 text-xs text-slate-300">
                      Chargement de la carte satellite...
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="absolute left-6 top-24 z-30 flex flex-col gap-2">
              <div className="glass-panel rounded-xl p-1.5 flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setMapVisualMode("topographic")}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    mapVisualMode === "topographic"
                      ? "bg-primary/20 text-primary"
                      : "text-slate-400 hover:bg-slate-800/40"
                  }`}
                >
                  <Layers3 className="h-3.5 w-3.5" /> Topographic
                </button>
                <button
                  type="button"
                  onClick={() => setMapVisualMode("satellite")}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    mapVisualMode === "satellite"
                      ? "bg-primary/20 text-primary"
                      : "text-slate-400 hover:bg-slate-800/40"
                  }`}
                >
                  <Satellite className="h-3.5 w-3.5" /> Satellite
                </button>
                <button
                  type="button"
                  onClick={() => setMapVisualMode("wireframe")}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    mapVisualMode === "wireframe"
                      ? "bg-primary/20 text-primary"
                      : "text-slate-400 hover:bg-slate-800/40"
                  }`}
                >
                  <Grid3X3 className="h-3.5 w-3.5" /> Wireframe
                </button>
              </div>
              <div className="glass-panel rounded-xl p-1.5 flex flex-col gap-1">
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800/40"
                  onClick={() => mapRef.current?.zoomIn({ duration: 240 })}
                  aria-label="Zoom avant"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border-t border-white/10 text-slate-300 hover:bg-slate-800/40"
                  onClick={() => mapRef.current?.zoomOut({ duration: 240 })}
                  aria-label="Zoom arrière"
                >
                  <Minus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {selectedAddress ? (
              <div className="absolute bottom-32 left-1/2 z-30 -translate-x-1/2 rounded-full border border-primary/30 bg-background-dark/70 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                Plot selected - {selectedAddress.label}
              </div>
            ) : null}

            <div className="absolute bottom-6 left-6 z-30 rounded-md bg-black/45 px-2 py-1 text-[10px] text-slate-100">
              {mapCenter.lat.toFixed(5)}, {mapCenter.lon.toFixed(5)}
            </div>

            <div className="absolute bottom-24 right-6 z-30 w-[560px] max-w-[65vw]">
              {selectedAddress && zone ? (
                <ParcelScene
                  pluData={parcelSceneData}
                  className="w-full aspect-video rounded-xl border border-white/10 overflow-hidden bg-transparent"
                  promptValue={scenePrompt}
                  hidePromptInput
                  onPromptChange={setScenePrompt}
                  onCaptureReady={(capture) => setCaptureScene(() => capture)}
                />
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-white/15 bg-background-dark/55 text-sm text-slate-300">
                  Sélectionnez une adresse pour afficher la visualisation 3D
                </div>
              )}
            </div>

            <footer className="absolute bottom-6 left-1/2 z-30 w-full max-w-3xl -translate-x-1/2 px-6">
              <div className="glass-panel rounded-2xl flex items-center gap-3 px-5 py-3">
                <Sparkles className="h-4 w-4 text-primary" />
                <Input
                  value={scenePrompt}
                  onChange={(e) => setScenePrompt(e.target.value)}
                  placeholder="Ask AI about zoning potential or height limits..."
                  disabled={!selectedAddress || !zone}
                  className="h-auto border-none bg-transparent px-0 py-0 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-0"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!selectedAddress || !zone}
                  className="bg-gradient-to-r from-primary to-indigo-500 text-white"
                >
                  Analyze
                </Button>
              </div>
            </footer>
          </section>

          <aside className="w-full xl:w-[400px] border-t xl:border-t-0 xl:border-l border-white/10 bg-background-dark/70 backdrop-blur-xl p-6 xl:p-8 overflow-y-auto space-y-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Land Intelligence
                </p>
                <h1 className="mt-1 text-2xl font-bold text-white">
                  {selectedAddress ? "Plot Selected" : "Aucune parcelle"}
                </h1>
                <p className="mt-1 text-sm text-slate-400 truncate">
                  {selectedAddress?.label ?? "Sélectionnez une adresse pour démarrer"}
                </p>
              </div>
              <button
                type="button"
                aria-label="Fermer"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-slate-800/40 text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Zoning Specs
                </h3>
                {zone ? (
                  <span className="rounded border border-primary/30 bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
                    {zone.libelle}
                  </span>
                ) : null}
              </div>

              {isLoadingZone ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : zone ? (
                <>
                  {isSimulationMode ? (
                    <div className="rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
                      Affichage 3D basé sur une simulation (Serveur IGN indisponible)
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] uppercase text-slate-500">Max Height</p>
                      <p className="text-3xl font-black text-white">{maxHeight ?? "-"}m</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-slate-500">Surface</p>
                      <p className="text-2xl font-bold text-white">{formatArea(parcel?.areaM2)}</p>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between border-b border-white/10 py-2">
                      <span className="text-slate-400">Type zone</span>
                      <span className="font-medium text-slate-100">{zone.typezone}</span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-slate-400">Commune</span>
                      <span className="font-medium text-slate-100">{zone.commune}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="py-6 text-sm text-slate-400 text-center">
                  Aucune donnée PLU disponible pour cette sélection.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-slate-400">Market Value</p>
                <span className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[9px] font-bold uppercase text-amber-400">
                  Données Certifiées DVF
                </span>
              </div>

              {isLoadingDvf ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-8 w-32 rounded bg-white/10" />
                  <div className="h-3 w-28 rounded bg-white/10" />
                </div>
              ) : !dvfSummary || dvfSummary.mutationCount === 0 ? (
                <p className="text-[11px] text-slate-400">
                  Données DVF non disponibles pour ce secteur
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-3xl font-black text-white">{formatCurrency(dvfSummary.medianValueEur)}</p>
                      <p className="text-[11px] text-slate-400">
                        {dvfSummary.mutationCount} mutations récentes
                      </p>
                    </div>
                    {dvfMomentumPct ? (
                      <span className="text-xs font-bold text-emerald-400">
                        +{dvfMomentumPct.toFixed(1)}%
                      </span>
                    ) : null}
                  </div>

                  <div className="h-16 w-full flex items-end gap-1">
                    {sparklineHeights.map((height, index) => (
                      <div
                        key={`dvf-spark-${index}`}
                        className={`flex-1 rounded-t-sm ${
                          index === sparklineHeights.length - 1
                            ? "bg-primary shadow-[0_0_10px_rgba(60,60,246,0.5)]"
                            : "bg-slate-800"
                        }`}
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>

                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <span>2022</span>
                    <span>2026 proj.</span>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 space-y-2">
              <div className="flex justify-between py-2 text-sm border-b border-white/10">
                <span className="text-slate-400">Parcel Surface</span>
                <span className="font-semibold text-slate-100">{formatArea(parcel?.areaM2)}</span>
              </div>
              <div className="flex justify-between py-2 text-sm border-b border-white/10">
                <span className="text-slate-400">Buildability Index</span>
                <span className="font-semibold text-slate-100">{buildabilityLabel}</span>
              </div>
              <div className="flex justify-between py-2 text-sm">
                <span className="text-slate-400">Historical Constraints</span>
                <span className="font-semibold text-slate-100">
                  {isSimulationMode ? "À confirmer" : "Aucune majeure"}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                onClick={handleExportReport}
                disabled={!zone || isLoadingZone || isExporting}
                className="group relative w-full overflow-hidden gap-2 bg-slate-100 text-slate-900 hover:bg-white"
              >
                <span
                  className={`absolute inset-y-0 left-0 bg-primary/10 transition-all duration-500 ${
                    isExporting ? "w-[65%]" : "w-0"
                  }`}
                />
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin z-10" />
                    <span className="z-10">Génération...</span>
                  </>
                ) : (
                  <>
                    <FileDown className="h-4 w-4 z-10" />
                    <span className="z-10">Download PDF Report</span>
                  </>
                )}
              </Button>
              <p className="text-center text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Generated in 1.2s
              </p>

              <Button
                onClick={handleSave}
                disabled={!isAuthenticated || !selectedAddress || isSaving || saveState === "saved"}
                variant="secondary"
                className="w-full gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enregistrement...
                  </>
                ) : saveState === "saved" ? (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    Saved
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save
                  </>
                )}
              </Button>

              {!isAuthenticated ? (
                <p className="text-xs text-slate-400 text-center">
                  Connectez-vous pour sauvegarder vos projets.
                </p>
              ) : null}
            </div>

            {saveState === "error" ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">Échec de sauvegarde</p>
                  <p className="text-xs text-slate-400">Vérifiez vos droits ou réessayez.</p>
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border border-white/10 bg-slate-900/40 p-4 text-xs text-slate-400 space-y-2">
              <p className="flex items-center gap-2"><Search className="h-3.5 w-3.5" /> Recherche</p>
              <p className="flex items-center gap-2"><Folder className="h-3.5 w-3.5" /> Mes Projets</p>
              <p className="flex items-center gap-2"><CreditCard className="h-3.5 w-3.5" /> Billing</p>
              <p className="flex items-center gap-2"><Settings className="h-3.5 w-3.5" /> Settings</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
