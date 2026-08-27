import {
  Injectable, NotFoundException, ForbiddenException,
  ConflictException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseService } from '../base/base.service';
import { SmsService } from '../sms/sms.service';
import { formaterPlaque } from '../commun/format';
import {
  DeclenchementAlerteDto, AnnulationAlerteDto, ClotureAlerteDto,
} from './alertes.dto';
import { CompteAuthentifie } from '../auth/jwt.strategie';

@Injectable()
export class AlertesService {
  private readonly logger = new Logger(AlertesService.name);

  constructor(
    private readonly base: BaseService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Declenchement de l'alerte.
   *
   * C'est le geste le plus important du produit, et il se fait dans les
   * pires conditions : le passager a peur, il est peut-etre observe, le
   * reseau est mauvais. Trois principes en decoulent :
   *
   *  1. L'alerte est enregistree d'abord, notifiee ensuite. Si les SMS
   *     echouent, l'alerte existe quand meme et reste consultable.
   *  2. Un second appui sur le bouton ne cree pas de doublon : il renvoie
   *     l'alerte deja active. Quelqu'un qui panique appuie plusieurs fois.
   *  3. Elle ne peut jamais echouer pour un motif accessoire.
   */
  async declencher(session: string, jetonSuivi: string, dto: DeclenchementAlerteDto) {
    const trajet = await this.trajetDeLaSession(session, jetonSuivi);

    if (trajet.etat === 'termine' || trajet.etat === 'abandonne') {
      throw new ConflictException(
        'Ce trajet est terminé. Pour signaler un incident après coup, ' +
        'utilisez un signalement.',
      );
    }

    // Deuxieme appui : on renvoie l'alerte en cours plutot qu'une erreur.
    const dejaActive = await this.base.premier<any>(
      `SELECT id, declenchee_le FROM alerte
        WHERE trajet_id = $1 AND etat = 'active'`,
      [trajet.id],
    );
    if (dejaActive) {
      return {
        id: dejaActive.id,
        etat: 'active',
        declencheeLe: dejaActive.declenchee_le,
        deja: true,
        message: 'Une alerte est déjà en cours. Les secours ont été prévenus.',
      };
    }

    const contexte = await this.base.premier<any>(
      `SELECT c.nom, c.prenom, c.reference_licence,
              v.plaque, v.marque, v.modele, v.couleur,
              vl.nom AS ville, c.autorite_id
         FROM trajet t
         JOIN chauffeur c ON c.id = t.chauffeur_id
         JOIN vehicule  v ON v.id = t.vehicule_id
         JOIN ville    vl ON vl.id = c.ville_id
        WHERE t.id = $1`,
      [trajet.id],
    );

    // Derniere position connue si le client n'en fournit pas : mieux vaut
    // une position d'il y a deux minutes que pas de position du tout.
    let latitude = dto.latitude ?? null;
    let longitude = dto.longitude ?? null;
    if (latitude === null || longitude === null) {
      const derniere = await this.base.premier<any>(
        `SELECT latitude, longitude FROM position_trajet
          WHERE trajet_id = $1 ORDER BY mesure_le DESC LIMIT 1`,
        [trajet.id],
      );
      if (derniere) {
        latitude = Number(derniere.latitude);
        longitude = Number(derniere.longitude);
      }
    }

    const { alerteId, destinataires } = await this.base.transaction(async (client) => {
      const alerte = await client.query(
        `INSERT INTO alerte (trajet_id, latitude, longitude)
         VALUES ($1, $2, $3) RETURNING id, declenchee_le`,
        [trajet.id, latitude, longitude],
      );
      const alerteId = alerte.rows[0].id;

      await client.query(
        `UPDATE trajet SET etat = 'alerte' WHERE id = $1`, [trajet.id],
      );

      // Les proches deja prevenus du trajet sont les premiers avertis :
      // ils savent ou est le passager et peuvent agir tout de suite.
      const proches = await client.query(
        `SELECT DISTINCT nom_destinataire, telephone FROM partage_trajet
          WHERE trajet_id = $1`,
        [trajet.id],
      );

      const destinataires: Array<{ id: string; nom: string; telephone: string | null; type: string }> = [];

      for (const proche of proches.rows) {
        const ligne = await client.query(
          `INSERT INTO alerte_destinataire (alerte_id, type, nom, telephone)
           VALUES ($1, 'proche', $2, $3) RETURNING id`,
          [alerteId, proche.nom_destinataire, proche.telephone],
        );
        destinataires.push({
          id: ligne.rows[0].id, nom: proche.nom_destinataire,
          telephone: proche.telephone, type: 'proche',
        });
      }

      // L'autorite n'est prevenue que si elle s'y est engagee formellement.
      // Recevoir des alertes en temps reel est bien plus lourd que valider
      // des dossiers : ne jamais le presumer.
      if (contexte.autorite_id) {
        const autorite = await client.query(
          `SELECT id, nom, telephone FROM autorite
            WHERE id = $1 AND actif AND recoit_alertes AND telephone IS NOT NULL`,
          [contexte.autorite_id],
        );
        if (autorite.rowCount) {
          const ligne = await client.query(
            `INSERT INTO alerte_destinataire (alerte_id, type, nom, telephone, autorite_id)
             VALUES ($1, 'autorite', $2, $3, $4) RETURNING id`,
            [alerteId, autorite.rows[0].nom, autorite.rows[0].telephone, autorite.rows[0].id],
          );
          destinataires.push({
            id: ligne.rows[0].id, nom: autorite.rows[0].nom,
            telephone: autorite.rows[0].telephone, type: 'autorite',
          });
        }
      }

      return { alerteId, destinataires, declencheeLe: alerte.rows[0].declenchee_le };
    });

    const message = this.messageAlerte(contexte, jetonSuivi, latitude, longitude);

    // Hors transaction : l'alerte est deja enregistree, et un SMS qui
    // echoue ne doit surtout pas l'annuler.
    for (const destinataire of destinataires) {
      if (!destinataire.telephone) continue;
      await this.sms.envoyer({
        telephone: destinataire.telephone,
        categorie: 'alerte',
        contenu: message,
        alerteId,
      });
      await this.base.requete(
        `UPDATE alerte_destinataire SET etat_sms = 'envoye', envoye_le = now()
          WHERE id = $1`,
        [destinataire.id],
      );
    }

    this.logger.warn(
      `ALERTE ${alerteId} sur le trajet ${jetonSuivi} — ` +
      `${destinataires.length} destinataire(s) prévenu(s)`,
    );

    return {
      id: alerteId,
      etat: 'active',
      deja: false,
      destinatairesPrevenus: destinataires.length,
      position: latitude !== null ? { latitude, longitude } : null,
      message: destinataires.length
        ? 'Alerte déclenchée. Vos proches ont été prévenus par SMS.'
        : 'Alerte déclenchée et enregistrée. Aucun proche n\'était associé à ce trajet.',
    };
  }

  /**
   * Annulation par le passager lui-meme.
   *
   * Aucun motif n'est exige : une fausse alerte doit etre triviale a
   * annuler, sinon les gens hesitent a appuyer sur le bouton. Le taux de
   * fausses alertes est un indicateur produit — trop eleve, le bouton est
   * mal place ; nul, il n'est pas trouve.
   */
  async annuler(session: string, jetonSuivi: string, dto: AnnulationAlerteDto) {
    const trajet = await this.trajetDeLaSession(session, jetonSuivi);

    const alerte = await this.base.premier<any>(
      `SELECT id FROM alerte WHERE trajet_id = $1 AND etat = 'active'`,
      [trajet.id],
    );
    if (!alerte) {
      throw new NotFoundException('Aucune alerte active sur ce trajet.');
    }

    const destinataires = await this.base.transaction(async (client) => {
      await client.query(
        `UPDATE alerte
            SET etat = 'annulee', annulee_le = now(), motif_annulation = $2
          WHERE id = $1`,
        [alerte.id, dto.motif?.trim() || 'Annulée par le passager'],
      );
      // Le trajet reprend son cours : l'alerte etait une fausse manoeuvre.
      await client.query(
        `UPDATE trajet SET etat = 'en_cours' WHERE id = $1 AND etat = 'alerte'`,
        [trajet.id],
      );
      const lignes = await client.query(
        `SELECT telephone FROM alerte_destinataire
          WHERE alerte_id = $1 AND telephone IS NOT NULL AND etat_sms = 'envoye'`,
        [alerte.id],
      );
      return lignes.rows;
    });

    // Tous ceux qui ont ete alertes doivent etre rassures — sans quoi
    // ils continueront a chercher le passager.
    for (const destinataire of destinataires) {
      await this.sms.envoyer({
        telephone: destinataire.telephone,
        categorie: 'annulation',
        contenu:
          'SecuriTaxi : fausse alerte. Le passager a annule l\'alerte, ' +
          'tout va bien. Aucune action necessaire.',
        alerteId: alerte.id,
      });
    }

    this.logger.log(`Alerte ${alerte.id} annulée par le passager`);

    return {
      id: alerte.id,
      etat: 'annulee',
      destinatairesInformes: destinataires.length,
      message: 'Alerte annulée. Vos proches ont été informés.',
    };
  }

  /** Alertes actives, pour le poste de suivi d'une autorite. */
  async lister(compte: CompteAuthentifie, etat: string = 'active') {
    // Un agent ne voit que les alertes de son autorite ; le superadmin
    // voit tout.
    const filtreAutorite = compte.role === 'superadmin'
      ? ''
      : 'AND c.autorite_id = $2';

    const parametres: unknown[] = [etat];
    if (compte.role !== 'superadmin') parametres.push(compte.autoriteId);

    return this.base.requete(
      `SELECT a.id, a.etat, a.declenchee_le, a.latitude, a.longitude,
              a.annulee_le, a.motif_annulation, a.close_le, a.note_traitement,
              t.jeton_suivi, t.demarre_le, t.statut_chauffeur_au_scan,
              c.nom, c.prenom, c.reference_licence,
              v.plaque, v.marque, v.modele, v.couleur,
              vl.nom AS ville,
              now() - a.declenchee_le AS anciennete,
              (SELECT count(*) FROM alerte_destinataire d WHERE d.alerte_id = a.id) AS destinataires
         FROM alerte a
         JOIN trajet t ON t.id = a.trajet_id
         JOIN chauffeur c ON c.id = t.chauffeur_id
         JOIN vehicule  v ON v.id = t.vehicule_id
         JOIN ville    vl ON vl.id = c.ville_id
        WHERE a.etat = $1 ${filtreAutorite}
        ORDER BY a.declenchee_le DESC`,
      parametres,
    );
  }

  /**
   * Cloture par un agent, apres traitement.
   *
   * La note est obligatoire : une alerte close sans trace de ce qui a ete
   * fait ne vaut rien, ni pour le passager ni pour l'autorite.
   */
  async clore(alerteId: string, compte: CompteAuthentifie, dto: ClotureAlerteDto) {
    const alerte = await this.base.premier<any>(
      `SELECT a.id, a.etat, c.autorite_id
         FROM alerte a
         JOIN trajet t ON t.id = a.trajet_id
         JOIN chauffeur c ON c.id = t.chauffeur_id
        WHERE a.id = $1`,
      [alerteId],
    );

    if (!alerte) throw new NotFoundException('Alerte introuvable.');

    if (compte.role !== 'superadmin' && alerte.autorite_id !== compte.autoriteId) {
      throw new ForbiddenException(
        'Cette alerte relève d\'une autre autorité.',
      );
    }
    if (alerte.etat !== 'active') {
      throw new ConflictException(`Cette alerte est déjà ${alerte.etat}.`);
    }

    await this.base.transaction(async (client) => {
      await client.query(
        `UPDATE alerte
            SET etat = 'close', close_le = now(), close_par = $2, note_traitement = $3
          WHERE id = $1`,
        [alerteId, compte.id, dto.note.trim()],
      );
      await client.query(
        `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
         VALUES ($1, 'alerte.close', 'alerte', $2, $3)`,
        [compte.id, alerteId, JSON.stringify({ note: dto.note.trim() })],
      );
    });

    this.logger.log(`Alerte ${alerteId} close par ${compte.id}`);

    return { id: alerteId, etat: 'close' };
  }

  private messageAlerte(
    contexte: any, jetonSuivi: string,
    latitude: number | null, longitude: number | null,
  ): string {
    const base = this.config.get<string>('URL_PUBLIQUE', 'http://localhost:3000');
    const vehicule = [contexte.marque, contexte.modele, contexte.couleur]
      .filter(Boolean).join(' ');

    const position = latitude !== null && longitude !== null
      ? ` Position : https://maps.google.com/?q=${latitude},${longitude}`
      : ' Position non disponible.';

    return (
      `URGENCE SecuriTaxi : la personne que vous suivez a declenche une alerte. ` +
      `Chauffeur ${contexte.prenom} ${contexte.nom}, ` +
      `${formaterPlaque(contexte.plaque)}${vehicule ? ' (' + vehicule + ')' : ''}, ` +
      `${contexte.ville}.${position} Suivi : ${base}/t/${jetonSuivi}`
    );
  }

  private async trajetDeLaSession(session: string, jetonSuivi: string) {
    const trajet = await this.base.premier<any>(
      `SELECT id, etat, session_passager FROM trajet WHERE jeton_suivi = $1`,
      [jetonSuivi.trim()],
    );

    if (!trajet) throw new NotFoundException('Trajet introuvable.');
    if (trajet.session_passager !== session) {
      throw new ForbiddenException('Ce trajet n\'appartient pas à cette session.');
    }
    return trajet;
  }
}
