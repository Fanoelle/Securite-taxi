import { Module } from '@nestjs/common';
import {
  SignalementsController, ObjetsPerdusController,
  ObjetsChauffeurController, TraitementSignalementsController,
} from './signalements.controller';
import { SignalementsService } from './signalements.service';

@Module({
  controllers: [
    // Les routes les plus specifiques d'abord : « signalements/traitement »
    // doit etre resolu avant tout parametre de « signalements ».
    TraitementSignalementsController,
    SignalementsController,
    ObjetsChauffeurController,
    ObjetsPerdusController,
  ],
  providers: [SignalementsService],
  exports: [SignalementsService],
})
export class SignalementsModule {}
