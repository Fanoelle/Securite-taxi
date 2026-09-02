# Tester la plateforme

Quatre manières de vérifier ce qui a été construit, de la plus rapide à
la plus manuelle.

## Prérequis, une seule fois

```bash
bash db/installer.sh          # crée la base et applique le schéma
cd api
npm install
cp .env.exemple .env          # puis renseigner JWT_SECRET
```

Pour `JWT_SECRET`, l'API refuse de démarrer tant que la valeur d'exemple
est en place — c'est délibéré. Générer une vraie valeur :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

En développement, laisser `PGHOST` **vide** : la connexion passe par la
socket Unix locale, sans mot de passe. Laisser `SMS_FOURNISSEUR=console`
— les SMS s'affichent dans les journaux au lieu d'être envoyés, et ne
coûtent rien.

---

## 1. Les tests automatiques

```bash
npm test
```

172 tests, une dizaine de secondes. C'est ce qu'il faut lancer après
toute modification. Aucune base n'est requise : les accès sont simulés.

```bash
npm test -- --watch              # relance à chaque sauvegarde
npm test -- src/alertes          # un seul module
npm run typecheck                # vérification des types seule
```

## 2. La démonstration de bout en bout

```bash
npm run dev            # dans un terminal
npm run demonstration  # dans un autre
```

Déroule le parcours complet contre l'API réelle et la vraie base :
inscription, pièces justificatives, validation, trajet, positions,
partage, alerte, signalement, suspension, objet oublié. Chaque étape
s'affiche avec son résultat — **37 vérifications**.

Le script contrôle autant ce qui doit marcher que ce qui doit être
**refusé** : dossier vide non validable, second trajet simultané rejeté,
exécutable déguisé en image bloqué, session étrangère écartée.

Les données sont effacées à la fin. Pour les garder :

```bash
npm run demonstration -- --garder
```

C'est aussi le script à lancer pour montrer le produit à quelqu'un.

## 3. Le jeu de données de développement

Pour explorer à la main sans rejouer le parcours à chaque fois :

```bash
npm run jeu-de-donnees
```

Crée des comptes et des dossiers dans les états qu'un agent rencontre
réellement :

| Compte | Rôle | État |
|---|---|---|
| `699000001` | superadmin | — |
| `699000002` | agent | Commune de Douala V, reçoit les alertes |
| `699000003` | agent | Commune de Yaoundé II |
| `699452108` | chauffeur | vérifié, QR scannable |
| `677334455` | chauffeur | dossier complet, pièces non examinées |
| `695112233` | chauffeur | dossier vide |
| `698776655` | chauffeur | suspendu, QR révoqué |

Mot de passe commun : `12345678`.
Le script affiche le jeton QR à scanner. Pour effacer :
`npm run jeu-de-donnees -- --vider`.

> Les pièces justificatives de ce jeu **ne sont pas écrites sur disque** :
> leurs chemins pointent vers rien. Le jeu sert à explorer les états, pas
> à tester le stockage — pour ça, utiliser la démonstration.

## 4. À la main

### Les pages, comme les voient les gens

| Adresse | Qui |
|---|---|
| `/s/JETON` | le passager qui scanne le QR |
| `/t/JETON` | le passager, puis ses proches via SMS |
| `/chauffeur/inscription` | un chauffeur qui s'inscrit |
| `/chauffeur` | son dossier, ses pièces, son QR |

C'est le produit. Le reste de cette page teste ce qu'il y a derrière.

### Documentation interactive

<http://localhost:3000/api/docs> — toutes les routes, essayables depuis
le navigateur. Pour les routes protégées, se connecter d'abord puis
coller le jeton dans **Authorize**.

### Le scan, sans authentification

```bash
curl localhost:3000/api/scan/LE_JETON_QR
```

C'est le cœur du produit : ce que voit un passager qui monte dans un
taxi. Aucun compte, aucune friction.

### Une session de passager

Le passager n'a pas de compte. Il envoie un jeton de session opaque :

```bash
SESSION="ma-session-de-test-$(openssl rand -hex 8)"

curl -X POST localhost:3000/api/trajets \
  -H "x-session-passager: $SESSION" \
  -H 'Content-Type: application/json' \
  -d '{"jetonQr":"LE_JETON_QR"}'
```

Cette session **n'authentifie rien**. Elle relie un trajet à ses contacts
et empêche d'agir sur le trajet d'un autre.

### Un compte agent

```bash
JETON=$(curl -s -X POST localhost:3000/api/auth/connexion \
  -H 'Content-Type: application/json' \
  -d '{"telephone":"699000002","motDePasse":"12345678"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['jeton'])")

curl localhost:3000/api/chauffeurs/file-validation -H "Authorization: Bearer $JETON"
```

### Voir les SMS

En développement ils partent dans les journaux, et sont conservés en base :

```sql
SELECT categorie, telephone, contenu, etat FROM sms_sortant ORDER BY cree_le DESC;
```

C'est aussi comme ça qu'on récupère un code OTP en développement.

### Vérifier la traçabilité

```sql
SELECT j.action, c.role, j.details, j.cree_le
FROM journal_audit j LEFT JOIN compte c ON c.id = j.compte_id
ORDER BY j.cree_le DESC LIMIT 20;
```

Chaque consultation d'une pièce d'identité y figure — c'est une exigence
de la loi n° 2024/017, pas un confort.

---

## Ce qui mérite d'être vérifié en priorité

Les invariants qui portent la crédibilité du produit :

1. **Aucun QR avant validation.** Un chauffeur inscrit n'a pas de code.
2. **Aucune validation sans pièces examinées.** La référence de licence
   est ce que voit le passager ; elle ne peut exister sans qu'un agent
   ait vu les documents.
3. **Un suspendu ne peut plus paraître vérifié.** La suspension révoque
   le QR dans la même transaction ; le scan renvoie 404.
4. **Le double appui sur l'alerte ne crée pas de doublon.** Quelqu'un qui
   panique appuie plusieurs fois.
5. **Une session ne pilote pas le trajet d'une autre.**
6. **Un agent ne voit que sa ville.** La file de validation filtre sur
   l'autorité portée par le jeton, jamais sur un paramètre d'URL. Le
   superadmin, rattaché à aucune autorité, voit tout — c'est le seul cas
   où l'absence de cloisonnement est voulue.

   ```bash
   # Un agent de Yaoundé ne doit voir aucun dossier de Douala,
   # et le paramètre villeId doit rester sans effet.
   curl -s "localhost:3000/api/chauffeurs/file-validation?villeId=peu-importe" \
     -H "Authorization: Bearer $JETON"
   ```

La démonstration vérifie les cinq premiers.

---

## En cas de problème

**« L'API ne répond pas »** — vérifier que `npm run dev` tourne et que le
port 3000 est libre : `ss -lptn 'sport = :3000'`.

**« JWT_SECRET absent ou laissé à sa valeur d'exemple »** — c'est voulu.
Générer une vraie valeur (voir plus haut).

**« client password must be a string »** — `PGHOST` est renseigné mais
`PGPASSWORD` est vide. En local, laisser `PGHOST` vide.

**Les tests deviennent très lents** — vérifier que `maxWorkers` est
toujours dans la configuration Jest de `package.json`. Sans lui, bcrypt
sature la machine et la suite passe de 10 s à près de 10 minutes.
