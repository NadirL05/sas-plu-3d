"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import { gsap } from "gsap";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getParcelPolygon, type ParcelGeometry } from "@/src/lib/plu-engine";

// ─── Données pour la visualisation 3D ─────────────────────────────────────────

export interface ParcelSceneData {
  /** Hauteur maximale autorisée par le PLU (mètres). */
  maxHeight: number;
  /** Type de zone PLU (U, AU, N, A). */
  zoneType?: string;
  /** Emprise au sol (m). Si absent, parcelle type utilisée. */
  footprint?: { width: number; depth: number };
  /** Géométrie réelle de la parcelle cadastrale (GeoJSON). */
  parcelPolygon?: ParcelGeometry;
  /** Centre de la parcelle (coordonnées WGS84) pour récupérer la géométrie exacte. */
  parcelCenter?: { lon: number; lat: number };
  /** Surface de la parcelle en m² (si disponible). */
  parcelAreaM2?: number;
}

interface ParcelShapeData {
  shapes: THREE.Shape[];
  width: number;
  depth: number;
  center: THREE.Vector3;
  boundaries: THREE.Vector3[][];
}

const DEFAULT_FOOTPRINT = { width: 10, depth: 15 };
const EARTH_RADIUS_M = 6_378_137;
const DEG_TO_RAD = Math.PI / 180;

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
  } else if (
    normalized.includes("toit terrasse") ||
    normalized.includes("terrasse")
  ) {
    roofStyle = "flat";
  }

  const modernStyle =
    normalized.includes("immeuble moderne") || normalized.includes("moderne");

  return { hasPrompt, roofStyle, modernStyle };
}

function isLonLatPoint(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function createRectShapeData(
  footprint?: { width: number; depth: number }
): ParcelShapeData {
  const width = Math.max(1, footprint?.width ?? DEFAULT_FOOTPRINT.width);
  const depth = Math.max(1, footprint?.depth ?? DEFAULT_FOOTPRINT.depth);

  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -depth / 2);
  shape.lineTo(width / 2, -depth / 2);
  shape.lineTo(width / 2, depth / 2);
  shape.lineTo(-width / 2, depth / 2);
  shape.lineTo(-width / 2, -depth / 2);

  return {
    shapes: [shape],
    width,
    depth,
    center: new THREE.Vector3(0, 0, 0),
    boundaries: [[
      new THREE.Vector3(-width / 2, 0.05, -depth / 2),
      new THREE.Vector3(width / 2, 0.05, -depth / 2),
      new THREE.Vector3(width / 2, 0.05, depth / 2),
      new THREE.Vector3(-width / 2, 0.05, depth / 2),
    ]],
  };
}

function toLocalMeters(
  lon: number,
  lat: number,
  originLon: number,
  originLat: number,
  cosLat: number
): THREE.Vector2 {
  const x = (lon - originLon) * DEG_TO_RAD * EARTH_RADIUS_M * cosLat;
  const z = (lat - originLat) * DEG_TO_RAD * EARTH_RADIUS_M;
  return new THREE.Vector2(x, z);
}

function ringToLocalPoints(
  ring: number[][],
  originLon: number,
  originLat: number,
  cosLat: number
): THREE.Vector2[] {
  const localPoints = ring
    .filter(isLonLatPoint)
    .map(([lon, lat]) => toLocalMeters(lon, lat, originLon, originLat, cosLat));

  if (localPoints.length >= 2) {
    const first = localPoints[0];
    const last = localPoints[localPoints.length - 1];
    if (first.distanceToSquared(last) < 1e-12) {
      localPoints.pop();
    }
  }

  return localPoints;
}

