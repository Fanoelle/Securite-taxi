#!/bin/sh
# =====================================================================
#  Ordonnanceur de l'entretien.
#
#  Une boucle qui dort jusqu'a l'heure dite, execute l'entretien, puis
#  se rendort. Pas de cron : ses taches demarrent avec un environnement
#  vide, et il faudrait reexporter les identifiants de la base dans un
#  fichier annexe pour qu'elles y aient acces. Ici, le script herite de
#  l'environnement du conteneur, sans intermediaire.
#
#  L'attente est calculee a chaque tour a partir de l'heure courante,
#  jamais accumulee : une execution qui prend dix minutes ne decale pas
#  celle du lendemain, et un conteneur redemarre reprend le bon rythme
#  sans rien reveiller d'avance.
# =====================================================================

set -u

HEURE="${HEURE_ENTRETIEN:-03:00}"
JOURNAL=/var/log/entretien.log

# Le format attendu est HH:MM. Une valeur incomprise ferait dormir la
# boucle pour toujours, sans une sauvegarde et sans un mot : mieux vaut
# refuser de demarrer.
if ! echo "$HEURE" | grep -qE '^[0-2][0-9]:[0-5][0-9]$'; then
    echo "Entretien : HEURE_ENTRETIEN « $HEURE » invalide (format attendu : HH:MM)"
    exit 1
fi

HEURE_H=${HEURE%%:*}
HEURE_M=${HEURE##*:}

if [ "$HEURE_H" -gt 23 ]; then
    echo "Entretien : heure « $HEURE » invalide (0 a 23)"
    exit 1
fi

touch "$JOURNAL"

# Le journal est recopie sur la sortie du conteneur : sans cela,
# `docker compose logs entretien` ne montrerait rien et l'on ne saurait
# jamais si les sauvegardes ont lieu.
tail -F "$JOURNAL" &

executer() {
    /usr/local/bin/entretien.sh >> "$JOURNAL" 2>&1
    if [ $? -ne 0 ]; then
        echo "Entretien : la derniere execution a signale une erreur." >> "$JOURNAL"
    fi
}

echo "Entretien : planifie chaque jour a $HEURE (fuseau ${TZ:-UTC})"

# Execution immediate au demarrage, si demandee. Utile pour verifier
# l'installation sans attendre la nuit.
if [ "${ENTRETIEN_AU_DEMARRAGE:-false}" = "true" ]; then
    echo "Entretien : execution immediate demandee"
    executer
fi

while true; do
    MAINTENANT_H=$(date +%H)
    MAINTENANT_M=$(date +%M)
    MAINTENANT_S=$(date +%S)

    # `date` renvoie « 08 » et « 09 », que le shell lirait en octal.
    # Le prefixe 1 puis la soustraction de 100 force le decimal, sinon
    # l'entretien echouerait deux heures par jour, tous les jours.
    MAINTENANT_H=$((1$MAINTENANT_H - 100))
    MAINTENANT_M=$((1$MAINTENANT_M - 100))
    MAINTENANT_S=$((1$MAINTENANT_S - 100))
    CIBLE_H=$((1$HEURE_H - 100))
    CIBLE_M=$((1$HEURE_M - 100))

    RESTE=$(( (CIBLE_H - MAINTENANT_H) * 3600 \
            + (CIBLE_M - MAINTENANT_M) * 60 \
            - MAINTENANT_S ))

    # L'heure est passee aujourd'hui : viser demain.
    [ "$RESTE" -le 0 ] && RESTE=$((RESTE + 86400))

    echo "Entretien : prochaine execution dans $((RESTE / 3600)) h $(((RESTE % 3600) / 60)) min"
    sleep "$RESTE"
    executer
done
