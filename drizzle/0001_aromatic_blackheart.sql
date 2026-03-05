CREATE TABLE IF NOT EXISTS "plu_ai_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"urlfic" text NOT NULL,
	"ces" text NOT NULL,
	"retrait" text NOT NULL,
	"espaces_verts" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plu_ai_cache_urlfic_unique" UNIQUE("urlfic")
);
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plu_zones" (
  "id" bigserial PRIMARY KEY,
  "code_commune" text NOT NULL,
  "libelle" text,
  "typezone" text,
  "urlfic" text,
  "geom" geometry(MultiPolygon, 4326) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plu_zones_geom_idx" ON "plu_zones" USING GIST ("geom");