function parcelGeometryToShapeData(
  geometry: ParcelGeometry,
  fallbackFootprint?: { width: number; depth: number }
): ParcelShapeData {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates as number[][][]]
      : (geometry.coordinates as number[][][][]);

  const lonLatPoints: [number, number][] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const point of ring) {
        if (isLonLatPoint(point)) {
          lonLatPoints.push([point[0], point[1]]);
        }
      }
    }
  }

  if (lonLatPoints.length < 3) {
    return createRectShapeData(fallbackFootprint);
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of lonLatPoints) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  const originLon = (minLon + maxLon) / 2;
  const originLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos(originLat * DEG_TO_RAD);

  const allLocalPoints: THREE.Vector2[] = [];
  const contourPoints: THREE.Vector2[] = [];
  const shapes: THREE.Shape[] = [];
  const boundaries: THREE.Vector3[][] = [];

  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;

    const outerRaw = ringToLocalPoints(
      polygon[0],
      originLon,
      originLat,
      cosLat
    );
    if (outerRaw.length < 3) continue;

    const contour = [...outerRaw];
    if (THREE.ShapeUtils.isClockWise(contour)) {
      contour.reverse();
    }

    const shape = new THREE.Shape(contour);
    allLocalPoints.push(...contour);
    contourPoints.push(...contour);
    boundaries.push(
      contour.map((point) => new THREE.Vector3(point.x, 0.05, point.y))
    );

    for (const holeRing of polygon.slice(1)) {
      const holeRaw = ringToLocalPoints(
        holeRing,
        originLon,
        originLat,
        cosLat
      );
      if (holeRaw.length < 3) continue;

      const hole = [...holeRaw];
      if (!THREE.ShapeUtils.isClockWise(hole)) {
        hole.reverse();
      }

      shape.holes.push(new THREE.Path(hole));
      allLocalPoints.push(...hole);
    }

    shapes.push(shape);
  }

  if (shapes.length === 0 || allLocalPoints.length === 0) {
    return createRectShapeData(fallbackFootprint);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let centerXAccumulator = 0;
  let centerZAccumulator = 0;
  let centerCount = 0;

  for (const point of allLocalPoints) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.y);
    maxZ = Math.max(maxZ, point.y);
  }

  for (const point of contourPoints) {
    centerXAccumulator += point.x;
    centerZAccumulator += point.y;
    centerCount += 1;
  }

  const centerX = centerCount > 0 ? centerXAccumulator / centerCount : 0;
  const centerZ = centerCount > 0 ? centerZAccumulator / centerCount : 0;

  return {
    shapes,
    width: Math.max(1, maxX - minX),
    depth: Math.max(1, maxZ - minZ),
    center: new THREE.Vector3(centerX, 0, centerZ),
    boundaries,
  };
}

function buildShapeData(
  parcelPolygon: ParcelGeometry | undefined,
  footprint?: { width: number; depth: number }
): ParcelShapeData {
  if (!parcelPolygon) return createRectShapeData(footprint);
  return parcelGeometryToShapeData(parcelPolygon, footprint);
}

function getParcelGeometryToken(geometry?: ParcelGeometry): string | null {
  if (!geometry) return null;

  if (geometry.type === "Polygon") {
    const polygon = geometry.coordinates as number[][][];
    const firstPoint = polygon[0]?.[0];
    const firstLon = typeof firstPoint?.[0] === "number" ? firstPoint[0].toFixed(6) : "x";
    const firstLat = typeof firstPoint?.[1] === "number" ? firstPoint[1].toFixed(6) : "y";
    return `P:${polygon.length}:${firstLon}:${firstLat}`;
  }

  const multiPolygon = geometry.coordinates as number[][][][];
  const firstPoint = multiPolygon[0]?.[0]?.[0];
  const firstLon = typeof firstPoint?.[0] === "number" ? firstPoint[0].toFixed(6) : "x";
  const firstLat = typeof firstPoint?.[1] === "number" ? firstPoint[1].toFixed(6) : "y";
  return `M:${multiPolygon.length}:${firstLon}:${firstLat}`;
}

