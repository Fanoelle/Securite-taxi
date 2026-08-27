import {
  Controller, Post, Get, Body, Param, Query, HttpCode, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiBearerAuth,
} from '@nestjs/swagger';
import { AlertesService } from './alertes.service';
import { SessionPassager, ENTETE_SESSION } from '../trajets/session.decorateur';
import { JwtGarde, RolesGarde, Roles, CompteConnecte } from '../auth/auth.garde';
import { CompteAuthentifie } from '../auth/jwt.strategie';
import {
  DeclenchementAlerteDto, AnnulationAlerteDto, ClotureAlerteDto,
  RechercheAlertesDto,
} from './alertes.dto';

/** Cote passager : declencher et annuler. Aucun compte requis. */
@ApiTags('alertes')
@ApiHeader({ name: ENTETE_SESSION, required: true })
@Controller('trajets/:jetonSuivi/alerte')
export class AlertesController {
  constructor(private readonly alertes: AlertesService) {}

  /**
   * Aucune limite de debit stricte ici, volontairement : le seul cas ou
   * quelqu'un appuie en boucle est celui ou il panique. Le service renvoie
   * l'alerte existante plutot que d'en creer une autre.
   */
  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Declencher l\'alerte d\'urgence' })
  @ApiResponse({ status: 201, description: 'Alerte enregistree, proches prevenus' })
  @ApiResponse({ status: 403, description: 'Le trajet appartient a une autre session' })
  async declencher(
    @SessionPassager() session: string,
    @Param('jetonSuivi') jetonSuivi: string,
    @Body() dto: DeclenchementAlerteDto,
  ) {
    return this.alertes.declencher(session, jetonSuivi, dto);
  }

  @Post('annulation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annuler une alerte (fausse manoeuvre)' })
  @ApiResponse({ status: 404, description: 'Aucune alerte active' })
  async annuler(
    @SessionPassager() session: string,
    @Param('jetonSuivi') jetonSuivi: string,
    @Body() dto: AnnulationAlerteDto,
  ) {
    return this.alertes.annuler(session, jetonSuivi, dto);
  }
}

/** Cote autorite : consulter et clore. */
@ApiTags('alertes')
@ApiBearerAuth()
@Controller('alertes')
@UseGuards(JwtGarde, RolesGarde)
@Roles('agent', 'superadmin')
export class SuiviAlertesController {
  constructor(private readonly alertes: AlertesService) {}

  @Get()
  @ApiOperation({ summary: 'Alertes de mon autorite' })
  @ApiResponse({ status: 403, description: 'Reserve aux agents' })
  async lister(
    @CompteConnecte() compte: CompteAuthentifie,
    @Query() recherche: RechercheAlertesDto,
  ) {
    return this.alertes.lister(compte, recherche.etat ?? 'active');
  }

  @Post(':id/cloture')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clore une alerte apres traitement' })
  @ApiResponse({ status: 403, description: 'Alerte d\'une autre autorite' })
  async clore(
    @Param('id') id: string,
    @CompteConnecte() compte: CompteAuthentifie,
    @Body() dto: ClotureAlerteDto,
  ) {
    return this.alertes.clore(id, compte, dto);
  }
}
