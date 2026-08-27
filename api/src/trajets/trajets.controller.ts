import {
  Controller, Post, Get, Body, Param, HttpCode,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { TrajetsService } from './trajets.service';
import { SessionPassager, ENTETE_SESSION } from './session.decorateur';
import {
  DemarrageTrajetDto, EnvoiPositionsDto, PartageTrajetDto, FinTrajetDto,
} from './trajets.dto';

/**
 * Toutes ces routes sont publiques : le passager n'a pas de compte.
 * L'en-tete de session ne l'authentifie pas — il relie un trajet a ses
 * contacts et empeche d'agir sur le trajet d'un autre.
 */
@ApiTags('trajets')
@ApiHeader({
  name: ENTETE_SESSION,
  description: 'Jeton de session anonyme genere par le client (16 a 128 caracteres)',
  required: true,
})
@Controller('trajets')
export class TrajetsController {
  constructor(private readonly trajets: TrajetsService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Demarrer un trajet apres un scan' })
  @ApiResponse({ status: 404, description: 'Code QR inconnu' })
  @ApiResponse({ status: 409, description: 'Un trajet est deja en cours' })
  async demarrer(
    @SessionPassager() session: string,
    @Body() dto: DemarrageTrajetDto,
  ) {
    return this.trajets.demarrer(session, dto);
  }

  @Get('courant')
  @ApiOperation({ summary: 'Trajet en cours de cette session, le cas echeant' })
  async courant(@SessionPassager() session: string) {
    return this.trajets.trajetCourant(session);
  }

  @Get('contacts')
  @ApiOperation({ summary: 'Contacts de confiance memorises par cette session' })
  async contacts(@SessionPassager() session: string) {
    return this.trajets.contacts(session);
  }

  /**
   * Limite haute : un tampon hors ligne peut se vider d'un coup, mais
   * une frequence anormale signale autre chose qu'un trajet.
   */
  @Post(':jetonSuivi/positions')
  @HttpCode(202)
  @Throttle({ default: { limit: 120, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Envoyer un lot de positions' })
  @ApiResponse({ status: 403, description: 'Le trajet appartient a une autre session' })
  async positions(
    @SessionPassager() session: string,
    @Param('jetonSuivi') jetonSuivi: string,
    @Body() dto: EnvoiPositionsDto,
  ) {
    return this.trajets.enregistrerPositions(session, jetonSuivi, dto);
  }

  @Post(':jetonSuivi/partage')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Partager le trajet avec des proches par SMS' })
  async partager(
    @SessionPassager() session: string,
    @Param('jetonSuivi') jetonSuivi: string,
    @Body() dto: PartageTrajetDto,
  ) {
    return this.trajets.partager(session, jetonSuivi, dto);
  }

  /**
   * Numéro du chauffeur, une fois la course terminée — pour un objet
   * oublié. Volontairement hors du scan : un numéro donné avant la
   * course serait récupérable sans jamais monter dans le véhicule.
   */
  @Get(':jetonSuivi/contact-chauffeur')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Numero du chauffeur (trajet termine)' })
  @ApiResponse({ status: 403, description: 'Le trajet appartient a une autre session' })
  @ApiResponse({ status: 409, description: 'Trajet non termine' })
  async contactChauffeur(
    @SessionPassager() session: string,
    @Param('jetonSuivi') jetonSuivi: string,
  ) {
    return this.trajets.contactChauffeur(session, jetonSuivi);
  }

  @Post(':jetonSuivi/fin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Terminer le trajet' })
  @ApiResponse({ status: 409, description: 'Alerte active ou trajet deja termine' })
  async terminer(
    @SessionPassager() session: string,
    @Param('jetonSuivi') jetonSuivi: string,
    @Body() dto: FinTrajetDto,
  ) {
    return this.trajets.terminer(session, jetonSuivi, dto);
  }
}

/**
 * Suivi public, pour le proche qui a recu le lien par SMS.
 * Aucune session requise : le proche n'a pas de compte, et c'est le
 * jeton long et aleatoire qui protege l'acces.
 */
@ApiTags('trajets')
@Controller('suivi')
export class SuiviController {
  constructor(private readonly trajets: TrajetsService) {}

  @Get(':jetonSuivi')
  @Throttle({ default: { limit: 120, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Suivre un trajet partage' })
  @ApiResponse({ status: 404, description: 'Lien de suivi invalide' })
  async suivre(@Param('jetonSuivi') jetonSuivi: string) {
    return this.trajets.suivrePublic(jetonSuivi);
  }
}
