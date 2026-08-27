import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, ConflictException, Logger,
} from '@nestjs/common';
import { BaseService } from '../base/base.service';
import { SmsService } from '../sms/sms.service';
import { normaliserTelephone, formaterPlaque } from '../commun/format';
import {
  CreationSignalementDto, TraitementSignalementDto,
  DeclarationObjetPerduDto, ReponseChauffeurDto,
} from './signalements.dto';
import { CompteAuthentifie } from '../auth/jwt.strategie';

/** Motifs dont la seule mention ne dit rien : il faut le recit. */
const MOTIFS_EXIGEANT_DESCRIPTION = ['comportement', 'autre'];

/** Etats qui rendent une conclusion : ils exigent une note de traitement. */
const ETATS_CONCLUSIFS = ['fonde', 'non_fonde', 'clos'];

@Injectable()
export class SignalementsService {
  private readonly logger = new Logger(SignalementsService.name);

  constructor(
    private readonly base: BaseService,
    private readonly sms: SmsService,
  ) {}

  /**
   * Depot d'un signalement par un passager.
   *
   * Trois cibles possibles, et c'est voulu : un trajet en cours, un
   * chauffeur, ou un simple code QR. Ce dernier cas est le plus
   * important — quelqu'un peut reperer un QR suspect colle sur un
   * pare-brise sans jamais monter dans le vehicule, et c'est exactement
   * ce qu'on veut apprendre.
   */
  async creer(session: string, dto: CreationSignalementDto) {
    if (MOTIFS_EXIGEANT_DESCRIPTION.includes(dto.motif) && !dto.description?.trim()) {
      throw new BadRequestException(
        'Une description est nécessaire pour ce motif : sans récit, ' +
        'le signalement n\'est pas exploitable.',
      );
    }

    let trajetId: string | null = null;
    let chauffeurId: string | null = null;
    let codeQrId: string | null = null;

    if (dto.jetonSuivi) {
      const trajet = await this.base.premier<any>(
        `SELECT id, chauffeur_id, code_qr_id, session_passager
           FROM trajet WHERE jeton_suivi = $1`,
        [dto.jetonSuivi.trim()],
      );
      if (!trajet) throw new NotFoundException('Trajet introuvable.');

      // On ne signale que ses propres trajets : sinon connaitre un jeton
      // de suivi suffirait a salir le dossier de n'importe quel chauffeur.
      if (trajet.session_passager !== session) {
        throw new ForbiddenException('Ce trajet n\'appartient pas à cette session.');
      }

      trajetId = trajet.id;
      chauffeurId = trajet.chauffeur_id;
      codeQrId = trajet.code_qr_id;
    }

    if (!trajetId && dto.jetonQr) {
      // Le QR peut etre inconnu — c'est meme le cas le plus preoccupant,
      // celui d'un faux code. On enregistre alors le signalement sans
      // cible, il vaut par sa description.
      const qr = await this.base.premier<any>(
        'SELECT id, chauffeur_id FROM code_qr WHERE jeton = $1',
        [dto.jetonQr.trim().toUpperCase()],
      );
      if (qr) {
        codeQrId = qr.id;
        chauffeurId = qr.chauffeur_id;
      } else {
        return this.enregistrerQrInconnu(session, dto);
      }
    }

    if (!trajetId && !chauffeurId && !codeQrId) {
      throw new BadRequestException(
        'Précisez le trajet ou le code QR concerné.',
      );
    }

    const signalement = await this.base.premier<any>(
      `INSERT INTO signalement
         (trajet_id, chauffeur_id, code_qr_id, session_passager, motif, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, etat, cree_le`,
      [trajetId, chauffeurId, codeQrId, session, dto.motif,
       dto.description?.trim() ?? null],
    );

    this.logger.warn(
      `Signalement ${signalement.id} (${dto.motif})` +
      (chauffeurId ? ` visant le chauffeur ${chauffeurId}` : ''),
    );

    return {
      id: signalement.id,
      etat: signalement.etat,
      creeLe: signalement.cree_le,
      message:
        'Signalement enregistré. Il sera examiné par l\'autorité compétente. ' +
        'En cas de danger immédiat, appelez la police (117).',
    };
  }

