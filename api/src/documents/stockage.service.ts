import { Injectable, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs, createReadStream } from 'fs';
import { join, resolve, extname } from 'path';
import { randomBytes, createHash } from 'crypto';

/**
 * Types acceptes. La liste est fermee : accepter un type arbitraire
 * reviendrait a heberger n'importe quoi sous un nom de piece d'identite.
 */
const TYPES_MIME = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['application/pdf', '.pdf'],
]);

/**
 * Signatures binaires. L'en-tete `Content-Type` est declaratif : il vient
 * du client et se falsifie. On verifie les premiers octets du fichier.
 */
const SIGNATURES: Array<{ mime: string; octets: number[]; decalage: number }> = [
  { mime: 'image/jpeg', octets: [0xff, 0xd8, 0xff], decalage: 0 },
  { mime: 'image/png', octets: [0x89, 0x50, 0x4e, 0x47], decalage: 0 },
  { mime: 'application/pdf', octets: [0x25, 0x50, 0x44, 0x46], decalage: 0 },
];

const TAILLE_MAX = 8 * 1024 * 1024;   // 8 Mo : une photo de CNI au telephone

/**
 * Stockage des pieces justificatives.
 *
 * Trois regles, toutes issues du fait qu'il s'agit de pieces d'identite :
 *
 *  1. Le nom du fichier est aleatoire, jamais derive du nom du chauffeur
 *     ni de son identifiant. Un repertoire lisible serait deja une fuite.
 *  2. Les fichiers vivent hors de l'arborescence servie par le serveur —
 *     ils ne sont accessibles que par une route authentifiee et tracee.
 *  3. Le type reel est verifie par la signature binaire, pas par
 *     l'en-tete declare par le client.
 */
@Injectable()
export class StockageService implements OnModuleInit {
  private readonly logger = new Logger(StockageService.name);
  private readonly racine: string;

  constructor(config: ConfigService) {
    this.racine = resolve(
      config.get<string>('STOCKAGE_DOCUMENTS', './stockage/documents'),
    );
  }

  async onModuleInit(): Promise<void> {
    // 0700 : lisible par le seul utilisateur qui fait tourner l'API.
    await fs.mkdir(this.racine, { recursive: true, mode: 0o700 });
    this.logger.log(`Stockage des documents : ${this.racine}`);
  }

  /**
   * Ecrit un fichier et renvoie son chemin relatif, a stocker en base.
   * Le chemin ne contient aucune information sur son proprietaire.
   */
  async enregistrer(fichier: Express.Multer.File): Promise<{
    chemin: string; taille: number; empreinte: string;
  }> {
    const mime = this.typeReel(fichier);
    const extension = TYPES_MIME.get(mime)!;

    // Repartition en sous-repertoires : un repertoire unique devient
    // ingerable au-dela de quelques milliers de fichiers.
    const nom = randomBytes(24).toString('hex') + extension;
    const sousRepertoire = nom.slice(0, 2);

    await fs.mkdir(join(this.racine, sousRepertoire), { recursive: true, mode: 0o700 });

    const chemin = join(sousRepertoire, nom);
    await fs.writeFile(join(this.racine, chemin), fichier.buffer, { mode: 0o600 });

    const empreinte = createHash('sha256').update(fichier.buffer).digest('hex');

    return { chemin, taille: fichier.size, empreinte };
  }

  /**
   * Flux de lecture d'un document.
   *
   * Le chemin vient de la base, mais il est revalide : une ecriture
   * malveillante en base ne doit pas permettre de lire `/etc/passwd`.
   */
  fluxLecture(chemin: string) {
    const absolu = resolve(this.racine, chemin);

    if (!absolu.startsWith(this.racine + '/')) {
      this.logger.error(`Tentative de lecture hors du stockage : ${chemin}`);
      throw new BadRequestException('Chemin de document invalide.');
    }

    return {
      flux: createReadStream(absolu),
      typeMime: this.mimeDepuisExtension(extname(absolu)),
    };
  }

  async supprimer(chemin: string): Promise<void> {
    const absolu = resolve(this.racine, chemin);
    if (!absolu.startsWith(this.racine + '/')) return;
    await fs.unlink(absolu).catch(() => undefined);
  }

  /**
   * Type reel du fichier, deduit de ses premiers octets.
   * Rejette tout ce qui n'est pas une image ou un PDF.
   */
  private typeReel(fichier: Express.Multer.File): string {
    if (!fichier?.buffer?.length) {
      throw new BadRequestException('Fichier vide.');
    }
    if (fichier.size > TAILLE_MAX) {
      throw new BadRequestException(
        `Fichier trop volumineux (${Math.round(fichier.size / 1024 / 1024)} Mo). ` +
        `Maximum ${TAILLE_MAX / 1024 / 1024} Mo.`,
      );
    }

    const correspondance = SIGNATURES.find(({ octets, decalage }) =>
      octets.every((octet, i) => fichier.buffer[decalage + i] === octet),
    );

    if (!correspondance) {
      throw new BadRequestException(
        'Format non reconnu. Envoyez une photo (JPEG ou PNG) ou un PDF.',
      );
    }

    // Incoherence entre le type declare et le contenu reel : on garde le
    // contenu reel, mais on le signale — c'est un indice utile.
    if (fichier.mimetype && fichier.mimetype !== correspondance.mime) {
      this.logger.warn(
        `Type declare « ${fichier.mimetype} » incoherent avec le contenu (${correspondance.mime}).`,
      );
    }

    return correspondance.mime;
  }

  private mimeDepuisExtension(extension: string): string {
    for (const [mime, ext] of TYPES_MIME) {
      if (ext === extension.toLowerCase()) return mime;
    }
    return 'application/octet-stream';
  }
}
