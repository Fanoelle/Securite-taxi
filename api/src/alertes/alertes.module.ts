import { Module } from '@nestjs/common';
import { AlertesController, SuiviAlertesController } from './alertes.controller';
import { AlertesService } from './alertes.service';

@Module({
  controllers: [AlertesController, SuiviAlertesController],
  providers: [AlertesService],
  exports: [AlertesService],
})
export class AlertesModule {}
