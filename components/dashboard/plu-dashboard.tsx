"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Box,
  Building2,
  Calculator,
  CheckCircle,
  CircleAlert,
  Euro,
  ExternalLink,
  FileDown,
  Grid3X3,
  Layers3,
  Loader2,
  MapPin,
  Minus,
  Palette,
  Plus,
  Save,
  Satellite,
  Search,
  ShieldCheck,
  Sparkles,
  Trees,
  TrendingUp,
  Waves,
} from "lucide-react";
import { toast } from "sonner";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { uploadFiles } from "@/src/utils/uploadthing";
import {
  lookupDvfAction,
  lookupGeorisquesAction,
  lookupZoneAction,
  saveProjectAction,
} from "@/app/actions/plu-actions";
import { fetchNearbyBuildings, type NearbyBuilding } from "@/src/lib/osm-engine";
import { computeProfitabilityScore } from "@/src/lib/plu-engine";
import type {
  AddressSuggestion,
  DvfSummary,
  GeorisquesSummary,
  ParcelPolygon,
  RiskLevel,
  ZoneUrba,
} from "@/src/lib/plu-engine";
import type {
  ParcelSceneData,
  ParcelSceneHandle,
  StudioTree,
} from "@/components/three/ParcelScene";

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
const MONTH_NAMES_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
] as const;
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

// Anciennes fonctions de génération de courbe DVF factices supprimées

function getBuildabilityLabel(height: number | null): string {
  if (height === null) return "En attente";
  if (height >= 14) return "Excellent (A+)";
  if (height >= 10) return "Bon potentiel (A)";
  if (height >= 7) return "Potentiel modéré (B)";
  return "Potentiel limité (C)";
}

interface PLUDashboardProps {
  isAuthenticated?: boolean;
  /** Accès au Studio PRO (façade, textures, arbres manuels). */
  isPro?: boolean;
}

