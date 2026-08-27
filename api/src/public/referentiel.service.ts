import { Injectable } from '@nestjs/common';
import { BaseService } from '../base/base.service';

/**
 * Le référentiel géographique, tel qu'un formulaire en a besoin.
 *
 * L'inscription exige un `villeId` — un UUID. Personne ne peut le
 * deviner : sans cette liste, aucun écran d'inscription n'est possible
 * sans lire la base à la main.
 */
@Injectable()
export class ReferentielService {
  constructor(private readonly base: BaseService) {}

  async villes() {
    return this.base.requete<{ id: string; nom: string; region: string }>(
      `SELECT v.id, v.nom, r.nom AS region
         FROM ville v
         JOIN region r ON r.code = v.region_code
        ORDER BY v.nom`,
      [],
    );
  }
}
