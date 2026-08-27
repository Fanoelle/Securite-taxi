import {
  IsString, IsOptional, IsNotEmpty, MaxLength, Matches, IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const MOTIFS = [
  'photo_differente', 'plaque_differente', 'qr_suspect',
  'comportement', 'objet_perdu', 'autre',
] as const;

export type MotifSignalement = (typeof MOTIFS)[number];

/**
 * Un signalement vise un trajet, un chauffeur ou un code QR — au moins
 * l'un des trois. Le cas du QR seul compte : quelqu'un peut scanner un
 * code suspect sur un pare-brise sans jamais monter dans le vehicule.
 */
export class CreationSignalementDto {
  @ApiProperty({ enum: MOTIFS })
  @Matches(/^(photo_differente|plaque_differente|qr_suspect|comportement|objet_perdu|autre)$/, {
    message: 'Motif inconnu.',
  })
  motif!: MotifSignalement;

  @ApiPropertyOptional({
    example: 'La photo du QR ne correspond pas au conducteur.',
    description: 'Obligatoire pour les motifs « comportement » et « autre »',
  })
  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Jeton de suivi du trajet concerne' })
  @IsOptional() @IsString() @MaxLength(16)
  jetonSuivi?: string;

  @ApiPropertyOptional({ description: 'Jeton du QR scanne, si le trajet n\'a pas ete demarre' })
  @IsOptional() @IsString() @MaxLength(16)
  jetonQr?: string;
}

export class TraitementSignalementDto {
  @ApiProperty({ enum: ['en_examen', 'fonde', 'non_fonde', 'clos'] })
  @Matches(/^(en_examen|fonde|non_fonde|clos)$/)
  etat!: 'en_examen' | 'fonde' | 'non_fonde' | 'clos';

  @ApiPropertyOptional({
    description: 'Obligatoire des lors qu\'une conclusion est rendue',
  })
  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    description: 'Suspendre le chauffeur — reserve aux signalements fondes',
  })
  @IsOptional()
  suspendreChauffeur?: boolean;
}

export class RechercheSignalementsDto {
  @ApiPropertyOptional({ enum: ['ouvert', 'en_examen', 'fonde', 'non_fonde', 'clos'] })
  @IsOptional() @Matches(/^(ouvert|en_examen|fonde|non_fonde|clos)$/)
  etat?: string;
}

export class DeclarationObjetPerduDto {
  @ApiProperty({ example: 'Sac a dos noir avec un ordinateur portable' })
  @IsString() @IsNotEmpty() @MaxLength(1000)
  description!: string;

  @ApiPropertyOptional({
    example: '699452108',
    description: 'Pour etre rappele par le chauffeur — facultatif',
  })
  @IsOptional() @IsString() @MaxLength(20)
  telephoneContact?: string;
}

export class ReponseChauffeurDto {
  @ApiProperty({ enum: ['vu_chauffeur', 'retrouve', 'non_retrouve'] })
  @Matches(/^(vu_chauffeur|retrouve|non_retrouve)$/)
  etat!: 'vu_chauffeur' | 'retrouve' | 'non_retrouve';

  @ApiPropertyOptional({ example: 'Objet retrouve, je le depose au commissariat de Bonanjo.' })
  @IsOptional() @IsString() @MaxLength(1000)
  reponse?: string;
}
