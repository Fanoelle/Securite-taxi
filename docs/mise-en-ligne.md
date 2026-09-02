# Mettre la plateforme en ligne

Ce document mène d'un dépôt sur votre machine à un site public en HTTPS,
avec le jeu de données de démonstration. Il suppose que vous n'avez ni
domaine ni serveur, et ne demande aucune connaissance préalable de
Docker.

Comptez **une heure**, dont une bonne partie d'attente.

---

## Ce que cela coûte

| Poste | Prix indicatif | Où |
|---|---|---|
| Nom de domaine | 10 à 15 € par an | Namecheap, OVH, Gandi |
| Serveur (VPS) | 5 à 6 € par mois | Hetzner, DigitalOcean, Contabo |
| Certificat HTTPS | **gratuit** | Let's Encrypt, automatique |

Prenez un serveur avec **4 Go de mémoire**. PostgreSQL avec PostGIS et
Node tiennent difficilement dans 2 Go, et un serveur qui manque de
mémoire tue le processus le plus gourmand sans prévenir — c'est-à-dire
la base.

---

## Étape 1 — Le nom de domaine

Achetez-le chez n'importe quel registrar. Deux remarques :

- **Il sera imprimé sur les autocollants QR** collés dans les taxis.
  Un domaine se change, mais pas un autocollant déjà posé. Choisissez-le
  comme un nom durable.
- Un `.cm` camerounais passe par l'ANTIC, avec des démarches et un coût
  plus élevés. Pour une démonstration, un `.org` ou un `.net` suffit ;
  le `.cm` se prendra pour le lancement réel.

---

## Étape 2 — Le serveur

Créez un VPS avec **Ubuntu 24.04**. L'hébergeur vous donne une **adresse
IP** — notez-la, elle sert à l'étape suivante.

Connectez-vous :

```bash
ssh root@VOTRE_IP
```

Installez Docker :

```bash
curl -fsSL https://get.docker.com | sh
```

Vérifiez :

```bash
docker --version
docker compose version
```

---

## Étape 3 — Faire pointer le domaine vers le serveur

Chez votre registrar, dans la zone DNS, créez **un enregistrement de
type A** :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `@` | l'IP de votre serveur |

Ajoutez le même pour `www` si vous voulez que `www.` fonctionne aussi.

**Cette étape doit précéder le démarrage.** Let's Encrypt vérifie que le
domaine vous appartient en le contactant ; si le domaine ne pointe nulle
part, le certificat est refusé.

La propagation prend de quelques minutes à quelques heures. Vérifiez :

```bash
dig +short VOTRE-DOMAINE
```

Tant que cette commande ne renvoie pas l'IP de votre serveur, attendez.
Ne démarrez pas : Let's Encrypt limite le nombre de demandes échouées
par semaine, et une série de tentatives prématurées peut vous bloquer
plusieurs jours sans HTTPS.

---

## Étape 4 — Installer le projet

Sur le serveur :

```bash
apt install -y git
git clone VOTRE_DEPOT securite-taxi
cd securite-taxi
```

Créez le fichier de configuration :

```bash
cp .env.example .env
```

Générez les deux secrets — **ne les inventez pas de tête** :

```bash
openssl rand -base64 32   # pour POSTGRES_PASSWORD
openssl rand -base64 32   # pour JWT_SECRET
```

Ouvrez `.env` (`nano .env`) et remplissez au minimum :

```
DOMAINE=votre-domaine.org
COURRIEL_TLS=vous@exemple.com
POSTGRES_PASSWORD=...le premier tirage...
JWT_SECRET=...le second tirage...
```

Laissez `SMS_FOURNISSEUR=console` : en démonstration, les codes de
connexion s'affichent dans les journaux au lieu d'être envoyés par SMS.

---

## Étape 5 — Démarrer

```bash
docker compose up -d --build
```

La première construction prend quelques minutes. Suivez ce qui se passe :

```bash
docker compose logs -f
```

Caddy demande le certificat tout seul. Quand vous voyez `certificate
obtained successfully`, le site est en HTTPS.

Installez le jeu de démonstration :

```bash
docker compose --profile amorcage run --rm amorcage
```

Ouvrez `https://votre-domaine.org` — la plateforme est en ligne.

---

