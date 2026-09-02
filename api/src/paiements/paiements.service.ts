import {
  Injectable, Logger, NotFoundException, ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PoolClient } from 'pg';

import { BaseService } from '../base/base.service';
import { genererJeton } from '../commun/format';
import {
  EncaissementGuichetDto, OuvertureMobileMoneyDto, TarifAutoriteDto,
} from './paiements.dto';

/**
 * Frais d'emission du code QR.
 *
 * Deux decisions structurent tout ce fichier.
 *
 * On encaisse APRES la validation, jamais avant. L'agent examine les
 * pieces et valide le dossier ; le QR n'est emis qu'une fois les frais
 * regles. Encaisser d'abord obligerait a rembourser un dossier rejete —
 * donc une procedure, un litige possible, et du code pour le gerer. Ici,
 * un dossier rejete n'a rien encaisse.
 *
 * Le montant n'est jamais fourni par le client. Il est lu dans la table
 * autorite au moment de l'encaissement : laisser l'appelant annoncer ce
 * qu'il paie reviendrait a le laisser choisir son tarif.
 */
@Injectable()
export class PaiementsService {
  private readonly logger = new Logger('Paiements');

  constructor(private readonly base: BaseService) {}

  // ------------------------------------------------------------------
  //  Le tarif
  // ------------------------------------------------------------------

  /**
   * Fixe les frais d'une autorite.
   *
   * Tant qu'aucun tarif n'est fixe, l'emission est refusee. Bloquer vaut
   * mieux qu'encaisser un montant arbitraire : un chauffeur a qui l'on
   * reclame une somme inventee n'a aucun recours.
   */
  async reglerTarif(autoriteId: string, dto: TarifAutoriteDto, compteId: string) {
    return this.base.transaction(async (client) => {
      const autorite = await client.query(
        'SELECT id, nom FROM autorite WHERE id = $1 FOR UPDATE',
        [autoriteId],
      );
      if (!autorite.rowCount) throw new NotFoundException('Autorité introuvable.');

      await client.query(
        `UPDATE autorite
            SET frais_qr_fcfa = $2,
                validite_qr_mois = COALESCE($3, validite_qr_mois)
          WHERE id = $1`,
        [autoriteId, dto.fraisQrFcfa, dto.validiteQrMois ?? null],
      );

      // Un changement de tarif se justifie devant un chauffeur qui
      // conteste : il est trace comme le reste.
      await this.tracer(client, compteId, 'autorite.tarif_modifie', autoriteId, {
        fraisQrFcfa: dto.fraisQrFcfa,
        validiteQrMois: dto.validiteQrMois ?? null,
      });

      this.logger.log(
        `Tarif de « ${autorite.rows[0].nom} » fixé à ${dto.fraisQrFcfa} FCFA`,
      );

      return {
        autoriteId,
        fraisQrFcfa: dto.fraisQrFcfa,
        validiteQrMois: dto.validiteQrMois ?? null,
      };
    });
  }

  // ------------------------------------------------------------------
  //  Ce que le chauffeur doit
  // ------------------------------------------------------------------

