import {
  Controller, Post, Get, Body, Param, HttpCode, Header,
  UseGuards, UseInterceptors, UploadedFile, Res,
  ForbiddenException, BadRequestException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';

import { ChauffeursService } from './chauffeurs.service';
import { PhotoService } from './photo.service';
import { InscriptionChauffeurDto, ValidationDossierDto } from './chauffeurs.dto';
import { JwtGarde, RolesGarde, Roles, CompteConnecte } from '../auth/auth.garde';
import { CompteAuthentifie } from '../auth/jwt.strategie';

@ApiTags('chauffeurs')
@Controller('chauffeurs')
export class ChauffeursController {
  constructor(
    private readonly chauffeurs: ChauffeursService,
    private readonly photos: PhotoService,
  ) {}

  /**
   * Photo de profil du chauffeur.
   *
   * C'est ce que le passager compare au visage qu'il a devant lui : une
   * fiche sans portrait laisse la vérification à moitié faite.
   */
  @Post('ma-photo')
  @HttpCode(200)
  @UseGuards(JwtGarde, RolesGarde)
  @Roles('chauffeur')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @UseInterceptors(FileInterceptor('fichier', {
    limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['fichier'],
      properties: { fichier: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Deposer ou remplacer sa photo de profil' })
  @ApiResponse({ status: 400, description: 'Format non reconnu (JPEG ou PNG attendu)' })
  async maPhoto(
    @CompteConnecte() compte: CompteAuthentifie,
    @UploadedFile() fichier: Express.Multer.File,
  ) {
    if (!fichier) {
      throw new BadRequestException('Aucun fichier reçu (champ « fichier »).');
    }
    return this.photos.remplacer(compte, fichier);
  }

  /** Ouvert : c'est le point d'entrée d'un chauffeur qui n'a pas encore de compte. */
  @Post('inscription')
  @HttpCode(201)
  @ApiOperation({ summary: 'Inscription d\'un chauffeur (statut declare)' })
  @ApiResponse({ status: 409, description: 'Numero ou plaque deja enregistre' })
  async inscrire(@Body() dto: InscriptionChauffeurDto) {
    return this.chauffeurs.inscrire(dto);
  }

  /**
   * La ville vient de l'autorité du jeton, jamais de l'URL : sinon un
   * agent élargirait son périmètre en changeant un paramètre.
   */
  @Get('file-validation')
  @UseGuards(JwtGarde, RolesGarde)
  @Roles('agent', 'superadmin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dossiers en attente de validation, de ma ville' })
  @ApiResponse({ status: 403, description: 'Reserve aux agents rattaches a une autorite' })
  async file(@CompteConnecte() agent: CompteAuthentifie) {
    return this.chauffeurs.fileValidation(agent);
  }

  /**
   * L'identité de l'agent et son autorité viennent du jeton, jamais du
   * corps de la requête : c'est ce qui rend la trace d'audit fiable.
   */
  @Post(':id/validation')
  @UseGuards(JwtGarde, RolesGarde)
  @Roles('agent', 'superadmin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Valider ou rejeter un dossier' })
  @ApiResponse({ status: 403, description: 'Reserve aux agents' })
  async valider(
    @Param('id') id: string,
    @Body() dto: ValidationDossierDto,
    @CompteConnecte() agent: CompteAuthentifie,
  ) {
    if (!agent.autoriteId) {
      throw new ForbiddenException(
        'Votre compte n\'est rattaché à aucune autorité validante. ' +
        'Une validation doit toujours être imputable à une autorité.',
      );
    }
    return this.chauffeurs.validerDossier(id, agent.id, agent.autoriteId, dto);
  }
}

/**
 * Service des photos de profil.
 *
 * Public et sans authentification, contrairement aux pièces
 * justificatives : c'est un portrait que tout passager doit pouvoir
 * comparer au visage du conducteur, au moment où il monte.
 *
 * Le contrôle d'accès repose sur l'imprévisibilité du nom de fichier —
 * 24 octets aléatoires — et non sur un jeton que le passager n'a pas.
 */
@ApiTags('chauffeurs')
@Controller('media/photos')
export class PhotosController {
  constructor(private readonly photos: PhotoService) {}

  @Get(':sousRepertoire/:nom')
  @Throttle({ default: { limit: 300, ttl: 3_600_000 } })
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiOperation({ summary: 'Photo de profil d\'un chauffeur' })
  @ApiResponse({ status: 404, description: 'Photo inconnue' })
  async servir(
    @Param('sousRepertoire') sousRepertoire: string,
    @Param('nom') nom: string,
    @Res() res: Response,
  ) {
    // Le chemin est reconstruit à partir de deux segments contrôlés :
    // aucune barre oblique ni « .. » ne peut traverser cette validation.
    if (!/^[0-9a-f]{2}$/.test(sousRepertoire)
        || !/^[0-9a-f]{48}\.(jpg|png)$/.test(nom)) {
      throw new BadRequestException('Chemin de photo invalide.');
    }

    const { flux, typeMime } = this.photos.fluxLecture(`${sousRepertoire}/${nom}`);
    res.type(typeMime);
    flux.on('error', () => res.status(404).end());
    flux.pipe(res);
  }
}
