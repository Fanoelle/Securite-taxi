# Sécurité Taxi Cameroun

Plateforme de sécurité des transports en commun. Un passager scanne le
code QR collé dans un taxi et sait, **avant de monter**, qui conduit,
si ses papiers ont été contrôlés, et par quelle autorité.

S'il monte, il peut partager son trajet avec un proche et déclencher une
alerte d'un seul appui.

---

## Le problème

Monter dans un taxi au Cameroun, c'est faire confiance à un inconnu sans
aucun moyen de vérifier quoi que ce soit. Il n'existe pas de registre
consultable : ni le passager, ni son entourage ne peuvent savoir qui
conduit.

La plateforme apporte trois choses, dans cet ordre :

1. **Vérifier** — un QR par chauffeur, adossé à des pièces réellement
   examinées par une autorité communale.
2. **Suivre** — un proche voit le trajet en direct, sans installer
   d'application ni créer de compte.
3. **Alerter** — un appui prévient les proches et l'autorité, avec la
   position.

---

## Démarrer

### Prérequis

PostgreSQL et Node.js. Aucune version minimale n'est déclarée dans
`package.json` ; le développement se fait sur Node 22 et PostgreSQL 14.
Le schéma utilise `gen_random_uuid()` (pgcrypto) et `citext`, tous deux
installés par `db/installer.sh`.

### Installation

```bash
bash db/installer.sh          # crée la base et applique le schéma
cd api
npm install
cp .env.exemple .env
```

Sur une base **déjà installée** avant une modification du schéma,
`installer.sh` ne suffit pas — il recrée tout. Appliquer les migrations
de `db/migrations/`, idempotentes et rejouables sans risque :

```bash
psql -d securitaxi -v ON_ERROR_STOP=1 -f db/migrations/2026-08-28_reference_relais.sql
```

L'API refuse de démarrer tant que `JWT_SECRET` garde sa valeur d'exemple
— c'est délibéré. Générer une vraie valeur :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

En développement, laisser `PGHOST` **vide** : la connexion passe par la
socket Unix locale, sans mot de passe. Laisser `SMS_FOURNISSEUR=console`
— les SMS s'affichent dans les journaux et ne coûtent rien.

### Lancer

Deux commandes, dans cet ordre. La première occupe son terminal : ouvrir
un second onglet pour la suivante.

```bash
cd api
npm run dev                # 1. API + pages, port 3000 — laisser tourner
npm run jeu-de-donnees     # 2. dans un autre terminal : données de test
```

**Un seul serveur sert tout.** Il n'y a rien d'autre à lancer : pas de
serveur de façade, pas d'étape de compilation. Les pages sont produites
par l'API elle-même, et chaque interface n'est qu'une adresse à ouvrir
dans le navigateur.

| Interface | Adresse | Entrer avec |
|---|---|---|
| **Passager** — scan | `http://localhost:3000/s/4NRZ7KT` | rien, remplacer par votre code |
| **Passager** — accueil | `http://localhost:3000/` | rien, saisie manuelle du code |
| **Chauffeur** — connexion | `http://localhost:3000/chauffeur/connexion` | `699452108` + code SMS |
| **Chauffeur** — inscription | `http://localhost:3000/chauffeur/inscription` | un numéro non utilisé |
| **Agent** — connexion | `http://localhost:3000/agent/connexion` | `699000002` / `DeveloppementSecuriTaxi2026` |
| **Superadmin** | `http://localhost:3000/api/docs` | Swagger — pas d'écran dédié |

Les adresses `/t/:jeton` (suivi du trajet), `/chauffeur` (le dossier) et
`/agent` (la file) ne s'ouvrent pas à la main : on y arrive depuis les
pages ci-dessus, une fois le trajet démarré ou la connexion établie.

Chaque interface est détaillée plus bas — comptes de test, codes SMS,
états de dossier à observer.

Le second script affiche les comptes créés et **le code QR à utiliser** :

```
699452108  Paul Bertrand NGONO    verifie
           → QR 4NRZ7KT — scannable
```

Ce code **change à chaque exécution** du script : remplacer `4NRZ7KT`
par celui que votre terminal affiche. Un code inventé donne « CODE NON
RECONNU » — c'est le comportement attendu, pas une panne.

