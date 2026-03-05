"use client";

import dynamic from "next/dynamic";
import type { ParcelGeometry } from "@/src/lib/plu-engine";
import type { ParcelSceneData } from "@/components/three/ParcelScene";

// Three.js / WebGL — SSR impossible, on charge le composant côté client uniquement
const ParcelScene = dynamic(
  () => import("@/components/three/ParcelScene").then((m) => m.ParcelScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-xs text-slate-500 animate-pulse">
          Chargement de la modélisation 3D…
        </span>
      </div>
    ),
  }
);

interface StudyParcelViewProps {
  maxHeight: number;
  zoneType?: string;
  parcelPolygon?: ParcelGeometry;
  parcelCenter?: { lon: number; lat: number };
  parcelAreaM2?: number;
}

export function StudyParcelView({
  maxHeight,
  zoneType,
  parcelPolygon,
  parcelCenter,
  parcelAreaM2,
}: StudyParcelViewProps) {
  const pluData: ParcelSceneData = {
    maxHeight,
    zoneType,
    parcelPolygon,
    parcelCenter,
    parcelAreaM2,
  };

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-xl border border-border/70 bg-slate-950/80">
      <ParcelScene pluData={pluData} fillContainer />
    </div>
  );
}
