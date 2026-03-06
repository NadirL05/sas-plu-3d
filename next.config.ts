import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Explicitly set turbopack root to this project directory.
  // Without this, Next.js detects multiple lockfiles and picks the wrong root
  // (C:\Users\nadir\package-lock.json), which causes the dev server to crash.
  turbopack: {
    root: path.resolve(__dirname),
    // Turbopack's CSS @import resolver can still pick up the wrong workspace
    // root when a stray package.json exists in a parent directory, causing
    // "Can't resolve 'tw-animate-css'" even though `root` is correct.
    // resolveAlias provides an absolute path that bypasses that broken lookup.
    resolveAlias: {
      "tw-animate-css": path.resolve(
        __dirname,
        "node_modules/tw-animate-css"
      ),
    },
  },
};

export default nextConfig;
