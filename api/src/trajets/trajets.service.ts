import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, ConflictException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseService } from '../base/base.service';
import { SmsService } from '../sms/sms.service';
import {
  genererJeton, normaliserTelephone, formaterPlaque, formaterTelephone,
} from '../commun/format';
import {
  DemarrageTrajetDto, EnvoiPositionsDto, PartageTrajetDto, FinTrajetDto,
} from './trajets.dto';

/**
 * Au-dela, l'horodatage de l'appareil n'est pas credible : telephone mal
 * regle, ou tentative de fabriquer un historique. La position est gardee
 * — elle a ete recue — mais datee de son arrivee au serveur.
 */
const DERIVE_HORLOGE_MAX_MS = 24 * 60 * 60 * 1000;

/** Un trajet oublie n'est pas un trajet en cours. */
const DUREE_TRAJET_MAX_HEURES = 12;

@Injectable()
export class TrajetsService {
  private readonly logger = new Logger(TrajetsService.name);

  constructor(
    private readonly base: BaseService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Demarrage d'un trajet, juste apres le scan.
   *
   * Le statut du chauffeur est fige ici : si le chauffeur est suspendu
   * plus tard, on doit pouvoir dire ce que le passager avait reellement
   * vu au moment de monter. C'est precisement la question qui se pose en
   * cas de litige.
   */
  async demarrer(session: string, dto: DemarrageTrajetDto) {
    const jeton = dto.jetonQr.trim().toUpperCase();

    const qr = await this.base.premier<any>(
      `SELECT q.id AS code_qr_id, q.chauffeur_id, c.statut, v.id AS vehicule_id
         FROM code_qr q
         JOIN chauffeur c ON c.id = q.chauffeur_id AND c.supprime_le IS NULL
         JOIN vehicule  v ON v.chauffeur_id = c.id AND v.actif
        WHERE q.jeton = $1 AND q.actif`,
      [jeton],
    );

    if (!qr) {
      throw new NotFoundException({
        code: 'QR_INCONNU',
        message: 'Ce code n\'est pas reconnu. Impossible de démarrer un trajet.',
      });
    }

    return this.base.transaction(async (client) => {
      // Un passager ne suit qu'un trajet a la fois : sinon le bouton
      // d'alerte devient ambigu, et c'est le seul moment ou l'ambiguite
      // est interdite.
      const enCours = await client.query(
        `SELECT jeton_suivi FROM trajet
          WHERE session_passager = $1 AND etat = 'en_cours'`,
        [session],
      );
      if (enCours.rowCount) {
        throw new ConflictException({
          code: 'TRAJET_DEJA_EN_COURS',
          message: 'Un trajet est déjà en cours. Terminez-le avant d\'en démarrer un autre.',
          jetonSuivi: enCours.rows[0].jeton_suivi,
        });
      }

      const jetonSuivi = await this.jetonSuiviUnique(client);

      const trajet = await client.query(
        `INSERT INTO trajet
           (jeton_suivi, chauffeur_id, vehicule_id, code_qr_id,
            statut_chauffeur_au_scan, session_passager,
            depart_latitude, depart_longitude)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, jeton_suivi, demarre_le, etat`,
        [jetonSuivi, qr.chauffeur_id, qr.vehicule_id, qr.code_qr_id,
         qr.statut, session, dto.latitude ?? null, dto.longitude ?? null],
      );

      this.logger.log(`Trajet ${jetonSuivi} démarré (chauffeur ${qr.chauffeur_id})`);

      return {
        id: trajet.rows[0].id,
        jetonSuivi,
        urlSuivi: this.urlSuivi(jetonSuivi),
        demarreLe: trajet.rows[0].demarre_le,
        etat: trajet.rows[0].etat,
        statutChauffeurAuScan: qr.statut,
      };
    });
  }

  /**
   * Enregistrement d'un lot de positions.
   *
   * Les deux horodatages sont conserves : `mesure_le` vient de
   * l'appareil, `recu_le` du serveur. Sur les axes inter-urbains le
   * reseau disparait, le telephone accumule et envoie en bloc — sans les
   * deux dates, le trajet serait impossible a reconstituer.
   */
  async enregistrerPositions(session: string, jetonSuivi: string, dto: EnvoiPositionsDto) {
    const trajet = await this.trajetDeLaSession(session, jetonSuivi);

    if (trajet.etat !== 'en_cours' && trajet.etat !== 'alerte') {
      throw new ConflictException(
        'Ce trajet est terminé : il n\'accepte plus de positions.',
      );
    }

    const maintenant = Date.now();
    let horodatagesCorriges = 0;

    const valeurs = dto.positions.map((p) => {
      const mesure = new Date(p.mesureLe).getTime();
      const credible =
        Number.isFinite(mesure) &&
        Math.abs(maintenant - mesure) <= DERIVE_HORLOGE_MAX_MS;

      if (!credible) horodatagesCorriges++;

      return {
        latitude: p.latitude,
        longitude: p.longitude,
        precisionM: p.precisionM ?? null,
        mesureLe: credible ? new Date(mesure).toISOString() : new Date(maintenant).toISOString(),
      };
    });

    // Insertion en un seul aller-retour : un tampon hors ligne peut
    // contenir des centaines de points.
    await this.base.requete(
      `INSERT INTO position_trajet (trajet_id, latitude, longitude, precision_m, mesure_le)
       SELECT $1, (p->>'latitude')::numeric, (p->>'longitude')::numeric,
              (p->>'precisionM')::smallint, (p->>'mesureLe')::timestamptz
         FROM jsonb_array_elements($2::jsonb) AS p`,
      [trajet.id, JSON.stringify(valeurs)],
    );

    if (horodatagesCorriges) {
      this.logger.warn(
        `Trajet ${jetonSuivi} : ${horodatagesCorriges} horodatage(s) hors limites, datés à la réception.`,
      );
    }

    return {
      enregistrees: valeurs.length,
      horodatagesCorriges,
    };
  }

  /**
   * Partage du trajet avec des proches.
   *
   * Chaque destinataire recoit un SMS contenant le lien de suivi. Le lien
   * est public par construction : le proche n'a pas de compte non plus.
   * C'est le jeton, long et aleatoire, qui protege l'acces.
   */
  async partager(session: string, jetonSuivi: string, dto: PartageTrajetDto) {
    const trajet = await this.trajetDeLaSession(session, jetonSuivi);

    if (trajet.etat === 'termine' || trajet.etat === 'abandonne') {
      throw new ConflictException('Ce trajet est terminé : il n\'y a plus rien à suivre.');
    }

    const details = await this.base.premier<any>(
      `SELECT c.nom, c.prenom, c.statut, v.plaque
         FROM trajet t
         JOIN chauffeur c ON c.id = t.chauffeur_id
         JOIN vehicule  v ON v.id = t.vehicule_id
        WHERE t.id = $1`,
      [trajet.id],
    );

    const destinataires = dto.contacts.map((contact) => {
      const telephone = normaliserTelephone(contact.telephone);
      if (!telephone) {
        throw new BadRequestException(
          `Numéro invalide pour « ${contact.nom} ». Format attendu : 6XXXXXXXX.`,
        );
      }
      return { nom: contact.nom.trim(), telephone };
    });

    const url = this.urlSuivi(jetonSuivi);
    const message =
      `${details.prenom} ${details.nom} (${formaterPlaque(details.plaque)}) ` +
      `vous transporte. Suivez le trajet : ${url}`;

    const envoyes = await this.base.transaction(async (client) => {
      const resultats = [];
      for (const destinataire of destinataires) {
        const partage = await client.query(
          `INSERT INTO partage_trajet (trajet_id, nom_destinataire, telephone)
           VALUES ($1, $2, $3) RETURNING id`,
          [trajet.id, destinataire.nom, destinataire.telephone],
        );

        if (dto.memoriser) {
          await client.query(
            `INSERT INTO contact_confiance (session_passager, nom, telephone)
             VALUES ($1, $2, $3)
             ON CONFLICT (session_passager, telephone) DO UPDATE SET nom = EXCLUDED.nom`,
            [session, destinataire.nom, destinataire.telephone],
          );
        }

        resultats.push({ ...destinataire, partageId: partage.rows[0].id });
      }
      return resultats;
    });

    // Les SMS partent hors transaction : un echec d'envoi ne doit pas
    // annuler l'enregistrement du partage.
    for (const destinataire of envoyes) {
      await this.sms.envoyer({
        telephone: destinataire.telephone,
        categorie: 'partage',
        contenu: message,
        partageId: destinataire.partageId,
      });
    }

    this.logger.log(`Trajet ${jetonSuivi} partagé avec ${envoyes.length} proche(s)`);

    return {
      partages: envoyes.map((d) => ({ nom: d.nom, telephone: d.telephone })),
      urlSuivi: url,
    };
  }

  /** Fin normale du trajet. */
  async terminer(session: string, jetonSuivi: string, dto: FinTrajetDto) {
    const trajet = await this.trajetDeLaSession(session, jetonSuivi);

    if (trajet.etat === 'termine') {
      throw new ConflictException('Ce trajet est déjà terminé.');
    }
    if (trajet.etat === 'alerte') {
      throw new ConflictException({
        code: 'ALERTE_ACTIVE',
        message:
          'Une alerte est en cours sur ce trajet. Elle doit être annulée ou ' +
          'close avant de terminer le trajet.',
      });
    }

    const termine = await this.base.premier<any>(
      `UPDATE trajet
          SET etat = 'termine', termine_le = now(),
              arrivee_latitude = $2, arrivee_longitude = $3
        WHERE id = $1
        RETURNING demarre_le, termine_le`,
      [trajet.id, dto.latitude ?? null, dto.longitude ?? null],
    );

    this.logger.log(`Trajet ${jetonSuivi} terminé`);

    return {
      etat: 'termine',
      demarreLe: termine.demarre_le,
      termineLe: termine.termine_le,
      dureeMinutes: Math.round(
        (new Date(termine.termine_le).getTime() -
         new Date(termine.demarre_le).getTime()) / 60_000,
      ),
    };
  }

  /**
   * Vue du proche qui a recu le lien.
   *
   * Volontairement limitee : de quoi identifier le vehicule et savoir ou
   * il se trouve, rien de plus. Le proche n'a pas a connaitre la session
   * du passager ni l'historique de ses trajets.
   */
  async suivrePublic(jetonSuivi: string) {
    const trajet = await this.base.premier<any>(
      `SELECT t.id, t.jeton_suivi, t.etat, t.demarre_le, t.termine_le,
              t.statut_chauffeur_au_scan,
              c.nom, c.prenom, c.photo_chemin, c.reference_licence,
              v.plaque, v.marque, v.modele, v.couleur,
              vl.nom AS ville
         FROM trajet t
         JOIN chauffeur c ON c.id = t.chauffeur_id
         JOIN vehicule  v ON v.id = t.vehicule_id
         JOIN ville    vl ON vl.id = c.ville_id
        WHERE t.jeton_suivi = $1`,
      [jetonSuivi.trim()],
    );

    if (!trajet) {
      throw new NotFoundException({
        code: 'TRAJET_INCONNU',
        message: 'Ce lien de suivi n\'est pas valide.',
      });
    }

    const position = await this.base.premier<any>(
      `SELECT latitude, longitude, mesure_le, recu_le
         FROM position_trajet
        WHERE trajet_id = $1
        ORDER BY mesure_le DESC
        LIMIT 1`,
      [trajet.id],
    );

    // Marquer la consultation : savoir si le proche a ouvert le lien est
    // ce qui permet de mesurer l'utilite reelle du partage.
    await this.base.requete(
      `UPDATE partage_trajet SET consulte_le = now()
        WHERE trajet_id = $1 AND consulte_le IS NULL`,
      [trajet.id],
    );

    return {
      jetonSuivi: trajet.jeton_suivi,
      etat: trajet.etat,
      demarreLe: trajet.demarre_le,
      termineLe: trajet.termine_le,
      chauffeur: {
        nom: trajet.nom,
        prenom: trajet.prenom,
        photoUrl: trajet.photo_chemin ? `/media/photos/${trajet.photo_chemin}` : null,
        referenceLicence: trajet.reference_licence,
        statutAuScan: trajet.statut_chauffeur_au_scan,
      },
      vehicule: {
        plaque: formaterPlaque(trajet.plaque),
        description: [trajet.marque, trajet.modele, trajet.couleur]
          .filter(Boolean).join(' · ') || null,
      },
      ville: trajet.ville,
      position: position
        ? {
            latitude: Number(position.latitude),
            longitude: Number(position.longitude),
            mesureLe: position.mesure_le,
            fraicheurSecondes: Math.round(
              (Date.now() - new Date(position.mesure_le).getTime()) / 1000,
            ),
          }
        : null,
    };
  }

  /** Trajet en cours de la session, s'il y en a un. */
  async trajetCourant(session: string) {
    const trajet = await this.base.premier<any>(
      `SELECT jeton_suivi FROM trajet
        WHERE session_passager = $1 AND etat IN ('en_cours','alerte')
        ORDER BY demarre_le DESC LIMIT 1`,
      [session],
    );
    return trajet ? this.suivrePublic(trajet.jeton_suivi) : null;
  }

  /** Contacts memorises par cette session. */
  async contacts(session: string) {
    const lignes = await this.base.requete<any>(
      `SELECT id, nom, telephone FROM contact_confiance
        WHERE session_passager = $1 ORDER BY cree_le`,
      [session],
    );
    return lignes.map((c) => ({ id: c.id, nom: c.nom, telephone: c.telephone }));
  }

  /**
   * Charge un trajet en verifiant qu'il appartient bien a la session
   * appelante. Sans ce controle, connaitre un jeton de suivi suffirait a
   * piloter le trajet de quelqu'un d'autre.
   */
  /**
   * Numéro du chauffeur, pour un objet oublié.
   *
   * Trois conditions, et aucune n'est accessoire :
   *
   *  1. Seule la session qui a fait la course l'obtient. Le proche qui
   *     suit le trajet par SMS n'y a pas droit.
   *  2. Le trajet doit être terminé. Un numéro donné au scan serait
   *     récupérable en masse par quiconque scanne des QR, sans jamais
   *     monter dans le véhicule.
   *  3. La consultation est tracée. Ce numéro est une donnée personnelle
   *     du chauffeur : savoir qui y a accédé et quand est le minimum
   *     qu'on lui doit.
   */
  async contactChauffeur(session: string, jetonSuivi: string) {
    const trajet = await this.base.premier<any>(
      `SELECT t.id, t.etat, t.session_passager, t.termine_le,
              c.nom, c.prenom, cp.telephone
         FROM trajet t
         JOIN chauffeur c ON c.id = t.chauffeur_id
         JOIN compte   cp ON cp.id = c.compte_id
        WHERE t.jeton_suivi = $1`,
      [jetonSuivi.trim()],
    );

    if (!trajet) throw new NotFoundException('Trajet introuvable.');

    if (trajet.session_passager !== session) {
      this.logger.warn(
        `Session ${session.slice(0, 8)}… a demandé le contact du trajet ${jetonSuivi}`,
      );
      throw new ForbiddenException('Ce trajet n\'appartient pas à cette session.');
    }

    if (trajet.etat !== 'termine') {
      throw new ConflictException(
        'Le numéro du chauffeur est disponible une fois le trajet terminé.',
      );
    }

    await this.base.requete(
      `INSERT INTO journal_audit (action, entite, entite_id, details)
       VALUES ('trajet.contact_chauffeur', 'trajet', $1, $2)`,
      [trajet.id, JSON.stringify({ jetonSuivi: trajet.jeton_suivi ?? jetonSuivi })],
    );

    return {
      nom: trajet.nom,
      prenom: trajet.prenom,
      telephone: formaterTelephone(trajet.telephone),
      message:
        'Appelez le chauffeur si vous avez oublié quelque chose. ' +
        'Vous pouvez aussi déclarer l\'objet : il recevra un SMS avec ' +
        'votre description.',
    };
  }

  private async trajetDeLaSession(session: string, jetonSuivi: string) {
    const trajet = await this.base.premier<any>(
      `SELECT id, etat, session_passager, demarre_le
         FROM trajet WHERE jeton_suivi = $1`,
      [jetonSuivi.trim()],
    );

    if (!trajet) throw new NotFoundException('Trajet introuvable.');

    if (trajet.session_passager !== session) {
      this.logger.warn(
        `Session ${session.slice(0, 8)}… a tenté d'agir sur le trajet ${jetonSuivi}`,
      );
      throw new ForbiddenException('Ce trajet n\'appartient pas à cette session.');
    }

    return trajet;
  }

  private async jetonSuiviUnique(client: any): Promise<string> {
    for (let essai = 0; essai < 10; essai++) {
      const candidat = genererJeton(10);
      const pris = await client.query(
        'SELECT 1 FROM trajet WHERE jeton_suivi = $1', [candidat],
      );
      if (!pris.rowCount) return candidat;
    }
    throw new Error('Impossible de générer un jeton de suivi unique après 10 essais.');
  }

  private urlSuivi(jetonSuivi: string): string {
    const base = this.config.get<string>('URL_PUBLIQUE', 'http://localhost:3000');
    return `${base}/t/${jetonSuivi}`;
  }
}