Pour retrouver un code actif sans relancer le script :

```bash
psql -d securitaxi -c "SELECT jeton FROM code_qr WHERE actif;"
```

#### L'écran passager

C'est le produit tel qu'un passager le rencontre. Aucun compte, aucune
installation.

| Ouvrir dans le navigateur | Ce que ça montre |
|---|---|
| `http://localhost:3000/s/4NRZ7KT` | **Le scan** — identité du chauffeur, plaque, statut. L'écran qui décide si on monte. |
| `http://localhost:3000/` | L'accueil, avec le champ de saisie manuelle d'un code |

Depuis l'écran de scan : **« Démarrer le trajet »** → suivi en direct,
partage à un proche par SMS, bouton d'alerte, puis « Terminer » → l'objet
oublié et la mise en relation par le call center.

Les SMS ne partent pas réellement en développement. Pour les lire :

```bash
psql -d securitaxi -c \
  "SELECT categorie, telephone, contenu FROM sms_sortant ORDER BY cree_le DESC LIMIT 5;"
```

#### L'écran chauffeur

| Ouvrir dans le navigateur | Ce que ça montre |
|---|---|
| `http://localhost:3000/chauffeur/connexion` | Connexion par code SMS |
| `http://localhost:3000/chauffeur/inscription` | Inscription d'un nouveau chauffeur |
| `http://localhost:3000/chauffeur` | Son dossier, ses pièces, son code QR |

Se connecter avec le numéro **`699452108`** (Paul Bertrand NGONO, déjà
vérifié). Le code SMS ne s'envoie pas : le récupérer dans les journaux
de `npm run dev`, ou en base :

```bash
psql -d securitaxi -c \
  "SELECT contenu FROM sms_sortant WHERE categorie='otp' ORDER BY cree_le DESC LIMIT 1;"
```

Autres comptes selon l'état de dossier à observer — mot de passe commun
`DeveloppementSecuriTaxi2026` :

| Numéro | État du dossier |
|---|---|
| `699452108` | vérifié, QR actif |
| `677334455` | pièces déposées, pas encore examinées |
| `695112233` | dossier vide |
| `698776655` | suspendu, QR révoqué |

#### L'écran agent

`http://localhost:3000/agent/connexion`, avec `699000002` /
`DeveloppementSecuriTaxi2026`. La file ne montre que les dossiers de la
commune de l'agent — la ville vient du jeton, jamais de l'URL.

Ouvrir un dossier, déplier chaque pièce, rendre un verdict. Le bouton de
validation reste grisé tant que les quatre pièces requises ne sont pas
jugées lisibles ; ce n'est qu'un confort d'affichage, le serveur refuse
de toute façon. La validation produit le code QR à l'écran.

---

## Les trois parcours

### Le passager — aucun compte

| Adresse | Ce qu'il voit |
|---|---|
| `/s/:jeton` | La fiche du chauffeur : statut, nom, plaque, autorité |
| `/t/:jeton` | Son trajet : alerte, partage, position |

Il scanne, il lit, il monte. Aucune inscription, aucune installation :
toute friction à ce moment-là fait abandonner, et quelqu'un qui hésite
devant un taxi la nuit n'ouvre pas un magasin d'applications.

Son identité tient dans un **jeton de session** que son navigateur
génère et garde. Ce jeton n'authentifie rien : il relie un trajet à ses
contacts et empêche d'agir sur le trajet d'un autre.

**Objet oublié.** Une fois la course terminée, le passager obtient le
numéro du **call center** et une référence de dossier, ou décrit l'objet,
et le chauffeur reçoit un SMS auquel il peut répondre. Le numéro
personnel du chauffeur ne lui est jamais communiqué : c'est l'opérateur
qui fait le relais.

L'accès à cette référence tient à trois conditions, et aucune n'est
accessoire : la course doit être terminée, la session doit être celle
qui l'a faite (un proche qui suit le trajet n'y a pas droit), et chaque
demande est écrite dans `journal_audit`.

**L'itinéraire.** Le parcours accompli est tracé sur la page de suivi,
avec la distance parcourue. Le passager le voit, et son proche aussi via
le lien qu'il a reçu.

