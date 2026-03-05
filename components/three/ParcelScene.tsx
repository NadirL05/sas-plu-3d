"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Grid,
  OrbitControls,
} from "@react-three/drei";
import { gsap } from "gsap";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { OBJExporter } from "three-stdlib";
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
  /** Style de toiture recommandé par l'IA. */
  roofType?: "flat" | "sloped";
  /** Présence d'un rez-de-chaussée commercial recommandée par l'IA. */
  hasCommercialGround?: boolean;
}

export interface ParcelSceneHandle {
  exportToObj: () => void;
  buildingTypology?: "massing" | "house" | "collective" | "mixed";
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
  /** Nombre d'étages explicitement demandé via le prompt (R+X), sinon null. */
  requestedFloors: number | null;
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

  let requestedFloors: number | null = null;
  const floorsMatch = normalized.match(/r\+(\d+)/);
  if (floorsMatch) {
    const parsed = Number.parseInt(floorsMatch[1] ?? "", 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      requestedFloors = parsed + 1;
    }
  }

  return { hasPrompt, roofStyle, modernStyle, requestedFloors };
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

interface SunSettings {
  position: [number, number, number];
  intensity: number;
  shadowOpacity: number;
}

function getSunSettings(sunTime: number, center: THREE.Vector3): SunSettings {
  const clampedTime = Math.min(20, Math.max(6, sunTime));
  const dayProgress = (clampedTime - 6) / 14;
  const altitudeFactor = Math.max(0.12, Math.sin(dayProgress * Math.PI));
  const azimuth = THREE.MathUtils.lerp(-Math.PI * 0.65, Math.PI * 0.65, dayProgress);
  const radius = 26;

  return {
    position: [
      center.x + Math.cos(azimuth) * radius,
      THREE.MathUtils.lerp(6, 24, altitudeFactor),
      center.z + Math.sin(azimuth) * radius,
    ],
    intensity: THREE.MathUtils.lerp(0.42, 1.35, altitudeFactor),
    shadowOpacity: THREE.MathUtils.lerp(0.68, 0.35, altitudeFactor),
  };
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

function scaleShapes(shapes: THREE.Shape[], scale: number): THREE.Shape[] {
  return shapes.map((shape) => {
    const extracted = shape.extractPoints(16);
    const contour = extracted.shape.map(
      (point) => new THREE.Vector2(point.x * scale, point.y * scale)
    );
    const scaledShape = new THREE.Shape(contour);

    for (const hole of extracted.holes) {
      const holePoints = hole.map(
        (point) => new THREE.Vector2(point.x * scale, point.y * scale)
      );
      scaledShape.holes.push(new THREE.Path(holePoints));
    }

    return scaledShape;
  });
}

interface BuildingPreviewProps {
  maxHeight: number;
  footprintShape: ParcelShapeData;
  buildingTypology?: "massing" | "house" | "collective" | "mixed";
  buildingGroupRef?: React.RefObject<THREE.Group | null>;
}

function BuildingPreview({
  maxHeight,
  footprintShape,
  buildingTypology = "collective",
  buildingGroupRef,
}: BuildingPreviewProps) {
  const FLOOR_HEIGHT = 3;
  const WALL_HEIGHT = FLOOR_HEIGHT - 0.2;
  const SLAB_HEIGHT = 0.2;
  const localGroupRef = useRef<THREE.Group>(null);
  const groupRef = buildingGroupRef ?? localGroupRef;
  const effectiveHeight = Math.max(0.2, maxHeight);
  const maxFloors = Math.max(1, Math.floor(effectiveHeight / FLOOR_HEIGHT));
  const numFloors = buildingTypology === "house" ? Math.min(maxFloors, 2) : maxFloors;

  const slabShapes = useMemo(() => scaleShapes(footprintShape.shapes, 1.02), [footprintShape.shapes]);
  const massingGeometry = useExtrudedGeometry(footprintShape.shapes, effectiveHeight);
  const floorGeometry = useExtrudedGeometry(footprintShape.shapes, WALL_HEIGHT);
  const slabGeometry = useExtrudedGeometry(slabShapes, SLAB_HEIGHT);

  useEffect(() => {
    if (!groupRef.current) return;
    const timeline = gsap.timeline({ defaults: { duration: 0.45, ease: "power2.out" } });

    timeline.fromTo(
      groupRef.current.scale,
      { x: 0.96, y: 0.96, z: 0.96 },
      { x: 1, y: 1, z: 1 },
      0
    );
    timeline.fromTo(
      groupRef.current.position,
      { y: -0.1 },
      { y: 0, ease: "back.out(1.25)" },
      0
    );

    return () => {
      timeline.kill();
    };
  }, [buildingTypology, effectiveHeight, numFloors, groupRef]);

  return (
    <group ref={groupRef}>
      {buildingTypology === "massing" ? (
        <mesh geometry={massingGeometry} castShadow receiveShadow>
          <meshStandardMaterial
            color="#60a5fa"
            transparent
            opacity={0.38}
            roughness={0.55}
            metalness={0.1}
          />
        </mesh>
      ) : (
        Array.from({ length: numFloors }).map((_, index) => {
          const isMixedGround = buildingTypology === "mixed" && index === 0;
          const floorBaseY = FLOOR_HEIGHT * index;

          return (
            <group key={`floor-${index}`} position={[0, floorBaseY, 0]}>
              <mesh geometry={floorGeometry} castShadow receiveShadow>
                {isMixedGround ? (
                  <meshPhysicalMaterial
                    color="#1e293b"
                    roughness={0.1}
                    metalness={0.35}
                    clearcoat={0.25}
                  />
                ) : (
                  <meshStandardMaterial
                    color="#f8fafc"
                    roughness={0.9}
                    metalness={0.05}
                  />
                )}
              </mesh>
              <mesh geometry={slabGeometry} position={[0, WALL_HEIGHT, 0]} castShadow receiveShadow>
                <meshStandardMaterial color="#d1d5db" roughness={0.45} metalness={0.08} />
              </mesh>
            </group>
          );
        })
      )}
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
  mapZoom,
}: {
  focus: SceneFocus | null;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  mapZoom?: number;
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (!focus) return;

    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const controls = controlsRef.current;

    const fovRad = perspectiveCamera.fov * DEG_TO_RAD;
    const halfExtent = Math.max(focus.width, focus.depth) / 2;
    const fitDistance = halfExtent / Math.tan(fovRad / 2);
    const zoomFactor =
      typeof mapZoom === "number" && Number.isFinite(mapZoom)
        ? Math.min(2.2, Math.max(0.85, 1 + (mapZoom - 14) * 0.12))
        : 1;
    const distance = Math.max(fitDistance * 1.7, focus.maxHeight * 1.9, 14) / zoomFactor;

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
  }, [camera, controlsRef, focus, mapZoom]);

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

interface TreeSpec {
  x: number;
  z: number;
  height: number;
  radius: number;
  species: "birch" | "oak";
}

function LowPolyTree({ tree }: { tree: TreeSpec }) {
  const trunkHeight = tree.height * 0.46;
  const crownBaseY = trunkHeight + tree.height * 0.18;

  if (tree.species === "birch") {
    return (
      <group position={[tree.x, 0, tree.z]}>
        <mesh position={[0, trunkHeight / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[tree.radius * 0.16, tree.radius * 0.2, trunkHeight, 6]} />
          <meshBasicMaterial color="#e8ecef" />
        </mesh>
        <mesh position={[0, trunkHeight * 0.48, 0]} castShadow>
          <cylinderGeometry
            args={[tree.radius * 0.17, tree.radius * 0.19, trunkHeight * 0.82, 6]}
          />
          <meshBasicMaterial color="#1f2937" />
        </mesh>
        <mesh position={[0, crownBaseY, 0]} castShadow>
          <coneGeometry args={[tree.radius * 0.8, tree.height * 0.56, 7]} />
          <meshBasicMaterial color="#7ea86b" />
        </mesh>
        <mesh position={[0, crownBaseY + tree.height * 0.18, 0]} castShadow>
          <coneGeometry args={[tree.radius * 0.6, tree.height * 0.42, 7]} />
          <meshBasicMaterial color="#6b9a5b" />
        </mesh>
      </group>
    );
  }

  return (
    <group position={[tree.x, 0, tree.z]}>
      <mesh position={[0, trunkHeight / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[tree.radius * 0.2, tree.radius * 0.24, trunkHeight, 7]} />
        <meshBasicMaterial color="#5b4630" />
      </mesh>
      <mesh position={[0, crownBaseY, 0]} castShadow>
        <dodecahedronGeometry args={[tree.radius * 0.76, 0]} />
        <meshBasicMaterial color="#5b8d4f" />
      </mesh>
      <mesh position={[tree.radius * 0.28, crownBaseY + tree.radius * 0.14, -tree.radius * 0.18]} castShadow>
        <dodecahedronGeometry args={[tree.radius * 0.52, 0]} />
        <meshBasicMaterial color="#6e9f60" />
      </mesh>
      <mesh position={[-tree.radius * 0.24, crownBaseY + tree.radius * 0.12, tree.radius * 0.2]} castShadow>
        <dodecahedronGeometry args={[tree.radius * 0.48, 0]} />
        <meshBasicMaterial color="#709f63" />
      </mesh>
    </group>
  );
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

    const generated: TreeSpec[] = [];

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
      generated.push({
        x,
        z,
        height,
        radius,
        species: random() > 0.52 ? "oak" : "birch",
      });
    }

    return generated;
  }, [shape]);

  return (
    <group>
      {trees.map((tree, index) => (
        <LowPolyTree key={`tree-${index}`} tree={tree} />
      ))}
    </group>
  );
}

// ─── Contenu de la scène (lumières, grille, volume) ────────────────────────────

function SceneContent({
  data,
  modifiers,
  buildingTypology,
  sunTime,
  mapZoom,
  onCaptureReady,
  buildingGroupRef,
}: {
  data: ParcelSceneData | null;
  modifiers: VisualModifiers;
  buildingTypology?: "massing" | "house" | "collective" | "mixed";
  sunTime: number;
  mapZoom?: number;
  onCaptureReady?: (capture: () => string | null) => void;
  buildingGroupRef?: React.RefObject<THREE.Group | null>;
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
  const sun = useMemo(
    () => getSunSettings(sunTime, focus?.center ?? new THREE.Vector3(0, 0, 0)),
    [sunTime, focus?.center]
  );
  const ambientIntensity = modifiers.hasPrompt ? 0.33 : 0.35;

  function DynamicSun({
    sunTime,
    focus,
    intensity,
  }: {
    sunTime: number;
    focus: SceneFocus | null;
    intensity: number;
  }) {
    const lightRef = useRef<THREE.DirectionalLight | null>(null);
    const targetRef = useRef<THREE.Object3D | null>(null);

    const targetPosition = useMemo(() => {
      const center = focus?.center ?? new THREE.Vector3(0, 0, 0);
      const sunAngle = ((sunTime - 6) / 14) * Math.PI;
      const radius = Math.max(40, Math.max(focus?.width ?? 20, focus?.depth ?? 20) * 1.2);
      const x = center.x + Math.cos(sunAngle) * -radius;
      const y = center.y + Math.max(Math.sin(sunAngle) * radius, 8);
      const z = center.z + Math.sin(sunAngle) * radius;
      return new THREE.Vector3(x, y, z);
    }, [sunTime, focus?.center, focus?.width, focus?.depth]);

    const targetCenter = useMemo(() => {
      const center = focus?.center ?? new THREE.Vector3(0, 0, 0);
      return new THREE.Vector3(center.x, 0, center.z);
    }, [focus?.center]);

    useFrame(() => {
      if (lightRef.current) {
        lightRef.current.position.lerp(targetPosition, 0.05);
      }
      if (targetRef.current) {
        targetRef.current.position.lerp(targetCenter, 0.05);
      }
    });

    const lightFrustum = focus
      ? Math.max(20, Math.ceil(Math.max(focus.width, focus.depth) * 1.4))
      : 20;

    return (
      <directionalLight
        ref={lightRef}
        intensity={intensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0001}
        shadow-camera-far={70}
        shadow-camera-left={-lightFrustum}
        shadow-camera-right={lightFrustum}
        shadow-camera-top={lightFrustum}
        shadow-camera-bottom={-lightFrustum}
      >
        <object3D ref={targetRef} attach="target" />
      </directionalLight>
    );
  }

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
      <ViewportAutoCenter focus={focus} controlsRef={controlsRef} mapZoom={mapZoom} />
      <AutoRotateOnParcelLoad controlsRef={controlsRef} triggerToken={parcelToken} />

      <ambientLight intensity={ambientIntensity} />
      <directionalLight position={[18, 22, 10]} intensity={0.35} />
      <DynamicSun sunTime={sunTime} focus={focus} intensity={sun.intensity} />
      <Environment preset="city" blur={0.75} />

      {data ? (
        <ContactShadows
          position={[focus?.center.x ?? 0, 0.02, focus?.center.z ?? 0]}
          opacity={sun.shadowOpacity}
          scale={Math.max(focus?.width ?? 20, focus?.depth ?? 20) * 1.8}
          blur={1.4}
          far={Math.max(10, data.maxHeight * 1.8)}
          resolution={2048}
          color="#020617"
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
          buildingTypology={buildingTypology}
          buildingGroupRef={buildingGroupRef}
        />
      ) : null}
    </>
  );
}

// ─── Canvas 3D principal ──────────────────────────────────────────────────────

interface ParcelSceneProps {
  /** Données PLU pour le volume. Si null, la scène est vide (grille + lumières). */
  pluData: ParcelSceneData | null;
  buildingTypology?: "massing" | "house" | "collective" | "mixed";
  className?: string;
  promptValue?: string;
  hidePromptInput?: boolean;
  fillContainer?: boolean;
  mapZoom?: number;
   /** Heure solaire (0–24) pilotée par le dashboard. */
  sunTime?: number;
  onPromptChange?: (prompt: string) => void;
  onCaptureReady?: (capture: () => string | null) => void;
}

export const ParcelScene = forwardRef<ParcelSceneHandle, ParcelSceneProps>(
  function ParcelScene(
    {
      pluData,
      buildingTypology = "collective",
      className,
      promptValue,
      hidePromptInput = false,
      fillContainer = false,
      mapZoom,
      sunTime,
      onPromptChange,
      onCaptureReady,
    }: ParcelSceneProps,
    ref
  ) {
    const [prompt, setPrompt] = useState("");
    const [modifiers, setModifiers] = useState<VisualModifiers>(() =>
      detectVisualModifiers("")
    );
    const [resolvedParcelPolygon, setResolvedParcelPolygon] =
      useState<ParcelGeometry | undefined>(pluData?.parcelPolygon);
    const captureRef = useRef<(() => string | null) | null>(null);
    const buildingGroupRef = useRef<THREE.Group | null>(null);

    const handleExportToObj = useCallback(() => {
      if (!buildingGroupRef.current) return;
      try {
        const exporter = new OBJExporter();
        const result = exporter.parse(buildingGroupRef.current);
        if (!result) return;

        const blob = new Blob([result], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "sas-plu-3d-building.obj";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch {
        // En cas d'erreur d'export, on ne casse pas l'expérience utilisateur.
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        exportToObj: handleExportToObj,
        buildingTypology,
      }),
      [handleExportToObj, buildingTypology]
    );

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

    const effectiveSunTime = useMemo(() => {
      if (typeof sunTime === "number" && Number.isFinite(sunTime)) {
        return Math.min(24, Math.max(0, sunTime));
      }
      return 14;
    }, [sunTime]);

    return (
      <div className={cn("w-full", fillContainer ? "h-full" : "space-y-3")}>
        <div
          className={cn(
            "relative w-full rounded-xl border border-border bg-transparent overflow-hidden",
            fillContainer ? "h-full aspect-auto" : "aspect-video",
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
              buildingTypology={buildingTypology}
              sunTime={effectiveSunTime}
              mapZoom={mapZoom}
              onCaptureReady={handleCaptureReady}
              buildingGroupRef={buildingGroupRef}
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
);