## Étape 6 — Fermer ce qui doit l'être

Le pare-feu, pour ne laisser passer que le web et SSH :

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

La base n'expose aucun port : elle n'est joignable que depuis le réseau
interne de Docker. C'est voulu, ne l'ouvrez pas.

---

## Ce qu'il faut savoir avant de montrer le site

**Tous les comptes de démonstration partagent le mot de passe
`12345678`.** C'est délibéré : il se tape sans le chercher pendant une
démonstration. Mais cela veut dire que sur un site public, **n'importe
qui se connecte comme agent de validation** — `699000002` / `12345678`
— et consulte les pièces déposées par les chauffeurs.

C'est acceptable tant que les pièces sont factices, **à deux
conditions** :

1. **Ne déposez jamais de vraie pièce d'identité sur ce site**, et ne
   laissez personne le faire. Une carte d'identité déposée là est
   publique.
2. Dites clairement, sur la page d'accueil, qu'il s'agit d'une
   démonstration et que les données n'en sont pas réelles.

Dès qu'un vrai chauffeur dépose un vrai document, cette configuration
n'est plus tenable. Il faut alors :

- effacer les comptes de démonstration
  (`docker compose --profile amorcage run --rm amorcage --vider`),
- créer les vrais agents avec des mots de passe tirés au sort
  (`openssl rand -base64 24`),
- passer aux SMS réels.

---

## Les gestes courants

| Ce que vous voulez | La commande |
|---|---|
| Voir les journaux | `docker compose logs -f` |
| Lire un code SMS de connexion | `docker compose logs api \| grep '\[SMS'` |
| Redémarrer | `docker compose restart` |
| Mettre à jour le code | `git pull && docker compose up -d --build` — voir ci-dessous |
| Réinstaller le jeu de démo | `docker compose --profile amorcage run --rm --build amorcage` |
| Effacer le jeu de démo | `docker compose --profile amorcage run --rm amorcage --vider` |
| Tout arrêter | `docker compose down` |

`docker compose down` **conserve** les données : elles vivent dans des
volumes. La commande qui les détruit est `docker compose down -v` —
elle efface la base et toutes les pièces déposées, sans confirmation.

Le `--build` de la ligne « réinstaller le jeu de démo » n'est pas
décoratif : sans lui, `run` réutilise l'image déjà construite et
ignore les modifications du code. On croit alors avoir changé quelque
chose sans que rien ne bouge.

---

## Mettre à jour une plateforme déjà en ligne

Un déploiement n'est pas une gravure. On modifie après, et c'est la
norme — il n'y a aucune raison d'attendre que tout soit fini pour
mettre en ligne.

### Le cas courant : du code seulement

```bash
git pull
docker compose up -d --build
```

Docker reconstruit l'image et remplace le conteneur. **Les données
restent** : elles vivent dans des volumes, pas dans le conteneur.
Quelques secondes d'interruption, pas davantage.

### Le cas qui demande une précaution : le schéma a changé

Les fichiers de `db/` ne sont joués **qu'à la création de la base**.
Sur une base déjà en service, ils sont ignorés — Docker ne rejoue pas
`docker-entrypoint-initdb.d` sur un volume existant. Il faut donc
appliquer la migration à la main :

```bash
# 1. Sauvegarder d'abord. Toujours.
docker compose exec entretien /usr/local/bin/entretien.sh

# 2. Appliquer la migration
docker compose exec -T db psql -U securitaxi -d securitaxi \
  -v ON_ERROR_STOP=1 < db/migrations/2026-09-02_paiement_expiration_qr.sql

# 3. Puis seulement, mettre le code à jour
docker compose up -d --build
```

`ON_ERROR_STOP=1` n'est pas décoratif : sans lui, `psql` continue après
une erreur et laisse le schéma à moitié migré — l'état le plus pénible
à rattraper.

Les migrations de `db/migrations/` sont **idempotentes** : les rejouer
ne casse rien. En cas de doute sur ce qui a déjà été appliqué, rejouez.

### Comment savoir si une migration est en attente

```bash
docker compose exec -T db psql -U securitaxi -d securitaxi -c "\d paiement"
```

Une table ou une colonne absente signale une migration non appliquée.

---

## Sauvegardes et entretien

