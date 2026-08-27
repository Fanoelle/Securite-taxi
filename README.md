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

L'API refuse de démarrer tant que `JWT_SECRET` garde sa valeur d'exemple
— c'est délibéré. Générer une vraie valeur :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

En développement, laisser `PGHOST` **vide** : la connexion passe par la
socket Unix locale, sans mot de passe. Laisser `SMS_FOURNISSEUR=console`
— les SMS s'affichent dans les journaux et ne coûtent rien.

### Lancer

```bash
npm run dev                # API + pages, port 3000
npm run jeu-de-donnees     # comptes et dossiers de démonstration
```

Le second script affiche un code QR, par exemple :

```
699452108  Paul Bertrand NGONO    verifie
           → QR BUH4FVZ — scannable
```

Ouvrir alors `http://localhost:3000/s/BUH4FVZ` — **en remplaçant
`BUH4FVZ` par le code que votre terminal affiche**. Il change à chaque
exécution du script ; un code inventé donne « CODE NON RECONNU », ce qui
est le comportement attendu.

Pour retrouver un code actif sans relancer le script :

```bash
psql -d securitaxi -c "SELECT jeton FROM code_qr WHERE actif;"
```

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
6. **Un agent ne voit que sa ville.** ⚠️ *Voir « Limites connues ».*

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
├── docs/             modèle de données, guide de test
├── ecrans/           maquettes d'origine (.dc.html)
└── test-visuel/      banc d'essai montrant les appels HTTP
```

**7 000 lignes de TypeScript, 19 tables, 156 tests.**

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

---

## Tester

Quatre niveaux, du plus rapide au plus manuel. Guide détaillé :
[docs/tester.md](docs/tester.md).

### 1. Tests automatiques

```bash
npm test              # 156 tests, ~10 s, aucune base requise
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

- **Les pages** : `/s/CODE`, `/t/JETON`, `/chauffeur`
- **Swagger** : <http://localhost:3000/api/docs>
- **Le banc d'essai** : `test-visuel/`, qui montre chaque appel HTTP
- **Les SMS** : `SELECT categorie, telephone, contenu FROM sms_sortant
  ORDER BY cree_le DESC;` — c'est aussi comme ça qu'on récupère un OTP
  en développement.

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

---

## Limites connues

**Le cloisonnement par ville n'est pas appliqué sur la file de
validation.** Un agent de Yaoundé voit les dossiers de Douala.

La cause est dans [api/src/chauffeurs/chauffeurs.controller.ts](api/src/chauffeurs/chauffeurs.controller.ts) :
le filtre vient d'un paramètre d'URL, donc du client.

```ts
async file(@Query('villeId') villeId?: string) {
  return this.chauffeurs.fileValidation(villeId);   // sans villeId → tout
}
```

Le service filtre correctement quand on lui passe la valeur, et la route
`:id/validation` juste en dessous applique le bon réflexe avec
`@CompteConnecte()`. C'est une route qui a échappé au motif, pas un
défaut de conception. Portée : la file expose des noms, plaques et
rattachements — pas de pièces d'identité — et seul un agent authentifié
l'atteint.

**Autres manques :**

- Pas d'écran agent ni d'écran superadmin (Swagger uniquement).
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
