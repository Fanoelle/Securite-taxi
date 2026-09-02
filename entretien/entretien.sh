#!/bin/sh
# =====================================================================
#  Entretien quotidien de la plateforme.
#
#  Trois taches, dans cet ordre :
#    1. sauvegarder la base et les pieces d'identite ;
#    2. purger les traces GPS de plus de 30 jours (obligation legale,
#       loi n° 2024/017) et les codes OTP perimes ;
#    3. faire tourner les sauvegardes.
#
#  La sauvegarde vient AVANT la purge : si la purge se trompe, la
#  sauvegarde du jour contient encore ce qu'elle a efface. L'inverse
#  detruirait la seule copie des donnees supprimees.
#
#  Le script continue apres l'echec d'une tache, mais retient l'echec
#  et sort en erreur : une purge ratee ne doit pas empecher la
#  sauvegarde du lendemain, et un echec silencieux serait pire que
#  tout.
# =====================================================================

set -u

REPERTOIRE="${REPERTOIRE_SAUVEGARDES:-/sauvegardes}"
RETENTION_JOURS="${RETENTION_SAUVEGARDES_JOURS:-14}"
RETENTION_GPS_JOURS="${RETENTION_GPS_JOURS:-30}"
SOURCE_PIECES="${SOURCE_PIECES:-/pieces}"
SOURCE_PHOTOS="${SOURCE_PHOTOS:-/photos}"

JOUR=$(date +%F)
HORODATAGE=$(date '+%Y-%m-%d %H:%M:%S')
ECHEC=0

journal() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

signaler_echec() {
    journal "ECHEC : $*"
    ECHEC=1
}

journal "===== Entretien du $HORODATAGE ====="
mkdir -p "$REPERTOIRE" || { journal "ECHEC : $REPERTOIRE inaccessible"; exit 1; }

# ---------------------------------------------------------------------
# 0. Attendre que la base accepte vraiment les connexions
#
# Le healthcheck de compose utilise pg_isready, qui interroge la socket
# locale du conteneur. Or PostgreSQL, pendant son initialisation,
# repond deja la sans accepter les connexions TCP : le service est
# declare sain quelques secondes avant de l'etre pour nous. Sans cette
# attente, tout redemarrage du serveur produit une sauvegarde ratee.
# ---------------------------------------------------------------------
ATTENTE=0
while ! pg_isready -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -q 2>/dev/null; do
    ATTENTE=$((ATTENTE + 2))
    if [ "$ATTENTE" -gt 60 ]; then
        journal "ECHEC : la base n'a pas repondu en 60 s, entretien abandonne"
        exit 1
    fi
    sleep 2
done
if [ "$ATTENTE" -gt 0 ]; then
    journal "Base joignable apres $ATTENTE s d'attente"
fi

# ---------------------------------------------------------------------
# 1. La base
#
# --clean --if-exists : le fichier obtenu se restaure sur une base
# existante sans devoir la supprimer d'abord.
#
# On ecrit dans un fichier temporaire que l'on renomme seulement en cas
# de succes. Une sauvegarde interrompue ne doit jamais prendre le nom
# d'une sauvegarde valide : on croirait en avoir une.
# ---------------------------------------------------------------------
FICHIER_BASE="$REPERTOIRE/base-$JOUR.sql.gz"
journal "Sauvegarde de la base vers $(basename "$FICHIER_BASE")"

# Temoin d'echec de pg_dump, relu plus bas. Efface d'abord : un reste
# de la veille ferait condamner une sauvegarde pourtant valide.
rm -f /tmp/pgdump.code

