import {
  createParamDecorator, ExecutionContext, BadRequestException,
} from '@nestjs/common';

export const ENTETE_SESSION = 'x-session-passager';

/**
 * Session anonyme du passager.
 *
 * Le passager n'a pas de compte — c'est un choix produit : l'ecran de
 * scan est ouvert par quelqu'un qui monte dans un taxi, souvent presse,
 * parfois la nuit. Toute friction a ce moment fait abandonner.
 *
 * Le client genere donc un jeton opaque, le garde dans son navigateur et
 * l'envoie en en-tete. Il ne prouve rien : il relie seulement un trajet a
 * ses contacts de confiance. C'est pourquoi il ne remplace jamais une
 * authentification et ne donne acces qu'a ce que cette session a cree.
 */
export const SessionPassager = createParamDecorator(
  (_donnee: unknown, contexte: ExecutionContext): string => {
    const valeur = contexte.switchToHttp().getRequest().headers[ENTETE_SESSION];
    const session = typeof valeur === 'string' ? valeur.trim() : '';

    // Longueur minimale : un jeton court serait devinable, et deviner une
    // session donnerait acces aux trajets de quelqu'un d'autre.
    if (session.length < 16 || session.length > 128) {
      throw new BadRequestException(
        `En-tête ${ENTETE_SESSION} manquant ou invalide. ` +
        'Le client doit générer un jeton de session de 16 à 128 caractères.',
      );
    }
    if (!/^[A-Za-z0-9_-]+$/.test(session)) {
      throw new BadRequestException(
        `En-tête ${ENTETE_SESSION} invalide : caractères non autorisés.`,
      );
    }

    return session;
  },
);
