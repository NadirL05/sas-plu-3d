"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import { gsap } from "gsap";
import * as THREE from "three";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Données pour la visualisation 3D ─────────────────────────────────────────

export interface ParcelSceneData {
  /** Hauteur maximale autorisée par le PLU (mètres). */
  maxHeight: number;
  /** Emprise au sol (m). Si absent, parcelle type utilisée. */
  footprint?: { width: number; depth: number };
}

// ─── Volume constructible (enveloppe PLU) ────────────────────────────────────

interface ConstructionVolumeProps {
  maxHeight: number;
  footprint?: { width: number; depth: number };
}

const DEFAULT_FOOTPRINT = { width: 10, depth: 15 };

type RoofStyle = "default" | "flat" | "slope";

interface VisualModifiers {
  hasPrompt: boolean;
  roofStyle: RoofStyle;
  modernStyle: boolean;
}

function normalizePrompt(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectVisualModifiers(prompt: string): VisualModifiers {
  const normalized = normalizePrompt(prompt);
  const hasPrompt = normalized.length > 0;

  let roofStyle: RoofStyle = "default";
  if (normalized.includes("toit en pente") || normalized.includes("pignon")) {
    roofStyle = "slope";
  } else if (normalized.includes("toit terrasse") || normalized.includes("terrasse")) {
    roofStyle = "flat";
  }

  const modernStyle =
    normalized.includes("immeuble moderne") || normalized.includes("moderne");

  return { hasPrompt, roofStyle, modernStyle };
}

function ConstructionVolume({ maxHeight, footprint }: ConstructionVolumeProps) {
  const { width, depth } = footprint ?? DEFAULT_FOOTPRINT;

  return (
    <mesh position={[0, maxHeight / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[width, maxHeight, depth]} />
      <meshStandardMaterial
        color="#b8d4e8"
        transparent
        opacity={0.5}
        roughness={0.4}
        metalness={0.05}
      />
    </mesh>
  );
}

interface BuildingPreviewProps {
  maxHeight: number;
  footprint?: { width: number; depth: number };
  modifiers: VisualModifiers;
}

function BuildingPreview({
  maxHeight,
  footprint,
  modifiers,
}: BuildingPreviewProps) {
  const { width, depth } = footprint ?? DEFAULT_FOOTPRINT;
  const groupRef = useRef<THREE.Group>(null);
  const bodyMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const roofMaterialRef = useRef<THREE.MeshStandardMaterial>(null);

  const roofHeight = Math.max(maxHeight * 0.25, 1.5);
  const baseHeight =
    modifiers.roofStyle === "slope" ? Math.max(maxHeight - roofHeight, 2) : maxHeight;
  const floors = Math.max(2, Math.min(6, Math.floor(baseHeight / 2.8)));

  const roofShape = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(0, roofHeight);
    shape.lineTo(width / 2, 0);
    shape.lineTo(-width / 2, 0);
    return shape;
  }, [roofHeight, width]);

  useEffect(() => {
    if (!groupRef.current || !bodyMaterialRef.current) return;

    const bodyColor = new THREE.Color(
      modifiers.modernStyle ? "#2d3138" : "#7f97ac"
    );
    const roofColor = new THREE.Color(
      modifiers.roofStyle === "flat"
        ? "#1f2329"
        : modifiers.modernStyle
          ? "#363b43"
          : "#6f7f8d"
    );

    const timeline = gsap.timeline({ defaults: { duration: 0.55, ease: "power2.out" } });
    timeline.to(
      bodyMaterialRef.current.color,
      { r: bodyColor.r, g: bodyColor.g, b: bodyColor.b },
      0
    );
    timeline.to(
      bodyMaterialRef.current,
      { opacity: modifiers.modernStyle ? 0.94 : 0.82 },
      0
    );

    if (roofMaterialRef.current) {
      timeline.to(
        roofMaterialRef.current.color,
        { r: roofColor.r, g: roofColor.g, b: roofColor.b },
        0
      );
      timeline.to(
        roofMaterialRef.current,
        { opacity: modifiers.modernStyle ? 0.95 : 0.9 },
        0
      );
    }

    timeline.fromTo(
      groupRef.current.scale,
      { x: 0.95, y: 0.95, z: 0.95 },
      { x: 1, y: 1, z: 1, duration: 0.7, ease: "power3.out" },
      0
    );

    timeline.fromTo(
      groupRef.current.position,
      { y: -0.15 },
      { y: 0, duration: 0.65, ease: "back.out(1.4)" },
      0
    );

    return () => {
      timeline.kill();
    };
  }, [modifiers.modernStyle, modifiers.roofStyle]);

  return (
    <group ref={groupRef}>
      <mesh position={[0, baseHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, baseHeight, depth]} />
        <meshStandardMaterial
          ref={bodyMaterialRef}
          color="#7f97ac"
          transparent
          opacity={0.82}
          roughness={0.45}
          metalness={0.12}
        />
      </mesh>

      {Array.from({ length: floors - 1 }, (_, idx) => (
        <mesh
          // Dalles intermédiaires pour donner un aspect plus détaillé
          key={`floor-${idx}`}
          position={[0, ((idx + 1) * baseHeight) / floors, 0]}
        >
          <boxGeometry args={[width * 0.95, 0.035, depth * 0.95]} />
          <meshStandardMaterial
            color={modifiers.modernStyle ? "#5b6470" : "#9cb3c5"}
            transparent
            opacity={0.55}
            roughness={0.4}
            metalness={0.2}
          />
        </mesh>
      ))}

      {modifiers.roofStyle === "slope" ? (
        <mesh position={[0, baseHeight, -depth / 2]} castShadow receiveShadow>
          <extrudeGeometry
            args={[roofShape, { depth, bevelEnabled: false, steps: 1 }]}
          />
          <meshStandardMaterial
            ref={roofMaterialRef}
            color="#6f7f8d"
            transparent
            opacity={0.9}
            roughness={0.5}
            metalness={0.08}
          />
        </mesh>
      ) : (
        <mesh position={[0, maxHeight + 0.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[width * 0.98, 0.12, depth * 0.98]} />
          <meshStandardMaterial
            ref={roofMaterialRef}
            color={modifiers.roofStyle === "flat" ? "#1f2329" : "#6f7f8d"}
            transparent
            opacity={0.9}
            roughness={0.55}
            metalness={0.1}
          />
        </mesh>
      )}
    </group>
  );
}

// ─── Contenu de la scène (lumières, grille, volume) ────────────────────────────

function SceneContent({
  data,
  modifiers,
  onCaptureReady,
}: {
  data: ParcelSceneData | null;
  modifiers: VisualModifiers;
  onCaptureReady?: (capture: () => string | null) => void;
}) {
  function CaptureBridge({
    onReady,
  }: {
    onReady?: (capture: () => string | null) => void;
  }) {
    const { gl, scene, camera } = useThree();

    useEffect(() => {
      if (!onReady) return;

      onReady(() => {
        gl.render(scene, camera);
        return gl.domElement.toDataURL("image/png");
      });

      return () => {
        onReady(() => null);
      };
    }, [onReady, gl, scene, camera]);

    return null;
  }

  return (
    <>
      <CaptureBridge onReady={onCaptureReady} />
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[8, 12, 6]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-far={50}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <Grid
        args={[30, 30]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#6b7280"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#4b5563"
        fadeDistance={35}
        fadeStrength={1}
        infiniteGrid
        position={[0, 0, 0]}
      />
      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2 - 0.1}
        maxDistance={50}
      />
      {data && (
        modifiers.hasPrompt ? (
          <BuildingPreview
            maxHeight={data.maxHeight}
            footprint={data.footprint}
            modifiers={modifiers}
          />
        ) : (
          <ConstructionVolume
            maxHeight={data.maxHeight}
            footprint={data.footprint}
          />
        )
      )}
    </>
  );
}

// ─── Canvas 3D principal ──────────────────────────────────────────────────────

interface ParcelSceneProps {
  /** Données PLU pour le volume. Si null, la scène est vide (grille + lumières). */
  pluData: ParcelSceneData | null;
  className?: string;
  onPromptChange?: (prompt: string) => void;
  onCaptureReady?: (capture: () => string | null) => void;
}

export function ParcelScene({
  pluData,
  className,
  onPromptChange,
  onCaptureReady,
}: ParcelSceneProps) {
  const [prompt, setPrompt] = useState("");
  const [modifiers, setModifiers] = useState<VisualModifiers>(() =>
    detectVisualModifiers("")
  );
  const captureRef = useRef<(() => string | null) | null>(null);

  const handleCaptureReady = useCallback(
    (capture: () => string | null) => {
      captureRef.current = capture;
      if (!onCaptureReady) return;
      onCaptureReady(() => captureRef.current?.() ?? null);
    },
    [onCaptureReady]
  );

  useEffect(() => {
    setModifiers(detectVisualModifiers(prompt));
  }, [prompt]);

  useEffect(() => {
    if (!onPromptChange) return;
    onPromptChange(prompt);
  }, [prompt, onPromptChange]);

  return (
    <div className="w-full space-y-3">
      <div
        className={cn(
          "w-full aspect-video rounded-xl border border-border bg-muted overflow-hidden",
          className
        )}
      >
        <Canvas
          shadows
          camera={{ position: [12, 8, 12], fov: 45 }}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        >
          <SceneContent
            data={pluData}
            modifiers={modifiers}
            onCaptureReady={handleCaptureReady}
          />
        </Canvas>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          Personnaliser la construction
        </p>
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ex: Toit terrasse, Toit en pente, Immeuble moderne"
          disabled={!pluData}
        />
      </div>
    </div>
  );
}
