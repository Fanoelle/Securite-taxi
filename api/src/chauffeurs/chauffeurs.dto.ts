import {
  IsString, IsNotEmpty, IsOptional, IsUUID, IsDateString,
  MaxLength, MinLength, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InscriptionChauffeurDto {
  @ApiProperty({ example: 'NGONO' })
  @IsString() @IsNotEmpty() @MaxLength(80)
  nom!: string;

  @ApiProperty({ example: 'Paul Bertrand' })
  @IsString() @IsNotEmpty() @MaxLength(80)
  prenom!: string;

  @ApiProperty({ example: '+237699452108', description: 'Accepte 699452108, 6 99 45 21 08, +237...' })
  @IsString() @IsNotEmpty()
  telephone!: string;

  @ApiPropertyOptional({ example: '1986-07-12' })
  @IsOptional() @IsDateString()
  dateNaissance?: string;

  @ApiPropertyOptional({ example: 'Ebolowa' })
  @IsOptional() @IsString() @MaxLength(80)
  lieuNaissance?: string;

  @ApiProperty({ description: 'Identifiant de la ville de rattachement' })
  @IsUUID()
  villeId!: string;

  @ApiProperty({ example: 'LT 452 AB' })
  @IsString() @IsNotEmpty()
  plaque!: string;

  @ApiPropertyOptional({ example: 'Toyota' })
  @IsOptional() @IsString() @MaxLength(50)
  marque?: string;

  @ApiPropertyOptional({ example: 'Corolla' })
  @IsOptional() @IsString() @MaxLength(50)
  modele?: string;

  @ApiPropertyOptional({ example: 'Jaune' })
  @IsOptional() @IsString() @MaxLength(30)
  couleur?: string;

  @ApiPropertyOptional({ example: 'MotDePasse123' })
  @IsOptional() @IsString() @MinLength(8) @MaxLength(72)
  motDePasse?: string;
}

export class ValidationDossierDto {
  @ApiProperty({ enum: ['verifie', 'certifie', 'rejete'] })
  @Matches(/^(verifie|certifie|rejete)$/)
  decision!: 'verifie' | 'certifie' | 'rejete';

  @ApiPropertyOptional({ description: 'Obligatoire en cas de rejet' })
  @IsOptional() @IsString() @MaxLength(500)
  motif?: string;

  @ApiPropertyOptional({ description: 'La plaque a-t-elle ete recoupee avec la carte grise ?' })
  @IsOptional()
  plaqueRecoupee?: boolean;
}
