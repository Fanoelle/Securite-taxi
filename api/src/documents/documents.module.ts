import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { StockageService } from './stockage.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, StockageService],
  exports: [DocumentsService, StockageService],
})
export class DocumentsModule {}
