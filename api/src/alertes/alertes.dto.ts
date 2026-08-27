import {
  IsOptional, IsNumber, IsString, MaxLength, Min, Max, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DeclenchementAlerteDto {
  @ApiPropertyOptional({ example: 4.051056 })
  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 9.767869 })
  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;
}

export class AnnulationAlerteDto {
  @ApiPropertyOptional({
    example: 'Declenchement accidentel',
    description: 'Facultatif : une fausse alerte ne doit rien couter a annuler',
  })
  @IsOptional() @IsString() @MaxLength(300)
  motif?: string;
}

export class ClotureAlerteDto {
  @ApiProperty({
    example: 'Passager contacte, situation resolue',
    description: 'Ce qui a ete fait — obligatoire, c\'est la trace du traitement',
  })
  @IsString() @MaxLength(1000)
  note!: string;
}

export class RechercheAlertesDto {
  @ApiPropertyOptional({ enum: ['active', 'annulee', 'close'] })
  @IsOptional() @Matches(/^(active|annulee|close)$/)
  etat?: 'active' | 'annulee' | 'close';
}