  /**
   * Un QR qui ne correspond a rien en base : probablement un faux code.
   * Le signalement est conserve sans cible — il n'y en a pas — mais
   * l'information vaut d'etre remontee.
   */
  private async enregistrerQrInconnu(session: string, dto: CreationSignalementDto) {
    const description = [
      `Code QR inconnu signalé : « ${dto.jetonQr} ».`,
      dto.description?.trim(),
    ].filter(Boolean).join(' ');

    // La contrainte signalement_cible impose au moins une cible ; sans
    // aucune, on ne peut pas ecrire dans la table. On journalise donc,
    // et on renvoie une reponse utile au passager.
    await this.base.requete(
      `INSERT INTO journal_audit (action, entite, details)
       VALUES ('signalement.qr_inconnu', 'code_qr', $1)`,
      [JSON.stringify({ jeton: dto.jetonQr, session, description })],
    );

    this.logger.warn(`QR inconnu signalé : ${dto.jetonQr}`);

    return {
      id: null,
      etat: 'enregistre',
      qrInconnu: true,
      message:
        'Ce code ne provient pas de la plateforme. Votre signalement a été ' +
        'enregistré. Ne montez pas dans ce véhicule et, en cas de danger, ' +
        'appelez la police (117).',
    };
  }

  /** File des signalements d'une autorite. */
  async lister(compte: CompteAuthentifie, etat = 'ouvert') {
    const filtre = compte.role === 'superadmin' ? '' : 'AND c.autorite_id = $2';
    const parametres: unknown[] = [etat];
    if (compte.role !== 'superadmin') parametres.push(compte.autoriteId);

    return this.base.requete(
      `SELECT s.id, s.motif, s.description, s.etat, s.cree_le,
              s.traite_le, s.note_traitement,
              t.jeton_suivi, t.demarre_le,
              c.id AS chauffeur_id, c.nom, c.prenom, c.statut,
              c.reference_licence,
              v.plaque, vl.nom AS ville,
              now() - s.cree_le AS anciennete,
              (SELECT count(*) FROM signalement s2
                WHERE s2.chauffeur_id = s.chauffeur_id
                  AND s2.etat = 'fonde') AS signalements_fondes
         FROM signalement s
         LEFT JOIN trajet t ON t.id = s.trajet_id
         LEFT JOIN chauffeur c ON c.id = s.chauffeur_id
         LEFT JOIN vehicule v ON v.chauffeur_id = c.id AND v.actif
         LEFT JOIN ville vl ON vl.id = c.ville_id
        WHERE s.etat = $1 ${filtre}
        ORDER BY s.cree_le ASC`,
      parametres,
    );
  }

  /**
   * Traitement par un agent.
   *
   * Une conclusion exige une note. Un signalement classe « non fonde »
   * sans explication est indefendable si le passager revient dessus, et
   * un « fonde » sans motif l'est tout autant pour le chauffeur.
   */
  async traiter(
    signalementId: string,
    compte: CompteAuthentifie,
    dto: TraitementSignalementDto,
  ) {
    if (ETATS_CONCLUSIFS.includes(dto.etat) && !dto.note?.trim()) {
      throw new BadRequestException(
        'Une note de traitement est obligatoire pour conclure un signalement.',
      );
    }
    if (dto.suspendreChauffeur && dto.etat !== 'fonde') {
      throw new BadRequestException(
        'Une suspension ne peut accompagner qu\'un signalement jugé fondé.',
      );
    }

    const signalement = await this.base.premier<any>(
      `SELECT s.id, s.etat, s.chauffeur_id, s.motif, c.autorite_id, c.ville_id
         FROM signalement s
         LEFT JOIN chauffeur c ON c.id = s.chauffeur_id
        WHERE s.id = $1`,
      [signalementId],
    );
    if (!signalement) throw new NotFoundException('Signalement introuvable.');

    await this.exigerAcces(signalement, compte);

    if (['fonde', 'non_fonde', 'clos'].includes(signalement.etat)) {
      throw new ConflictException(`Ce signalement est déjà ${signalement.etat}.`);
    }

    if (dto.suspendreChauffeur && !signalement.chauffeur_id) {
      throw new BadRequestException(
        'Ce signalement ne vise aucun chauffeur identifié.',
      );
    }

    await this.base.transaction(async (client) => {
      await client.query(
        `UPDATE signalement
            SET etat = $2, note_traitement = $3, traite_par = $4, traite_le = now()
          WHERE id = $1`,
        [signalementId, dto.etat, dto.note?.trim() ?? null, compte.id],
      );

      if (dto.suspendreChauffeur) {
        await client.query(
          `UPDATE chauffeur
              SET statut = 'suspendu', motif_suspension = $2, statut_change_le = now()
            WHERE id = $1`,
          [signalement.chauffeur_id,
           `Signalement fondé : ${dto.note?.trim() ?? signalement.motif}`],
        );
        // Le QR est revoque dans la meme transaction : un chauffeur
        // suspendu dont le code reste actif continuerait a paraitre
        // verifie a l'ecran de scan.
        await client.query(
          `UPDATE code_qr SET actif = false, revoque_le = now(),
                  motif_revocation = 'chauffeur suspendu'
            WHERE chauffeur_id = $1 AND actif`,
          [signalement.chauffeur_id],
        );
      }

      await client.query(
        `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
         VALUES ($1, $2, 'signalement', $3, $4)`,
        [compte.id,
         dto.suspendreChauffeur ? 'signalement.fonde_avec_suspension' : 'signalement.traite',
         signalementId,
         JSON.stringify({ etat: dto.etat, chauffeurId: signalement.chauffeur_id })],
      );
    });

    if (dto.suspendreChauffeur) {
      this.logger.warn(
        `Chauffeur ${signalement.chauffeur_id} suspendu suite au signalement ${signalementId}`,
      );
    }

    return {
      id: signalementId,
      etat: dto.etat,
      chauffeurSuspendu: dto.suspendreChauffeur === true,
    };
  }

