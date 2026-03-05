CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS plu_zones (
  id SERIAL PRIMARY KEY,
  code_commune VARCHAR NOT NULL,
  libelle VARCHAR,
  typezone VARCHAR,
  urlfic TEXT,
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS plu_zones_geom_idx
ON plu_zones
USING GIST (geom);