  /**
   * Etat des frais pour un chauffeur : ce qu'il doit, ce qu'il a paye,
   * et si son QR est en cours de validite.
   */
  async situation(chauffeurId: string) {
    const ligne = await this.base.premier<any>(
      `SELECT c.id, c.statut, c.autorite_id,
              a.nom               AS autorite_nom,
              a.frais_qr_fcfa,
              a.validite_qr_mois,
              q.jeton, q.expire_le,
              q.expire_le IS NOT NULL AND q.expire_le <= now() AS qr_expire
         FROM chauffeur c
         LEFT JOIN autorite a ON a.id = c.autorite_id
         LEFT JOIN code_qr  q ON q.chauffeur_id = c.id AND q.actif
        WHERE c.id = $1 AND c.supprime_le IS NULL`,
      [chauffeurId],
    );
    if (!ligne) throw new NotFoundException('Chauffeur introuvable.');

    const paiements = await this.base.requete<any>(
      `SELECT id, montant_fcfa, mode, operateur, statut, motif,
              reference_externe, cree_le, confirme_le
         FROM paiement
        WHERE chauffeur_id = $1
        ORDER BY cree_le DESC
        LIMIT 20`,
      [chauffeurId],
    );

    return {
      chauffeurId,
      statutDossier: ligne.statut,
      autorite: ligne.autorite_nom ?? null,
      fraisFcfa: ligne.frais_qr_fcfa === null ? null : Number(ligne.frais_qr_fcfa),
      validiteMois: ligne.validite_qr_mois ?? null,
      qr: ligne.jeton
        ? {
            jeton: ligne.jeton,
            expireLe: ligne.expire_le,
            expire: ligne.qr_expire === true,
          }
        : null,
      // Le paiement n'est du qu'une fois le dossier valide : avant, il
      // n'y a rien a encaisser.
      paiementRequis:
        ['verifie', 'certifie'].includes(ligne.statut)
        && (!ligne.jeton || ligne.qr_expire === true),
      paiements: paiements.map((p) => ({
        id: p.id,
        montantFcfa: Number(p.montant_fcfa),
        mode: p.mode,
        operateur: p.operateur,
        statut: p.statut,
        motif: p.motif,
        reference: p.reference_externe,
        creeLe: p.cree_le,
        confirmeLe: p.confirme_le,
      })),
    };
  }

  // ------------------------------------------------------------------
  //  Encaissement au guichet
  // ------------------------------------------------------------------

  /**
   * Un agent encaisse en especes et saisit le recu.
   *
   * C'est le seul mode qui ne depende d'aucun tiers : ni contrat
   * marchand, ni prestataire, ni reseau. Une regie communale fonctionne
   * ainsi aujourd'hui, et la plateforme doit pouvoir demarrer sans
   * attendre un accord Mobile Money.
   *
   * Le paiement est confirme et le QR emis dans LA MEME transaction :
   * un encaissement sans QR laisserait un chauffeur ayant paye sans rien
   * recevoir, et un QR sans encaissement serait un droit donne sans
   * contrepartie.
   */
  async encaisserAuGuichet(
    chauffeurId: string,
    dto: EncaissementGuichetDto,
    agentCompteId: string,
    agentAutoriteId: string | null,
  ) {
    return this.base.transaction(async (client) => {
      const chauffeur = await this.chauffeurAEncaisser(client, chauffeurId);

      // Un agent n'encaisse que pour sa propre commune. Le cloisonnement
      // vient du jeton, jamais d'un parametre de la requete.
      if (agentAutoriteId && chauffeur.autorite_id
          && chauffeur.autorite_id !== agentAutoriteId) {
        throw new ConflictException({
          code: 'AUTRE_AUTORITE',
          message: 'Ce dossier relève d\'une autre autorité.',
        });
      }

      const montant = this.montantDu(chauffeur);

      // La reference du recu ne doit compter qu'une fois. L'index unique
      // en base le garantit, mais un message clair vaut mieux qu'une
      // violation de contrainte remontee brute.
      const deja = await client.query(
        'SELECT id FROM paiement WHERE reference_externe = $1',
        [dto.referenceRecu],
      );
      if (deja.rowCount) {
        throw new ConflictException({
          code: 'RECU_DEJA_ENCAISSE',
          message: 'Ce numéro de reçu a déjà été encaissé.',
        });
      }

      const paiement = await client.query(
        `INSERT INTO paiement
           (chauffeur_id, autorite_id, montant_fcfa, mode, telephone_payeur,
            reference_externe, statut, confirme_le)
         VALUES ($1, $2, $3, 'guichet', $4, $5, 'confirme', now())
         RETURNING id`,
        [
          chauffeurId, chauffeur.autorite_id, montant,
          dto.telephonePayeur ?? null, dto.referenceRecu,
        ],
      );
      const paiementId = paiement.rows[0].id;

      const qr = await this.emettreQr(client, chauffeurId, chauffeur.validite_qr_mois);

      await client.query(
        'UPDATE paiement SET qr_id = $2 WHERE id = $1',
        [paiementId, qr.id],
      );

      await this.tracer(client, agentCompteId, 'paiement.encaisse', chauffeurId, {
        paiementId, montantFcfa: montant, mode: 'guichet',
        reference: dto.referenceRecu, jetonQr: qr.jeton,
      });

      this.logger.log(
        `Encaissement guichet ${montant} FCFA pour ${chauffeurId} — QR ${qr.jeton}`,
      );

      return {
        paiementId,
        montantFcfa: montant,
        mode: 'guichet',
        reference: dto.referenceRecu,
        jetonQr: qr.jeton,
        expireLe: qr.expireLe,
      };
    });
  }

