import { Injectable, NotFoundException } from '@nestjs/common';
import { CompteAuthentifie } from '../auth/jwt.strategie';
import { ConfigService } from '@nestjs/config';
import { BaseService } from '../base/base.service';
import * as QRCode from 'qrcode';

@Injectable()
export class QrService {
  constructor(
    private readonly base: BaseService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Image du QR d'un chauffeur, en SVG.
   *
   * Le SVG est choisi pour l'impression : le chauffeur affiche ce code
   * dans son véhicule, il doit rester net à toute taille. Correction
   * d'erreur au niveau M — un QR collé sur un pare-brise se salit et
   * se raye, la redondance n'est pas un luxe ici.
   */
  async imageSvg(chauffeurId: string): Promise<string> {
    const qr = await this.base.premier<{ jeton: string }>(
      'SELECT jeton FROM code_qr WHERE chauffeur_id = $1 AND actif',
      [chauffeurId],
    );

    if (!qr) {
      throw new NotFoundException(
        'Aucun code QR actif. Le code est émis après validation du dossier.',
      );
    }

    return QRCode.toString(this.urlScan(qr.jeton), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
    });
  }

  /**
   * Qui a le droit de voir ce QR : son propriétaire, un agent de
   * l'autorité qui a validé le dossier, ou le superadmin.
   */
  async peutConsulter(chauffeurId: string, compte: CompteAuthentifie): Promise<boolean> {
    if (compte.role === 'superadmin') return true;

    const chauffeur = await this.base.premier<{
      compte_id: string; autorite_id: string | null;
    }>(
      'SELECT compte_id, autorite_id FROM chauffeur WHERE id = $1 AND supprime_le IS NULL',
      [chauffeurId],
    );
    if (!chauffeur) return false;

    if (compte.role === 'chauffeur') return chauffeur.compte_id === compte.id;

    return compte.role === 'agent'
        && compte.autoriteId !== null
        && chauffeur.autorite_id === compte.autoriteId;
  }

  urlScan(jeton: string): string {
    const base = this.config.get<string>('URL_PUBLIQUE', 'http://localhost:3000');
    return `${base}/s/${jeton}`;
  }
}
