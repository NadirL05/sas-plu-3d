"use client";

import dynamic from "next/dynamic";

// Spline runtime requires WebGL — loaded client-side only.
const Spline = dynamic(() => import("@splinetool/react-spline"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-2xl bg-white/5" />
  ),
});

const SPLINE_SCENE_URL = process.env.NEXT_PUBLIC_SPLINE_URL ?? "";

export function SplineHero() {
  if (!SPLINE_SCENE_URL) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
        <p className="text-center text-xs text-slate-500">
          Scène Spline non configurée.
          <br />
          Ajoutez{" "}
          <code className="font-mono text-slate-400">NEXT_PUBLIC_SPLINE_URL</code>
          {" "}dans <code className="font-mono text-slate-400">.env.local</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <Spline
        scene={SPLINE_SCENE_URL}
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
        }}
      />
    </div>
  );
}
