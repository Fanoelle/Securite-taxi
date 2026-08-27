import { Controller, Get, Param, Ip, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ScanService } from './scan.service';

@ApiTags('scan')
@Controller('scan')
export class ScanController {
  private readonly logger = new Logger(ScanController.name);

  constructor(private readonly scan: ScanService) {}

  /**
   * Point d'entrée public du QR. Aucune authentification : c'est
   * délibéré, le passager n'a pas de compte.
   *
   * Limitation de débit : un QR légitime est scanné quelques fois par
   * jour. Un débit élevé signale une énumération de jetons.
   */
  @Get(':jeton')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Résoudre un code QR scanné' })
  @ApiResponse({ status: 200, description: 'Informations publiques du chauffeur' })
  @ApiResponse({ status: 404, description: 'Code inconnu ou révoqué' })
  async resoudre(@Param('jeton') jeton: string, @Ip() ip: string) {
    this.logger.log(`Scan ${jeton} depuis ${ip}`);
    return this.scan.resoudre(jeton);
  }
}