# Dans un tube, `if` ne teste que le code du DERNIER maillon — ici
# gzip, qui reussit meme si pg_dump a echoue et n'a rien produit. On
# releve donc le code de pg_dump lui-meme : sh n'a pas de PIPESTATUS.
{ pg_dump --clean --if-exists -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" 2>/tmp/pgdump.err \
    || echo "$?" > /tmp/pgdump.code ; } | gzip > "$FICHIER_BASE.partiel"

if [ ! -f /tmp/pgdump.code ]; then
    # gzip d'un flux vide reussit malgre tout : on verifie que le
    # contenu est plausible avant de valider le fichier.
    TAILLE=$(wc -c < "$FICHIER_BASE.partiel")
    if [ "$TAILLE" -lt 1024 ]; then
        signaler_echec "sauvegarde suspecte ($TAILLE octets), fichier ecarte"
        mv "$FICHIER_BASE.partiel" "$FICHIER_BASE.suspect"
    else
        mv "$FICHIER_BASE.partiel" "$FICHIER_BASE"
        journal "  base sauvegardee ($TAILLE octets)"
    fi
else
    signaler_echec "pg_dump : $(head -c 300 /tmp/pgdump.err)"
    rm -f "$FICHIER_BASE.partiel"
fi

# ---------------------------------------------------------------------
# 2. Les pieces d'identite et les photos
#
# Elles ne sont dans AUCUNE sauvegarde SQL : ce sont des fichiers. Les
# perdre obligerait chaque chauffeur a tout redeposer, et l'autorite a
# tout reexaminer.
# ---------------------------------------------------------------------
sauvegarder_dossier() {
    nom="$1"
    source="$2"

    if [ ! -d "$source" ]; then
        journal "  $nom : dossier absent, ignore"
        return 0
    fi

    # Un dossier vide donne une archive valide mais inutile : on le dit
    # plutot que de laisser croire a une sauvegarde.
    if [ -z "$(ls -A "$source" 2>/dev/null)" ]; then
        journal "  $nom : aucun fichier a sauvegarder"
        return 0
    fi

    cible="$REPERTOIRE/$nom-$JOUR.tar.gz"
    if tar czf "$cible.partiel" -C "$source" . 2>/tmp/tar.err; then
        mv "$cible.partiel" "$cible"
        journal "  $nom sauvegarde ($(wc -c < "$cible") octets)"
    else
        signaler_echec "$nom : $(head -c 300 /tmp/tar.err)"
        rm -f "$cible.partiel"
    fi
}

journal "Sauvegarde des fichiers"
sauvegarder_dossier pieces "$SOURCE_PIECES"
sauvegarder_dossier photos "$SOURCE_PHOTOS"

# ---------------------------------------------------------------------
# 3. Les purges
#
# purger_positions_anciennes preserve les trajets lies a une alerte
# active ou un signalement en examen : la loi impose d'effacer, pas de
# detruire une preuve en cours d'instruction.
# ---------------------------------------------------------------------
journal "Purge des donnees perimees"

if RESULTAT=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAq \
        -v ON_ERROR_STOP=1 \
        -c "SELECT * FROM purger_positions_anciennes($RETENTION_GPS_JOURS);" \
        2>/tmp/psql.err); then
    journal "  traces GPS : $(echo "$RESULTAT" | tr '|' ' ') (trajets, positions)"
else
    signaler_echec "purge GPS : $(head -c 300 /tmp/psql.err)"
fi

if RESULTAT=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAq \
        -v ON_ERROR_STOP=1 \
        -c "SELECT purger_otp_expires();" 2>/tmp/psql.err); then
    journal "  codes OTP supprimes : $RESULTAT"
else
    signaler_echec "purge OTP : $(head -c 300 /tmp/psql.err)"
fi

# ---------------------------------------------------------------------
# 4. Rotation
#
# Sans elle, le disque se remplit et la plateforme s'arrete — une
# sauvegarde qui remplit le disque finit par tuer ce qu'elle protege.
#
# La rotation ne s'execute QUE si la sauvegarde du jour a reussi.
# Supprimer les anciennes apres un echec, c'est detruire les seules
# copies valides qui restent.
# ---------------------------------------------------------------------
if [ "$ECHEC" -eq 0 ]; then
    journal "Rotation au-dela de $RETENTION_JOURS jours"
    SUPPRIMES=$(find "$REPERTOIRE" -maxdepth 1 -type f \
        \( -name '*.sql.gz' -o -name '*.tar.gz' \) \
        -mtime "+$RETENTION_JOURS" -print -delete | wc -l)
    journal "  $SUPPRIMES fichier(s) supprime(s)"
else
    journal "Rotation ignoree : une tache a echoue, les anciennes"
    journal "sauvegardes sont conservees."
fi

# Les fichiers ecartes s'accumuleraient sinon sans jamais etre nettoyes.
find "$REPERTOIRE" -maxdepth 1 -type f -name '*.suspect' -mtime +7 -delete 2>/dev/null

journal "Etat du repertoire :"
du -sh "$REPERTOIRE" 2>/dev/null | sed 's/^/  /'
ls -1t "$REPERTOIRE" 2>/dev/null | head -6 | sed 's/^/  /'

if [ "$ECHEC" -eq 0 ]; then
    journal "===== Entretien termine ====="
else
    journal "===== Entretien termine AVEC ERREURS ====="
fi

exit "$ECHEC"
