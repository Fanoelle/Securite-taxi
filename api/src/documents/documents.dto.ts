import {
  IsString, IsOptional, IsDateString, MaxLength, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const TYPES_DOCUMENT = [
  'cni_recto', 'cni_verso', 'permis',
  'carte_grise', 'licence_transport', 'assurance',
] as const;

export type TypeDocument = (typeof TYPES_DOCUMENT)[number];

/** Ce qu'un dossier doit contenir pour etre examinable. */
export const DOCUMENTS_REQUIS: TypeDocument[] = [
  'cni_recto', 'cni_verso', 'permis', 'carte_grise',
];

export class TeleversementDocumentDto {
  @ApiProperty({ enum: TYPES_DOCUMENT })
  @Matches(/^(cni_recto|cni_verso|permis|carte_grise|licence_transport|assurance)$/, {
    message: 'Type de document inconnu.',
  })
  type!: TypeDocument;

  @ApiPropertyOptional({
    example: '2028-06-30',
    description: 'Date d\'expiration — attendue pour le permis et l\'assurance',
  })
  @IsOptional() @IsDateString()
  dateExpiration?: string;
}

export class ExamenDocumentDto {
  @ApiProperty({ enum: ['lisible', 'illisible', 'expire', 'non_conforme'] })
  @Matches(/^(lisible|illisible|expire|non_conforme)$/)
  verdict!: 'lisible' | 'illisible' | 'expire' | 'non_conforme';

  @ApiPropertyOptional({
    description: 'Obligatoire si le verdict n\'est pas « lisible » : ' +
                 'le chauffeur doit savoir quoi corriger',
  })
  @IsOptional() @IsString() @MaxLength(500)
  commentaire?: string;

  @ApiPropertyOptional({ example: '2028-06-30' })
  @IsOptional() @IsDateString()
  dateExpiration?: string;
}
