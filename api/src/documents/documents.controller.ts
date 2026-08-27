import {
  Controller, Post, Get, Body, Param, UseGuards, UseInterceptors,
  UploadedFile, HttpCode, StreamableFile, Res, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { JwtGarde, RolesGarde, Roles, CompteConnecte } from '../auth/auth.garde';
import { CompteAuthentifie } from '../auth/jwt.strategie';
import {
  TeleversementDocumentDto, ExamenDocumentDto, TYPES_DOCUMENT,
} from './documents.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
@UseGuards(JwtGarde)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * Televersement d'une piece par le chauffeur.
   *
   * Le fichier reste en memoire le temps de la verification de sa
   * signature binaire : ecrire d'abord sur disque puis controler
   * laisserait un fichier arbitraire sur le serveur, meme brievement.
   */
  @Post()
  @HttpCode(201)
  @Roles('chauffeur')
  @UseGuards(RolesGarde)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @UseInterceptors(FileInterceptor('fichier', {
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'fichier'],
      properties: {
        type: { type: 'string', enum: [...TYPES_DOCUMENT] },
        dateExpiration: { type: 'string', example: '2028-06-30' },
        fichier: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Televerser une piece justificative' })
  @ApiResponse({ status: 400, description: 'Format non reconnu ou piece expiree' })
  async televerser(
    @CompteConnecte() compte: CompteAuthentifie,
    @Body() dto: TeleversementDocumentDto,
    @UploadedFile() fichier: Express.Multer.File,
  ) {
    if (!fichier) {
      throw new BadRequestException('Aucun fichier reçu (champ « fichier »).');
    }
    return this.documents.televerser(compte, dto, fichier);
  }

  @Get('mon-dossier')
  @Roles('chauffeur')
  @UseGuards(RolesGarde)
  @ApiOperation({ summary: 'Etat de mon dossier : ce qu\'il reste a fournir' })
  async monDossier(@CompteConnecte() compte: CompteAuthentifie) {
    return this.documents.monDossier(compte);
  }

  @Get('chauffeur/:chauffeurId')
  @Roles('agent', 'superadmin')
  @UseGuards(RolesGarde)
  @ApiOperation({ summary: 'Pieces d\'un dossier a examiner' })
  @ApiResponse({ status: 403, description: 'Dossier d\'une autre autorite' })
  async listerPourAgent(
    @Param('chauffeurId') chauffeurId: string,
    @CompteConnecte() compte: CompteAuthentifie,
  ) {
    return this.documents.listerPourAgent(chauffeurId, compte);
  }

  /**
   * Le fichier lui-meme. Jamais servi statiquement : chaque consultation
   * d'une piece d'identite passe par ici et laisse une trace.
   */
  @Get(':id/fichier')
  @ApiOperation({ summary: 'Recuperer le fichier d\'une piece' })
  @ApiResponse({ status: 403, description: 'Piece non accessible' })
  async fichier(
    @Param('id') id: string,
    @CompteConnecte() compte: CompteAuthentifie,
    @Res({ passthrough: true }) reponse: Response,
  ): Promise<StreamableFile> {
    const { flux, typeMime } = await this.documents.fichier(id, compte);

    reponse.set({
      'Content-Type': typeMime,
      // Jamais en cache partage : ce sont des pieces d'identite.
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    });

    return new StreamableFile(flux);
  }

  @Post(':id/examen')
  @HttpCode(200)
  @Roles('agent', 'superadmin')
  @UseGuards(RolesGarde)
  @ApiOperation({ summary: 'Rendre un verdict sur une piece' })
  @ApiResponse({ status: 400, description: 'Commentaire manquant sur un rejet' })
  async examiner(
    @Param('id') id: string,
    @CompteConnecte() compte: CompteAuthentifie,
    @Body() dto: ExamenDocumentDto,
  ) {
    return this.documents.examiner(id, compte, dto);
  }
}