Le tracé est un **SVG dessiné à partir des positions enregistrées**, sans
fond de carte : une carte à tuiles chargerait une bibliothèque et des
dizaines d'images au moment précis où la page doit rester légère. Il ne
donne donc pas les noms de rues, mais il montre la forme du trajet —
assez pour reconnaître un itinéraire habituel, et surtout pour voir qu'il
s'en écarte.

Un trajet d'une heure accumule des centaines de positions ; l'API en
renvoie une soixantaine, échantillonnées en base. 400 points stockés
donnent environ 3 Ko sur le réseau.

### Le proche — un lien reçu par SMS

Il ouvre `/t/:jeton` et voit le trajet se mettre à jour. Pas de compte
non plus. C'est le jeton, long et aléatoire, qui protège l'accès.

La même adresse sert au passager et au proche. Le serveur ne peut pas
les distinguer — un lien ouvert depuis un SMS n'envoie pas d'en-tête de
session — alors la page demande à l'API si cette session possède ce
trajet. Le passager obtient les commandes, le proche non. Et le serveur
refuse de toute façon toute action venant d'une session étrangère (403).

### Le chauffeur — un compte, un dossier, un QR

| Adresse | Étape |
|---|---|
| `/chauffeur/inscription` | Nom, téléphone, ville, véhicule |
| `/chauffeur/connexion` | Retour sur son dossier |
| `/chauffeur` | Dépôt des pièces, suivi de l'examen, code QR |

Il dépose sa **photo de profil** et quatre pièces obligatoires — CNI
recto, CNI verso, permis, carte grise. Un agent les examine une par une.
**Le QR n'existe qu'après validation.**

La photo et les pièces sont stockées séparément, et c'est délibéré : une
CNI est un secret que seul un agent consulte, avec une trace d'audit ; le
portrait est fait pour être vu par chaque passager, qui doit pouvoir le
comparer au visage du conducteur. Les deux répertoires, les deux
permissions et les deux routes sont distincts.

Quand une pièce est refusée, le chauffeur voit le motif écrit par
l'agent : « Photo floue, reprenez-la en plein jour ». Sans cela,
l'obligation de commenter un rejet ne servirait à rien.

### L'agent — validation

Pas encore d'écran dédié. Les routes existent et sont utilisables via
Swagger : file de validation, examen des pièces, décision, suspension.

---

## Ce qui tient le produit

Six invariants. Ce ne sont pas des détails d'implémentation : chacun
répond à une manière dont le produit pourrait mentir à quelqu'un.

1. **Aucun QR avant validation.** Un chauffeur inscrit n'a pas de code.
2. **Aucune validation sans pièces examinées.** La référence de licence
   est ce que voit le passager ; elle ne peut exister sans qu'un agent
   ait vu les documents et les ait jugés lisibles.
3. **Un suspendu ne peut plus paraître vérifié.** La suspension révoque
   le QR dans la même transaction ; le scan renvoie 404.
4. **Le double appui sur l'alerte ne crée pas de doublon.** Quelqu'un
   qui panique appuie plusieurs fois — l'alerte existante est renvoyée.
5. **Une session ne pilote pas le trajet d'une autre.**
6. **Un agent ne voit que sa ville.** La file de validation est filtrée
   sur l'autorité portée par son jeton, jamais sur un paramètre d'URL.

---

## Architecture

```
securite-taxi-cameroun/
├── api/              NestJS + PostgreSQL — l'API et les pages publiques
│   ├── src/
│   │   ├── public/       pages HTML servies aux URL publiques
│   │   ├── scan/         résolution d'un QR
│   │   ├── trajets/      trajets, positions, partage
│   │   ├── alertes/      urgence et notification
│   │   ├── chauffeurs/   inscription, validation
│   │   ├── documents/    pièces justificatives et examen
│   │   ├── signalements/ signalements et suspension
│   │   ├── auth/         JWT, OTP, rôles
│   │   ├── qr/           génération SVG
│   │   ├── sms/          envoi (console en développement)
│   │   └── base/         accès PostgreSQL et transactions
│   └── scripts/      superadmin, démonstration, jeu de données
├── db/               schéma SQL, vues, rétention
├── docs/             cahier des charges, modèle de données, guide de test
├── ecrans/           maquettes d'origine (.dc.html)
└── test-visuel/      banc d'essai montrant les appels HTTP
```

