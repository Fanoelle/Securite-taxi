# Modèle de données — décisions de conception

Ce document explique **pourquoi** le schéma est fait ainsi. Le SQL dit *quoi*,
ce fichier dit *pourquoi*. À lire avant toute modification du schéma.

## Les décisions structurantes

### 1. Le passager n'a pas de compte

Il est identifié par une `session_passager` : un jeton anonyme stocké dans
son navigateur. Aucune inscription, aucun mot de passe, aucune donnée
personnelle collectée.

C'est un choix produit délibéré. L'écran de scan est ouvert par quelqu'un
qui monte dans un taxi, souvent pressé, parfois la nuit. Toute friction à ce
moment fait abandonner. Conséquence technique : les contacts de confiance sont
rattachés à la session, pas à un utilisateur — s'il change de téléphone, il
les ressaisit. C'est le prix à payer, et il est juste.

### 2. Le QR encode un jeton, jamais l'identifiant interne

`code_qr.jeton` est une chaîne courte et opaque (`0447DLA`). L'identifiant
`uuid` du chauffeur n'apparaît jamais dans une URL publique.

Cela permet surtout de **révoquer** un QR : si un chauffeur se fait copier son
code, ou si son compte est suspendu, on désactive le jeton et on en émet un
nouveau. L'index unique partiel garantit un seul QR actif par chauffeur.

### 3. Le statut du chauffeur est figé dans le trajet

`trajet.statut_chauffeur_au_scan` copie le statut au moment du scan.

Sans cette colonne, un chauffeur suspendu après un incident ferait apparaître
tous ses trajets passés comme « suspendus » — on perdrait l'information de ce
que le passager avait réellement vu au moment de monter. En cas de litige,
c'est précisément la question qui se pose.

### 4. La référence de licence n'existe qu'après validation

`chauffeur.reference_licence` est `NULL` tant que le dossier n'est pas validé,
et une contrainte `CHECK` interdit le statut `verifie` sans référence.

Cette référence est ce que le passager voit sur l'écran de scan. Elle ne doit
jamais pouvoir exister sans qu'un agent l'ait attribuée : c'est ce qui la rend
crédible. Le champ « licence de transport » que le chauffeur téléverse à
l'inscription est un **document justificatif** différent, facultatif.

### 5. Les positions ont deux horodatages

`position_trajet.mesure_le` (horloge de l'appareil) et `recu_le` (serveur).

Sur les axes inter-urbains, le réseau disparaît. Le téléphone accumule les
positions hors ligne et les envoie en bloc au retour du signal. Sans les deux
horodatages, on ne pourrait pas reconstituer un trajet correctement.

### 6. Les plaques sont normalisées en base

Stockées `LT452AB`, affichées `LT 452 AB`. Une contrainte `CHECK` impose le
format. Un index unique partiel garantit qu'une plaque n'est active que sur un
seul véhicule à la fois — sinon deux chauffeurs pourraient déclarer la même.

### 7. Les fausses alertes sont conservées

Une alerte annulée passe à `etat = 'annulee'` mais n'est jamais supprimée. Le
taux de fausses alertes est un indicateur produit : trop élevé, le bouton est
mal placé ; nul, il n'est pas trouvé.

## Ce que le passager peut voir

La vue `v_scan_public` est la frontière entre le dossier du chauffeur et le
public. Elle expose : nom, prénom, photo, statut, référence de licence,
plaque, marque, modèle, couleur, ville, autorité validante.

Elle **n'expose jamais** : pièces d'identité, date et lieu de naissance,
adresse, numéro de téléphone personnel, documents justificatifs.

> **Règle** : l'API ne doit jamais requêter `chauffeur` directement pour
> répondre à un scan. Elle passe par la vue. Ajouter une colonne sensible à
> cette vue est une faute de sécurité, pas une amélioration.

## Conservation des données

Contexte : loi camerounaise **n° 2024/017** sur la protection des données
personnelles. Photos, pièces d'identité et positions GPS en temps réel entrent
tous dans son champ.

| Donnée | Durée | Règle |
|---|---|---|
| Positions GPS | 30 jours | Purgées, **sauf** trajet lié à une alerte ou un signalement non clos |
| Codes OTP | 24 heures | Purgés systématiquement |
| Documents justificatifs | À définir | Dépend de l'engagement pris avec l'autorité validante |
| Journal d'audit | À définir | Obligation de traçabilité — probablement plusieurs années |

Les deux premières règles sont implémentées dans `010_retention.sql`. Les deux
suivantes attendent une décision — à trancher avec ton partenaire institutionnel
et lors de la déclaration ANTIC.

## Points ouverts

1. **PostGIS n'est pas installé.** Les coordonnées sont en `numeric(9,6)`, ce
   qui suffit largement à l'affichage et au stockage. PostGIS deviendrait utile
   pour des requêtes du type « tous les trajets actifs dans un rayon de 2 km »
   — pas nécessaire aujourd'hui.

2. **Les documents sont stockés hors base** (`document.chemin`). Il faudra
   décider où : disque chiffré local pour commencer, stockage objet ensuite.
   Ne jamais les servir par une URL publique devinable.

3. **`autorite.recoit_alertes` est `false` par défaut.** Recevoir et traiter
   des alertes en temps réel est un engagement bien plus lourd que valider des
   dossiers. Ne passer ce drapeau à `true` qu'après accord formel écrit.