  /**
   * Declaration d'un objet oublie dans le vehicule.
   *
   * Rattachee au trajet, donc au chauffeur : c'est tout l'interet
   * d'avoir scanne le QR en montant. Sans cela, un sac oublie est perdu.
   */
  async declarerObjetPerdu(
    session: string, jetonSuivi: string, dto: DeclarationObjetPerduDto,
  ) {
    const trajet = await this.base.premier<any>(
      `SELECT t.id, t.session_passager, t.chauffeur_id,
              c.nom, c.prenom, cp.telephone AS telephone_chauffeur,
              v.plaque
         FROM trajet t
         JOIN chauffeur c ON c.id = t.chauffeur_id
         JOIN compte   cp ON cp.id = c.compte_id
         JOIN vehicule  v ON v.id = t.vehicule_id
        WHERE t.jeton_suivi = $1`,
      [jetonSuivi.trim()],
    );

    if (!trajet) throw new NotFoundException('Trajet introuvable.');
    if (trajet.session_passager !== session) {
      throw new ForbiddenException('Ce trajet n\'appartient pas à cette session.');
    }

    let telephone: string | null = null;
    if (dto.telephoneContact) {
      telephone = normaliserTelephone(dto.telephoneContact);
      if (!telephone) {
        throw new BadRequestException(
          'Numéro invalide. Format attendu : 6XXXXXXXX.',
        );
      }
    }

    const objet = await this.base.premier<any>(
      `INSERT INTO objet_perdu (trajet_id, description, telephone_contact)
       VALUES ($1, $2, $3) RETURNING id, etat, cree_le`,
      [trajet.id, dto.description.trim(), telephone],
    );

    // Le chauffeur est prevenu tout de suite : un objet retrouve le jour
    // meme a bien plus de chances de revenir a son proprietaire.
    await this.sms.envoyer({
      telephone: trajet.telephone_chauffeur,
      categorie: 'notification',
      contenu:
        `SecuriTaxi : un passager a oublie un objet dans votre vehicule ` +
        `(${formaterPlaque(trajet.plaque)}). Description : ` +
        `${dto.description.trim().slice(0, 100)}. ` +
        `Consultez l'application pour repondre.`,
    });

    this.logger.log(`Objet perdu déclaré sur le trajet ${jetonSuivi}`);

    return {
      id: objet.id,
      etat: objet.etat,
      message:
        'Déclaration enregistrée. Le chauffeur a été prévenu et pourra ' +
        'vous répondre.',
    };
  }

