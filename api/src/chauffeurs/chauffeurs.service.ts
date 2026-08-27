import {
  Injectable, BadRequestException, NotFoundException,
  ConflictException, Logger,
} from '@nestjs/common';
import { BaseService } from '../base/base.service';
import {
  normaliserPlaque, plaqueValide, normaliserTelephone, genererJeton,
} from '../commun/format';
import { InscriptionChauffeurDto, ValidationDossierDto } from './chauffeurs.dto';
import { DOCUMENTS_REQUIS } from '../documents/documents.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ChauffeursService {
  private readonly logger = new Logger(ChauffeursService.name);

  constructor(private readonly base: BaseService) {}

  /**
   * Inscription d'un chauffeur. Le compte est créé au statut « déclaré » :
   * aucun QR n'est émis tant qu'un agent n'a pas validé le dossier.
   */
  async inscrire(dto: InscriptionChauffeurDto) {
    const telephone = normaliserTelephone(dto.telephone);
    if (!telephone) {
      throw new BadRequestException(
        'Numéro invalide. Format attendu : 6XXXXXXXX ou 2XXXXXXXX.',
      );
    }

    if (!plaqueValide(dto.plaque)) {
      throw new BadRequestException(
        'Plaque invalide. Format attendu : deux lettres, trois chiffres, deux lettres (ex. LT 452 AB).',
      );
    }
    const plaque = normaliserPlaque(dto.plaque);

    const ville = await this.base.premier(
      'SELECT id FROM ville WHERE id = $1', [dto.villeId],
    );
    if (!ville) throw new BadRequestException('Ville inconnue.');

    return this.base.transaction(async (client) => {
      const dejaPris = await client.query(
        'SELECT 1 FROM compte WHERE telephone = $1', [telephone],
      );
      if (dejaPris.rowCount) {
        throw new ConflictException('Ce numéro est déjà enregistré.');
      }

      // Une plaque ne peut être active que sur un seul véhicule.
      const plaquePrise = await client.query(
        'SELECT 1 FROM vehicule WHERE plaque = $1 AND actif', [plaque],
      );
      if (plaquePrise.rowCount) {
        throw new ConflictException(
          'Cette plaque est déjà enregistrée par un autre chauffeur. ' +
          'S\'il s\'agit d\'une erreur, signalez-le à votre commune.',
        );
      }

      const hash = dto.motDePasse ? await bcrypt.hash(dto.motDePasse, 12) : null;

      const compte = await client.query(
        `INSERT INTO compte (telephone, mot_de_passe_hash, role)
         VALUES ($1, $2, 'chauffeur') RETURNING id`,
        [telephone, hash],
      );
      const compteId = compte.rows[0].id;

      const chauffeur = await client.query(
        `INSERT INTO chauffeur
           (compte_id, nom, prenom, date_naissance, lieu_naissance, ville_id, statut)
         VALUES ($1, $2, $3, $4, $5, $6, 'declare')
         RETURNING id, statut, cree_le`,
        [compteId, dto.nom.trim(), dto.prenom.trim(),
         dto.dateNaissance ?? null, dto.lieuNaissance ?? null, dto.villeId],
      );
      const chauffeurId = chauffeur.rows[0].id;

      await client.query(
        `INSERT INTO vehicule (chauffeur_id, plaque, marque, modele, couleur)
         VALUES ($1, $2, $3, $4, $5)`,
        [chauffeurId, plaque, dto.marque ?? null, dto.modele ?? null, dto.couleur ?? null],
      );

      await client.query(
        `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
         VALUES ($1, 'chauffeur.inscrit', 'chauffeur', $2, $3)`,
        [compteId, chauffeurId, JSON.stringify({ plaque })],
      );

      this.logger.log(`Inscription chauffeur ${chauffeurId} (${plaque})`);

      return {
        id: chauffeurId,
        statut: 'declare',
        message:
          'Inscription enregistrée. Votre dossier sera examiné par un agent. ' +
          'Votre code QR sera émis après validation.',
      };
    });
  }

  /**
   * Validation d'un dossier par un agent.
   * Le passage à « vérifié » attribue la référence de licence ET émet le QR,
   * dans une seule transaction : jamais l'un sans l'autre.
   */
  async validerDossier(
    chauffeurId: string,
    agentCompteId: string,
    autoriteId: string,
    dto: ValidationDossierDto,
  ) {
    if (dto.decision === 'rejete' && !dto.motif?.trim()) {
      throw new BadRequestException('Un motif est obligatoire en cas de rejet.');
    }

    return this.base.transaction(async (client) => {
      const existant = await client.query(
        `SELECT c.id, c.statut, c.reference_licence, v.nom AS ville, r.code AS region
           FROM chauffeur c
           JOIN ville v ON v.id = c.ville_id
           JOIN region r ON r.code = v.region_code
          WHERE c.id = $1 AND c.supprime_le IS NULL
          FOR UPDATE`,
        [chauffeurId],
      );
      if (!existant.rowCount) throw new NotFoundException('Chauffeur introuvable.');
      const chauffeur = existant.rows[0];

      if (['verifie', 'certifie'].includes(chauffeur.statut) && dto.decision !== 'rejete') {
        throw new ConflictException('Ce dossier est déjà validé.');
      }

      // Un dossier ne peut etre valide que si les pieces requises sont
      // presentes et jugees lisibles. La reference de licence est ce que
      // le passager voit sur l'ecran de scan : elle ne doit jamais
      // pouvoir exister sans qu'un agent ait reellement vu les pieces.
      if (dto.decision !== 'rejete') {
        const pieces = await client.query(
          `SELECT type, verdict FROM document WHERE chauffeur_id = $1`,
          [chauffeurId],
        );
        const parType = new Map<string, string | null>(
          pieces.rows.map((d: any) => [d.type, d.verdict]),
        );

        const manquantes = DOCUMENTS_REQUIS.filter((type) => !parType.has(type));
        if (manquantes.length) {
          throw new ConflictException({
            code: 'DOSSIER_INCOMPLET',
            message:
              'Ce dossier ne peut pas être validé : des pièces manquent.',
            manquantes,
          });
        }

        const nonRetenues = DOCUMENTS_REQUIS.filter(
          (type) => parType.get(type) !== 'lisible',
        );
        if (nonRetenues.length) {
          throw new ConflictException({
            code: 'PIECES_NON_EXAMINEES',
            message:
              'Chaque pièce requise doit avoir été examinée et jugée lisible ' +
              'avant la validation du dossier.',
            enAttente: nonRetenues,
          });
        }
      }

      if (dto.decision === 'rejete') {
        await client.query(
          `UPDATE chauffeur
              SET statut = 'rejete', motif_suspension = $2, statut_change_le = now()
            WHERE id = $1`,
          [chauffeurId, dto.motif],
        );
        await client.query(
          `UPDATE code_qr SET actif = false, revoque_le = now(),
                  motif_revocation = 'dossier rejete'
            WHERE chauffeur_id = $1 AND actif`,
          [chauffeurId],
        );
        await this.tracer(client, agentCompteId, 'chauffeur.rejete', chauffeurId,
                          { motif: dto.motif });
        return { statut: 'rejete', motif: dto.motif };
      }

      // Référence de licence : numéro séquentiel par région (0447-DLA).
      let reference = chauffeur.reference_licence;
      if (!reference) {
        const suffixe = await this.suffixeRegion(client, chauffeur.region);
        const compteur = await client.query(
          `SELECT count(*) + 1 AS n FROM chauffeur
            WHERE reference_licence LIKE '%-' || $1`,
          [suffixe],
        );
        const numero = String(compteur.rows[0].n).padStart(4, '0');
        reference = `${numero}-${suffixe}`;
      }

      await client.query(
        `UPDATE chauffeur
            SET statut = $2, reference_licence = $3, autorite_id = $4,
                statut_change_le = now(), motif_suspension = NULL
          WHERE id = $1`,
        [chauffeurId, dto.decision, reference, autoriteId],
      );

      if (dto.plaqueRecoupee !== undefined) {
        await client.query(
          'UPDATE vehicule SET plaque_recoupee = $2 WHERE chauffeur_id = $1 AND actif',
          [chauffeurId, dto.plaqueRecoupee],
        );
      }

      // Émission du QR : un seul actif à la fois.
      const qrExistant = await client.query(
        'SELECT jeton FROM code_qr WHERE chauffeur_id = $1 AND actif',
        [chauffeurId],
      );

      let jeton: string;
      if (qrExistant.rowCount) {
        jeton = qrExistant.rows[0].jeton;
      } else {
        jeton = await this.jetonUnique(client);
        await client.query(
          'INSERT INTO code_qr (chauffeur_id, jeton) VALUES ($1, $2)',
          [chauffeurId, jeton],
        );
      }

      await this.tracer(client, agentCompteId, 'chauffeur.valide', chauffeurId,
                        { decision: dto.decision, reference });

      this.logger.log(`Dossier ${chauffeurId} validé (${dto.decision}), QR ${jeton}`);

      return { statut: dto.decision, referenceLicence: reference, jetonQr: jeton };
    });
  }

  /** Suffixe de référence : trois lettres tirées de la région. */
  private async suffixeRegion(client: any, codeRegion: string): Promise<string> {
    const correspondances: Record<string, string> = {
      LT: 'DLA', CE: 'YDE', OU: 'BAF', NW: 'BAM', SW: 'BUE',
      NO: 'GAR', EN: 'MAR', AD: 'NGA', ES: 'BER', SU: 'EBO',
    };
    return correspondances[codeRegion] ?? codeRegion.padEnd(3, 'X');
  }

  /** Jeton de QR garanti unique. */
  private async jetonUnique(client: any): Promise<string> {
    for (let essai = 0; essai < 10; essai++) {
      const candidat = genererJeton(7);
      const pris = await client.query(
        'SELECT 1 FROM code_qr WHERE jeton = $1', [candidat],
      );
      if (!pris.rowCount) return candidat;
    }
    throw new Error('Impossible de générer un jeton unique après 10 essais.');
  }

  private async tracer(
    client: any, compteId: string, action: string,
    entiteId: string, details: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
       VALUES ($1, $2, 'chauffeur', $3, $4)`,
      [compteId, action, entiteId, JSON.stringify(details)],
    );
  }

  /** File d'attente de validation, filtrée par ville si demandé. */
  async fileValidation(villeId?: string) {
    const sql = villeId
      ? 'SELECT * FROM v_file_validation WHERE ville_id = $1 ORDER BY depose_le ASC'
      : 'SELECT * FROM v_file_validation ORDER BY depose_le ASC';
    return this.base.requete(sql, villeId ? [villeId] : []);
  }
}