  // ------------------------------------------------------------------
  //  Mobile Money
  // ------------------------------------------------------------------

  /**
   * Ouvre un paiement Mobile Money, sans rien confirmer.
   *
   * La ligne reste « en_attente » : seule une confirmation venue du
   * prestataire la fera passer a « confirme ». Un client qui se declare
   * paye n'est pas une preuve de paiement, et c'est exactement par la
   * qu'on obtiendrait un QR sans payer.
   *
   * Le raccordement a un prestataire — agregateur ou operateur en
   * direct — n'est pas encore choisi. Ce qui suit ne depend pas de ce
   * choix : la reference externe et le rapprochement sont les memes quel
   * que soit le fournisseur.
   */
  async ouvrirMobileMoney(
    chauffeurId: string,
    dto: OuvertureMobileMoneyDto,
    compteId: string,
  ) {
    return this.base.transaction(async (client) => {
      const chauffeur = await this.chauffeurAEncaisser(client, chauffeurId);
      const montant = this.montantDu(chauffeur);

      // Un paiement deja ouvert et non tranche est renvoye plutot que
      // duplique. Quelqu'un dont le reseau a coupe reessaie ; il ne doit
      // pas se retrouver avec deux demandes de debit.
      const enCours = await client.query(
        `SELECT id, montant_fcfa, operateur, cree_le
           FROM paiement
          WHERE chauffeur_id = $1 AND statut = 'en_attente'
            AND cree_le > now() - interval '30 minutes'
          ORDER BY cree_le DESC LIMIT 1`,
        [chauffeurId],
      );
      if (enCours.rowCount) {
        const p = enCours.rows[0];
        return {
          paiementId: p.id,
          montantFcfa: Number(p.montant_fcfa),
          operateur: p.operateur,
          statut: 'en_attente',
          reprise: true,
        };
      }

      const insere = await client.query(
        `INSERT INTO paiement
           (chauffeur_id, autorite_id, montant_fcfa, mode, operateur,
            telephone_payeur, reference_externe, statut)
         VALUES ($1, $2, $3, 'mobile_money', $4, $5, $6, 'en_attente')
         RETURNING id`,
        [
          chauffeurId, chauffeur.autorite_id, montant, dto.operateur,
          dto.telephonePayeur, `STX-${genererJeton(10)}`,
        ],
      );

      await this.tracer(client, compteId, 'paiement.ouvert', chauffeurId, {
        paiementId: insere.rows[0].id, montantFcfa: montant,
        mode: 'mobile_money', operateur: dto.operateur,
      });

      return {
        paiementId: insere.rows[0].id,
        montantFcfa: montant,
        operateur: dto.operateur,
        statut: 'en_attente',
        reprise: false,
      };
    });
  }

