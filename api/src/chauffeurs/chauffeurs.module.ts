import { Module } from '@nestjs/common';
import { ChauffeursController, PhotosController } from './chauffeurs.controller';
import { ChauffeursService } from './chauffeurs.service';
import { PhotoService } from './photo.service';

@Module({
  controllers: [ChauffeursController, PhotosController],
  providers: [ChauffeursService, PhotoService],
  exports: [ChauffeursService, PhotoService],
})
export class ChauffeursModule {}