export function PLUDashboard({ isAuthenticated = false, isPro = false }: PLUDashboardProps) {
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
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiArchitectParams, setAiArchitectParams] = useState<{
    recommendedHeight?: number;
    roofType?: "flat" | "sloped";
    hasCommercialGround?: boolean;
  } | null>(null);
  const [mapCenter, setMapCenter] = useState(DEFAULT_MAP_CENTER);
  const [mapZoom, setMapZoom] = useState(14);
  const [sunTime, setSunTime] = useState(14);
  const [sunMonth, setSunMonth] = useState(6);
  const [nearbyBuildings, setNearbyBuildings] = useState<NearbyBuilding[]>([]);
  const [buildingType, setBuildingType] = useState<
    "massing" | "house" | "collective" | "mixed"
  >("collective");
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
  const parcelSceneRef = useRef<ParcelSceneHandle | null>(null);
  const investorSummaryRef = useRef<HTMLDivElement | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [isPluAnalyzing, setIsPluAnalyzing] = useState(false);
  const [isUploadingPluPdf, setIsUploadingPluPdf] = useState(false);
  const [uploadedPluPdfUrl, setUploadedPluPdfUrl] = useState<string | null>(null);
  const [pluAnalysisStatus, setPluAnalysisStatus] = useState<string | null>(null);
  const [pluAnalysisData, setPluAnalysisData] = useState<{
    ces: string;
    retrait: string;
    espacesVerts: string;
  } | null>(null);
  const activePluPdfUrl = uploadedPluPdfUrl ?? zone?.urlfic ?? null;

  // ── Bilan Financier Promoteur ────────────────────────────────────────────────
  const [landPriceEur, setLandPriceEur] = useState<string>("");
  const [constructionCostPerM2, setConstructionCostPerM2] = useState<string>("1800");
  const [salePricePerM2, setSalePricePerM2] = useState<string>("4500");

  // ── Studio PRO ──────────────────────────────────────────────────────────────
  const [facadeColor, setFacadeColor] = useState("#f8fafc");
  const [facadeTexture, setFacadeTexture] = useState<"enduit" | "brique" | "bois">("enduit");
  const [studioTrees, setStudioTrees] = useState<StudioTree[]>([]);

  const handleAddStudioTree = useCallback(() => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 8 + Math.random() * 6;
    setStudioTrees((prev) => [
      ...prev,
      {
        id: `tree-${Date.now()}`,
        dx: Math.cos(angle) * dist,
        dz: Math.sin(angle) * dist,
      },
    ]);
  }, []);

  const handleExportObj = useCallback(() => {
    if (!parcelSceneRef.current) return;
    parcelSceneRef.current.exportToObj();
  }, [parcelSceneRef]);

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
    setUploadedPluPdfUrl(null);
    setPluAnalysisData(null);
    setPluAnalysisStatus(null);
    setIsLoadingZone(true);
    setIsLoadingDvf(true);
    setIsLoadingRisks(true);
    setNearbyBuildings([]);

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
    const nearbyBuildingsPromise = fetchNearbyBuildings(suggestion.lat, suggestion.lon).catch(
      (error) => {
        console.warn("[OSM_NEARBY_BUILDINGS_WARNING]", error);
        return [];
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
      const [dvfResult, georisquesResult, nearbyResult] = await Promise.all([
        dvfPromise,
        georisquesPromise,
        nearbyBuildingsPromise,
      ]);
      if (requestId !== lookupRequestIdRef.current) return;
      setDvfSummary(dvfResult);
      setGeorisquesSummary(georisquesResult);
      setNearbyBuildings(nearbyResult);
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
      if (result.projectId) {
        setCurrentProjectId(result.projectId);
      }
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

  const handlePluPdfUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];

      if (!file) return;

      setIsUploadingPluPdf(true);

      try {
        const uploaded = await uploadFiles({
          endpoint: "pluPdfUploader",
          files: [file],
        });

        const first = uploaded[0] as { url?: string; ufsUrl?: string } | undefined;
        const uploadedUrl = first?.url ?? first?.ufsUrl ?? null;

        if (!uploadedUrl) {
          throw new Error("Upload PDF réussi mais URL absente.");
        }

        setUploadedPluPdfUrl(uploadedUrl);
        setPluAnalysisData(null);
        setPluAnalysisStatus(null);
        toast.success("PDF réglementaire importé.");
      } catch (error) {
        console.error("[handlePluPdfUpload]", error);
        toast.error("Upload du PDF réglementaire impossible.");
      } finally {
        input.value = "";
        setIsUploadingPluPdf(false);
      }
    },
    []
  );

  const handleAnalyzePluPdf = useCallback(async () => {
    if (!activePluPdfUrl) {
      toast.error("Importez un PDF réglementaire ou sélectionnez une zone avec document.");
      return;
    }

    setPluAnalysisData(null);
    setIsPluAnalyzing(true);
    setPluAnalysisStatus("Téléchargement du document...");

    const stepTimeouts: number[] = [];

    try {
      stepTimeouts.push(
        window.setTimeout(
          () => setPluAnalysisStatus("Lecture par l'IA..."),
          1100
        )
      );
      stepTimeouts.push(
        window.setTimeout(
          () => setPluAnalysisStatus("Extraction des règles..."),
          2100
        )
      );

      const response = await fetch("/api/plu/analyze-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urlfic: activePluPdfUrl }),
      });

      if (!response.ok) {
        throw new Error("Analyse du PDF réglementaire impossible.");
      }

      const data = (await response.json()) as {
        ces?: string;
        retrait?: string;
        espacesVerts?: string;
      };

      setPluAnalysisData({
        ces: data.ces ?? "Non spécifié",
        retrait: data.retrait ?? "Non spécifié",
        espacesVerts: data.espacesVerts ?? "Non spécifié",
      });
      setPluAnalysisStatus("Analyse terminée");
    } catch (error) {
      console.error("[handleAnalyzePluPdf]", error);
      setPluAnalysisStatus(null);
      toast.error("Analyse du PDF réglementaire impossible pour le moment.");
    } finally {
      stepTimeouts.forEach((id) => window.clearTimeout(id));
      setIsPluAnalyzing(false);
    }
  }, [activePluPdfUrl]);

  const handleAnalyzePrompt = useCallback(async () => {
    if (!scenePrompt.trim() || !selectedAddress) return;
    setIsAiAnalyzing(true);
    try {
      const currentMaxHeight =
        zone?.typezone === MOCK_ZONE_DATA.zone.typezone
          ? MOCK_ZONE_DATA.maxHeight
          : zone?.typezone
          ? DEFAULT_MAX_HEIGHT_BY_ZONE[zone.typezone] ?? 9
          : 9;

      const res = await fetch("/api/ai/analyze-zoning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: scenePrompt,
          currentMaxHeight,
          parcelArea: parcel?.areaM2,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAiArchitectParams(data);
      if (data.aiFeedback) toast.success(data.aiFeedback);
    } catch (error) {
      console.error("[handleAnalyzePrompt]", error);
      toast.error("L'analyse IA a échoué. Vérifiez votre clé OPENAI_API_KEY.");
    } finally {
      setIsAiAnalyzing(false);
    }
  }, [scenePrompt, selectedAddress, zone?.typezone, parcel?.areaM2]);

  const handleCopyPublicLink = useCallback(() => {
    if (!currentProjectId) {
      toast.error("Enregistrez d'abord le projet pour générer un lien public.");
      return;
    }
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    const url = `${window.location.origin}/p/${currentProjectId}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        toast.success("Lien public copié dans le presse-papier.");
      })
      .catch(() => {
        toast.error("Impossible de copier le lien.");
      });
  }, [currentProjectId]);

  const baseParcelSceneData = buildParcelSceneData(zone, parcel, selectedAddress);
  const parcelSceneData = baseParcelSceneData
    ? {
        ...baseParcelSceneData,
        maxHeight: aiArchitectParams?.recommendedHeight ?? baseParcelSceneData.maxHeight,
        roofType: aiArchitectParams?.roofType,
        hasCommercialGround: aiArchitectParams?.hasCommercialGround,
      }
    : null;
  const maxHeight = zone
    ? zone.typezone === MOCK_ZONE_DATA.zone.typezone
      ? MOCK_ZONE_DATA.maxHeight
      : DEFAULT_MAX_HEIGHT_BY_ZONE[zone.typezone] ?? 8
    : null;
  const buildabilityLabel = getBuildabilityLabel(maxHeight);
  const mutationCount = dvfSummary?.mutationCount ?? 0;
  const dvfMomentumPct =
    mutationCount > 0 ? Math.min(9.9, Math.max(1.2, mutationCount / 55)) : null;
  const dvfHistoryData =
    dvfSummary?.dvfHistory && dvfSummary.dvfHistory.length > 0
      ? dvfSummary.dvfHistory
      : [];
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
    medianSalePricePerM2Eur: dvfSummary?.medianPricePerM2Eur ?? null,
  });
  const promoterBalance = profitability;

  // ── Bilan Financier en temps réel ────────────────────────────────────────────
  // Emprise au sol selon le type de bâtiment choisi dans la scène 3D
  const financialCoverageRatio =
    buildingType === "collective" ? 0.6
    : buildingType === "house"   ? 0.4
    : buildingType === "mixed"   ? 0.5
    : 0.7; // massing
  // Nombre d'étages déduit de la hauteur PLU (1 niveau ≈ 3 m, min 1)
  const financialFloors = maxHeight ? Math.max(1, Math.floor(maxHeight / 3)) : null;
  // Surface de plancher estimée (emprise × étages)
  const financialSdpM2 =
    parcel?.areaM2 && financialFloors
      ? Math.round(parcel.areaM2 * financialCoverageRatio * financialFloors)
      : null;
  const financialLandPrice   = parseFloat(landPriceEur.replace(/\s/g, "")) || 0;
  const financialConstructCost = parseFloat(constructionCostPerM2) || 1800;
  const financialSalePrice   = parseFloat(salePricePerM2)          || 4500;
  const financialCA          = financialSdpM2 ? financialSdpM2 * financialSalePrice : null;
  const financialCoutTotal   = financialSdpM2
    ? financialLandPrice + financialSdpM2 * financialConstructCost
    : null;
  // Marge nette = (CA - coûts totaux) / CA
  const financialMargeNette  =
    financialCA && financialCA > 0 && financialCoutTotal !== null
      ? (financialCA - financialCoutTotal) / financialCA
      : null;
  // Seuil de risque : marge < 15 %
  const financialIsRisky     =
    financialMargeNette !== null && financialMargeNette < 0.15;

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
            surface: `${dvfSummary.mutationCount} ventes${
              dvfSummary.scope === "commune" ? " (commune)" : ""
            }`,
            price: formatCurrency(dvfSummary.medianValueEur),
          },
        ]
      : [
          { date: "-", type: "Aucune donnée", surface: "-", price: "-" },
          { date: "-", type: "Aucune donnée", surface: "-", price: "-" },
        ];
  const generateInvestorReport = useCallback(async () => {
    if (!selectedAddress || !zone) {
      toast.error("Données insuffisantes pour générer le rapport investisseur.");
      return;
    }

    const parcelData = buildParcelSceneData(zone, parcel, selectedAddress);
    if (!parcelData) {
      toast.error("Impossible de générer un rapport sans données PLU.");
      return;
    }

    setIsExporting(true);

    try {
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;
      let y = 18;

      const ensurePageSpace = (neededHeight: number) => {
        if (y + neededHeight > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
      };

      const writeParagraph = (text: string, fontSize = 10) => {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(fontSize);
        const lines = pdf.splitTextToSize(text, contentWidth);
        const estimatedHeight = lines.length * (fontSize * 0.42 + 1.1);
        ensurePageSpace(estimatedHeight + 1);
        pdf.text(lines, margin, y);
        y += estimatedHeight;
      };

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text("SAS PLU 3D - Étude de faisabilité", margin, y);
      y += 7;

      const reportDate = new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "long",
      }).format(new Date());

      writeParagraph(`Date : ${reportDate}`);
      writeParagraph(`Parcelle : ${selectedAddress.label}`);
      writeParagraph("Rapport Investisseur");
      y += 2;

      const sceneImageDataUrl = parcelSceneRef.current?.getCanvasImage?.() ?? null;

      if (sceneImageDataUrl) {
        ensurePageSpace(12);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(12);
        pdf.text("Maquette 3D", margin, y);
        y += 5;

        const imageProps = pdf.getImageProperties(sceneImageDataUrl);
        const imageWidth = 180;
        const imageHeight = Math.min(95, (imageWidth * imageProps.height) / imageProps.width);
        ensurePageSpace(imageHeight + 5);
        pdf.addImage(sceneImageDataUrl, "PNG", margin, y, imageWidth, imageHeight, undefined, "FAST");
        y += imageHeight + 6;
      } else {
        writeParagraph("Capture 3D indisponible pour cette session.");
      }

      if (investorSummaryRef.current) {
        const summaryCanvas = await html2canvas(investorSummaryRef.current, {
          scale: 1.2,
          backgroundColor: "#020617",
          useCORS: true,
          logging: false,
        });

        const summaryImage = summaryCanvas.toDataURL("image/png");
        const summaryHeight = Math.min(
          100,
          (contentWidth * summaryCanvas.height) / summaryCanvas.width
        );

        ensurePageSpace(summaryHeight + 10);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(12);
        pdf.text("Synthèse visuelle", margin, y);
        y += 5;
        pdf.addImage(summaryImage, "PNG", margin, y, contentWidth, summaryHeight, undefined, "FAST");
        y += summaryHeight + 6;
      }

      ensurePageSpace(12);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.text("Section PLU (IA)", margin, y);
      y += 6;

      const pluLines = [
        `Zone : ${zone.libelle || zone.typezone || "-"}`,
        `Type de zone : ${zone.typezone || "-"}`,
        `CES : ${pluAnalysisData?.ces ?? `${groundCoveragePct}% (estimation)`}`,
        `Hauteur max : ${parcelData.maxHeight} m`,
        `Retrait : ${pluAnalysisData?.retrait ?? `${setbackDistance.toFixed(1)} m (estimation)`}`,
        `Espaces verts : ${pluAnalysisData?.espacesVerts ?? "Non analysé"}`,
      ];

      for (const line of pluLines) {
        writeParagraph(`• ${line}`);
      }

      const hasFinancialData =
        financialSdpM2 !== null ||
        financialMargeNette !== null ||
        financialCA !== null ||
        financialCoutTotal !== null;

      if (hasFinancialData) {
        ensurePageSpace(12);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(13);
        pdf.text("Section Bilan", margin, y);
        y += 6;

        const financialLines = [
          `Surface de plancher estimée : ${
            financialSdpM2 !== null ? `${financialSdpM2.toLocaleString("fr-FR")} m²` : "N/A"
          }`,
          `Chiffre d'affaires estimé : ${formatCurrency(financialCA)}`,
          `Coût total estimé : ${formatCurrency(financialCoutTotal)}`,
          `Marge nette estimée : ${
            financialMargeNette !== null ? `${(financialMargeNette * 100).toFixed(1)} %` : "N/A"
          }`,
        ];

        for (const line of financialLines) {
          writeParagraph(`• ${line}`);
        }
      }

      const safeAddress = selectedAddress.label
        .slice(0, 10)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9-_]/g, "_");

      pdf.save(`Etude_Faisabilite_${safeAddress || "parcelle"}.pdf`);
      toast.success("Rapport investisseur généré.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erreur pendant la génération du rapport investisseur.";
      toast.error(message);
      console.error("[INVESTOR_REPORT_ERROR]", error);
    } finally {
      setIsExporting(false);
    }
  }, [
    selectedAddress,
    zone,
    parcel,
    pluAnalysisData,
    groundCoveragePct,
    setbackDistance,
    financialSdpM2,
    financialMargeNette,
    financialCA,
    financialCoutTotal,
  ]);


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
                  disabled={!selectedAddress || !zone || !scenePrompt.trim() || isAiAnalyzing}
                  onClick={handleAnalyzePrompt}
                  className="bg-primary text-white hover:bg-primary/90"
                >
                  {isAiAnalyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Analyze"
                  )}
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
            <div className="mb-3 ml-1 inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-slate-950/55 p-1.5 shadow-[0_12px_30px_rgba(2,6,23,0.45)] backdrop-blur-xl">
              {[
                { key: "massing", label: "Volume Max" },
                { key: "house", label: "Maison R+1" },
                { key: "collective", label: "Résidentiel" },
                { key: "mixed", label: "Mixte (Commerces)" },
              ].map((option) => {
                const isActive = buildingType === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() =>
                      setBuildingType(
                        option.key as "massing" | "house" | "collective" | "mixed"
                      )
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                      isActive
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.09]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="relative h-[440px] w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-slate-950/80">
              <ParcelScene
                ref={parcelSceneRef}
                pluData={parcelSceneData}
                buildingType={buildingType}
                fillContainer
                mapZoom={mapZoom}
                sunTime={sunTime}
                sunMonth={sunMonth}
                className="h-full w-full rounded-none border-0 bg-transparent"
                promptValue={scenePrompt}
                hidePromptInput
                onPromptChange={setScenePrompt}
                facadeColor={isPro ? facadeColor : undefined}
                facadeTexture={isPro ? facadeTexture : undefined}
                studioTrees={isPro ? studioTrees : undefined}
                nearbyBuildings={nearbyBuildings}
              />
              <div className="absolute bottom-6 right-6 z-40 premium-glass rounded-xl p-4 w-72 shadow-2xl">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Heure solaire
                      </span>
                      <span className="rounded-md bg-primary/20 px-2 py-1 text-xs font-bold text-white">
                        {Math.floor(sunTime)}h{sunTime % 1 !== 0 ? "30" : "00"}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={6}
                      max={20}
                      step={0.5}
                      value={sunTime}
                      onChange={(e) => setSunTime(parseFloat(e.target.value))}
                      className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-primary"
                      aria-label="Heure solaire (ensoleillement)"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Mois de l&apos;année
                      </span>
                      <span className="rounded-md bg-primary/20 px-2 py-1 text-xs font-bold text-white">
                        {MONTH_NAMES_FR[sunMonth - 1]}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={12}
                      step={1}
                      value={sunMonth}
                      onChange={(e) => setSunMonth(parseInt(e.target.value, 10))}
                      className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-primary"
                      aria-label="Mois de l'année (ensoleillement)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section id="investor-report-summary" ref={investorSummaryRef} className="xl:col-start-2 space-y-3 rounded-2xl premium-glass p-4">
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

              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/[0.12]">
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={handlePluPdfUpload}
                      className="hidden"
                      disabled={isUploadingPluPdf || isPluAnalyzing}
                    />
                    {isUploadingPluPdf ? "Import du PDF..." : "Importer un PDF PLU"}
                  </label>
                  <span className="inline-flex items-center rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">
                    {activePluPdfUrl ? "PDF prêt pour analyse" : "Aucun PDF sélectionné"}
                  </span>
                </div>

                {activePluPdfUrl ? (
                  <a
                    href={activePluPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-sky-300 transition hover:text-sky-200"
                  >
                    Voir le document actif
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Importez un PDF réglementaire pour lancer l&apos;analyse IA.
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleAnalyzePluPdf}
                  disabled={isPluAnalyzing || isUploadingPluPdf || !activePluPdfUrl}
                  className="group relative inline-flex rounded-full bg-gradient-to-r from-emerald-400 via-sky-500 to-indigo-500 p-[1px] text-[11px] font-semibold text-emerald-50 shadow-[0_0_24px_rgba(56,189,248,0.45)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.75),transparent_60%)] opacity-70 mix-blend-screen blur-sm" />
                  <span className="relative flex items-center gap-2 rounded-full bg-slate-950/95 px-3 py-1 group-hover:bg-slate-950">
                    <Sparkles className="h-3 w-3 text-emerald-300" />
                    Analyser le PDF réglementaire avec l&apos;IA
                  </span>
                </button>

                {isPluAnalyzing ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-[11px] text-emerald-200">
                      {pluAnalysisStatus ?? "Téléchargement du document..."}
                    </p>
                    <div className="flex flex-col gap-1">
                      <div className="h-1.5 w-full animate-pulse rounded-full bg-emerald-500/25" />
                      <div className="h-1.5 w-5/6 animate-pulse rounded-full bg-emerald-500/15" />
                      <div className="h-1.5 w-2/3 animate-pulse rounded-full bg-emerald-500/10" />
                    </div>
                  </div>
                ) : null}

                {pluAnalysisData && !isPluAnalyzing ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">
                      CES : {pluAnalysisData.ces}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold text-sky-200">
                      Retrait : {pluAnalysisData.retrait}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-lime-400/40 bg-lime-400/10 px-2.5 py-1 text-[10px] font-semibold text-lime-100">
                      Espaces verts : {pluAnalysisData.espacesVerts}
                    </span>
                  </div>
                ) : null}
              </div>
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
                    : dvfSummary.scope === "commune"
                      ? `${dvfSummary.mutationCount} mutations récentes sur la commune`
                      : `${dvfSummary.mutationCount} mutations récentes`}
              </p>
            </div>

            <div className="rounded-2xl premium-glass p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    Bilan Promoteur IA
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Synthèse automatique du bilan financier promoteur.
                  </p>
                </div>
              </div>

              {promoterBalance ? (
                <div className="space-y-4">
                  <div className="rounded-2xl bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>CA potentiel</span>
                      <span className="font-black tracking-tight text-white">
                        {formatCurrency(promoterBalance.chiffreAffairesEstimeEur)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                      <span>Coûts de sortie (travaux + annexes)</span>
                      <span className="font-black tracking-tight text-white">
                        {formatCurrency(
                          promoterBalance.coutConstructionEur +
                            promoterBalance.fraisAnnexesEur
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-5 shadow-[0_0_32px_rgba(16,185,129,0.38)]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                      Prix d&apos;achat max recommandé
                    </p>
                    <p className="mt-2 text-[11px] text-emerald-200/80">
                      Niveau cible intégrant construction, frais annexes et marge promoteur.
                    </p>
                    <p className="mt-4 text-3xl font-black tracking-tight text-emerald-400 md:text-4xl">
                      {formatCurrency(promoterBalance.prixMaxTerrainEur)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Sélectionnez une parcelle avec données DVF pour calculer un bilan promoteur
                  estimatif.
                </p>
              )}
            </div>

            <div className="rounded-xl premium-glass p-5">
              <div className="h-40 w-full">
                {dvfHistoryData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dvfHistoryData}>
                      <defs>
                        <linearGradient id="dvfAreaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#0f172a" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="year"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                      />
                      <YAxis
                        hide
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 10, fill: "#64748b" }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "rgba(15,23,42,0.95)",
                          borderRadius: 12,
                          border: "1px solid rgba(148,163,184,0.35)",
                          padding: "8px 10px",
                        }}
                        labelStyle={{ fontSize: 11, color: "#e2e8f0" }}
                        formatter={(value?: number) => {
                          const formatted =
                            typeof value === "number"
                              ? new Intl.NumberFormat("fr-FR", {
                                  style: "currency",
                                  currency: "EUR",
                                  maximumFractionDigits: 0,
                                }).format(value)
                              : "-";
                          return [formatted, "Prix médian"];
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#dvfAreaGradient)"
                        dot={false}
                        activeDot={{ r: 4, fill: "#22c55e" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
                    Historique temporel insuffisant
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Source : DVF (Etalab / CQuest)
              </p>
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
                onClick={generateInvestorReport}
                disabled={!zone || isLoadingZone || isExporting}
                className="gap-2 bg-slate-100 text-slate-900 hover:bg-white"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Génération du PDF en cours...
                  </>
                ) : (
                  <>
                    <FileDown className="h-4 w-4" />
                    Télécharger le rapport PDF
                  </>
                )}
              </Button>
              <Button
                onClick={handleExportObj}
                disabled={!parcelSceneData}
                variant="outline"
                className="gap-2 border-slate-500/40 bg-slate-900/60 text-slate-100 hover:bg-slate-900"
              >
                <Box className="h-4 w-4" />
                Exporter la maquette 3D (.obj)
              </Button>
              <Button
                onClick={handleCopyPublicLink}
                disabled={!currentProjectId}
                variant="outline"
                className="gap-2 border-emerald-500/40 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/10"
              >
                <ExternalLink className="h-4 w-4" />
                Copier le lien public
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
        <aside className="pointer-events-none fixed right-4 top-28 z-40 hidden 2xl:flex w-[320px] flex-col gap-4 bg-[#101022]/40 backdrop-blur-3xl border-l border-white/5 rounded-l-2xl pl-4 pr-4 py-4">

          {/* ── Bilan Financier Promoteur (paramétrable) ── */}
          <div className="pointer-events-auto premium-glass rounded-3xl p-6">
            {/* Header */}
            <div className="mb-5 flex items-center gap-2">
              <Calculator className="h-3.5 w-3.5 text-slate-500" />
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-500">
                Bilan Promoteur
              </p>
            </div>

            {/* ── Inputs ── */}
            <div className="space-y-3 mb-5">
              {/* Prix terrain */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                  Prix d&apos;achat terrain (€)
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                    <Euro className="h-3.5 w-3.5 text-slate-500" />
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    placeholder="350 000"
                    value={landPriceEur}
                    onChange={(e) => setLandPriceEur(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-8 pr-3 text-xs font-semibold text-white placeholder:text-slate-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                  />
                </div>
              </div>

              {/* Coût de construction */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                  Coût construction (€/m²)
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                    <Building2 className="h-3.5 w-3.5 text-slate-500" />
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={constructionCostPerM2}
                    onChange={(e) => setConstructionCostPerM2(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-8 pr-3 text-xs font-semibold text-white placeholder:text-slate-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                  />
                </div>
              </div>

              {/* Prix de vente */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                  Prix de vente (€/m²)
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                    <TrendingUp className="h-3.5 w-3.5 text-slate-500" />
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={salePricePerM2}
                    onChange={(e) => setSalePricePerM2(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-8 pr-3 text-xs font-semibold text-white placeholder:text-slate-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* ── Résultats ── */}
            {financialSdpM2 ? (
              <div className="space-y-2.5">
                {/* SDP */}
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Surface de plancher (SDP)</span>
                    <span className="font-black text-white">
                      {financialSdpM2.toLocaleString("fr-FR")}&nbsp;m²
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-600">
                    {financialFloors}&nbsp;étage{financialFloors !== 1 ? "s" : ""}
                    &nbsp;·&nbsp;{Math.round(financialCoverageRatio * 100)}%&nbsp;emprise
                    &nbsp;·&nbsp;{buildingType}
                  </p>
                </div>

                {/* CA + Coût total */}
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Chiffre d&apos;affaires</span>
                    <span className="font-black text-white">{formatCurrency(financialCA)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Coût total</span>
                    <span className="font-black text-white">{formatCurrency(financialCoutTotal)}</span>
                  </div>
                </div>

                {/* Marge nette — conditionnellement verte ou rouge */}
                {financialMargeNette !== null ? (
                  financialIsRisky ? (
                    <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-4 shadow-[0_0_28px_rgba(239,68,68,0.22)]">
                      <div className="mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-400">
                          Projet risqué
                        </p>
                      </div>
                      <p className="text-3xl font-black tracking-tight text-red-400">
                        {(financialMargeNette * 100).toFixed(1)}%
                      </p>
                      <p className="mt-1 text-[10px] text-red-300/60">
                        Marge nette inférieure au seuil de 15 %
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-4 shadow-[0_0_28px_rgba(16,185,129,0.25)]">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">
                        Marge nette
                      </p>
                      <p className="mt-2 text-3xl font-black tracking-tight text-emerald-400">
                        +{(financialMargeNette * 100).toFixed(1)}%
                      </p>
                      <p className="mt-1 text-[10px] text-emerald-300/60">
                        Opération viable ✓
                      </p>
                    </div>
                  )
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Sélectionnez une parcelle pour estimer la SDP et calculer la rentabilité en temps réel.
              </p>
            )}
          </div>

          {/* ── Bilan Promoteur IA (DVF auto) ── */}
          <div className="pointer-events-auto premium-glass rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-500 flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-slate-500" />
                Bilan Promoteur IA
              </p>
            </div>

            {promoterBalance ? (
              <div className="space-y-4">
                <div className="rounded-2xl bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>CA potentiel</span>
                    <span className="font-black tracking-tight text-white">
                      {formatCurrency(promoterBalance.chiffreAffairesEstimeEur)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Coûts de sortie (travaux + annexes)</span>
                    <span className="font-black tracking-tight text-white">
                      {formatCurrency(
                        promoterBalance.coutConstructionEur +
                          promoterBalance.fraisAnnexesEur
                      )}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-5 shadow-[0_0_32px_rgba(16,185,129,0.38)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
                    Prix d&apos;achat max recommandé
                  </p>
                  <p className="mt-2 text-[11px] text-emerald-200/80">
                    Intègre construction, frais annexes et marge cible de 10%.
                  </p>
                  {promoterBalance.prixMaxTerrainEur > 0 ? (
                    <>
                      <p className="mt-4 text-3xl font-black tracking-tight text-emerald-400 md:text-4xl">
                        {formatCurrency(promoterBalance.prixMaxTerrainEur)}
                      </p>
                      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3 py-1">
                        {(() => {
                          const ca = promoterBalance.chiffreAffairesEstimeEur;
                          const totalCosts =
                            promoterBalance.coutConstructionEur +
                            promoterBalance.fraisAnnexesEur +
                            promoterBalance.prixMaxTerrainEur;
                          const rawMarginPct =
                            typeof ca === "number" && ca > 0
                              ? (ca - totalCosts) / ca
                              : 0.1;
                          const marginPct = Math.max(0.1, rawMarginPct);
                          const displayPct = (marginPct * 100).toFixed(1);
                          return (
                            <>
                              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100">
                                Marge promoteur potentielle
                              </span>
                              <span className="text-xs font-black text-emerald-50">
                                +{displayPct}%
                              </span>
                            </>
                          );
                        })()}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mt-4 text-3xl font-black tracking-tight text-red-400 md:text-4xl">
                        {formatCurrency(promoterBalance.prixMaxTerrainEur)}
                      </p>
                      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-red-300">
                        PROJET NON RENTABLE EN L&apos;ÉTAT
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Sélectionnez une parcelle avec données DVF pour obtenir un bilan promoteur
                estimatif.
              </p>
            )}
          </div>

            <div className="pointer-events-auto premium-glass rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-500 flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
                Expertise & Risques
              </p>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                Source : Géorisques
              </span>
            </div>

            {georisquesSummary?.isFallback ? (
              <p className="mb-3 text-[11px] text-slate-400">
                Analyse des risques en cours (Basé sur les données historiques communales).
              </p>
            ) : null}

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

          {/* ── Studio PRO ── visible uniquement pour les abonnés PRO ── */}
          <div className="pointer-events-auto premium-glass rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-500 flex items-center gap-2">
                <Palette className="h-3.5 w-3.5 text-slate-500" />
                Studio PRO
              </p>
              {!isPro && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                  PRO requis
                </span>
              )}
            </div>

            {isPro ? (
              <div className="space-y-4">
                {/* Couleur de façade */}
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-400">Couleur façade</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={facadeColor}
                      onChange={(e) => {
                        setFacadeColor(e.target.value);
                        setFacadeTexture("enduit");
                      }}
                      className="h-8 w-10 cursor-pointer rounded-md border border-white/10 bg-transparent"
                      aria-label="Couleur de façade"
                    />
                    <span className="font-mono text-[11px] text-slate-400">{facadeColor}</span>
                  </div>
                </div>

                {/* Texture de façade */}
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-400">Texture façade</p>
                  <div className="flex gap-1.5">
                    {(["enduit", "brique", "bois"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setFacadeTexture(t);
                          setFacadeColor(
                            t === "enduit" ? "#f8fafc" : t === "brique" ? "#c2714f" : "#8b6f47"
                          );
                        }}
                        className={`flex-1 rounded-lg border py-1.5 text-[11px] font-medium capitalize transition-all ${
                          facadeTexture === t
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Arbres */}
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Végétation ({studioTrees.length} arbre{studioTrees.length !== 1 ? "s" : ""})
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleAddStudioTree}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2 text-[11px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
                    >
                      <Trees className="h-3.5 w-3.5" />
                      Ajouter un arbre
                    </button>
                    {studioTrees.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setStudioTrees([])}
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-medium text-slate-400 transition-colors hover:bg-white/[0.08]"
                        aria-label="Effacer tous les arbres"
                      >
                        Tout effacer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Débloquez le Studio PRO pour personnaliser la façade et ajouter des éléments à votre maquette 3D.
              </p>
            )}
          </div>
        </aside>
      ) : null}
      </div>
    </div>
  );
}