  /**
   * Confirme un paiement et emet le QR.
   *
   * Appelee par le rapprochement avec le prestataire — jamais par le
   * chauffeur lui-meme.
   *
   * Confirmer deux fois n'emet pas deux QR : la seconde confirmation
   * renvoie le resultat de la premiere. Les webhooks Mobile Money
   * arrivent en double, c'est la norme, et un doublon ne doit pas
   * produire un second droit.
   */
  async confirmer(
    paiementId: string,
    referenceExterne: string | null,
    compteId: string,
  ) {
    return this.base.transaction(async (client) => {
      const trouve = await client.query(
        `SELECT p.id, p.chauffeur_id, p.statut, p.montant_fcfa, p.qr_id,
                a.validite_qr_mois
           FROM paiement p
           LEFT JOIN chauffeur c ON c.id = p.chauffeur_id
           LEFT JOIN autorite  a ON a.id = c.autorite_id
          WHERE p.id = $1
          FOR UPDATE OF p`,
        [paiementId],
      );
      if (!trouve.rowCount) throw new NotFoundException('Paiement introuvable.');
      const paiement = trouve.rows[0];

      // Deja confirme : on rend le meme resultat, sans rien reemettre.
      if (paiement.statut === 'confirme') {
        const qr = await client.query(
          'SELECT jeton, expire_le FROM code_qr WHERE id = $1',
          [paiement.qr_id],
        );
        return {
          paiementId,
          statut: 'confirme',
          deja: true,
          jetonQr: qr.rows[0]?.jeton ?? null,
          expireLe: qr.rows[0]?.expire_le ?? null,
        };
      }

      if (paiement.statut !== 'en_attente') {
        throw new ConflictException({
          code: 'PAIEMENT_NON_CONFIRMABLE',
          message: `Un paiement « ${paiement.statut} » ne peut plus être confirmé.`,
        });
      }

      await client.query(
        `UPDATE paiement
            SET statut = 'confirme', confirme_le = now(),
                reference_externe = COALESCE($2, reference_externe)
          WHERE id = $1`,
        [paiementId, referenceExterne],
      );

      const qr = await this.emettreQr(
        client, paiement.chauffeur_id, paiement.validite_qr_mois,
      );
      await client.query(
        'UPDATE paiement SET qr_id = $2 WHERE id = $1', [paiementId, qr.id],
      );

      await this.tracer(client, compteId, 'paiement.confirme', paiement.chauffeur_id, {
        paiementId, montantFcfa: Number(paiement.montant_fcfa), jetonQr: qr.jeton,
      });

      this.logger.log(`Paiement ${paiementId} confirmé — QR ${qr.jeton}`);

      return {
        paiementId,
        statut: 'confirme',
        deja: false,
        jetonQr: qr.jeton,
        expireLe: qr.expireLe,
      };
    });
  }

  /**
   * Marque un paiement echoue.
   *
   * Le motif est obligatoire — la base l'impose aussi. Une ligne
   * « echoue » sans motif ne permet de repondre a personne, et c'est
   * precisement ce qu'un chauffeur viendra reclamer.
   */
  async marquerEchoue(paiementId: string, motif: string, compteId: string) {
    if (!motif?.trim()) {
      throw new BadRequestException('Un échec doit être motivé.');
    }

    return this.base.transaction(async (client) => {
      const trouve = await client.query(
        'SELECT id, chauffeur_id, statut FROM paiement WHERE id = $1 FOR UPDATE',
        [paiementId],
      );
      if (!trouve.rowCount) throw new NotFoundException('Paiement introuvable.');

      if (trouve.rows[0].statut === 'confirme') {
        throw new ConflictException({
          code: 'PAIEMENT_DEJA_CONFIRME',
          message:
            'Ce paiement est confirmé : le déclarer échoué reviendrait à '
            + 'retirer un droit déjà ouvert. Révoquez le QR si nécessaire.',
        });
      }

      await client.query(
        `UPDATE paiement SET statut = 'echoue', motif = $2 WHERE id = $1`,
        [paiementId, motif.trim()],
      );

      await this.tracer(client, compteId, 'paiement.echoue',
                        trouve.rows[0].chauffeur_id, { paiementId, motif });

      return { paiementId, statut: 'echoue', motif: motif.trim() };
    });
  }

  // ------------------------------------------------------------------
  //  Details internes
  // ------------------------------------------------------------------