**7 000 lignes de TypeScript, 19 tables, 172 tests.**

### Choix techniques

**SQL écrit à la main, pas d'ORM.** Le schéma porte des contraintes que
la couche métier ne devrait pas pouvoir contourner : un QR actif exige
un chauffeur validé, une alerte close exige une note. Ces règles vivent
dans la base, avec des `CHECK` et des transactions.

**Les pages HTML sont dans le code, pas sur le disque.** Une page servie
à quelqu'un qui monte dans un taxi la nuit doit s'afficher même si le
reste est cassé. Un fichier manquant en production n'est pas un risque
acceptable pour cet écran-là.

**Le français partout.** Noms de tables, de colonnes, de méthodes,
messages d'erreur. Le domaine est camerounais, les agents qui liront ces
messages sont francophones ; traduire dans les deux sens introduit des
contresens.

**Pas de PostGIS obligatoire.** Le schéma prévoit son usage
(`db/004_postgis.sql`) mais la plateforme tourne sans : les positions
sont stockées en latitude/longitude. Exiger une extension superuser
compliquerait le déploiement pour un bénéfice différé.

### Le modèle de données

Les tables centrales et leurs liens :

- **compte** — identité et rôle : `chauffeur`, `agent`, `superadmin`.
  Il n'existe pas de rôle « passager », et c'est délibéré : un passager
  n'a pas de compte du tout.
- **chauffeur** → **vehicule**, **document**, **code_qr**
- **trajet** → **position_trajet**, **partage_trajet**, **alerte**
- **autorite** → **ville** → **region**
- **journal_audit** — toute consultation d'une pièce d'identité y figure.
  C'est une exigence de la loi n° 2024/017, pas un confort.

Détail complet : [docs/modele-donnees.md](docs/modele-donnees.md).

Les exigences, le périmètre et l'articulation avec la plateforme
officielle Taxi-Yaoundé.com sont décrits dans
[docs/cahier-des-charges.pdf](docs/cahier-des-charges.pdf) — 15 pages, généré
depuis `docs/cahier-des-charges.html`.

---

## Tester

Quatre niveaux, du plus rapide au plus manuel. Guide détaillé :
[docs/tester.md](docs/tester.md).

### 1. Tests automatiques

```bash
npm test              # 172 tests, ~10 s, aucune base requise
npm run typecheck
```

À lancer après toute modification.

> Si la suite devient très lente, vérifier que `maxWorkers` est toujours
> dans la configuration Jest. Sans lui, bcrypt sature la machine et la
> suite passe de 10 s à près de 10 minutes.

### 2. Démonstration de bout en bout

```bash
npm run dev            # dans un terminal
npm run demonstration  # dans un autre
```

37 vérifications contre l'API et la vraie base : inscription, pièces,
validation, trajet, alerte, signalement, suspension, objet oublié. Le
script contrôle autant ce qui doit marcher que ce qui doit être
**refusé**.

### 3. Jeu de données

```bash
npm run jeu-de-donnees
```

| Compte | Rôle | État |
|---|---|---|
| `699000001` | superadmin | — |
| `699000002` | agent | Douala V, reçoit les alertes |
| `699000003` | agent | Yaoundé II |
| `699452108` | chauffeur | vérifié, QR scannable |
| `677334455` | chauffeur | dossier complet, non examiné |
| `695112233` | chauffeur | dossier vide |
| `698776655` | chauffeur | suspendu, QR révoqué |

Mot de passe commun : `DeveloppementSecuriTaxi2026`.
Pour effacer : `npm run jeu-de-donnees -- --vider`.

### 4. À la main

- **Les pages** : `/s/CODE`, `/chauffeur/connexion`, `/agent/connexion`
- **Swagger** : <http://localhost:3000/api/docs>
- **Le banc d'essai** : `test-visuel/`, qui montre chaque appel HTTP
- **Les SMS** : `SELECT categorie, telephone, contenu FROM sms_sortant
  ORDER BY cree_le DESC;` — c'est aussi comme ça qu'on récupère un OTP
  en développement.

### Toutes les commandes

Depuis `api/`.