function useExtrudedGeometry(shapes: THREE.Shape[], height: number): THREE.ExtrudeGeometry {
  const geometry = useMemo(() => {
    const extrudeHeight = Math.max(height, 0.2);
    const extrude = new THREE.ExtrudeGeometry(shapes, {
      depth: extrudeHeight,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 8,
    });

    // L'extrusion native se fait sur l'axe Z ; on la bascule pour obtenir la hauteur sur Y.
    extrude.rotateX(-Math.PI / 2);
    extrude.computeVertexNormals();
    return extrude;
  }, [shapes, height]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return geometry;
}

interface BuildingPreviewProps {
  maxHeight: number;
  footprintShape: ParcelShapeData;
  modifiers: VisualModifiers;
}

function BuildingPreview({
  maxHeight,
  footprintShape,
  modifiers,
}: BuildingPreviewProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const roofMaterialRef = useRef<THREE.MeshStandardMaterial>(null);

  const roofThickness =
    modifiers.roofStyle === "slope"
      ? Math.max(maxHeight * 0.08, 0.55)
      : modifiers.roofStyle === "flat"
        ? 0.18
        : 0.3;
  const baseHeight = Math.max(maxHeight - roofThickness, 2);

  const bodyGeometry = useExtrudedGeometry(footprintShape.shapes, baseHeight);
  const roofGeometry = useExtrudedGeometry(footprintShape.shapes, roofThickness);

  const edgesGeometry = useMemo(() => {
    return new THREE.EdgesGeometry(bodyGeometry, 25);
  }, [bodyGeometry]);

  useEffect(() => {
    return () => {
      edgesGeometry.dispose();
    };
  }, [edgesGeometry]);

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

    const timeline = gsap.timeline({
      defaults: { duration: 0.55, ease: "power2.out" },
    });
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
      <mesh geometry={bodyGeometry} castShadow receiveShadow>
        <meshStandardMaterial
          ref={bodyMaterialRef}
          color="#7f97ac"
          transparent
          opacity={0.82}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>

      <lineSegments geometry={edgesGeometry} position={[0, 0.01, 0]}>
        <lineBasicMaterial
          color={modifiers.modernStyle ? "#aeb6bf" : "#d5e2ec"}
          transparent
          opacity={0.45}
        />
      </lineSegments>

      <mesh position={[0, baseHeight + 0.03, 0]} geometry={roofGeometry} castShadow receiveShadow>
        <meshStandardMaterial
          ref={roofMaterialRef}
          color={modifiers.roofStyle === "flat" ? "#1f2329" : "#6f7f8d"}
          transparent
          opacity={0.9}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>
    </group>
  );
}

interface SceneFocus {
  width: number;
  depth: number;
  maxHeight: number;
  center: THREE.Vector3;
}

function ViewportAutoCenter({
  focus,
  controlsRef,
}: {
  focus: SceneFocus | null;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (!focus) return;

    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const controls = controlsRef.current;

    const fovRad = perspectiveCamera.fov * DEG_TO_RAD;
    const halfExtent = Math.max(focus.width, focus.depth) / 2;
    const fitDistance = halfExtent / Math.tan(fovRad / 2);
    const distance = Math.max(fitDistance * 1.7, focus.maxHeight * 1.9, 14);

    const target = {
      x: focus.center.x,
      y: focus.maxHeight * 0.3,
      z: focus.center.z,
    };
    const position = {
      x: target.x + distance * 0.95,
      y: distance * 0.75,
      z: target.z + distance * 0.95,
    };

    const tweens: gsap.core.Tween[] = [];

    if (controls) {
      tweens.push(
        gsap.to(controls.target, {
          ...target,
          duration: 0.9,
          ease: "power2.out",
          onUpdate: () => controls.update(),
        })
      );
    }

    tweens.push(
      gsap.to(perspectiveCamera.position, {
        ...position,
        duration: 0.9,
        ease: "power2.out",
        onUpdate: () => {
          if (controls) {
            controls.update();
          } else {
            perspectiveCamera.lookAt(target.x, target.y, target.z);
          }
        },
      })
    );

    return () => {
      for (const tween of tweens) {
        tween.kill();
      }
    };
  }, [camera, controlsRef, focus]);

  return null;
}

function AutoRotateOnParcelLoad({
  controlsRef,
  triggerToken,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  triggerToken: string | null;
}) {
  useEffect(() => {
    if (!triggerToken) return;

    const controls = controlsRef.current;
    if (!controls) return;

    const previousAutoRotate = controls.autoRotate;
    const previousSpeed = controls.autoRotateSpeed;

    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.8;
    controls.update();

    const stopRotation = gsap.delayedCall(2.6, () => {
      controls.autoRotate = previousAutoRotate;
      controls.autoRotateSpeed = previousSpeed;
      controls.update();
    });

    return () => {
      stopRotation.kill();
      controls.autoRotate = previousAutoRotate;
      controls.autoRotateSpeed = previousSpeed;
      controls.update();
    };
  }, [controlsRef, triggerToken]);

  return null;
}