  /**
   * Charge un chauffeur en verifiant qu'il y a bien lieu d'encaisser.
   *
   * Verrouille la ligne : deux encaissements simultanes pour le meme
   * chauffeur ne doivent pas produire deux QR.
   */
  private async chauffeurAEncaisser(client: PoolClient, chauffeurId: string) {
    const trouve = await client.query(
      `SELECT c.id, c.statut, c.autorite_id,
              a.frais_qr_fcfa, a.validite_qr_mois,
              q.id AS qr_id, q.expire_le
         FROM chauffeur c
         LEFT JOIN autorite a ON a.id = c.autorite_id
         LEFT JOIN code_qr  q ON q.chauffeur_id = c.id AND q.actif
        WHERE c.id = $1 AND c.supprime_le IS NULL
        FOR UPDATE OF c`,
      [chauffeurId],
    );
    if (!trouve.rowCount) throw new NotFoundException('Chauffeur introuvable.');
    const chauffeur = trouve.rows[0];

    // On encaisse APRES la validation. Un dossier non valide n'a rien a
    // payer : s'il est ensuite rejete, il n'y aura rien a rembourser.
    if (!['verifie', 'certifie'].includes(chauffeur.statut)) {
      throw new ConflictException({
        code: 'DOSSIER_NON_VALIDE',
        message:
          'Les frais ne sont dus qu\'une fois le dossier validé par un agent. '
          + 'Encaisser avant obligerait à rembourser un dossier rejeté.',
        statut: chauffeur.statut,
      });
    }

    // Un QR actif et non expire signifie que les frais ont deja ete
    // regles pour la periode en cours.
    const qrValide = chauffeur.qr_id
      && (chauffeur.expire_le === null || new Date(chauffeur.expire_le) > new Date());
    if (qrValide) {
      throw new ConflictException({
        code: 'QR_ENCORE_VALIDE',
        message: 'Ce chauffeur dispose déjà d\'un code QR en cours de validité.',
        expireLe: chauffeur.expire_le,
      });
    }

    return chauffeur;
  }

  /**
   * Montant du, lu dans la table autorite.
   *
   * Un tarif non fixe bloque l'emission plutot que de laisser encaisser
   * un montant arbitraire.
   */
  private montantDu(chauffeur: any): number {
    if (chauffeur.frais_qr_fcfa === null || chauffeur.frais_qr_fcfa === undefined) {
      throw new ConflictException({
        code: 'TARIF_NON_FIXE',
        message:
          'Aucun tarif n\'a été fixé pour cette autorité : impossible '
          + 'd\'encaisser. Un montant arbitraire ne se réclame pas.',
      });
    }
    return Number(chauffeur.frais_qr_fcfa);
  }

  /**
   * Emet le QR et pose sa date de fin de validite.
   *
   * Un seul QR actif par chauffeur : l'ancien, expire, est revoque dans
   * la meme transaction. Sans cela l'index unique partiel refuserait
   * l'insertion — et deux QR actifs voudraient dire deux verites.
   */
  private async emettreQr(
    client: PoolClient, chauffeurId: string, validiteMois: number | null,
  ): Promise<{ id: string; jeton: string; expireLe: Date }> {
    await client.query(
      `UPDATE code_qr
          SET actif = false, revoque_le = now(),
              motif_revocation = 'periode de validite echue'
        WHERE chauffeur_id = $1 AND actif`,
      [chauffeurId],
    );

    const mois = validiteMois ?? 6;
    let jeton = '';
    for (let essai = 0; essai < 10 && !jeton; essai++) {
      const candidat = genererJeton(7);
      const pris = await client.query(
        'SELECT 1 FROM code_qr WHERE jeton = $1', [candidat],
      );
      if (!pris.rowCount) jeton = candidat;
    }
    if (!jeton) {
      throw new Error('Impossible de générer un jeton unique après 10 essais.');
    }

    const insere = await client.query(
      `INSERT INTO code_qr (chauffeur_id, jeton, expire_le)
       VALUES ($1, $2, now() + make_interval(months => $3))
       RETURNING id, expire_le`,
      [chauffeurId, jeton, mois],
    );

    return {
      id: insere.rows[0].id,
      jeton,
      expireLe: insere.rows[0].expire_le,
    };
  }

  private async tracer(
    client: PoolClient, compteId: string, action: string,
    entiteId: string, details: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
       VALUES ($1, $2, 'chauffeur', $3, $4)`,
      [compteId, action, entiteId, JSON.stringify(details)],
    );
  }
}
