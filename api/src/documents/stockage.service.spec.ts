import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StockageService } from './stockage.service';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';

describe('StockageService', () => {
  let service: StockageService;
  let racine: string;

  const fichierDe = (octets: number[], options: Partial<Express.Multer.File> = {}) => ({
    buffer: Buffer.from(octets),
    size: options.size ?? octets.length,
    mimetype: options.mimetype ?? 'image/jpeg',
    originalname: 'piece.jpg',
  } as Express.Multer.File);

  const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00];
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d];
  const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

  beforeEach(async () => {
    racine = mkdtempSync(join(tmpdir(), 'securitaxi-test-'));
    service = new StockageService(
      { get: () => racine } as unknown as ConfigService,
    );
    await service.onModuleInit();
  });

  afterEach(() => rmSync(racine, { recursive: true, force: true }));

  describe('types acceptes', () => {
    it.each([
      { nom: 'JPEG', octets: JPEG, extension: '.jpg' },
      { nom: 'PNG', octets: PNG, extension: '.png' },
      { nom: 'PDF', octets: PDF, extension: '.pdf' },
    ])('accepte un $nom et lui donne l\'extension $extension', async ({ octets, extension }) => {
      const r = await service.enregistrer(fichierDe(octets));
      expect(r.chemin.endsWith(extension)).toBe(true);
    });

    it('rejette un contenu qui n\'est ni image ni PDF', async () => {
      await expect(service.enregistrer(fichierDe([0x4d, 0x5a, 0x90, 0x00])))
        .rejects.toThrow(/Format non reconnu/);
    });

    it('se fie au contenu, pas au type declare par le client', async () => {
      // Un executable annonce comme une image : le contenu fait foi.
      await expect(service.enregistrer(
        fichierDe([0x4d, 0x5a, 0x90], { mimetype: 'image/jpeg' }),
      )).rejects.toThrow(BadRequestException);

      // Et inversement : un vrai JPEG mal declare passe quand meme.
      const r = await service.enregistrer(
        fichierDe(JPEG, { mimetype: 'application/octet-stream' }),
      );
      expect(r.chemin).toBeDefined();
    });

    it('rejette un fichier vide', async () => {
      await expect(service.enregistrer(fichierDe([]))).rejects.toThrow(/vide/);
    });

    it('rejette un fichier trop volumineux', async () => {
      await expect(service.enregistrer(
        fichierDe(JPEG, { size: 20 * 1024 * 1024 }),
      )).rejects.toThrow(/volumineux/);
    });
  });

  describe('nommage', () => {
    it('ne derive jamais le nom du fichier de son origine', async () => {
      const r = await service.enregistrer(fichierDe(JPEG));
      expect(r.chemin).not.toContain('piece');
      expect(r.chemin).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{48}\.jpg$/);
    });

    it('donne un nom different a deux fichiers identiques', async () => {
      const a = await service.enregistrer(fichierDe(JPEG));
      const b = await service.enregistrer(fichierDe(JPEG));
      expect(a.chemin).not.toBe(b.chemin);
      expect(a.empreinte).toBe(b.empreinte);   // meme contenu, meme empreinte
    });

    it('ecrit reellement le fichier sur le disque', async () => {
      const r = await service.enregistrer(fichierDe(JPEG));
      const contenu = await fs.readFile(join(racine, r.chemin));
      expect([...contenu]).toEqual(JPEG);
    });

    it('restreint les droits du fichier a son proprietaire', async () => {
      const r = await service.enregistrer(fichierDe(JPEG));
      const stat = await fs.stat(join(racine, r.chemin));
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe('lecture', () => {
    it('refuse un chemin qui sort du stockage', () => {
      expect(() => service.fluxLecture('../../etc/passwd'))
        .toThrow(BadRequestException);
      expect(() => service.fluxLecture('/etc/passwd'))
        .toThrow(BadRequestException);
    });

    it('deduit le type MIME de l\'extension', async () => {
      const r = await service.enregistrer(fichierDe(PDF));
      const { flux, typeMime } = service.fluxLecture(r.chemin);
      // L'ouverture est asynchrone : sans ecouteur d'erreur, l'echec
      // arrive apres la fin du cas et Jest l'impute au test suivant.
      flux.on('error', () => undefined);
      flux.destroy();
      expect(typeMime).toBe('application/pdf');
    });
  });

  describe('suppression', () => {
    it('efface le fichier', async () => {
      const r = await service.enregistrer(fichierDe(JPEG));
      await service.supprimer(r.chemin);
      await expect(fs.access(join(racine, r.chemin))).rejects.toThrow();
    });

    it('n\'efface rien en dehors du stockage', async () => {
      // Un fichier voisin de la racine, que le service ne doit jamais
      // pouvoir atteindre meme avec un chemin remontant.
      const voisin = join(racine, '..', 'temoin-hors-stockage.txt');
      await fs.writeFile(voisin, 'ne pas effacer');
      try {
        await service.supprimer('../temoin-hors-stockage.txt');
        await service.supprimer('/etc/passwd');
        await expect(fs.readFile(voisin, 'utf8')).resolves.toBe('ne pas effacer');
      } finally {
        await fs.unlink(voisin).catch(() => undefined);
      }
    });

    it('n\'efface pas non plus par un chemin absolu', async () => {
      const r = await service.enregistrer(fichierDe(JPEG));
      await service.supprimer('/etc/hosts');
      // Le fichier legitime est toujours la : rien n'a ete efface a tort.
      await expect(fs.access(join(racine, r.chemin))).resolves.toBeUndefined();
    });
  });
});
