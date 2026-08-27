import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, ConflictException, Logger,
} from '@nestjs/common';
import { BaseService } from '../base/base.service';
import { StockageService } from './stockage.service';
import {
  TeleversementDocumentDto, ExamenDocumentDto,
  DOCUMENTS_REQUIS, TypeDocument,
} from './documents.dto';
import { CompteAuthentifie } from '../auth/jwt.strategie';

/** Types dont la date d'expiration conditionne la validite. */
const TYPES_PERISSABLES: TypeDocument[] = ['permis', 'assurance'];

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly base: BaseService,
    private readonly stockage: StockageService,
  ) {}

  /**
   * Televersement par le chauffeur.
   *
   * Un seul document par type : renvoyer une piece remplace la
   * precedente. Un chauffeur dont la CNI a ete jugee illisible doit
   * pouvoir la reprendre sans creer de doublon dans le dossier de
   * l'agent.
   */
  async televerser(
    compte: CompteAuthentifie,
    dto: TeleversementDocumentDto,
    fichier: Express.Multer.File,
  ) {
    const chauffeur = await this.chauffeurDuCompte(compte);

    if (['verifie', 'certifie'].includes(chauffeur.statut)) {
      throw new ConflictException(
        'Votre dossier est déjà validé. Pour modifier une pièce, ' +
        'contactez votre autorité de rattachement.',
      );
    }

    if (TYPES_PERISSABLES.includes(dto.type) && !dto.dateExpiration) {
      throw new BadRequestException(
        `La date d'expiration est requise pour ce type de document (${dto.type}).`,
      );
    }
    if (dto.dateExpiration && new Date(dto.dateExpiration) <= new Date()) {
      throw new BadRequestException(
        'Ce document est déjà expiré. Envoyez une pièce en cours de validité.',
      );
    }

    const enregistre = await this.stockage.enregistrer(fichier);

    try {
      const ancien = await this.base.transaction(async (client) => {
        const precedent = await client.query(
          'SELECT chemin FROM document WHERE chauffeur_id = $1 AND type = $2',
          [chauffeur.id, dto.type],
        );

        // Le remplacement remet le verdict a zero : une nouvelle piece
        // n'a pas encore ete examinee.
        await client.query(
          `INSERT INTO document (chauffeur_id, type, chemin, date_expiration)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (chauffeur_id, type) DO UPDATE
             SET chemin = EXCLUDED.chemin,
                 date_expiration = EXCLUDED.date_expiration,
                 verdict = NULL, commentaire = NULL,
                 examine_par = NULL, examine_le = NULL,
                 cree_le = now()`,
          [chauffeur.id, dto.type, enregistre.chemin, dto.dateExpiration ?? null],
        );

        await client.query(
          `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
           VALUES ($1, 'document.televerse', 'chauffeur', $2, $3)`,
          [compte.id, chauffeur.id,
           JSON.stringify({ type: dto.type, empreinte: enregistre.empreinte })],
        );

        return precedent.rows[0]?.chemin ?? null;
      });

      // L'ancien fichier n'est efface qu'apres succes en base : sinon on
      // perdrait la piece sans avoir enregistre la nouvelle.
      if (ancien) await this.stockage.supprimer(ancien);
    } catch (erreur) {
      await this.stockage.supprimer(enregistre.chemin);
      throw erreur;
    }

    this.logger.log(`Document ${dto.type} téléversé pour le chauffeur ${chauffeur.id}`);

    return {
      type: dto.type,
      taille: enregistre.taille,
      remplace: true,
      dossier: await this.etatDossier(chauffeur.id),
    };
  }

  /** Etat du dossier vu par le chauffeur : ce qu'il lui reste a fournir. */
  async monDossier(compte: CompteAuthentifie) {
    const chauffeur = await this.chauffeurDuCompte(compte);
    return {
      statut: chauffeur.statut,
      ...(await this.etatDossier(chauffeur.id)),
    };
  }

  /** Pieces d'un dossier, pour l'agent qui l'examine. */
  async listerPourAgent(chauffeurId: string, compte: CompteAuthentifie) {
    await this.exigerAccesAgent(chauffeurId, compte);

    const documents = await this.base.requete<any>(
      `SELECT d.id, d.type, d.verdict, d.commentaire, d.date_expiration,
              d.cree_le, d.examine_le,
              c.telephone AS examine_par_telephone
         FROM document d
         LEFT JOIN compte c ON c.id = d.examine_par
        WHERE d.chauffeur_id = $1
        ORDER BY d.type`,
      [chauffeurId],
    );

    return documents.map((d) => ({
      id: d.id,
      type: d.type,
      verdict: d.verdict,
      commentaire: d.commentaire,
      dateExpiration: d.date_expiration,
      deposeLe: d.cree_le,
      examineLe: d.examine_le,
      expire: d.date_expiration ? new Date(d.date_expiration) < new Date() : false,
      // Le chemin de stockage n'est jamais expose : le fichier se
      // recupere par son identifiant, via une route tracee.
      url: `/api/documents/${d.id}/fichier`,
    }));
  }

  /**
   * Lecture d'un fichier.
   *
   * Chaque consultation est tracee. Il s'agit de pieces d'identite :
   * savoir qui les a regardees, et quand, fait partie de ce que la loi
   * n° 2024/017 impose de pouvoir demontrer.
   */
  async fichier(documentId: string, compte: CompteAuthentifie) {
    const document = await this.base.premier<any>(
      `SELECT d.id, d.chemin, d.type, d.chauffeur_id,
              c.compte_id, c.autorite_id
         FROM document d
         JOIN chauffeur c ON c.id = d.chauffeur_id
        WHERE d.id = $1`,
      [documentId],
    );

    if (!document) throw new NotFoundException('Document introuvable.');

    // Le chauffeur accede a ses propres pieces ; sinon c'est le meme
    // controle que pour l'examen — un agent ne voit que les dossiers de
    // sa ville.
    if (document.compte_id !== compte.id) {
      try {
        await this.exigerAccesAgent(document.chauffeur_id, compte);
      } catch (erreur) {
        this.logger.warn(
          `Accès refusé au document ${documentId} pour le compte ${compte.id}`,
        );
        throw erreur;
      }
    }

    await this.base.requete(
      `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
       VALUES ($1, 'document.consulte', 'document', $2, $3)`,
      [compte.id, documentId, JSON.stringify({ type: document.type })],
    );

    return this.stockage.fluxLecture(document.chemin);
  }

  /**
   * Verdict de l'agent sur une piece.
   *
   * Un verdict negatif exige un commentaire : le chauffeur doit savoir
   * quoi corriger. Un rejet sans motif le laisse deviner, et il reviendra
   * au guichet — cout pour lui, cout pour l'agent.
   */
  async examiner(documentId: string, compte: CompteAuthentifie, dto: ExamenDocumentDto) {
    if (dto.verdict !== 'lisible' && !dto.commentaire?.trim()) {
      throw new BadRequestException(
        'Un commentaire est obligatoire lorsque la pièce n\'est pas retenue : ' +
        'le chauffeur doit savoir quoi corriger.',
      );
    }

    const document = await this.base.premier<any>(
      `SELECT d.id, d.chauffeur_id, c.autorite_id, c.compte_id
         FROM document d
         JOIN chauffeur c ON c.id = d.chauffeur_id
        WHERE d.id = $1`,
      [documentId],
    );
    if (!document) throw new NotFoundException('Document introuvable.');

    await this.exigerAccesAgent(document.chauffeur_id, compte);

    await this.base.transaction(async (client) => {
      await client.query(
        `UPDATE document
            SET verdict = $2, commentaire = $3, examine_par = $4, examine_le = now(),
                date_expiration = COALESCE($5, date_expiration)
          WHERE id = $1`,
        [documentId, dto.verdict, dto.commentaire?.trim() ?? null,
         compte.id, dto.dateExpiration ?? null],
      );

      // Le dossier passe en examen des la premiere piece examinee : le
      // chauffeur voit que quelqu'un s'en occupe.
      await client.query(
        `UPDATE chauffeur SET statut = 'en_examen', statut_change_le = now()
          WHERE id = $1 AND statut = 'declare'`,
        [document.chauffeur_id],
      );

      await client.query(
        `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
         VALUES ($1, 'document.examine', 'document', $2, $3)`,
        [compte.id, documentId, JSON.stringify({ verdict: dto.verdict })],
      );
    });

    this.logger.log(`Document ${documentId} examiné : ${dto.verdict}`);

    return {
      id: documentId,
      verdict: dto.verdict,
      dossier: await this.etatDossier(document.chauffeur_id),
    };
  }

  /**
   * Etat de completude d'un dossier.
   *
   * Sert au chauffeur (« que me manque-t-il ? ») et a l'agent (« ce
   * dossier est-il examinable ? »).
   */
  private async etatDossier(chauffeurId: string) {
    const documents = await this.base.requete<any>(
      `SELECT type, verdict, commentaire, date_expiration
         FROM document WHERE chauffeur_id = $1`,
      [chauffeurId],
    );

    const parType = new Map(documents.map((d) => [d.type, d]));
    const maintenant = new Date();

    const manquants = DOCUMENTS_REQUIS.filter((type) => !parType.has(type));
    const aRefaire = documents
      .filter((d) => d.verdict && d.verdict !== 'lisible')
      .map((d) => d.type);
    const expires = documents
      .filter((d) => d.date_expiration && new Date(d.date_expiration) < maintenant)
      .map((d) => d.type);

    // Le verdict d'un agent s'accompagne d'un commentaire obligatoire :
    // c'est la seule chose qui dit au chauffeur quoi corriger. Sans le
    // lui transmettre, l'exigence ne sert à rien.
    const motifs = documents
      .filter((d) => d.verdict && d.verdict !== 'lisible')
      .map((d) => ({
        type: d.type,
        verdict: d.verdict,
        commentaire: d.commentaire ?? null,
      }));

    return {
      deposes: documents.map((d) => d.type),
      manquants,
      aRefaire,
      motifs,
      expires,
      complet: manquants.length === 0 && aRefaire.length === 0 && expires.length === 0,
      examinable: manquants.length === 0,
    };
  }

  /** Un agent n'examine que les dossiers de sa ville. */
  private async exigerAccesAgent(chauffeurId: string, compte: CompteAuthentifie) {
    if (compte.role === 'superadmin') return;

    if (compte.role !== 'agent' || !compte.autoriteId) {
      throw new ForbiddenException('Action réservée aux agents.');
    }

    const accessible = await this.base.premier(
      `SELECT 1 FROM chauffeur c
         JOIN autorite a ON a.ville_id = c.ville_id
        WHERE c.id = $1 AND a.id = $2 AND c.supprime_le IS NULL`,
      [chauffeurId, compte.autoriteId],
    );

    if (!accessible) {
      throw new ForbiddenException(
        'Ce dossier ne relève pas de votre autorité.',
      );
    }
  }

  private async chauffeurDuCompte(compte: CompteAuthentifie) {
    const chauffeur = await this.base.premier<any>(
      'SELECT id, statut FROM chauffeur WHERE compte_id = $1 AND supprime_le IS NULL',
      [compte.id],
    );
    if (!chauffeur) {
      throw new ForbiddenException(
        'Aucun dossier chauffeur n\'est rattaché à ce compte.',
      );
    }
    return chauffeur;
  }
}
