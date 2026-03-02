import { drizzle } from "drizzle-orm/neon-serverless";
import { schema } from "./schema";

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

export const connectionString = sanitizeEnv(
  process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.NEON_DATABASE_URL
);

export const DB_AVAILABLE = connectionString.length > 0;

if (!DB_AVAILABLE) {
  console.warn("[db] DATABASE_URL absente: lancement en mode invite (sans base de donnees).");
}

export const db = DB_AVAILABLE ? drizzle(connectionString, { schema }) : null;
