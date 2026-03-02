"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  BarChart3,
  Building2,
  CheckCircle,
  CircleAlert,
  FileDown,
  Grid3X3,
  Layers3,
  Loader2,
  MapPin,
  Minus,
  Plus,
  Save,
  Satellite,
  Search,
  ShieldCheck,
  Sparkles,
  Waves,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  lookupDvfAction,
  lookupGeorisquesAction,
  lookupZoneAction,
  saveProjectAction,
} from "@/app/actions/plu-actions";
import { computeProfitabilityScore } from "@/src/lib/plu-engine";
import type {
  AddressSuggestion,
  DvfSummary,
  GeorisquesSummary,
  ParcelPolygon,
  RiskLevel,
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
        getZoom: () => number;
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
  if (!address) return null;
  const maxHeight = zone
    ? DEFAULT_MAX_HEIGHT_BY_ZONE[zone.typezone] ?? 8
    : MOCK_ZONE_DATA.maxHeight;

  return {
    maxHeight,
    zoneType: zone?.typezone,
    footprint: undefined,
    parcelPolygon: parcel?.geometry,
    parcelCenter: { lon: address.lon, lat: address.lat },
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

function getRiskVisual(level: RiskLevel): {
  label: string;
  dotClassName: string;
  textClassName: string;
} {
  if (level === "HIGH") {
    return {
      label: "Élevé",
      dotClassName: "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.55)]",
      textClassName: "text-red-300",
    };
  }
  if (level === "MEDIUM") {
    return {
      label: "Modéré",
      dotClassName: "bg-orange-300 shadow-[0_0_10px_rgba(253,186,116,0.45)]",
      textClassName: "text-orange-200",
    };
  }
  if (level === "LOW") {
    return {
      label: "Faible",
      dotClassName: "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.45)]",
      textClassName: "text-emerald-200",
    };
  }
  return {
    label: "Inconnu",
    dotClassName: "bg-slate-400",
    textClassName: "text-slate-300",
  };
}

function buildMarketTrendSeries(summary: DvfSummary | null): number[] {
  if (!summary || summary.mutationCount <= 0) {
    return [42, 45, 44, 48, 50, 52, 54];
  }

  const median = typeof summary.medianValueEur === "number" ? summary.medianValueEur : 0;
  const count = Math.max(1, summary.mutationCount);
  const amplitude = Math.min(9, Math.max(3, Math.log10(count + 1) * 4));
  const base = median > 0 ? Math.min(72, 44 + Math.log10(median) * 6) : 52;

  return [
    base - amplitude * 0.8,
    base - amplitude * 0.25,
    base - amplitude * 0.45,
    base + amplitude * 0.15,
    base + amplitude * 0.05,
    base + amplitude * 0.55,
    base + amplitude * 0.95,
  ].map((value) => Math.max(18, Math.min(92, value)));
}

interface TrendPoint {
  x: number;
  y: number;
}

function buildSmoothBezierPath(points: TrendPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
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
  const [isLoadingRisks, setIsLoadingRisks] = useState(false);
  const [georisquesSummary, setGeorisquesSummary] = useState<GeorisquesSummary | null>(null);
  const [scenePrompt, setScenePrompt] = useState("");
  const [captureScene, setCaptureScene] = useState<(() => string | null) | null>(null);
  const [mapCenter, setMapCenter] = useState(DEFAULT_MAP_CENTER);
  const [mapZoom, setMapZoom] = useState(14);
  const [sunTime, setSunTime] = useState(14);
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
    getZoom: () => number;
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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
    // Fallback immédiat pour garantir un rendu 3D prioritaire à 12m.
    setZone(MOCK_ZONE_DATA.zone);
    setParcel(null);
    setIsSimulationMode(false);
    setDvfSummary(null);
    setGeorisquesSummary(null);
    setSaveState("idle");
    setIsLoadingZone(true);
    setIsLoadingDvf(true);
    setIsLoadingRisks(true);

    const dvfPromise = lookupDvfAction(suggestion.lon, suggestion.lat).catch((error) => {
      console.warn("[DVF_LOOKUP_WARNING]", error);
      return null;
    });
    const georisquesPromise = lookupGeorisquesAction(suggestion.lon, suggestion.lat).catch(
      (error) => {
        console.warn("[GEORISQUES_LOOKUP_WARNING]", error);
        return null;
      }
    );

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
      const [dvfResult, georisquesResult] = await Promise.all([dvfPromise, georisquesPromise]);
      if (requestId !== lookupRequestIdRef.current) return;
      setDvfSummary(dvfResult);
      setGeorisquesSummary(georisquesResult);
      setIsLoadingDvf(false);
      setIsLoadingRisks(false);
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
        setMapZoom(18);
      }
      if (mapMarkerRef.current && mapRef.current) {
        mapMarkerRef.current.setLngLat([suggestion.lon, suggestion.lat]);
        mapMarkerRef.current.addTo(mapRef.current);
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
        mapMarkerRef.current.setLngLat([lon, lat]);
        mapMarkerRef.current.addTo(mapRef.current);
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
        const marker = new window.mapboxgl.Marker({ color: "#3c3cf6" });
        marker.setLngLat([DEFAULT_MAP_CENTER.lon, DEFAULT_MAP_CENTER.lat]);
        marker.addTo(map);
        mapMarkerRef.current = marker;

        map.on("load", () => {
          setIsMapReady(true);
          setMapError(null);
          setMapZoom(map.getZoom());
        });

        map.on("moveend", () => {
          if (!mapRef.current) return;
          const center = mapRef.current.getCenter();
          const lon = Number(center.lng);
          const lat = Number(center.lat);
          setMapZoom(mapRef.current.getZoom());
          setMapCenter({ lon, lat });
          if (mapMarkerRef.current && mapRef.current) {
            mapMarkerRef.current.setLngLat([lon, lat]);
            mapMarkerRef.current.addTo(mapRef.current);
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

        map.on("zoom", () => {
          if (!mapRef.current) return;
          setMapZoom(mapRef.current.getZoom());
        });

        map.on("click", (evt: unknown) => {
          const event = evt as { lngLat?: { lng: number; lat: number } };
          const lon = event.lngLat?.lng;
          const lat = event.lngLat?.lat;
          if (typeof lon !== "number" || typeof lat !== "number") return;
          if (mapMarkerRef.current && mapRef.current) {
            mapMarkerRef.current.setLngLat([lon, lat]);
            mapMarkerRef.current.addTo(mapRef.current);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/") return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase() ?? "";
      const isTypingTarget =
        tagName === "input" ||
        tagName === "textarea" ||
        target?.isContentEditable === true;

      if (isTypingTarget) return;

      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
  const trendSeries = buildMarketTrendSeries(dvfSummary);
  const trendWidth = 280;
  const trendHeight = 72;
  const trendStepX = trendWidth / Math.max(1, trendSeries.length - 1);
  const trendPoints: TrendPoint[] = trendSeries.map((value, index) => ({
    x: index * trendStepX,
    y: trendHeight - (value / 100) * trendHeight,
  }));
  const trendPath = buildSmoothBezierPath(trendPoints);
  const firstTrendPoint = trendPoints[0];
  const lastTrendPoint = trendPoints[trendPoints.length - 1];
  const trendAreaPath =
    trendPath && firstTrendPoint && lastTrendPoint
      ? `${trendPath} L ${lastTrendPoint.x.toFixed(2)} ${trendHeight.toFixed(2)} L ${firstTrendPoint.x.toFixed(2)} ${trendHeight.toFixed(2)} Z`
      : "";
  const groundCoveragePct =
    zone?.typezone === "U"
      ? 65
      : zone?.typezone === "AU"
        ? 55
        : zone?.typezone === "N" || zone?.typezone === "A"
          ? 25
          : 50;
  const setbackDistance = zone?.typezone === "U" ? 4.5 : zone?.typezone === "AU" ? 5 : 6;
  const profitability = computeProfitabilityScore({
    parcelAreaM2: parcel?.areaM2 ?? null,
    coveragePct: groundCoveragePct,
    maxHeightM: maxHeight,
    medianDvfValueEur: dvfSummary?.medianValueEur ?? null,
  });
  const profitabilityGaugeRadius = 52;
  const profitabilityGaugeCircumference = 2 * Math.PI * profitabilityGaugeRadius;
  const profitabilityGaugeOffset = profitability
    ? profitabilityGaugeCircumference * (1 - profitability.score / 100)
    : profitabilityGaugeCircumference;
  const profitabilityToneClass =
    profitability && profitability.score >= 72
      ? "text-emerald-300"
      : profitability && profitability.score >= 45
        ? "text-orange-200"
        : "text-rose-300";
  const floodRiskVisual = getRiskVisual(georisquesSummary?.floodLevel ?? "UNKNOWN");
  const clayRiskVisual = getRiskVisual(georisquesSummary?.clayLevel ?? "UNKNOWN");
  const riskRank: Record<RiskLevel, number> = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  const overallRiskLevel: RiskLevel = georisquesSummary
    ? riskRank[georisquesSummary.floodLevel] >= riskRank[georisquesSummary.clayLevel]
      ? georisquesSummary.floodLevel
      : georisquesSummary.clayLevel
    : "UNKNOWN";
  const overallRiskVisual = getRiskVisual(overallRiskLevel);
  const hazardsCountText =
    typeof georisquesSummary?.hazardCount === "number" && georisquesSummary.hazardCount > 0
      ? `${georisquesSummary.hazardCount} aléas`
      : "Aucun aléa détecté";

  const salesHistoryRows =
    dvfSummary && dvfSummary.mutationCount > 0
      ? [
          {
            date: "Dernière mutation",
            type: "Mutation",
            surface: parcel?.areaM2 ? `${Math.round(parcel.areaM2)} m²` : "N/A",
            price: formatCurrency(dvfSummary.medianValueEur),
          },
          {
            date: "Période analysée",
            type: "DVF",
            surface: `${dvfSummary.mutationCount} ventes`,
            price: formatCurrency(dvfSummary.medianValueEur),
          },
        ]
      : [
          { date: "-", type: "Aucune donnée", surface: "-", price: "-" },
          { date: "-", type: "Aucune donnée", surface: "-", price: "-" },
        ];
  const zoningCardsActive = !!selectedAddress && !isLoadingZone;

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-background-dark font-display text-slate-100">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8">
        <main className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="xl:col-start-1 xl:row-span-3 rounded-3xl border border-white/[0.08] bg-slate-950/70 p-2 md:p-3">
              <div className="relative h-[720px] overflow-hidden rounded-[1.35rem] bg-slate-950/70">
            <div className="absolute inset-0 bg-background-dark">
              {mapError ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-amber-200/90">
                  {mapError}
                </div>
              ) : (
                <>
                  <div ref={mapContainerRef} className="h-full w-full" />
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_10%,rgba(11,11,20,0.45)_100%)]" />
                  {!isMapReady ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-background-dark/70 text-xs text-slate-300">
                      Chargement de la carte satellite...
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="absolute left-1/2 top-6 z-40 w-full max-w-3xl -translate-x-1/2 px-4">
              <div className="flex h-14 items-center gap-3 rounded-2xl bg-black/40 px-5 backdrop-blur-3xl shadow-[0_22px_55px_rgba(0,0,0,0.65)]">
                <Search className="h-4 w-4 shrink-0 text-slate-300" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={handleQueryChange}
                  onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 120)}
                  placeholder="Rechercher une adresse..."
                  className="h-auto border-none bg-transparent px-0 py-0 text-sm text-slate-100 placeholder:text-slate-400 shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
                />
                {isSearching ? (
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                    Live
                  </span>
                ) : null}
              </div>

              {showDropdown ? (
              <div className="absolute left-4 right-4 top-full z-50 mt-3 overflow-hidden rounded-2xl bg-slate-950/90 p-2 backdrop-blur-3xl shadow-[0_20px_55px_rgba(2,6,23,0.65)]">
                  <div className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
                    Suggestions
                  </div>
                  <div className="space-y-1">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.label}
                        type="button"
                        onMouseDown={() => handleSelect(suggestion)}
                        className="flex w-full items-center justify-between gap-4 rounded-xl px-4 py-3.5 text-left transition-colors hover:bg-white/[0.04]"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                          <div className="min-w-0">
                            <p className="truncate text-sm text-slate-100">{suggestion.label}</p>
                            <p className="truncate text-xs text-slate-500">
                              {suggestion.city || "Ville non renseignée"}
                            </p>
                          </div>
                        </div>
                        <span className="text-[11px] font-medium text-slate-400">
                          {suggestion.postcode || suggestion.city}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {!selectedAddress || !parcelSceneData ? (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background-dark/65 px-8 text-center">
                <div className="relative mb-8 flex h-40 w-40 items-center justify-center">
                  <div className="absolute inset-0 rotate-12 rounded-xl border border-white/10" />
                  <div className="absolute inset-0 -rotate-12 rounded-xl border border-white/10" />
                  <Grid3X3 className="h-14 w-14 text-slate-700" />
                </div>
                <h3 className="mb-2 text-2xl font-light text-slate-300">
                  Explorez une parcelle pour débloquer l&apos;intelligence foncière
                </h3>
                <p className="text-slate-500">
                  Sélectionnez une zone sur la carte pour voir les détails d&apos;urbanisme
                </p>
              </div>
            ) : null}

            <div className="absolute left-6 top-24 z-30 flex flex-col gap-2">
              <div className="premium-glass rounded-xl p-1.5">
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
              <div className="premium-glass rounded-xl p-1.5">
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
              <div className="premium-glass absolute bottom-32 left-1/2 z-30 -translate-x-1/2 rounded-full border border-primary/30 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                Plot selected - {selectedAddress.label}
              </div>
            ) : null}

            <div className="premium-glass absolute bottom-6 left-6 z-30 rounded-md px-2 py-1 text-[10px] text-slate-100">
              {mapCenter.lat.toFixed(5)}, {mapCenter.lon.toFixed(5)} · zoom {mapZoom.toFixed(2)}
            </div>

            <footer className="absolute bottom-6 left-1/2 z-30 w-full max-w-3xl -translate-x-1/2 px-6">
              <div className="premium-glass rounded-2xl px-5 py-3">
                <div className="flex items-center gap-3">
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
                  className="bg-primary text-white hover:bg-primary/90"
                >
                  Analyze
                </Button>
                </div>
              </div>
            </footer>
          </div>
        </section>

        {selectedAddress && parcelSceneData ? (
          <section className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 xl:col-start-1">
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                  Modélisation 3D
                </p>
                <p className="text-xs text-slate-500">
                  Volume théorique selon le PLU actif.
                </p>
              </div>
            </div>
            <div className="relative h-[440px] w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-slate-950/80">
              <ParcelScene
                pluData={parcelSceneData}
                fillContainer
                mapZoom={mapZoom}
                sunTime={sunTime}
                className="h-full w-full rounded-none border-0 bg-transparent"
                promptValue={scenePrompt}
                hidePromptInput
                onPromptChange={setScenePrompt}
                onCaptureReady={(capture) => setCaptureScene(() => capture)}
              />
            </div>
            <div className="mt-4 flex flex-col gap-2 px-1 text-[11px] text-slate-300 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Héliodon
                </p>
                <p className="text-xs text-slate-500">
                  Faites glisser pour simuler la course du soleil autour de la parcelle.
                </p>
              </div>
              <div className="flex flex-1 items-center gap-3 md:justify-end">
                <div className="relative flex-1 max-w-xs">
                  <input
                    type="range"
                    min={0}
                    max={24}
                    step={0.5}
                    value={sunTime}
                    onChange={(event) => setSunTime(Number(event.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-800/80 accent-primary"
                    aria-label="Héliodon (heure solaire)"
                  />
                </div>
                <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
                  {(() => {
                    const hours = Math.floor(sunTime);
                    const minutes = Math.round((sunTime - hours) * 60);
                    const paddedMinutes = String(minutes).padStart(2, "0");
                    return `Soleil : ${hours}h${paddedMinutes}`;
                  })()}
                </span>
              </div>
            </div>
          </section>
        ) : null}

        <section className="xl:col-start-2 space-y-3 rounded-2xl premium-glass p-4">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <BarChart3 className="h-5 w-5 text-primary" />
            Zoning Intelligence
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div
              className={`rounded-xl bg-white/[0.02] p-5 transition-shadow ${
                zoningCardsActive
                  ? "border-[0.5px] border-sky-400/70 shadow-[0_0_18px_rgba(56,189,248,0.45)]"
                  : "border border-white/[0.05]"
              }`}
            >
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                <Building2 className="h-4 w-4 text-slate-400" />
                Hauteur maximale
              </div>
              <p className="text-4xl font-black leading-none text-white">
                {isLoadingZone ? "..." : `${maxHeight ?? "-"}m`}
              </p>
              <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                Limite de hauteur réglementaire pour la zone active.
              </p>
            </div>

            <div
              className={`rounded-xl bg-white/[0.02] p-5 transition-shadow ${
                zoningCardsActive
                  ? "border-[0.5px] border-sky-400/70 shadow-[0_0_18px_rgba(56,189,248,0.45)]"
                  : "border border-white/[0.05]"
              }`}
            >
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                <Grid3X3 className="h-4 w-4 text-slate-400" />
                Surface parcelle
              </div>
              <p className="text-4xl font-black leading-none text-white">
                {formatArea(parcel?.areaM2)}
              </p>
              <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                Surface cadastrale estimée pour la parcelle étudiée.
              </p>
            </div>

            <div
              className={`rounded-xl bg-white/[0.02] p-5 transition-shadow ${
                zoningCardsActive
                  ? "border-[0.5px] border-sky-400/70 shadow-[0_0_18px_rgba(56,189,248,0.45)]"
                  : "border border-white/[0.05]"
              }`}
            >
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                <Layers3 className="h-4 w-4 text-slate-400" />
                Emprise au sol
              </div>
              <p className="text-4xl font-black leading-none text-white">{groundCoveragePct}%</p>
              <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                Coefficient d&apos;emprise projeté sur la zone considérée.
              </p>
            </div>

            <div
              className={`rounded-xl bg-white/[0.02] p-5 transition-shadow ${
                zoningCardsActive
                  ? "border-[0.5px] border-sky-400/70 shadow-[0_0_18px_rgba(56,189,248,0.45)]"
                  : "border border-white/[0.05]"
              }`}
            >
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                <Grid3X3 className="h-4 w-4 text-slate-400" />
                Retrait
              </div>
              <p className="text-4xl font-black leading-none text-white">
                {setbackDistance.toFixed(1)}m
              </p>
              <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                Distance minimale aux limites séparatives pour le bâti projeté.
              </p>
            </div>
          </div>
          {isSimulationMode ? (
            <div className="mt-3 inline-flex items-center rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
              Mode Simulation (Serveur IGN en maintenance)
            </div>
          ) : null}
        </section>

        <section className="xl:col-start-2 space-y-4">
          <div className="space-y-4">
            <h2 className="mb-4 text-lg font-semibold text-white">Market Insights</h2>
            <div className="space-y-4 rounded-2xl premium-glass p-4">
            <div className="rounded-xl premium-glass p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Prix médian DVF</p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <p className="text-4xl font-black leading-none text-white">
                  {isLoadingDvf ? "..." : formatCurrency(dvfSummary?.medianValueEur)}
                </p>
                <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-500">
                  {dvfMomentumPct ? `+${dvfMomentumPct.toFixed(1)}%` : "Stable"}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {isLoadingDvf
                  ? "Chargement DVF..."
                  : !dvfSummary || dvfSummary.mutationCount === 0
                    ? "Données DVF non disponibles pour ce secteur"
                    : `${dvfSummary.mutationCount} mutations récentes`}
              </p>
            </div>

            <div className="rounded-xl premium-glass p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                  Profitability Score
                </p>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  Rendement projeté
                </span>
              </div>

              <div className="grid grid-cols-[128px_minmax(0,1fr)] items-center gap-4">
                <div className="relative mx-auto h-32 w-32">
                  <div className="pointer-events-none absolute inset-[-18%] rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.55),transparent_60%)] blur-xl" />
                  <svg className="h-full w-full -rotate-90" viewBox="0 0 128 128">
                    <circle
                      cx="64"
                      cy="64"
                      r={profitabilityGaugeRadius}
                      fill="none"
                      stroke="rgba(148,163,184,0.2)"
                      strokeWidth="10"
                    />
                    <circle
                      cx="64"
                      cy="64"
                      r={profitabilityGaugeRadius}
                      fill="none"
                      stroke="url(#profitabilityGaugeGradient)"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={profitabilityGaugeCircumference}
                      strokeDashoffset={profitabilityGaugeOffset}
                    />
                    <defs>
                      <linearGradient id="profitabilityGaugeGradient" x1="0" y1="0" x2="128" y2="0" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#22c55e" />
                        <stop offset="58%" stopColor="#34d399" />
                        <stop offset="100%" stopColor="#6366f1" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-4xl font-black leading-none text-white`}>
                      {profitability ? profitability.score : "--"}
                    </span>
                    <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                      sur 100
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs text-slate-400">
                    Surface théorique:{" "}
                    <span className="font-black text-white">
                      {profitability
                        ? `${Math.round(profitability.theoreticalFloorAreaM2)} m²`
                        : "-"}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Niveaux estimés:{" "}
                    <span className="font-black text-white">
                      {profitability ? profitability.theoreticalLevels : "-"}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Valeur projetée:{" "}
                    <span className="font-black tracking-tight text-white">
                      {profitability ? formatCurrency(profitability.theoreticalValueEur) : "-"}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Marge brute:{" "}
                    <span className="font-black tracking-tight text-white">
                      {profitability ? formatCurrency(profitability.grossProfitEur) : "-"}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl premium-glass p-5">
              <div className="relative h-32 w-full">
                <svg className="h-full w-full" viewBox={`0 0 ${trendWidth} ${trendHeight}`}>
                  <defs>
                    <linearGradient id="marketGradient" x1="0" x2={trendWidth} y1="0" y2={trendHeight} gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity="0.06" />
                    </linearGradient>
                    <linearGradient id="marketStrokeGradient" x1="0" x2={trendWidth} y1="0" y2="0" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#22c55e" />
                      <stop offset="60%" stopColor="#34d399" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                    <filter id="dvfGlow" x="-200%" y="-200%" width="400%" height="400%">
                      <feGaussianBlur stdDeviation="4.6" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {trendAreaPath ? (
                    <path
                      d={trendAreaPath}
                      fill="url(#marketGradient)"
                      stroke="none"
                    />
                  ) : null}
                  {trendPath ? (
                    <path
                      d={trendPath}
                      fill="none"
                      stroke="url(#marketStrokeGradient)"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.2"
                    />
                  ) : null}
                  {lastTrendPoint ? (
                    <>
                      <circle
                        cx={lastTrendPoint.x}
                        cy={lastTrendPoint.y}
                        r="5.2"
                        className="animate-pulse"
                        fill="#6366f1"
                        opacity="0.42"
                        filter="url(#dvfGlow)"
                      />
                      <circle
                        cx={lastTrendPoint.x}
                        cy={lastTrendPoint.y}
                        r="2.8"
                        fill="#a5b4fc"
                      />
                    </>
                  ) : null}
                </svg>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Source : Ministère des Finances</p>
            </div>

            <div className="rounded-xl premium-glass p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                  Expertise & Risques
                </p>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                  Source : Géorisques
                </span>
              </div>

              {isLoadingRisks ? (
                <div className="space-y-3">
                  <div className="h-9 w-full animate-pulse rounded-lg bg-white/5" />
                  <div className="h-9 w-full animate-pulse rounded-lg bg-white/5" />
                  <div className="h-7 w-2/3 animate-pulse rounded-lg bg-white/5" />
                </div>
              ) : georisquesSummary ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    <span className="flex items-center gap-2 text-xs text-slate-300">
                      <Waves className="h-3.5 w-3.5 text-cyan-300" />
                      Inondation
                    </span>
                    <span className={`inline-flex items-center gap-2 text-sm font-black ${floodRiskVisual.textClassName}`}>
                      <span className={`h-2 w-2 rounded-full ${floodRiskVisual.dotClassName}`} />
                      {floodRiskVisual.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    <span className="flex items-center gap-2 text-xs text-slate-300">
                      <CircleAlert className="h-3.5 w-3.5 text-orange-300" />
                      Argile
                    </span>
                    <span className={`inline-flex items-center gap-2 text-sm font-black ${clayRiskVisual.textClassName}`}>
                      <span className={`h-2 w-2 rounded-full ${clayRiskVisual.dotClassName}`} />
                      {clayRiskVisual.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    <span className="flex items-center gap-2 text-xs text-slate-300">
                      <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                      Exposition globale
                    </span>
                    <span className={`inline-flex items-center gap-2 text-sm font-black ${overallRiskVisual.textClassName}`}>
                      <span className={`h-2 w-2 rounded-full ${overallRiskVisual.dotClassName}`} />
                      {overallRiskVisual.label}
                    </span>
                  </div>
                  <p className="pt-1 text-[11px] text-slate-500">{hazardsCountText}</p>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Données risques indisponibles pour cette parcelle.
                </p>
              )}
            </div>

            <button
              type="button"
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition-all hover:bg-primary/90"
            >
              View Sales Details
            </button>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Sales History (DVF)</h2>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleExportReport}
                disabled={!zone || isLoadingZone || isExporting}
                className="gap-2 bg-slate-100 text-slate-900 hover:bg-white"
              >
                {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                Download PDF Report
              </Button>
              <Button
                onClick={handleSave}
                disabled={!isAuthenticated || !selectedAddress || isSaving || saveState === "saved"}
                variant="secondary"
                className="gap-2"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saveState === "saved" ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {isSaving ? "Enregistrement..." : saveState === "saved" ? "Saved" : "Save"}
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-6 py-4 text-xs font-semibold uppercase text-slate-400">Date</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase text-slate-400">Type</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase text-slate-400">Surface</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold uppercase text-slate-400">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isLoadingDvf ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-400">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Chargement des mutations DVF...
                      </span>
                    </td>
                  </tr>
                ) : (
                  salesHistoryRows.map((row, index) => (
                    <tr key={`${row.date}-${index}`} className="transition-colors hover:bg-white/5">
                      <td className="px-6 py-4 text-sm font-medium">{row.date}</td>
                      <td className="px-6 py-4 text-sm text-slate-300">{row.type}</td>
                      <td className="px-6 py-4 text-sm text-slate-300">{row.surface}</td>
                      <td className="px-6 py-4 text-right text-sm font-bold text-white">{row.price}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-slate-300 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3">
              Surface parcelle: <span className="font-semibold text-white">{formatArea(parcel?.areaM2)}</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3">
              Buildability index: <span className="font-semibold text-white">{buildabilityLabel}</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3">
              Zone active: <span className="font-semibold text-white">{zone?.libelle ?? "-"}</span>
            </div>
          </div>

          {!isAuthenticated ? (
            <p className="mt-3 text-xs text-slate-400">Connectez-vous pour sauvegarder vos projets.</p>
          ) : null}

          {saveState === "error" ? (
            <div className="mt-3 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
              <div>
                <p className="text-sm font-semibold">Échec de sauvegarde</p>
                <p className="text-xs text-slate-400">Vérifiez vos droits ou réessayez.</p>
              </div>
            </div>
          ) : null}
          </div>
        </section>
      </main>

      {selectedAddress ? (
        <aside className="pointer-events-none fixed right-4 top-28 z-40 hidden 2xl:flex w-[320px] flex-col gap-4">
          <div className="pointer-events-auto premium-glass rounded-2xl border border-white/[0.06] p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                Profitability Score
              </p>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                Rendement projeté
              </span>
            </div>

            <div className="grid grid-cols-[128px_minmax(0,1fr)] items-center gap-4">
              <div className="relative mx-auto h-32 w-32">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 128 128">
                  <circle
                    cx="64"
                    cy="64"
                    r={profitabilityGaugeRadius}
                    fill="none"
                    stroke="rgba(148,163,184,0.2)"
                    strokeWidth="10"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r={profitabilityGaugeRadius}
                    fill="none"
                    stroke="url(#profitabilityGaugeGradient)"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={profitabilityGaugeCircumference}
                    strokeDashoffset={profitabilityGaugeOffset}
                  />
                  <defs>
                    <linearGradient id="profitabilityGaugeGradient" x1="0" y1="0" x2="128" y2="0" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#22c55e" />
                      <stop offset="58%" stopColor="#34d399" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-3xl font-black leading-none ${profitabilityToneClass}`}>
                    {profitability ? profitability.score : "--"}
                  </span>
                  <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                    sur 100
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-slate-400">
                  Surface théorique:{" "}
                  <span className="font-black text-white">
                    {profitability
                      ? `${Math.round(profitability.theoreticalFloorAreaM2)} m²`
                      : "-"}
                  </span>
                </p>
                <p className="text-xs text-slate-400">
                  Niveaux estimés:{" "}
                  <span className="font-black text-white">
                    {profitability ? profitability.theoreticalLevels : "-"}
                  </span>
                </p>
                <p className="text-xs text-slate-400">
                  Valeur projetée:{" "}
                  <span className="font-black text-white">
                    {profitability ? formatCurrency(profitability.theoreticalValueEur) : "-"}
                  </span>
                </p>
                <p className="text-xs text-slate-400">
                  Marge brute:{" "}
                  <span className="font-black text-white">
                    {profitability ? formatCurrency(profitability.grossProfitEur) : "-"}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <div className="pointer-events-auto premium-glass rounded-2xl border border-white/[0.06] p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                Expertise & Risques
              </p>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                Source : Géorisques
              </span>
            </div>

            {isLoadingRisks ? (
              <div className="space-y-3">
                <div className="h-9 w-full animate-pulse rounded-lg bg-white/5" />
                <div className="h-9 w-full animate-pulse rounded-lg bg-white/5" />
                <div className="h-7 w-2/3 animate-pulse rounded-lg bg-white/5" />
              </div>
            ) : georisquesSummary ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                  <span className="flex items-center gap-2 text-xs text-slate-300">
                    <Waves className="h-3.5 w-3.5 text-cyan-300" />
                    Inondation
                  </span>
                  <span className={`inline-flex items-center gap-2 text-sm font-black ${floodRiskVisual.textClassName}`}>
                    <span className={`h-2 w-2 rounded-full ${floodRiskVisual.dotClassName}`} />
                    {floodRiskVisual.label}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                  <span className="flex items-center gap-2 text-xs text-slate-300">
                    <CircleAlert className="h-3.5 w-3.5 text-orange-300" />
                    Argile
                  </span>
                  <span className={`inline-flex items-center gap-2 text-sm font-black ${clayRiskVisual.textClassName}`}>
                    <span className={`h-2 w-2 rounded-full ${clayRiskVisual.dotClassName}`} />
                    {clayRiskVisual.label}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                  <span className="flex items-center gap-2 text-xs text-slate-300">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    Exposition globale
                  </span>
                  <span className={`inline-flex items-center gap-2 text-sm font-black ${overallRiskVisual.textClassName}`}>
                    <span className={`h-2 w-2 rounded-full ${overallRiskVisual.dotClassName}`} />
                    {overallRiskVisual.label}
                  </span>
                </div>
                <p className="pt-1 text-[11px] text-slate-500">{hazardsCountText}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Données risques indisponibles pour cette parcelle.
              </p>
            )}
          </div>
        </aside>
      ) : null}
      </div>
    </div>
  );
}
