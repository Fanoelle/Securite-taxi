import { IsString, IsNotEmpty, Matches, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DemandeOtpDto {
  @ApiProperty({ example: '699452108', description: 'Accepte 699452108, 6 99 45 21 08, +237...' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  telephone!: string;
}

export class VerificationOtpDto {
  @ApiProperty({ example: '699452108' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  telephone!: string;

  @ApiProperty({ example: '482915', description: 'Code a 6 chiffres recu par SMS' })
  @Matches(/^\d{6}$/, { message: 'Le code doit comporter six chiffres.' })
  code!: string;
}

export class ConnexionMotDePasseDto {
  @ApiProperty({ example: '699452108' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  telephone!: string;

  @ApiProperty({ example: 'MotDePasse123' })
  @IsString() @IsNotEmpty() @MaxLength(72)
  motDePasse!: string;
}

export class CreationAgentDto {
  @ApiProperty({ example: '699452108' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  telephone!: string;

  @ApiProperty({ description: 'Autorite de rattachement de l\'agent' })
  @IsString() @IsNotEmpty()
  autoriteId!: string;

  @ApiPropertyOptional({ example: 'MotDePasseAgent123' })
  @IsOptional() @IsString() @MaxLength(72)
  motDePasse?: string;
}
