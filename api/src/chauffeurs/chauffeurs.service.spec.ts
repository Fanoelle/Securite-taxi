import { Test } from '@nestjs/testing';
import {
  ConflictException, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { ChauffeursService } from './chauffeurs.service';
import { BaseService } from '../base/base.service';

describe('ChauffeursService — validation de dossier', () => {
  let service: ChauffeursService;
  let base: { premier: jest.Mock; requete: jest.Mock; transaction: jest.Mock };
  let client: { query: jest.Mock };

  const REQUIS = ['cni_recto', 'cni_verso', 'permis', 'carte_grise'];

  const dossierExistant = {
    id: 'ch-1', statut: 'en_examen', reference_licence: null,
    ville: 'Douala', region: 'LT',
  };

  /**
   * Le service enchaine plusieurs requetes dans sa transaction ; on les
   * route par motif plutot que par ordre d'appel, plus robuste.
   */
  const monter = (options: {
    dossier?: any;
    pieces?: Array<{ type: string; verdict: string | null }>;
    qrExistant?: string;
  } = {}) => {
    const pieces = options.pieces ?? REQUIS.map((type) => ({ type, verdict: 'lisible' }));

    client.query.mockImplementation(async (sql: string) => {
      if (/FROM chauffeur c/.test(sql) && /FOR UPDATE/.test(sql)) {
        const dossier = 'dossier' in options ? options.dossier : dossierExistant;
        return dossier ? { rowCount: 1, rows: [dossier] } : { rowCount: 0, rows: [] };
      }
      if (/FROM document/.test(sql)) {
        return { rowCount: pieces.length, rows: pieces };
      }
      if (/count\(\*\) \+ 1/.test(sql)) {
        return { rowCount: 1, rows: [{ n: 7 }] };
      }
      if (/FROM code_qr/.test(sql)) {
        return options.qrExistant
          ? { rowCount: 1, rows: [{ jeton: options.qrExistant }] }
          : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });
  };

  beforeEach(async () => {
    client = { query: jest.fn() };
    base = {
      premier: jest.fn(),
      requete: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((operation) => operation(client)),
    };
    const module = await Test.createTestingModule({
      providers: [ChauffeursService, { provide: BaseService, useValue: base }],
    }).compile();
    service = module.get(ChauffeursService);
  });

  describe('exigence de dossier complet', () => {
    it('valide un dossier dont toutes les pieces sont lisibles', async () => {
      monter();
      const r = await service.validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'verifie' });

      expect(r.statut).toBe('verifie');
      expect(r.referenceLicence).toBe('0007-DLA');
      expect(r.jetonQr).toBeDefined();
    });

    it('refuse un dossier auquel il manque des pieces', async () => {
      monter({ pieces: [{ type: 'cni_recto', verdict: 'lisible' }] });

      await expect(
        service.validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'verifie' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'DOSSIER_INCOMPLET' }),
      });
    });

    it('nomme les pieces manquantes', async () => {
      monter({ pieces: [
        { type: 'cni_recto', verdict: 'lisible' },
        { type: 'cni_verso', verdict: 'lisible' },
      ]});

      const erreur = await service
        .validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'verifie' })
        .catch((e) => e);
      expect(erreur.response.manquantes).toEqual(['permis', 'carte_grise']);
    });

    it('refuse tant qu\'une piece requise n\'est pas examinee', async () => {
      monter({ pieces: REQUIS.map((type) => ({
        type, verdict: type === 'permis' ? null : 'lisible',
      }))});

      const erreur = await service
        .validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'verifie' })
        .catch((e) => e);
      expect(erreur.response.code).toBe('PIECES_NON_EXAMINEES');
      expect(erreur.response.enAttente).toEqual(['permis']);
    });

    it('refuse si une piece a ete jugee illisible', async () => {
      monter({ pieces: REQUIS.map((type) => ({
        type, verdict: type === 'cni_verso' ? 'illisible' : 'lisible',
      }))});

      const erreur = await service
        .validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'verifie' })
        .catch((e) => e);
      expect(erreur.response.enAttente).toEqual(['cni_verso']);
    });

    it('n\'exige aucune piece pour un rejet', async () => {
      monter({ pieces: [] });
      const r = await service.validerDossier('ch-1', 'a-1', 'aut-1', {
        decision: 'rejete', motif: 'Dossier vide depuis trois mois',
      });
      expect(r.statut).toBe('rejete');
    });

    it('n\'emet aucun QR quand la validation echoue', async () => {
      monter({ pieces: [] });
      await service.validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'verifie' })
        .catch(() => undefined);
      expect(client.query.mock.calls.some((c) => /INSERT INTO code_qr/.test(c[0]))).toBe(false);
    });
  });

  describe('regles generales', () => {
    it('exige un motif pour rejeter', async () => {
      await expect(service.validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'rejete' }))
        .rejects.toThrow(BadRequestException);
    });

    it('refuse un chauffeur inconnu', async () => {
      monter({ dossier: null });
      await expect(service.validerDossier('ch-x', 'a-1', 'aut-1', { decision: 'verifie' }))
        .rejects.toThrow(NotFoundException);
    });

    it('refuse de revalider un dossier deja valide', async () => {
      monter({ dossier: { ...dossierExistant, statut: 'verifie' } });
      await expect(service.validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'verifie' }))
        .rejects.toThrow(ConflictException);
    });

    it('reutilise le QR existant plutot que d\'en emettre un second', async () => {
      monter({ qrExistant: 'DEJA123' });
      const r = await service.validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'verifie' });

      expect(r.jetonQr).toBe('DEJA123');
      expect(client.query.mock.calls.some((c) => /INSERT INTO code_qr/.test(c[0]))).toBe(false);
    });

    it('revoque le QR lors d\'un rejet', async () => {
      monter();
      await service.validerDossier('ch-1', 'a-1', 'aut-1', {
        decision: 'rejete', motif: 'Permis falsifie',
      });
      expect(client.query.mock.calls.some(
        (c) => /UPDATE code_qr SET actif = false/.test(c[0]),
      )).toBe(true);
    });

    it('impute la validation a l\'agent dans le journal d\'audit', async () => {
      monter();
      await service.validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'verifie' });
      const audit = client.query.mock.calls.find((c) => /journal_audit/.test(c[0]));
      expect(audit[1][0]).toBe('a-1');
    });

    it('derive la reference de licence de la region', async () => {
      monter({ dossier: { ...dossierExistant, region: 'CE', ville: 'Yaounde' } });
      const r = await service.validerDossier('ch-1', 'a-1', 'aut-1', { decision: 'verifie' });
      expect(r.referenceLicence).toBe('0007-YDE');
    });
  });

  /**
   * Un dossier validé engage l'autorité qui le prononce, et cette
   * autorité est territoriale. La file doit donc être cloisonnée par la
   * ville de l'agent — dérivée de son jeton, jamais d'un paramètre que
   * le client contrôle.
   */
  describe('fileValidation — cloisonnement par ville', () => {
    it('filtre sur l\'autorite du jeton, jamais sur un parametre client', async () => {
      base.requete.mockResolvedValue([]);

      await service.fileValidation({ role: 'agent', autoriteId: 'aut-yaounde' });

      const [sql, params] = base.requete.mock.calls[0];
      expect(sql).toContain('a.id = $1');
      expect(params).toEqual(['aut-yaounde']);
    });

    it('ne rend jamais la file entiere a un agent', async () => {
      base.requete.mockResolvedValue([]);

      await service.fileValidation({ role: 'agent', autoriteId: 'aut-yaounde' });

      // Sans clause de restriction, l'agent verrait les dossiers des
      // autres villes — c'est precisement le defaut corrige ici.
      const [sql] = base.requete.mock.calls[0];
      expect(sql).toMatch(/WHERE/);
    });

    it('refuse un agent sans autorite de rattachement', async () => {
      await expect(
        service.fileValidation({ role: 'agent', autoriteId: null }),
      ).rejects.toThrow(ForbiddenException);
      expect(base.requete).not.toHaveBeenCalled();
    });

    it('laisse le superadmin voir toutes les villes', async () => {
      base.requete.mockResolvedValue([]);

      await service.fileValidation({ role: 'superadmin', autoriteId: null });

      const [sql, params] = base.requete.mock.calls[0];
      expect(sql).not.toContain('a.id = $1');
      expect(params).toBeUndefined();
    });
  });
});