Un service `entretien` tourne **toutes les nuits à 3 h**, sans rien
demander. Il fait trois choses, dans cet ordre :

1. **Sauvegarde** la base et les pièces d'identité ;
2. **Purge** les traces GPS de plus de 30 jours et les codes SMS
   périmés ;
3. **Fait tourner** les sauvegardes, en gardant les 14 derniers jours.

L'ordre n'est pas indifférent : la sauvegarde précède la purge, pour que
la sauvegarde du jour contienne encore ce que la purge va effacer.

La purge n'est pas un confort. La **loi n° 2024/017** impose d'effacer
les traces de géolocalisation ; les fonctions existaient en base depuis
le début, mais rien ne les appelait. C'est ce service qui les appelle.

### Vérifier que ça marche

Sans attendre trois heures du matin, mettez `ENTRETIEN_AU_DEMARRAGE=true`
dans le `.env`, puis :

```bash
docker compose up -d entretien
docker compose logs entretien
```

Vous devez voir `base sauvegardee` suivi d'un nombre d'octets.
**Remettez la variable à `false` ensuite**, sinon chaque redémarrage
relance une sauvegarde complète.

Les fichiers apparaissent dans le dossier `sauvegardes/` :

```
base-2026-09-02.sql.gz      la base entière
pieces-2026-09-02.tar.gz    les pièces d'identité
photos-2026-09-02.tar.gz    les photos de profil
```

Un fichier `.suspect` signale une sauvegarde jugée trop petite pour être
valide : le service l'écarte plutôt que de la faire passer pour bonne.

### Restaurer

À lire **avant** d'en avoir besoin. La base :

```bash
gunzip -c sauvegardes/base-2026-09-02.sql.gz \
  | docker compose exec -T db psql -U securitaxi -d securitaxi
```

Les pièces d'identité :

```bash
docker run --rm \
  -v securite-taxi_pieces:/pieces \
  -v "$PWD/sauvegardes":/sauvegardes:ro \
  alpine tar xzf /sauvegardes/pieces-2026-09-02.tar.gz -C /pieces
```

Vérifiez ensuite qu'un QR se scanne : c'est le test qui prouve que la
restauration a réellement fonctionné.

### Ce qui reste à votre charge

**Copier les sauvegardes hors du serveur.** Le service les écrit dans
`sauvegardes/`, sur la machine — mais une sauvegarde qui ne vit que sur
la machine qu'elle protège ne protège de rien. Un disque qui lâche, un
serveur résilié, et tout part avec.

Depuis votre poste, une fois par semaine au minimum :

```bash
rsync -avz --delete root@VOTRE_IP:~/securite-taxi/sauvegardes/ ./sauvegardes-taxi/
```

**Et restaurez pour de vrai, au moins une fois**, sur une base d'essai.
Une sauvegarde jamais restaurée n'est pas une sauvegarde : c'est un
fichier dont on espère quelque chose.

### Régler l'entretien

Dans le `.env` :

| Variable | Effet |
|---|---|
| `HEURE_ENTRETIEN` | L'heure, au format `HH:MM` (défaut `03:00`) |
| `FUSEAU_HORAIRE` | `Africa/Douala` par défaut |
| `RETENTION_SAUVEGARDES_JOURS` | Combien de jours garder (défaut 14) |
| `RETENTION_GPS_JOURS` | Conservation des traces GPS — **30, valeur légale** |
| `CHEMIN_SAUVEGARDES` | Où écrire les fichiers |

Après modification : `docker compose up -d entretien`.

---

## Ce qui reste avant un usage réel

Cette procédure met en ligne une **démonstration**. Avant d'accueillir
de vrais chauffeurs :

- **Déclarer l'identifiant d'expéditeur SMS auprès de l'ART**, puis
  passer `SMS_FOURNISSEUR=nexah`. C'est une démarche administrative avec
  un délai : à lancer tôt.
- **Changer le mot de passe agent** et créer les vrais comptes.
- **Automatiser les sauvegardes** et vérifier qu'une restauration
  fonctionne — une sauvegarde jamais restaurée n'est pas une sauvegarde.
- **Terminer le module de paiement** si le QR doit être payant.
- **Programmer la purge des positions GPS** (`db/010_retention.sql`),
  exigée par la loi n° 2024/017 sur la protection des données.
