import {
  Controller, Post, Get, Body, Param, HttpCode, UseGuards, ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { PaiementsService } from './paiements.service';
import {
  EncaissementGuichetDto, OuvertureMobileMoneyDto, TarifAutoriteDto,
} from './paiements.dto';
import { JwtGarde, RolesGarde, Roles, CompteConnecte } from '../auth/auth.garde';
import { CompteAuthentifie } from '../auth/jwt.strategie';

@ApiTags('paiements')
@Controller('paiements')
export class PaiementsController {
  constructor(private readonly paiements: PaiementsService) {}

  /**
   * Ce qu'un chauffeur doit, et l'etat de son QR.
   *
   * Le chauffeur ne consulte que sa propre situation ; un agent consulte
   * celle d'un dossier qu'il instruit.
   */
  @Get('situation/:chauffeurId')
  @UseGuards(JwtGarde, RolesGarde)
  @Roles('chauffeur', 'agent', 'superadmin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Frais dus et validite du QR' })
  async situation(
    @Param('chauffeurId') chauffeurId: string,
    @CompteConnecte() compte: CompteAuthentifie,
  ) {
    // Un chauffeur n'interroge que son propre dossier. Sans ce controle,
    // l'identifiant dans l'URL suffirait a lire la situation d'un autre.
    if (compte.role === 'chauffeur' && compte.id !== chauffeurId) {
      throw new ForbiddenException(
        'Vous ne pouvez consulter que votre propre situation.',
      );
    }
    return this.paiements.situation(chauffeurId);
  }

  /**
   * Encaissement au guichet, par un agent.
   *
   * Le seul mode qui ne depende d'aucun tiers : ni contrat marchand, ni
   * prestataire, ni reseau. Le paiement est confirme et le QR emis dans
   * la meme transaction.
   */
  @Post('guichet/:chauffeurId')
  @HttpCode(201)
  @UseGuards(JwtGarde, RolesGarde)
  @Roles('agent', 'superadmin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Encaisser les frais en especes et emettre le QR' })
  @ApiResponse({ status: 409, description:
    'Dossier non valide, tarif non fixe, QR encore valide, ou recu deja encaisse.' })
  async encaisserGuichet(
    @Param('chauffeurId') chauffeurId: string,
    @Body() dto: EncaissementGuichetDto,
    @CompteConnecte() compte: CompteAuthentifie,
  ) {
    return this.paiements.encaisserAuGuichet(
      chauffeurId, dto, compte.id, compte.autoriteId,
    );
  }

  /**
   * Ouverture d'un paiement Mobile Money par le chauffeur.
   *
   * Cree une ligne « en_attente » et rien de plus : aucun QR n'est emis
   * ici. Seule une confirmation venue du prestataire ouvre le droit.
   */
  @Post('mobile-money')
  @HttpCode(201)
  @UseGuards(JwtGarde, RolesGarde)
  @Roles('chauffeur')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Ouvrir un paiement Mobile Money' })
  async ouvrirMobileMoney(
    @Body() dto: OuvertureMobileMoneyDto,
    @CompteConnecte() compte: CompteAuthentifie,
  ) {
    return this.paiements.ouvrirMobileMoney(compte.id, dto, compte.id);
  }

  /**
   * Confirmation d'un paiement, et emission du QR.
   *
   * Reservee aux agents et au superadmin tant qu'aucun prestataire n'est
   * raccorde : le rapprochement se fait a la main, sur relevé. Quand un
   * prestataire sera choisi, son webhook appellera le meme service —
   * avec sa propre verification de signature, jamais ce point d'entree.
   */
  @Post(':paiementId/confirmer')
  @HttpCode(200)
  @UseGuards(JwtGarde, RolesGarde)
  @Roles('agent', 'superadmin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirmer un paiement et emettre le QR' })
  async confirmer(
    @Param('paiementId') paiementId: string,
    @Body() corps: { referenceExterne?: string },
    @CompteConnecte('id') compteId: string,
  ) {
    return this.paiements.confirmer(
      paiementId, corps?.referenceExterne ?? null, compteId,
    );
  }

  /**
   * Declaration d'echec, motivee.
   *
   * Le motif est ce qu'un chauffeur viendra reclamer s'il conteste :
   * sans lui, une ligne « echoue » ne permet de repondre a personne.
   */
  @Post(':paiementId/echec')
  @HttpCode(200)
  @UseGuards(JwtGarde, RolesGarde)
  @Roles('agent', 'superadmin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Declarer un paiement echoue' })
  async marquerEchoue(
    @Param('paiementId') paiementId: string,
    @Body() corps: { motif: string },
    @CompteConnecte('id') compteId: string,
  ) {
    return this.paiements.marquerEchoue(paiementId, corps?.motif, compteId);
  }

  /**
   * Tarif d'une autorite.
   *
   * Le montant vit en base et non dans le code : une commune le fait
   * evoluer sans redeploiement. Reserve au superadmin — un agent qui
   * fixerait lui-meme le tarif qu'il encaisse serait juge et partie.
   */
  @Post('tarif/:autoriteId')
  @HttpCode(200)
  @UseGuards(JwtGarde, RolesGarde)
  @Roles('superadmin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fixer les frais d\'emission d\'une autorite' })
  async reglerTarif(
    @Param('autoriteId') autoriteId: string,
    @Body() dto: TarifAutoriteDto,
    @CompteConnecte('id') compteId: string,
  ) {
    return this.paiements.reglerTarif(autoriteId, dto, compteId);
  }
}
