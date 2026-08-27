# Tester à l'écran

Deux choses différentes vivent ici.

## 1. La vraie application — `http://localhost:3000/s/CODE`

**C'est ce que voient les utilisateurs.** Pas de journal technique, pas de
code à taper : la page que quelqu'un ouvre en montant dans un taxi.

```bash
cd api && npm run dev            # l'API sert aussi les pages
cd api && npm run jeu-de-donnees # affiche un code QR à essayer
```

Puis ouvrir **`http://localhost:3000/s/LE_CODE`**.

### Les trois adresses publiques

| Adresse | Qui l'ouvre | Comment il y arrive |
|---|---|---|
| `/s/:jeton` | le passager | il scanne le QR collé dans le taxi |
| `/t/:jeton` | le passager, puis ses proches | redirection, puis lien SMS |
| `/` | quelqu'un qui tape l'adresse | rappelle qu'il faut scanner |

Ce sont les URL encodées dans le QR imprimé et dans le SMS de partage —
pas des adresses inventées pour la démonstration.

### Le parcours

1. **`/s/CODE`** — bandeau vert *VÉRIFIÉ*, nom, plaque, autorité qui a
   validé. Un code inconnu donne un bandeau rouge et un avertissement.
2. **« Démarrer le trajet »** — redirige vers `/t/...`, demande la
   position au navigateur, et l'envoie ensuite toutes les minutes.
3. **« ALERTE D'URGENCE »** — bannière rouge, proches et autorité
   prévenus par SMS. Annulable sans justification.
4. **« Envoyer le lien de suivi »** — le proche reçoit un SMS.

### Depuis un vrai téléphone

Le QR encode `URL_PUBLIQUE`, réglée dans `api/.env`. Pour scanner avec
votre téléphone sur le même réseau, remplacez `localhost` par l'adresse
de votre machine :

```
URL_PUBLIQUE=http://192.168.1.X:3000
```

Puis régénérez les données (`npm run jeu-de-donnees`) — les QR déjà émis
encodent l'ancienne adresse.

> La géolocalisation exige HTTPS, sauf sur `localhost`. Depuis un
> téléphone en HTTP, le trajet fonctionne mais sans position.

### Passager ou proche ?

La même adresse `/t/:jeton` sert aux deux, et le serveur ne peut pas les
distinguer — un lien ouvert depuis un SMS n'envoie pas d'en-tête de
session. La page demande donc à l'API si cette session possède ce
trajet : le passager obtient les commandes, le proche ne voit que le
suivi.

Pour le vérifier vous-même : ouvrez `/t/...` dans une **fenêtre privée**.
Vous verrez ce que voit un proche. Le serveur refuse d'ailleurs toute
action d'une session étrangère avec un **403**.

## 2. Le banc d'essai — `test-visuel/index.html`

Une page de développement qui montre **chaque appel HTTP** à côté de
l'écran. Utile pour comprendre ce qui circule ; ce n'est pas le produit.

```bash
cd test-visuel && python3 -m http.server 8080
```

Puis <http://localhost:8080>.

## Captures

`captures/` contient le parcours joué automatiquement sur un écran de
téléphone : scan, trajet, alerte, vue du proche, code refusé.

## Ce qui n'a pas encore d'écran

Le côté **agent** (file de validation, examen des pièces, suspension) et
le côté **chauffeur** (inscription, téléversement, affichage de son QR).
Ils restent testables par `npm run demonstration` et par Swagger sur
<http://localhost:3000/api/docs>.
