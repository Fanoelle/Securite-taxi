import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function demarrer() {
  const app = await NestFactory.create(AppModule);

  // Les adresses lues par des humains — imprimées sur un QR, envoyées
  // par SMS — échappent au préfixe : leur longueur et leur lisibilité
  // font partie du produit.
  app.setGlobalPrefix('api', {
    exclude: [
      's/:jeton', 't/:jetonSuivi', '',
      'chauffeur', 'chauffeur/inscription', 'chauffeur/connexion',
      'media/photos/:sousRepertoire/:nom',
    ],
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,            // ignore les champs non déclarés
    forbidNonWhitelisted: true, // et les refuse explicitement
    transform: true,
  }));

  app.enableCors({ origin: true, credentials: true });

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
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = new Logger('Démarrage');
  logger.log(`API démarrée sur http://localhost:${port}`);
  logger.log(`Documentation : http://localhost:${port}/api/docs`);
}

demarrer();
