import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseService } from '../base/base.service';
import { formaterTelephone } from '../commun/format';

export type CategorieSms = 'otp' | 'partage' | 'alerte' | 'annulation' | 'notification';

export interface DemandeSms {
  telephone: string;
  contenu: string;
  categorie: CategorieSms;
  alerteId?: string;
  partageId?: string;
}

/**
 * Priorités d'envoi. Quand la file est chargée — et elle le sera un
 * vendredi soir à Douala — une alerte doit passer avant un OTP, et un
 * OTP avant une notification de confort.
 */
const PRIORITES: Record<CategorieSms, number> = {
  alerte: 1,
  annulation: 2,
  otp: 4,
  partage: 5,
  notification: 8,
};

/**
 * Envoi de SMS.
 *
 * Tout message est d'abord écrit dans `sms_sortant`, puis remis au
 * fournisseur. L'ordre compte : si la passerelle tombe, on garde une
 * trace de ce qui aurait dû partir et on peut réémettre. Un SMS d'alerte
 * perdu sans trace serait la pire défaillance possible de ce système.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly fournisseur: string;

  constructor(
    private readonly base: BaseService,
    private readonly config: ConfigService,
  ) {
    this.fournisseur = this.config.get<string>('SMS_FOURNISSEUR', 'console');
  }

  /**
   * Met un message en file et tente l'envoi immédiatement.
   * Ne lève jamais : l'échec d'un SMS ne doit pas faire échouer
   * l'opération métier qui l'a déclenché (une alerte reste enregistrée
   * même si le SMS ne part pas).
   */
  async envoyer(demande: DemandeSms): Promise<string | null> {
    let id: string;
    try {
      const ligne = await this.base.premier<{ id: string }>(
        `INSERT INTO sms_sortant (telephone, contenu, categorie, priorite, alerte_id, partage_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          demande.telephone,
          demande.contenu,
          demande.categorie,
          PRIORITES[demande.categorie] ?? 5,
          demande.alerteId ?? null,
          demande.partageId ?? null,
        ],
      );
      id = ligne!.id;
    } catch (erreur) {
      this.logger.error(
        `Impossible d'enregistrer le SMS (${demande.categorie}) : ${(erreur as Error).message}`,
      );
      return null;
    }

    await this.remettre(id, demande);
    return id;
  }

  /** Remise au fournisseur, avec mise à jour de l'état en base. */
  private async remettre(id: string, demande: DemandeSms): Promise<void> {
    try {
      const reference = await this.transmettre(demande);
      await this.base.requete(
        `UPDATE sms_sortant
            SET etat = 'envoye', envoye_le = now(), tentatives = tentatives + 1,
                fournisseur = $2, reference_ext = $3
          WHERE id = $1`,
        [id, this.fournisseur, reference],
      );
    } catch (erreur) {
      const message = (erreur as Error).message;
      this.logger.error(`Échec d'envoi du SMS ${id} : ${message}`);
      await this.base.requete(
        `UPDATE sms_sortant
            SET etat = 'echec', tentatives = tentatives + 1,
                fournisseur = $2, erreur = $3
          WHERE id = $1`,
        [id, this.fournisseur, message],
      );
    }
  }

  /**
   * Remise effective. En développement (`SMS_FOURNISSEUR=console`), le
   * message est écrit dans les journaux — on voit le code OTP sans
   * dépenser un franc ni dépendre du réseau.
   */
  private async transmettre(demande: DemandeSms): Promise<string | null> {
    switch (this.fournisseur) {
      case 'console':
        this.logger.log(
          `[SMS ${demande.categorie}] ${formaterTelephone(demande.telephone)} : ${demande.contenu}`,
        );
        return null;

      case 'nexah':
        return this.transmettreNexah(demande);

      default:
        throw new Error(`Fournisseur SMS inconnu : ${this.fournisseur}`);
    }
  }

  /**
   * Nexah — agrégateur camerounais. L'identifiant d'expéditeur doit être
   * déclaré auprès de l'ART avant toute mise en production.
   */
  private async transmettreNexah(demande: DemandeSms): Promise<string> {
    const cle = this.config.get<string>('SMS_NEXAH_CLE');
    const utilisateur = this.config.get<string>('SMS_NEXAH_UTILISATEUR');
    const expediteur = this.config.get<string>('SMS_EXPEDITEUR', 'SECURITAXI');

    if (!cle || !utilisateur) {
      throw new Error('SMS_NEXAH_CLE et SMS_NEXAH_UTILISATEUR sont requis.');
    }

    const reponse = await fetch('https://smsvas.com/bulk/public/index.php/api/v1/sendsms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: utilisateur,
        password: cle,
        senderid: expediteur,
        sms: demande.contenu,
        mobiles: demande.telephone.replace('+', ''),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!reponse.ok) {
      throw new Error(`Nexah a répondu ${reponse.status}`);
    }

    const corps = (await reponse.json()) as { responsecode?: number; sms?: Array<{ messageid?: string }> };
    if (corps.responsecode !== 1) {
      throw new Error(`Nexah a refusé le message : ${JSON.stringify(corps)}`);
    }

    return corps.sms?.[0]?.messageid ?? '';
  }
}
