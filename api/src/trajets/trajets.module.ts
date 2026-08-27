import { Module } from '@nestjs/common';
import { TrajetsController, SuiviController } from './trajets.controller';
import { TrajetsService } from './trajets.service';

@Module({
  controllers: [TrajetsController, SuiviController],
  providers: [TrajetsService],
  exports: [TrajetsService],
})
export class TrajetsModule {}
