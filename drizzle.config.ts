import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

function sanitizeEnv(value?: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

const databaseUrl = sanitizeEnv(
  process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.NEON_DATABASE_URL
);

if (!databaseUrl) {
  console.warn(
    "[drizzle-kit] DATABASE_URL absent (.env.local). Placeholder local utilise pour eviter l'erreur host/url."
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  extensionsFilters: ["postgis"],
  dbCredentials: {
    url: databaseUrl || "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
  },
});
