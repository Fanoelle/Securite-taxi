import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsOptional, IsInt, Min, Max,
  MaxLength, Matches,
} from 'class-validator';

/**
 * Encaissement des frais d'emission du code QR.
 *
 * Le montant n'est PAS un champ de ce DTO, et c'est deliberé : il est lu
 * dans la table autorite au moment de l'encaissement. Laisser le client
 * annoncer ce qu'il paie reviendrait a laisser choisir son propre tarif.
 */
export class EncaissementGuichetDto {
  @ApiProperty({
    example: 'RECU-2026-00412',
    description:
      'Reference du recu remis au chauffeur. Unique : le meme recu ne '
      + 'peut pas etre encaisse deux fois.',
  })
  @IsString() @IsNotEmpty() @MaxLength(64)
  @Matches(/^[A-Za-z0-9\-_/]+$/, {
    message: 'La reference ne peut contenir que lettres, chiffres, tiret, '
      + 'soulignement et barre oblique.',
  })
  referenceRecu!: string;

  @ApiPropertyOptional({
    example: '699452108',
    description: 'Telephone du payeur, s\'il differe de celui du chauffeur.',
  })
  @IsOptional() @IsString() @MaxLength(20)
  telephonePayeur?: string;
}

/**
 * Ouverture d'un paiement par Mobile Money.
 *
 * Cree une ligne « en_attente ». La confirmation viendra du prestataire,
 * jamais du client : une application qui se declare payee n'est pas une
 * preuve de paiement.
 */
export class OuvertureMobileMoneyDto {
  @ApiProperty({ example: 'mtn', enum: ['mtn', 'orange'] })
  @Matches(/^(mtn|orange)$/, {
    message: 'L\'operateur doit etre « mtn » ou « orange ».',
  })
  operateur!: 'mtn' | 'orange';

  @ApiProperty({
    example: '699452108',
    description: 'Numero depuis lequel le paiement sera fait.',
  })
  @IsString() @IsNotEmpty() @MaxLength(20)
  telephonePayeur!: string;
}

/**
 * Reglage du tarif par l'autorite.
 *
 * Le montant vit en base et non dans le code : une commune peut le faire
 * evoluer sans redeploiement, et pratiquer un tarif different d'une autre.
 */
export class TarifAutoriteDto {
  @ApiProperty({
    example: 5000,
    description: 'Frais d\'emission du QR, en FCFA. Entier : le franc CFA '
      + 'n\'a pas de subdivision en circulation.',
  })
  @IsInt() @Min(0) @Max(9_999_999)
  fraisQrFcfa!: number;

  @ApiPropertyOptional({
    example: 6,
    description: 'Duree de validite du QR emis, en mois.',
  })
  @IsOptional() @IsInt() @Min(1) @Max(60)
  validiteQrMois?: number;
}
