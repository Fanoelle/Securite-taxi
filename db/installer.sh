#!/usr/bin/env bash
# Installation de la base de donnees en local.
# Usage :  bash db/installer.sh
set -euo pipefail

BASE="${1:-securitaxi}"
UTILISATEUR="${USER}"

echo "== Base '$BASE' pour l'utilisateur '$UTILISATEUR' =="

# 1. Creer le role PostgreSQL correspondant a l'utilisateur systeme.
#    Demande le mot de passe sudo (necessaire une seule fois).
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$UTILISATEUR'" | grep -q 1; then
    echo "-- creation du role $UTILISATEUR"
    sudo -u postgres createuser --createdb "$UTILISATEUR"
else
    echo "-- role $UTILISATEUR deja present"
fi

# 2. Creer la base.
if psql -lqt | cut -d'|' -f1 | grep -qw "$BASE"; then
    echo "-- base $BASE deja presente"
    read -rp "   La recreer (toutes les donnees seront perdues) ? [o/N] " reponse
    [[ "$reponse" == "o" ]] || { echo "   abandon"; exit 0; }
    dropdb "$BASE"
fi
createdb "$BASE"
echo "-- base $BASE creee"

# 3. Appliquer les scripts dans l'ordre.
for f in db/001_schema.sql db/002_referentiel.sql db/003_vues.sql db/004_postgis.sql db/010_retention.sql; do
    echo "-- $f"
    psql -q -d "$BASE" -v ON_ERROR_STOP=1 -f "$f"
done

echo
echo "== Termine =="
psql -d "$BASE" -c "\dt" | tail -25
