import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { ReferentielService } from './referentiel.service';
import { ScanModule } from '../scan/scan.module';
import { TrajetsModule } from '../trajets/trajets.module';
import { BaseModule } from '../base/base.module';

/**
 * Les pages HTML servies aux adresses que le monde extérieur connaît :
 * celle imprimée sur le QR et celle envoyée par SMS. Ce module ne
 * contient aucune logique — il habille ce que Scan et Trajets savent
 * déjà faire.
 */
@Module({
  imports: [BaseModule, ScanModule, TrajetsModule],
  controllers: [PublicController],
  providers: [ReferentielService],
})
export class PublicModule {}
