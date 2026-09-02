import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function demarrer() {
  const app = await NestFactory.create(AppModule);
  const production = process.env.NODE_ENV === 'production';

  // En-têtes de sécurité HTTP. Les pages sont produites par le serveur
  // et n'appellent aucun script externe : la politique de contenu peut
  // donc être stricte. `unsafe-inline` reste nécessaire pour les
  // scripts et styles écrits dans les gabarits — les sortir dans des
  // fichiers séparés contredirait la raison pour laquelle ils sont dans
  // le code : une page qui s'affiche même si le reste est cassé.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // blob: — les pièces d'identité affichées depuis la mémoire du
        // navigateur, jamais depuis une adresse partageable.
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // Le suivi de trajet est ouvert par un lien reçu par SMS : une
    // politique trop stricte casserait la navigation depuis l'appli SMS.
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));

  // Les adresses lues par des humains — imprimées sur un QR, envoyées
  // par SMS — échappent au préfixe : leur longueur et leur lisibilité
  // font partie du produit.
  app.setGlobalPrefix('api', {
    exclude: [
      's/:jeton', 't/:jetonSuivi', '',
      'chauffeur', 'chauffeur/inscription', 'chauffeur/connexion',
      'agent', 'agent/connexion',
      'media/photos/:sousRepertoire/:nom',
    ],
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,            // ignore les champs non déclarés
    forbidNonWhitelisted: true, // et les refuse explicitement
    transform: true,
  }));

  // En production, seul le domaine public est autorisé. `origin: true`
  // accepte n'importe quelle origine : commode en développement, mais
  // en production cela laisse un site tiers appeler l'API avec les
  // droits d'un agent connecté.
  const origines = (process.env.ORIGINES_AUTORISEES ?? '')
    .split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: production ? (origines.length ? origines : false) : true,
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('Sécurité Taxi Cameroun')
    .setDescription(
      'API de la plateforme de sécurité des transports en commun. ' +
      'Les points d\'entrée /api/scan sont publics et sans authentification : ' +
      'le passager n\'a pas de compte.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  // La documentation interactive décrit toute la surface de l'API, y
  // compris les points d'entrée réservés aux agents. Elle n'a rien à
  // faire sur une plateforme ouverte au public : SWAGGER_PUBLIC=true
  // permet de la rouvrir sciemment, jamais par défaut.
  if (!production || process.env.SWAGGER_PUBLIC === 'true') {
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = new Logger('Démarrage');
  logger.log(`API démarrée sur le port ${port}${production ? ' (production)' : ''}`);
  if (!production || process.env.SWAGGER_PUBLIC === 'true') {
    logger.log(`Documentation : http://localhost:${port}/api/docs`);
  }
  if (production && !origines.length) {
    logger.warn(
      'ORIGINES_AUTORISEES est vide : toute requête inter-origine sera '
      + 'refusée. Renseigner le domaine public.',
    );
  }
}

demarrer();
