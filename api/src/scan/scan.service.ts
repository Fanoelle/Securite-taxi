import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { BaseService } from '../base/base.service';
import { formaterPlaque } from '../commun/format';

/** Ce que le passager reçoit après un scan. Rien d'autre ne sort d'ici. */
export interface ResultatScan {
  jeton: string;
  chauffeur: {
    nom: string;
    prenom: string;
    photoUrl: string | null;
    referenceLicence: string | null;
    inscritDepuis: string;
  };
  vehicule: {
    plaque: string;
    plaqueRecoupee: boolean;
    description: string | null;
  };
  statut: {
    code: string;
    libelle: string;
    verifie: boolean;
    autorite: string | null;
    verifieLe: string | null;
    avertissement: string | null;
  };
  ville: string;
}

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(private readonly base: BaseService) {}

  /**
   * Résolution d'un QR scanné.
   *
   * Passe par la vue v_scan_public, jamais par la table chauffeur :
   * c'est la garantie qu'aucune donnée sensible ne peut fuiter ici par
   * inadvertance. Voir docs/modele-donnees.md.
   */
  async resoudre(jeton: string): Promise<ResultatScan> {
    const ligne = await this.base.premier<any>(
      'SELECT * FROM v_scan_public WHERE jeton = $1',
      [jeton.trim().toUpperCase()],
    );

    if (!ligne) {
      this.logger.warn(`Scan d'un jeton inconnu ou révoqué : ${jeton}`);
      throw new NotFoundException({
        code: 'QR_INCONNU',
        message:
          'Ce code n\'est pas reconnu. Il peut être périmé, révoqué, ou ne pas ' +
          'provenir de la plateforme. Ne montez pas sans vérifier autrement.',
      });
    }

    return {
      jeton: ligne.jeton,
      chauffeur: {
        nom: ligne.nom,
        prenom: ligne.prenom,
        photoUrl: ligne.photo_chemin ? `/media/photos/${ligne.photo_chemin}` : null,
        referenceLicence: ligne.reference_licence,
        inscritDepuis: new Date(ligne.chauffeur_inscrit_le).getFullYear().toString(),
      },
      vehicule: {
        plaque: formaterPlaque(ligne.plaque),
        plaqueRecoupee: ligne.plaque_recoupee,
        description: [ligne.marque, ligne.modele, ligne.couleur]
          .filter(Boolean).join(' · ') || null,
      },
      statut: this.decrireStatut(ligne),
      ville: ligne.ville,
    };
  }

  /**
   * Le passager doit comprendre en une seconde le degré de confiance.
   * Les libellés sont volontairement directs.
   */
  private decrireStatut(ligne: any): ResultatScan['statut'] {
    const base = {
      autorite: ligne.autorite_nom ?? null,
      verifieLe: ligne.verifie_le
        ? new Date(ligne.verifie_le).toISOString().slice(0, 10)
        : null,
    };

    switch (ligne.statut) {
      case 'certifie':
        return { ...base, code: 'certifie', libelle: 'CERTIFIÉ',
                 verifie: true, avertissement: null };

      case 'verifie':
        return { ...base, code: 'verifie', libelle: 'VÉRIFIÉ',
                 verifie: true, avertissement: null };

      case 'declare':
      case 'en_examen':
        return {
          ...base, code: 'non_verifie', libelle: 'NON VÉRIFIÉ', verifie: false,
          avertissement:
            'Ses documents n\'ont pas encore été contrôlés. Ces informations ' +
            'sont déclarées par lui seul.',
        };

      case 'suspendu':
        return {
          ...base, code: 'suspendu', libelle: 'COMPTE SUSPENDU', verifie: false,
          avertissement:
            'Ce compte a été suspendu par l\'autorité. Il est fortement ' +
            'déconseillé de monter dans ce véhicule.',
        };

      case 'rejete':
        return {
          ...base, code: 'rejete', libelle: 'DOSSIER REJETÉ', verifie: false,
          avertissement:
            'Le dossier de ce chauffeur a été rejeté après contrôle.',
        };

      default:
        return {
          ...base, code: 'inconnu', libelle: 'STATUT INCONNU', verifie: false,
          avertissement: 'Statut indéterminé. Vérifiez par un autre moyen.',
        };
    }
  }
}