function BoundaryLoop({ points }: { points: THREE.Vector3[] }) {
  const geometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [points]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <lineLoop geometry={geometry}>
      <lineBasicMaterial color="#1f2937" transparent opacity={0.95} />
    </lineLoop>
  );
}

function ParcelBoundaries({ loops }: { loops: THREE.Vector3[][] }) {
  if (loops.length === 0) return null;

  return (
    <group>
      {loops.map((points, index) => (
        <BoundaryLoop key={`boundary-${index}`} points={points} />
      ))}
    </group>
  );
}

function isPointInLoop(x: number, z: number, loop: THREE.Vector3[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
    const xi = loop[i].x;
    const zi = loop[i].z;
    const xj = loop[j].x;
    const zj = loop[j].z;

    const intersects =
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi + Number.EPSILON) + xi;

    if (intersects) inside = !inside;
  }
  return inside;
}

function createSeed(shape: ParcelShapeData): number {
  const seedBase =
    Math.round(shape.width * 100) * 73856093 +
    Math.round(shape.depth * 100) * 19349663 +
    Math.round(shape.center.x * 100) * 83492791 +
    Math.round(shape.center.z * 100) * 2654435761;
  return Math.abs(seedBase) % 2147483647;
}

function mulberry32(seed: number): () => number {
  let t = seed || 1;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function ParcelTrees({ shape }: { shape: ParcelShapeData }) {
  const trees = useMemo(() => {
    const loops = shape.boundaries;
    if (loops.length === 0) return [];

    const allPoints = loops.flat();
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of allPoints) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }

    const areaApprox = Math.max(1, shape.width * shape.depth);
    const targetCount = Math.max(6, Math.min(36, Math.round(areaApprox / 40)));
    const random = mulberry32(createSeed(shape));

    const generated: Array<{
      x: number;
      z: number;
      height: number;
      radius: number;
      color: string;
    }> = [];

    let attempts = 0;
    const maxAttempts = targetCount * 40;
    while (generated.length < targetCount && attempts < maxAttempts) {
      attempts += 1;

      const x = minX + random() * (maxX - minX);
      const z = minZ + random() * (maxZ - minZ);
      const inside = loops.some((loop) => isPointInLoop(x, z, loop));
      if (!inside) continue;

      const height = 0.35 + random() * 0.5;
      const radius = height * (0.35 + random() * 0.1);
      const shade = 90 + Math.round(random() * 40);
      generated.push({
        x,
        z,
        height,
        radius,
        color: `hsl(120 ${shade}% ${28 + Math.round(random() * 10)}%)`,
      });
    }

    return generated;
  }, [shape]);

  return (
    <group>
      {trees.map((tree, index) => (
        <mesh
          key={`tree-${index}`}
          position={[tree.x, tree.height / 2, tree.z]}
          castShadow
          receiveShadow
        >
          <coneGeometry args={[tree.radius, tree.height, 8]} />
          <meshStandardMaterial color={tree.color} roughness={0.85} metalness={0.05} />
        </mesh>
      ))}
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
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const footprintShape = useMemo(() => {
    return buildShapeData(data?.parcelPolygon, data?.footprint);
  }, [data?.parcelPolygon, data?.footprint]);
  const parcelToken = useMemo(
    () => getParcelGeometryToken(data?.parcelPolygon),
    [data?.parcelPolygon]
  );

  const focus = useMemo<SceneFocus | null>(() => {
    if (!data) return null;

    return {
      width: footprintShape.width,
      depth: footprintShape.depth,
      maxHeight: data.maxHeight,
      center: footprintShape.center,
    };
  }, [data, footprintShape.width, footprintShape.depth, footprintShape.center]);

  const gridSize = focus
    ? Math.max(30, Math.ceil(Math.max(focus.width, focus.depth) * 2.5))
    : 30;
  const lightFrustum = focus
    ? Math.max(20, Math.ceil(Math.max(focus.width, focus.depth) * 1.4))
    : 20;

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
      <ViewportAutoCenter focus={focus} controlsRef={controlsRef} />
      <AutoRotateOnParcelLoad controlsRef={controlsRef} triggerToken={parcelToken} />

      <ambientLight intensity={0.3} />
      <directionalLight
        position={[8, 12, 6]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-far={70}
        shadow-camera-left={-lightFrustum}
        shadow-camera-right={lightFrustum}
        shadow-camera-top={lightFrustum}
        shadow-camera-bottom={-lightFrustum}
      />

      {data ? (
        <ContactShadows
          position={[focus?.center.x ?? 0, 0.02, focus?.center.z ?? 0]}
          opacity={0.55}
          scale={Math.max(focus?.width ?? 20, focus?.depth ?? 20) * 1.8}
          blur={2.2}
          far={Math.max(10, data.maxHeight * 1.8)}
          resolution={1024}
          color="#0b0b14"
        />
      ) : null}

      <Grid
        args={[gridSize, gridSize]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#6b7280"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#4b5563"
        fadeDistance={gridSize + 5}
        fadeStrength={1}
        infiniteGrid
        position={[0, 0, 0]}
      />

      <OrbitControls
        ref={controlsRef}
        enablePan
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2 - 0.1}
        maxDistance={focus ? Math.max(80, Math.max(focus.width, focus.depth) * 8) : 80}
      />

      {data ? <ParcelBoundaries loops={footprintShape.boundaries} /> : null}
      {data && (data.zoneType === "N" || data.zoneType === "A") ? (
        <ParcelTrees shape={footprintShape} />
      ) : null}

      {data ? (
        <BuildingPreview
          maxHeight={data.maxHeight}
          footprintShape={footprintShape}
          modifiers={modifiers}
        />
      ) : null}
    </>
  );
}

