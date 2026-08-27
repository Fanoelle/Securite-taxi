import {
  Controller, Get, Param, Res, Header, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';

import { ScanService } from '../scan/scan.service';
import { TrajetsService } from '../trajets/trajets.service';
import { ReferentielService } from './referentiel.service';
import {
  pageScan, pageScanRefuse, pageTrajet, pageSuiviRefuse,
} from './page';
import {
  pageInscription, pageConnexion, pageDossier,
} from './page-chauffeur';

/**
 * Les deux adresses que le monde extérieur connaît.
 *
 * `/s/:jeton` est ce qu'encode le QR collé dans le véhicule ; `/t/:jeton`
 * est ce que reçoit un proche par SMS. Elles échappent au préfixe `/api`
 * (voir main.ts) parce qu'elles sont lues par des humains et imprimées
 * sur du papier : leur longueur et leur lisibilité comptent.
 *
 * Elles renvoient du HTML, jamais du JSON — celui qui les ouvre est dans
 * un taxi, pas devant un terminal.
 */
@ApiTags('public')
@Controller()
export class PublicController {
  constructor(
    private readonly scan: ScanService,
    private readonly trajets: TrajetsService,
    private readonly referentiel: ReferentielService,
  ) {}

  /**
   * Le geste central du produit : quelqu'un pointe son téléphone sur le
   * QR d'un taxi. Aucun compte, aucune installation, aucune friction.
   */
  @Get('s/:jeton')
  @Throttle({ default: { limit: 120, ttl: 3_600_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Page de scan (cible du QR imprime)' })
  async scanner(@Param('jeton') jeton: string, @Res() res: Response) {
    try {
      const resultat = await this.scan.resoudre(jeton);
      res.type('html').send(pageScan(resultat, jeton));
    } catch (e: any) {
      // Un QR inconnu n'est pas une erreur technique à afficher : c'est
      // un avertissement à lire avant de monter dans la voiture.
      const message = e?.response?.message
        ?? 'Ce code n\'est pas reconnu.';
      res.status(HttpStatus.NOT_FOUND).type('html').send(pageScanRefuse(message));
    }
  }

  /**
   * Le suivi. La même adresse sert au passager et au proche : c'est le
   * jeton de session, envoyé par le navigateur, qui décide si les
   * commandes (alerte, partage, fin) s'affichent ou non.
   */
  @Get('t/:jetonSuivi')
  @Throttle({ default: { limit: 240, ttl: 3_600_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Page de suivi (cible du lien SMS)' })
  async suivre(
    @Param('jetonSuivi') jetonSuivi: string,
    @Res() res: Response,
  ) {
    let vue: any;
    try {
      vue = await this.trajets.suivrePublic(jetonSuivi);
    } catch {
      res.status(HttpStatus.NOT_FOUND).type('html').send(pageSuiviRefuse());
      return;
    }
    if (!vue) {
      res.status(HttpStatus.NOT_FOUND).type('html').send(pageSuiviRefuse());
      return;
    }

    // Un navigateur qui suit un lien reçu par SMS n'envoie aucun en-tête
    // personnalisé : la session ne peut donc pas être lue ici. La page
    // est servie sans commandes, et son script demande à /api/trajets/
    // courant si cette session possède bien ce trajet — auquel cas les
    // commandes apparaissent. Le proche, lui, n'obtient jamais rien.
    res.type('html').send(pageTrajet(vue, jetonSuivi, false));
  }

  /* ---------------------------------------------------------------- */
  /* Espace chauffeur                                                  */
  /*                                                                   */
  /* Contrairement au passager, le chauffeur a un compte : il dépose    */
  /* des pièces d'identité et reçoit un QR qui l'engage. Ces pages ne   */
  /* sont pas gardées côté serveur — elles ne contiennent rien de       */
  /* confidentiel. C'est leur script qui présente le jeton, et l'API    */
  /* qui refuse tout accès sans lui.                                   */
  /* ---------------------------------------------------------------- */

  @Get('chauffeur/inscription')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Formulaire d\'inscription chauffeur' })
  async inscription(@Res() res: Response) {
    res.type('html').send(pageInscription(await this.referentiel.villes()));
  }

  @Get('chauffeur/connexion')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Connexion chauffeur' })
  async connexion(@Res() res: Response) {
    res.type('html').send(pageConnexion());
  }

  /** Dossier, pièces à fournir, et code QR une fois validé. */
  @Get('chauffeur')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Dossier du chauffeur et son code QR' })
  async dossier(@Res() res: Response) {
    res.type('html').send(pageDossier());
  }

  /** Racine : sans QR à scanner, il n'y a rien à montrer. */
  @Get()
  @ApiExcludeEndpoint()
  @Header('Cache-Control', 'no-store')
  async accueil(@Res() res: Response) {
    res.type('html').send(
      `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sécurité Taxi Cameroun</title>
<body style="font-family:system-ui;background:#E7E3DA;color:#14261F;
             margin:0;padding:60px 24px;text-align:center">
<h1 style="font-size:20px">Sécurité Taxi Cameroun</h1>
<p style="color:#6B6459;max-width:34ch;margin:12px auto;line-height:1.6">
Scannez le code QR affiché dans le véhicule pour vérifier votre chauffeur.</p>
</body>`,
    );
  }
}
