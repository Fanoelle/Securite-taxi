import { Test } from '@nestjs/testing';
import {
  NotFoundException, ForbiddenException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { StockageService } from './stockage.service';
import { BaseService } from '../base/base.service';
import { CompteAuthentifie } from '../auth/jwt.strategie';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let base: { premier: jest.Mock; requete: jest.Mock; transaction: jest.Mock };
  let stockage: { enregistrer: jest.Mock; supprimer: jest.Mock; fluxLecture: jest.Mock };
  let client: { query: jest.Mock };

  const chauffeur: CompteAuthentifie = { id: 'c-1', role: 'chauffeur', autoriteId: null };
  const agent: CompteAuthentifie = { id: 'a-1', role: 'agent', autoriteId: 'aut-1' };
  const admin: CompteAuthentifie = { id: 's-1', role: 'superadmin', autoriteId: null };

  const fichier = {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    size: 4, mimetype: 'image/jpeg', originalname: 'cni.jpg',
  } as Express.Multer.File;

  beforeEach(async () => {
    client = { query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    base = {
      premier: jest.fn(),
      requete: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((operation) => operation(client)),
    };
    stockage = {
      enregistrer: jest.fn().mockResolvedValue({
        chemin: 'ab/abcdef.jpg', taille: 4, empreinte: 'deadbeef',
      }),
      supprimer: jest.fn().mockResolvedValue(undefined),
      fluxLecture: jest.fn().mockReturnValue({ flux: 'FLUX', typeMime: 'image/jpeg' }),
    };

    const module = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: BaseService, useValue: base },
        { provide: StockageService, useValue: stockage },
      ],
    }).compile();
    service = module.get(DocumentsService);
  });

  describe('televerser', () => {
    it('enregistre la piece et rend l\'etat du dossier', async () => {
      base.premier.mockResolvedValueOnce({ id: 'ch-1', statut: 'declare' });
      base.requete.mockResolvedValueOnce([{ type: 'cni_recto', verdict: null }]);

      const r = await service.televerser(chauffeur, { type: 'cni_recto' }, fichier);

      expect(stockage.enregistrer).toHaveBeenCalled();
      expect(r.type).toBe('cni_recto');
      expect(r.dossier.manquants).toContain('permis');
    });

    it('remplace la piece precedente et efface l\'ancien fichier', async () => {
      base.premier.mockResolvedValueOnce({ id: 'ch-1', statut: 'declare' });
      client.query.mockResolvedValueOnce({
        rowCount: 1, rows: [{ chemin: 'cd/ancien.jpg' }],
      });

      await service.televerser(chauffeur, { type: 'cni_recto' }, fichier);

      expect(stockage.supprimer).toHaveBeenCalledWith('cd/ancien.jpg');
      const insertion = client.query.mock.calls.find((c) => /INSERT INTO document/.test(c[0]));
      expect(insertion[0]).toContain('verdict = NULL');   // verdict remis a zero
    });

    it('efface le fichier si l\'ecriture en base echoue', async () => {
      base.premier.mockResolvedValueOnce({ id: 'ch-1', statut: 'declare' });
      base.transaction.mockRejectedValueOnce(new Error('base indisponible'));

      await expect(service.televerser(chauffeur, { type: 'cni_recto' }, fichier))
        .rejects.toThrow('base indisponible');
      expect(stockage.supprimer).toHaveBeenCalledWith('ab/abcdef.jpg');
    });

    it('exige une date d\'expiration pour un permis', async () => {
      base.premier.mockResolvedValueOnce({ id: 'ch-1', statut: 'declare' });
      await expect(service.televerser(chauffeur, { type: 'permis' }, fichier))
        .rejects.toThrow(BadRequestException);
      expect(stockage.enregistrer).not.toHaveBeenCalled();
    });

    it('refuse une piece deja expiree', async () => {
      base.premier.mockResolvedValueOnce({ id: 'ch-1', statut: 'declare' });
      await expect(service.televerser(
        chauffeur, { type: 'permis', dateExpiration: '2020-01-01' }, fichier,
      )).rejects.toThrow(/expiré/);
    });

    it('refuse de modifier un dossier deja valide', async () => {
      base.premier.mockResolvedValueOnce({ id: 'ch-1', statut: 'verifie' });
      await expect(service.televerser(chauffeur, { type: 'cni_recto' }, fichier))
        .rejects.toThrow(ConflictException);
    });

    it('refuse un compte sans dossier chauffeur', async () => {
      base.premier.mockResolvedValueOnce(null);
      await expect(service.televerser(agent, { type: 'cni_recto' }, fichier))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('etat du dossier', () => {
    it('signale les pieces manquantes, a refaire et expirees', async () => {
      base.premier.mockResolvedValueOnce({ id: 'ch-1', statut: 'en_examen' });
      base.requete.mockResolvedValueOnce([
        { type: 'cni_recto', verdict: 'lisible', date_expiration: null },
        { type: 'cni_verso', verdict: 'illisible', date_expiration: null },
        { type: 'permis', verdict: 'lisible', date_expiration: '2020-01-01' },
      ]);

      const r = await service.monDossier(chauffeur);

      expect(r.manquants).toEqual(['carte_grise']);
      expect(r.aRefaire).toEqual(['cni_verso']);
      expect(r.expires).toEqual(['permis']);
      expect(r.complet).toBe(false);
      expect(r.examinable).toBe(false);
    });

    it('reconnait un dossier complet', async () => {
      base.premier.mockResolvedValueOnce({ id: 'ch-1', statut: 'en_examen' });
      base.requete.mockResolvedValueOnce(
        ['cni_recto', 'cni_verso', 'permis', 'carte_grise'].map((type) => ({
          type, verdict: 'lisible', date_expiration: null,
        })),
      );

      const r = await service.monDossier(chauffeur);
      expect(r.complet).toBe(true);
      expect(r.manquants).toHaveLength(0);
    });
  });

  describe('fichier', () => {
    const document = {
      id: 'd-1', chemin: 'ab/x.jpg', type: 'cni_recto',
      chauffeur_id: 'ch-1', compte_id: 'c-1', autorite_id: 'aut-1',
    };

    it('laisse le chauffeur lire ses propres pieces', async () => {
      base.premier.mockResolvedValueOnce(document);
      const r = await service.fichier('d-1', chauffeur);
      expect(r.typeMime).toBe('image/jpeg');
    });

    it('trace chaque consultation', async () => {
      base.premier.mockResolvedValueOnce(document);
      await service.fichier('d-1', chauffeur);

      const audit = base.requete.mock.calls.find((c) => /journal_audit/.test(c[0]));
      expect(audit[1][0]).toBe('c-1');
      expect(audit[0]).toContain('document.consulte');
    });

    it('refuse un agent d\'une autre ville', async () => {
      base.premier
        .mockResolvedValueOnce(document)
        .mockResolvedValueOnce(null);        // exigerAccesAgent : aucun rattachement
      await expect(service.fichier('d-1', agent)).rejects.toThrow(ForbiddenException);
    });

    it('laisse passer un agent de la bonne ville', async () => {
      base.premier
        .mockResolvedValueOnce(document)
        .mockResolvedValueOnce({ '?column?': 1 });
      await expect(service.fichier('d-1', agent)).resolves.toBeDefined();
    });

    it('refuse un document inexistant', async () => {
      base.premier.mockResolvedValueOnce(null);
      await expect(service.fichier('d-x', admin)).rejects.toThrow(NotFoundException);
    });
  });

  describe('examiner', () => {
    it('exige un commentaire sur un verdict negatif', async () => {
      await expect(service.examiner('d-1', agent, { verdict: 'illisible' }))
        .rejects.toThrow(/commentaire est obligatoire/);
      expect(base.transaction).not.toHaveBeenCalled();
    });

    it('accepte un verdict positif sans commentaire', async () => {
      base.premier
        .mockResolvedValueOnce({ id: 'd-1', chauffeur_id: 'ch-1', autorite_id: 'aut-1' })
        .mockResolvedValueOnce({ '?column?': 1 });
      base.requete.mockResolvedValueOnce([]);

      const r = await service.examiner('d-1', agent, { verdict: 'lisible' });
      expect(r.verdict).toBe('lisible');
    });

    it('fait passer le dossier en examen', async () => {
      base.premier
        .mockResolvedValueOnce({ id: 'd-1', chauffeur_id: 'ch-1', autorite_id: 'aut-1' })
        .mockResolvedValueOnce({ '?column?': 1 });

      await service.examiner('d-1', agent, { verdict: 'lisible' });
      expect(client.query.mock.calls.some(
        (c) => /statut = 'en_examen'/.test(c[0]),
      )).toBe(true);
    });

    it('trace l\'examen', async () => {
      base.premier
        .mockResolvedValueOnce({ id: 'd-1', chauffeur_id: 'ch-1', autorite_id: 'aut-1' })
        .mockResolvedValueOnce({ '?column?': 1 });

      await service.examiner('d-1', agent, { verdict: 'non_conforme', commentaire: 'floue' });
      const audit = client.query.mock.calls.find((c) => /journal_audit/.test(c[0]));
      expect(audit[1][0]).toBe('a-1');
    });

    it('refuse un agent d\'une autre autorite', async () => {
      base.premier
        .mockResolvedValueOnce({ id: 'd-1', chauffeur_id: 'ch-1', autorite_id: 'aut-2' })
        .mockResolvedValueOnce(null);
      await expect(service.examiner('d-1', agent, { verdict: 'lisible' }))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('listerPourAgent', () => {
    it('n\'expose jamais le chemin de stockage', async () => {
      base.premier.mockResolvedValueOnce({ '?column?': 1 });
      base.requete.mockResolvedValueOnce([{
        id: 'd-1', type: 'cni_recto', verdict: 'lisible', commentaire: null,
        date_expiration: null, cree_le: new Date(), examine_le: new Date(),
      }]);

      const r = await service.listerPourAgent('ch-1', agent);
      expect(JSON.stringify(r)).not.toContain('chemin');
      expect(r[0].url).toBe('/api/documents/d-1/fichier');
    });
  });
});