| Commande | Ce qu'elle fait |
|---|---|
| `npm run dev` | API + toutes les pages, port 3000, rechargement à chaud |
| `npm run jeu-de-donnees` | Comptes et dossiers de test ; affiche le code QR |
| `npm run jeu-de-donnees -- --vider` | Efface ces données |
| `npm run demonstration` | 37 vérifications de bout en bout (API à lancer avant) |
| `npm test` | 172 tests unitaires, ~10 s, aucune base requise |
| `npm run typecheck` | Vérification des types, sans compiler |
| `npm run creer-superadmin -- 699452108` | Amorçage : le premier superadmin, mot de passe demandé au clavier |
| `npm run build` puis `npm start` | Compilation et exécution en production |

---

## Depuis un vrai téléphone

Le QR encode `URL_PUBLIQUE`. Pour scanner depuis votre téléphone sur le
même réseau :

```bash
# api/.env
URL_PUBLIQUE=http://192.168.1.X:3000
```

Puis régénérer les données — les QR déjà émis encodent l'ancienne
adresse.

> La géolocalisation exige HTTPS hors `localhost`. En HTTP depuis un
> téléphone, le trajet fonctionne mais sans position.

---

## Sécurité

**La photo de profil** est publique par nature — le passager doit
pouvoir comparer. Elle est servie sans authentification, mais par une
route applicative et jamais par un répertoire statique : le nom du
fichier est 24 octets aléatoires, les deux segments de l'URL sont
validés par expression régulière, et seuls JPEG et PNG sont acceptés
(un PDF, valable comme pièce, est refusé comme portrait).

**Les pièces d'identité** ne sont jamais servies statiquement. Chaque
fichier reçoit un nom aléatoire, sa signature binaire est vérifiée avant
écriture — un exécutable renommé en `.jpg` est rejeté — et toute
consultation est tracée dans `journal_audit`.

**Les mots de passe** passent par bcrypt (coût 12 ; 10 pour les codes
OTP, qui expirent en quelques minutes). Les jetons JWT
portent le rôle et l'autorité, relus en base à chaque requête : un
compte désactivé perd l'accès immédiatement, sans attendre l'expiration.

**Les débits sont limités** par route : 20 scans/minute (une fréquence
plus élevée signale une énumération de jetons), 20 trajets/heure,
30 téléversements/heure. L'alerte, elle, est volontairement peu bridée :
le seul cas où quelqu'un appuie en boucle est celui où il panique.

**La session passager** n'authentifie rien et ne donne accès qu'à ce
qu'elle a créé.

**Le numéro du chauffeur** ne sort d'aucun point de l'API passager :
ni au scan, ni dans le suivi partagé, ni après la course. Le besoin
légitime — joindre le chauffeur pour un objet oublié — passe par le
call center, qui met en relation sur référence. Un numéro personnel
remis à un inconnu ne se reprend plus, et le chauffeur n'a pas choisi
son passager ; l'opérateur, lui, peut refuser une mise en relation et
garde une trace des deux versions.

---

## Limites connues

- Pas d'écran superadmin : la supervision passe par Swagger.
- `db/verifier.sh` échoue sur `CREATE EXTENSION postgis` (droits
  superuser). La plateforme tourne sans.
- L'envoi de SMS réel (Nexah) n'a pas été testé contre le fournisseur ;
  l'identifiant d'expéditeur doit être déclaré auprès de l'ART avant
  production.

---

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `PORT` | Port d'écoute (3000) |
| `PGHOST` … `PGPASSWORD` | Connexion PostgreSQL — vide = socket Unix |
| `JWT_SECRET` | **Obligatoire**, refuse la valeur d'exemple |
| `JWT_EXPIRATION` | Durée de validité des jetons |
| `URL_PUBLIQUE` | Base des QR et des liens de suivi |
| `STOCKAGE_DOCUMENTS` | Dossier des pièces, hors dépôt git |
| `STOCKAGE_PHOTOS` | Dossier des photos de profil, servi publiquement |
| `SMS_FOURNISSEUR` | `console` en développement, `nexah` en production |
| `SMS_NEXAH_*` | Identifiants du fournisseur |
| `SMS_EXPEDITEUR` | À déclarer auprès de l'ART |

Ne jamais committer `.env`.