  /** Objets declares sur les trajets de cette session. */
  async mesObjetsPerdus(session: string) {
    const lignes = await this.base.requete<any>(
      `SELECT o.id, o.description, o.etat, o.reponse_chauffeur,
              o.cree_le, o.modifie_le,
              t.jeton_suivi, c.nom, c.prenom, v.plaque
         FROM objet_perdu o
         JOIN trajet t ON t.id = o.trajet_id
         JOIN chauffeur c ON c.id = t.chauffeur_id
         JOIN vehicule v ON v.id = t.vehicule_id
        WHERE t.session_passager = $1
        ORDER BY o.cree_le DESC`,
      [session],
    );

    return lignes.map((o) => ({
      id: o.id,
      description: o.description,
      etat: o.etat,
      reponseChauffeur: o.reponse_chauffeur,
      declareLe: o.cree_le,
      chauffeur: `${o.prenom} ${o.nom}`,
      plaque: formaterPlaque(o.plaque),
      jetonSuivi: o.jeton_suivi,
    }));
  }

  /** Objets signales sur les trajets d'un chauffeur. */
  async objetsDeMesTrajets(compte: CompteAuthentifie) {
    return this.base.requete(
      `SELECT o.id, o.description, o.etat, o.reponse_chauffeur,
              o.telephone_contact, o.cree_le,
              t.jeton_suivi, t.demarre_le
         FROM objet_perdu o
         JOIN trajet t ON t.id = o.trajet_id
         JOIN chauffeur c ON c.id = t.chauffeur_id
        WHERE c.compte_id = $1
        ORDER BY o.cree_le DESC`,
      [compte.id],
    );
  }

  /** Reponse du chauffeur sur un objet declare. */
  async repondreObjetPerdu(
    objetId: string, compte: CompteAuthentifie, dto: ReponseChauffeurDto,
  ) {
    const objet = await this.base.premier<any>(
      `SELECT o.id, o.etat, o.telephone_contact, c.compte_id, v.plaque
         FROM objet_perdu o
         JOIN trajet t ON t.id = o.trajet_id
         JOIN chauffeur c ON c.id = t.chauffeur_id
         JOIN vehicule v ON v.id = t.vehicule_id
        WHERE o.id = $1`,
      [objetId],
    );

    if (!objet) throw new NotFoundException('Déclaration introuvable.');
    if (objet.compte_id !== compte.id && compte.role !== 'superadmin') {
      throw new ForbiddenException('Cette déclaration ne concerne pas vos trajets.');
    }

    await this.base.requete(
      `UPDATE objet_perdu
          SET etat = $2, reponse_chauffeur = $3, modifie_le = now()
        WHERE id = $1`,
      [objetId, dto.etat, dto.reponse?.trim() ?? null],
    );

    // Le passager n'a laisse son numero que pour etre rappele : on ne
    // s'en sert que pour cela, et seulement s'il y a du nouveau.
    if (objet.telephone_contact && dto.etat !== 'vu_chauffeur') {
      const nouvelle = dto.etat === 'retrouve'
        ? 'Bonne nouvelle : votre objet a ete retrouve.'
        : 'Le chauffeur n\'a pas retrouve votre objet.';
      await this.sms.envoyer({
        telephone: objet.telephone_contact,
        categorie: 'notification',
        contenu:
          `SecuriTaxi : ${nouvelle}` +
          (dto.reponse?.trim() ? ` ${dto.reponse.trim().slice(0, 120)}` : ''),
      });
    }

    return { id: objetId, etat: dto.etat };
  }

  /**
   * Un agent ne traite que ce qui releve de sa ville. Un signalement sans
   * chauffeur identifie (QR suspect) reste accessible a tout agent : il
   * n'appartient a personne, et le laisser sans traitement serait pire.
   */
  private async exigerAcces(signalement: any, compte: CompteAuthentifie) {
    if (compte.role === 'superadmin') return;
    if (compte.role !== 'agent' || !compte.autoriteId) {
      throw new ForbiddenException('Action réservée aux agents.');
    }
    if (!signalement.chauffeur_id) return;

    const accessible = await this.base.premier(
      `SELECT 1 FROM autorite a
        WHERE a.id = $1 AND a.ville_id = $2`,
      [compte.autoriteId, signalement.ville_id],
    );
    if (!accessible) {
      throw new ForbiddenException('Ce signalement relève d\'une autre autorité.');
    }
  }
}
