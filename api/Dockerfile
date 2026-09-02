# =====================================================================
#  Image de l'API — construction en plusieurs etapes.
#
#  La premiere etape compile avec les devDependencies (nest, typescript) ;
#  la deuxieme n'embarque que le strict necessaire a l'execution. Une
#  image qui contient son compilateur transporte des centaines de
#  megaoctets qui ne serviront jamais, et une surface d'attaque avec.
#
#  Une troisieme etape, `amorcage`, sert aux scripts d'installation du
#  premier jour. Elle n'est construite que si on la demande.
# =====================================================================

# --- Etape 1 : compilation ------------------------------------------
FROM node:22-alpine AS compilation

WORKDIR /app

# Les manifestes d'abord, le code ensuite : Docker met en cache la
# couche des dependances tant que package-lock.json ne bouge pas. Sans
# cette separation, la moindre ligne de code change relancerait un
# npm ci complet.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm run build

# --- Etape 2 : execution --------------------------------------------
FROM node:22-alpine AS execution

# tini : sans lui, Node tourne en PID 1 et n'y recoit pas les signaux
# de terminaison comme ailleurs. Un `docker stop` attendrait alors le
# delai de grace complet avant de tuer le processus, en coupant les
# requetes en cours au lieu de les laisser finir.
RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=compilation /app/dist ./dist

# Les pieces d'identite et les photos sont ecrites par l'API dans des
# volumes. Le conteneur ne tourne pas en root : un processus qui n'a
# besoin que d'ecrire dans deux dossiers n'a pas besoin de la machine
# entiere. `node` est un utilisateur non privilegie fourni par l'image.
RUN mkdir -p /app/stockage/documents /app/stockage/photos \
    && chown -R node:node /app/stockage
USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]

# --- Etape 3 : amorcage ----------------------------------------------
#
#  Cible separee, construite seulement quand on la demande
#  (`docker compose --profile amorcage`). Elle sert a creer le compte
#  superadmin et le jeu de donnees de demonstration.
#
#  Pourquoi une image a part : ces scripts sont en TypeScript et
#  passent par ts-node, qui est une dependance de developpement. Les
#  embarquer dans l'image d'execution y ferait entrer tout l'outillage
#  de compilation — pour du code qui tourne une fois, le premier jour.
#
#  Elle repart de l'etape de compilation, qui a deja node_modules
#  complet et les sources : rien n'est reinstalle.
#  ENTRYPOINT plutot que CMD : `docker compose run amorcage --vider`
#  remplacerait un CMD en entier et tenterait d'executer « --vider »
#  comme une commande. En ENTRYPOINT, l'argument est transmis au script,
#  qui le lit dans process.argv — et efface le jeu de donnees.
FROM compilation AS amorcage
ENV NODE_ENV=demonstration
ENTRYPOINT ["npx", "ts-node", "scripts/jeu-de-donnees.ts"]
