import {
  Controller, Post, Get, Body, Param, Query, HttpCode, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiBearerAuth,
} from '@nestjs/swagger';
import { SignalementsService } from './signalements.service';
import { SessionPassager, ENTETE_SESSION } from '../trajets/session.decorateur';
import { JwtGarde, RolesGarde, Roles, CompteConnecte } from '../auth/auth.garde';
import { CompteAuthentifie } from '../auth/jwt.strategie';
import {
  CreationSignalementDto, TraitementSignalementDto, RechercheSignalementsDto,
  DeclarationObjetPerduDto, ReponseChauffeurDto,
} from './signalements.dto';

/** Cote passager. Aucun compte requis. */
@ApiTags('signalements')
@ApiHeader({ name: ENTETE_SESSION, required: true })
@Controller('signalements')
export class SignalementsController {
  constructor(private readonly signalements: SignalementsService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Signaler une anomalie' })
  @ApiResponse({ status: 400, description: 'Description manquante pour ce motif' })
  async creer(
    @SessionPassager() session: string,
    @Body() dto: CreationSignalementDto,
  ) {
    return this.signalements.creer(session, dto);
  }
}

/** Objets oublies — cote passager. */
@ApiTags('objets-perdus')
@ApiHeader({ name: ENTETE_SESSION, required: true })
@Controller('objets-perdus')
export class ObjetsPerdusController {
  constructor(private readonly signalements: SignalementsService) {}

  @Post('trajet/:jetonSuivi')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Declarer un objet oublie dans le vehicule' })
  @ApiResponse({ status: 403, description: 'Le trajet appartient a une autre session' })
  async declarer(
    @SessionPassager() session: string,
    @Param('jetonSuivi') jetonSuivi: string,
    @Body() dto: DeclarationObjetPerduDto,
  ) {
    return this.signalements.declarerObjetPerdu(session, jetonSuivi, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Mes declarations d\'objets perdus' })
  async mesObjets(@SessionPassager() session: string) {
    return this.signalements.mesObjetsPerdus(session);
  }
}

/** Objets oublies — cote chauffeur. */
@ApiTags('objets-perdus')
@ApiBearerAuth()
@Controller('objets-perdus/chauffeur')
@UseGuards(JwtGarde, RolesGarde)
@Roles('chauffeur', 'superadmin')
export class ObjetsChauffeurController {
  constructor(private readonly signalements: SignalementsService) {}

  @Get()
  @ApiOperation({ summary: 'Objets signales sur mes trajets' })
  async lister(@CompteConnecte() compte: CompteAuthentifie) {
    return this.signalements.objetsDeMesTrajets(compte);
  }

  @Post(':id/reponse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Repondre a une declaration d\'objet perdu' })
  @ApiResponse({ status: 403, description: 'Declaration d\'un autre chauffeur' })
  async repondre(
    @Param('id') id: string,
    @CompteConnecte() compte: CompteAuthentifie,
    @Body() dto: ReponseChauffeurDto,
  ) {
    return this.signalements.repondreObjetPerdu(id, compte, dto);
  }
}

/** Cote autorite : file et traitement. */
@ApiTags('signalements')
@ApiBearerAuth()
@Controller('signalements/traitement')
@UseGuards(JwtGarde, RolesGarde)
@Roles('agent', 'superadmin')
export class TraitementSignalementsController {
  constructor(private readonly signalements: SignalementsService) {}

  @Get()
  @ApiOperation({ summary: 'File des signalements de mon autorite' })
  async lister(
    @CompteConnecte() compte: CompteAuthentifie,
    @Query() recherche: RechercheSignalementsDto,
  ) {
    return this.signalements.lister(compte, recherche.etat ?? 'ouvert');
  }

  @Post(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Traiter un signalement, avec suspension eventuelle' })
  @ApiResponse({ status: 400, description: 'Note de traitement manquante' })
  async traiter(
    @Param('id') id: string,
    @CompteConnecte() compte: CompteAuthentifie,
    @Body() dto: TraitementSignalementDto,
  ) {
    return this.signalements.traiter(id, compte, dto);
  }
}
