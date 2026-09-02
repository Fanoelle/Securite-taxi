import { Module } from '@nestjs/common';
import { PaiementsController } from './paiements.controller';
import { PaiementsService } from './paiements.service';

@Module({
  controllers: [PaiementsController],
  providers: [PaiementsService],
  exports: [PaiementsService],
})
export class PaiementsModule {}
