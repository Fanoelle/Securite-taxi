import {
  IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsNumber,
  IsDateString, IsInt, Min, Max, MaxLength, ArrayMaxSize, ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DemarrageTrajetDto {
  @ApiProperty({ example: 'X98QD6R', description: 'Jeton du QR scanne' })
  @IsString() @IsNotEmpty() @MaxLength(16)
  jetonQr!: string;

  @ApiPropertyOptional({ example: 4.051056 })
  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 9.767869 })
  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;
}

export class PositionDto {
  @ApiProperty({ example: 4.051056 })
  @IsNumber() @Min(-90) @Max(90)
  latitude!: number;

  @ApiProperty({ example: 9.767869 })
  @IsNumber() @Min(-180) @Max(180)
  longitude!: number;

  @ApiPropertyOptional({ example: 12, description: 'Precision en metres' })
  @IsOptional() @IsInt() @Min(0) @Max(10_000)
  precisionM?: number;

  @ApiProperty({
    example: '2026-08-21T13:40:00.000Z',
    description: 'Horodatage de l\'appareil, conserve tel quel pour les envois differes',
  })
  @IsDateString()
  mesureLe!: string;
}

/**
 * Les positions arrivent par paquets : hors reseau, le telephone accumule
 * et vide son tampon au retour du signal.
 */
export class EnvoiPositionsDto {
  @ApiProperty({ type: [PositionDto], maxItems: 500 })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PositionDto)
  positions!: PositionDto[];
}

export class ContactDto {
  @ApiProperty({ example: 'Maman' })
  @IsString() @IsNotEmpty() @MaxLength(80)
  nom!: string;

  @ApiProperty({ example: '699452108' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  telephone!: string;
}

export class PartageTrajetDto {
  @ApiProperty({ type: [ContactDto], maxItems: 5 })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts!: ContactDto[];

  @ApiPropertyOptional({ description: 'Memoriser ces contacts pour les prochains trajets' })
  @IsOptional()
  memoriser?: boolean;
}

export class FinTrajetDto {
  @ApiPropertyOptional({ example: 4.061056 })
  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 9.777869 })
  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;
}
