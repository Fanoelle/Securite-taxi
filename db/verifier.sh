#!/usr/bin/env bash
# Verifie le schema sur une base jetable, sans toucher a la base de travail.
set -euo pipefail
BASE="securitaxi_verif_$$"

echo "== Verification du schema sur '$BASE' =="
createdb "$BASE"
trap 'dropdb --if-exists "$BASE"' EXIT

for f in db/001_schema.sql db/002_referentiel.sql db/003_vues.sql \
         db/004_postgis.sql db/010_retention.sql; do
    psql -q -d "$BASE" -v ON_ERROR_STOP=1 -f "$f"
done

echo "-- objets crees"
psql -tAd "$BASE" -c "
  SELECT 'tables : ' || count(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE'"
psql -tAd "$BASE" -c "
  SELECT 'vues   : ' || count(*) FROM information_schema.views WHERE table_schema='public'"
psql -tAd "$BASE" -c "
  SELECT 'index  : ' || count(*) FROM pg_indexes WHERE schemaname='public'"

echo "-- la vue publique n'expose aucune donnee sensible"
psql -tAd "$BASE" -c "
  SELECT CASE WHEN count(*)=0 THEN '   OK'
              ELSE '   ALERTE : ' || string_agg(column_name,', ') END
  FROM information_schema.columns
  WHERE table_name='v_scan_public'
    AND column_name ~* 'naissance|telephone|cni|adresse|mot_de_passe'"

echo "== Schema valide =="