// ─── Canvas 3D principal ──────────────────────────────────────────────────────

interface ParcelSceneProps {
  /** Données PLU pour le volume. Si null, la scène est vide (grille + lumières). */
  pluData: ParcelSceneData | null;
  className?: string;
  promptValue?: string;
  hidePromptInput?: boolean;
  onPromptChange?: (prompt: string) => void;
  onCaptureReady?: (capture: () => string | null) => void;
}

export function ParcelScene({
  pluData,
  className,
  promptValue,
  hidePromptInput = false,
  onPromptChange,
  onCaptureReady,
}: ParcelSceneProps) {
  const [prompt, setPrompt] = useState("");
  const [modifiers, setModifiers] = useState<VisualModifiers>(() =>
    detectVisualModifiers("")
  );
  const [resolvedParcelPolygon, setResolvedParcelPolygon] =
    useState<ParcelGeometry | undefined>(pluData?.parcelPolygon);
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

  useEffect(() => {
    if (typeof promptValue !== "string") return;
    if (promptValue === prompt) return;
    setPrompt(promptValue);
  }, [promptValue, prompt]);

  useEffect(() => {
    setResolvedParcelPolygon(pluData?.parcelPolygon);
  }, [pluData?.parcelPolygon]);

  useEffect(() => {
    const lon = pluData?.parcelCenter?.lon;
    const lat = pluData?.parcelCenter?.lat;

    if (typeof lon !== "number" || typeof lat !== "number") {
      return;
    }

    let cancelled = false;

    getParcelPolygon(lon, lat)
      .then((parcel) => {
        if (cancelled || !parcel?.geometry) return;
        setResolvedParcelPolygon(parcel.geometry);
      })
      .catch(() => {
        // On garde la géométrie déjà disponible (lookup serveur ou fallback footprint).
      });

    return () => {
      cancelled = true;
    };
  }, [pluData?.parcelCenter?.lon, pluData?.parcelCenter?.lat]);

  const sceneData = useMemo<ParcelSceneData | null>(() => {
    if (!pluData) return null;

    return {
      ...pluData,
      parcelPolygon: resolvedParcelPolygon ?? pluData.parcelPolygon,
    };
  }, [pluData, resolvedParcelPolygon]);

  return (
    <div className="w-full space-y-3">
      <div
        className={cn(
          "w-full aspect-video rounded-xl border border-border bg-transparent overflow-hidden",
          className
        )}
      >
        <Canvas
          shadows
          camera={{ position: [12, 8, 12], fov: 45 }}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
          }}
        >
          <SceneContent
            data={sceneData}
            modifiers={modifiers}
            onCaptureReady={handleCaptureReady}
          />
        </Canvas>
      </div>

      {!hidePromptInput ? (
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
      ) : null}
    </div>
  );
}
