import {
  Controller, Get, Param, Header, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { QrService } from './qr.service';
import { JwtGarde, CompteConnecte } from '../auth/auth.garde';
import { CompteAuthentifie } from '../auth/jwt.strategie';

@ApiTags('qr')
@Controller('qr')
export class QrController {
  constructor(private readonly qr: QrService) {}

  /**
   * Un chauffeur ne voit que son propre QR ; les agents voient ceux de
   * leur autorité, pour pouvoir réimprimer un code abîmé au guichet.
   */
  @Get(':chauffeurId.svg')
  @UseGuards(JwtGarde)
  @ApiBearerAuth()
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'private, max-age=3600')
  @ApiOperation({ summary: 'Image SVG du code QR du chauffeur' })
  @ApiResponse({ status: 403, description: 'QR d\'un autre chauffeur' })
  async svg(
    @Param('chauffeurId') chauffeurId: string,
    @CompteConnecte() compte: CompteAuthentifie,
  ) {
    if (!(await this.qr.peutConsulter(chauffeurId, compte))) {
      throw new ForbiddenException(
        'Ce code QR n\'est pas le vôtre. Un QR est strictement personnel.',
      );
    }
    return this.qr.imageSvg(chauffeurId);
  }
}
