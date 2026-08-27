import {
  Injectable, BadRequestException, NotFoundException, Logger, OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs, createReadStream } from 'fs';
import { join, resolve, extname } from 'path';
import { randomBytes } from 'crypto';

import { BaseService } from '../base/base.service';
import { CompteAuthentifie } from '../auth/jwt.strategie';

/**
 * Photo de profil du chauffeur.
 *
 * Elle est stockée à part des pièces justificatives, et c'est le point
 * essentiel : une CNI est un secret que seul un agent consulte, avec une
 * trace d'audit ; la photo de profil est faite pour être vue par chaque
 * passager qui monte dans le véhicule.
 *
 * Confondre les deux serait dangereux dans un sens comme dans l'autre —
 * servir une CNI publiquement, ou exiger une authentification pour
 * afficher un visage que le passager doit justement pouvoir comparer.
 *
 * Elle reste néanmoins servie par une route applicative, jamais par un
 * répertoire statique : le nom du fichier est aléatoire et ne dit rien
 * de son propriétaire.
 */

const TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
]);

const SIGNATURES: Array<{ mime: string; octets: number[] }> = [
  { mime: 'image/jpeg', octets: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', octets: [0x89, 0x50, 0x4e, 0x47] },
];

/** 4 Mo : un portrait pris au téléphone, pas un scan haute définition. */
const TAILLE_MAX = 4 * 1024 * 1024;

@Injectable()
export class PhotoService implements OnModuleInit {
  private readonly logger = new Logger(PhotoService.name);
  private readonly racine: string;

  constructor(
    private readonly base: BaseService,
    config: ConfigService,
  ) {
    this.racine = resolve(
      config.get<string>('STOCKAGE_PHOTOS', './stockage/photos'),
    );
  }

  async onModuleInit(): Promise<void> {
    // 0755 ici, contrairement aux pièces : ces fichiers sont destinés à
    // être servis publiquement, il n'y a rien à cacher dans le répertoire.
    await fs.mkdir(this.racine, { recursive: true, mode: 0o755 });
    this.logger.log(`Stockage des photos : ${this.racine}`);
  }

  /**
   * Remplace la photo du chauffeur connecté.
   *
   * L'ancienne est supprimée : garder l'historique des visages d'une
   * personne n'a aucune utilité pour le produit, et en conserver plus
   * que nécessaire est un risque en soi.
   */
  async remplacer(compte: CompteAuthentifie, fichier: Express.Multer.File) {
    const mime = this.typeReel(fichier);

    const chauffeur = await this.base.premier<{ id: string; photo_chemin: string | null }>(
      `SELECT id, photo_chemin FROM chauffeur
        WHERE compte_id = $1 AND supprime_le IS NULL`,
      [compte.id],
    );
    if (!chauffeur) {
      throw new NotFoundException('Aucun dossier chauffeur pour ce compte.');
    }

    const nom = randomBytes(24).toString('hex') + TYPES.get(mime)!;
    const sousRepertoire = nom.slice(0, 2);
    await fs.mkdir(join(this.racine, sousRepertoire), { recursive: true, mode: 0o755 });

    const chemin = join(sousRepertoire, nom);
    await fs.writeFile(join(this.racine, chemin), fichier.buffer, { mode: 0o644 });

    const ancienne = chauffeur.photo_chemin;
    await this.base.requete(
      'UPDATE chauffeur SET photo_chemin = $2 WHERE id = $1',
      [chauffeur.id, chemin],
    );
    if (ancienne) await this.supprimer(ancienne);

    this.logger.log(`Photo mise à jour pour le chauffeur ${chauffeur.id}`);
    return { photoUrl: `/media/photos/${chemin}`, taille: fichier.size };
  }

  /**
   * Flux de lecture. Le chemin vient de l'URL : il est revalidé pour
   * qu'aucune remontée de répertoire ne sorte du stockage.
   */
  fluxLecture(chemin: string) {
    const absolu = resolve(this.racine, chemin);

    if (!absolu.startsWith(this.racine + '/')) {
      this.logger.error(`Tentative de lecture hors du stockage : ${chemin}`);
      throw new BadRequestException('Chemin de photo invalide.');
    }

    const extension = extname(absolu).toLowerCase();
    const typeMime = extension === '.png' ? 'image/png'
      : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
      : null;

    // Servir une extension inattendue reviendrait à laisser le stockage
    // héberger autre chose que des photos.
    if (!typeMime) throw new BadRequestException('Type de photo invalide.');

    return { flux: createReadStream(absolu), typeMime };
  }

  private async supprimer(chemin: string): Promise<void> {
    const absolu = resolve(this.racine, chemin);
    if (!absolu.startsWith(this.racine + '/')) return;
    await fs.unlink(absolu).catch(() => undefined);
  }

  /** Type réel, déduit des premiers octets — l'en-tête client se falsifie. */
  private typeReel(fichier: Express.Multer.File): string {
    if (!fichier?.buffer?.length) {
      throw new BadRequestException('Fichier vide.');
    }
    if (fichier.size > TAILLE_MAX) {
      throw new BadRequestException(
        `Photo trop volumineuse (${Math.round(fichier.size / 1024 / 1024)} Mo). ` +
        `Maximum ${TAILLE_MAX / 1024 / 1024} Mo.`,
      );
    }

    const correspondance = SIGNATURES.find(({ octets }) =>
      octets.every((octet, i) => fichier.buffer[i] === octet),
    );

    // Un PDF est accepté comme pièce justificative, jamais comme portrait.
    if (!correspondance) {
      throw new BadRequestException(
        'Format non reconnu. Envoyez une photo au format JPEG ou PNG.',
      );
    }

    if (fichier.mimetype && fichier.mimetype !== correspondance.mime) {
      this.logger.warn(
        `Type declaré « ${fichier.mimetype} » incohérent avec le contenu ` +
        `(${correspondance.mime}).`,
      );
    }

    return correspondance.mime;
  }
}
