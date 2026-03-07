"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;
const SPLINE_SCENE_URL = process.env.NEXT_PUBLIC_SPLINE_URL ?? "";
const MOBILE_FALLBACK_IMAGE = "/hero-spline-mobile-fallback.svg";

// Spline runtime requires WebGL - loaded client-side only.
const Spline = dynamic(() => import("@splinetool/react-spline"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-white/5" />,
});

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    const update = () => setIsMobile(mediaQuery.matches);
    update();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return isMobile;
}

export function SplineHero() {
  const isMobile = useIsMobile();
  const [isSceneReady, setIsSceneReady] = useState(false);

  if (!SPLINE_SCENE_URL) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
        <p className="text-center text-xs text-slate-500">
          Scène Spline non configurée.
          <br />
          Ajoutez <code className="font-mono text-slate-400">NEXT_PUBLIC_SPLINE_URL</code> dans{" "}
          <code className="font-mono text-slate-400">.env.local</code>.
        </p>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80">
        <Image
          src={MOBILE_FALLBACK_IMAGE}
          alt="Aperçu statique de la scène 3D"
          fill
          className="object-cover"
          sizes="100vw"
          priority
        />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      {!isSceneReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/20 backdrop-blur-[2px]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white/90" />
        </div>
      )}
      <Spline
        scene={SPLINE_SCENE_URL}
        onLoad={() => setIsSceneReady(true)}
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
        }}
      />
    </div>
  );
}

