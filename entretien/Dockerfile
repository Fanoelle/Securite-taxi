# =====================================================================
#  Image d'entretien : sauvegardes et purges quotidiennes.
#
#  Elle part de l'image PostgreSQL, et non d'une alpine nue, pour une
#  raison precise : pg_dump doit avoir la MEME version majeure que le
#  serveur. Un pg_dump 15 refuse de sauvegarder une base 16 — et on ne
#  s'en apercevrait que le jour ou l'on en a besoin.
#
#  Aucun paquet n'est installe : l'image fournit deja pg_dump, psql,
#  tar, gzip et les fuseaux horaires. Une image qui n'appelle pas
#  apt-get se construit partout, y compris derriere un reseau
#  restreint, et ne peut pas casser le jour ou un depot change.
#
#  L'ordonnancement se fait par une boucle d'attente plutot que par
#  cron : cron demarre ses taches avec un environnement vide, ce qui
#  obligerait a reexporter les identifiants de la base dans un fichier
#  annexe. La boucle, elle, herite naturellement de l'environnement du
#  conteneur — moins de pieces, moins de facons d'echouer en silence.
# =====================================================================
FROM postgis/postgis:16-3.4

COPY entretien.sh /usr/local/bin/entretien.sh
COPY demarrer.sh  /usr/local/bin/demarrer.sh
RUN chmod +x /usr/local/bin/entretien.sh /usr/local/bin/demarrer.sh

# L'image de base declare un ENTRYPOINT qui demarre PostgreSQL : il
# faut l'annuler, sinon ce conteneur lancerait un second serveur.
ENTRYPOINT []
CMD ["/usr/local/bin/demarrer.sh"]
