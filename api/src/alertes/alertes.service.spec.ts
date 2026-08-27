import { Test } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlertesService } from './alertes.service';
import { BaseService } from '../base/base.service';
import { SmsService } from '../sms/sms.service';
import { CompteAuthentifie } from '../auth/jwt.strategie';

describe('AlertesService', () => {
  let service: AlertesService;
  let base: { premier: jest.Mock; requete: jest.Mock; transaction: jest.Mock };
  let sms: { envoyer: jest.Mock };
  let client: { query: jest.Mock };

  const SESSION = 'session-passager-abcdef123456';
  const trajetEnCours = { id: 't-1', etat: 'en_cours', session_passager: SESSION };
  const contexte = {
    nom: 'NGONO', prenom: 'Paul', reference_licence: '0001-DLA',
    plaque: 'LT452AB', marque: 'Toyota', modele: 'Corolla', couleur: 'Jaune',
    ville: 'Douala', autorite_id: 'aut-1',
  };

  const agent: CompteAuthentifie = { id: 'a-1', role: 'agent', autoriteId: 'aut-1' };

  beforeEach(async () => {
    client = { query: jest.fn() };
    base = {
      premier: jest.fn(),
      requete: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((operation) => operation(client)),
    };
    sms = { envoyer: jest.fn().mockResolvedValue('sms-1') };

    const module = await Test.createTestingModule({
      providers: [
        AlertesService,
        { provide: BaseService, useValue: base },
        { provide: SmsService, useValue: sms },
        { provide: ConfigService, useValue: { get: (_: string, d?: any) => d } },
      ],
    }).compile();
    service = module.get(AlertesService);
  });

  /** Deux proches partages, autorite qui ne recoit pas les alertes. */
  const scenarioNormal = (options: { autoriteRecoit?: boolean; proches?: number } = {}) => {
    const nbProches = options.proches ?? 2;
    client.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO alerte \(/.test(sql)) {
        return { rowCount: 1, rows: [{ id: 'al-1', declenchee_le: new Date() }] };
      }
      if (/FROM partage_trajet/.test(sql)) {
        return {
          rowCount: nbProches,
          rows: Array.from({ length: nbProches }, (_, i) => ({
            nom_destinataire: `Proche${i}`, telephone: `+23769945210${i}`,
          })),
        };
      }
      if (/INSERT INTO alerte_destinataire/.test(sql)) {
        return { rowCount: 1, rows: [{ id: `d-${Math.random()}` }] };
      }
      if (/FROM autorite/.test(sql)) {
        return options.autoriteRecoit
          ? { rowCount: 1, rows: [{ id: 'aut-1', nom: 'Commune', telephone: '+237222000000' }] }
          : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });
  };

  describe('declencher', () => {
    it('enregistre l\'alerte et previent les proches', async () => {
      base.premier
        .mockResolvedValueOnce(trajetEnCours)   // trajet
        .mockResolvedValueOnce(null)            // pas d'alerte active
        .mockResolvedValueOnce(contexte)        // contexte
        .mockResolvedValueOnce(null);           // pas de position enregistree
      scenarioNormal();

      const r = await service.declencher(SESSION, 'ABC123XYZ4', {
        latitude: 4.05, longitude: 9.76,
      });

      expect(r.etat).toBe('active');
      expect(r.deja).toBe(false);
      expect(r.destinatairesPrevenus).toBe(2);
      expect(sms.envoyer).toHaveBeenCalledTimes(2);
      expect(sms.envoyer.mock.calls[0][0].categorie).toBe('alerte');
    });

    it('bascule le trajet en etat alerte', async () => {
      base.premier
        .mockResolvedValueOnce(trajetEnCours).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(contexte).mockResolvedValueOnce(null);
      scenarioNormal();

      await service.declencher(SESSION, 'ABC123XYZ4', {});
      expect(client.query.mock.calls.some(
        (c) => /UPDATE trajet SET etat = 'alerte'/.test(c[0]),
      )).toBe(true);
    });

    it('le SMS contient la plaque et un lien de position', async () => {
      base.premier
        .mockResolvedValueOnce(trajetEnCours).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(contexte).mockResolvedValueOnce(null);
      scenarioNormal();

      await service.declencher(SESSION, 'ABC123XYZ4', { latitude: 4.05, longitude: 9.76 });

      const message = sms.envoyer.mock.calls[0][0].contenu;
      expect(message).toContain('LT 452 AB');
      expect(message).toContain('maps.google.com/?q=4.05,9.76');
      expect(message).toContain('ABC123XYZ4');
    });

    it('retombe sur la derniere position connue', async () => {
      base.premier
        .mockResolvedValueOnce(trajetEnCours).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(contexte)
        .mockResolvedValueOnce({ latitude: '4.061', longitude: '9.771' });
      scenarioNormal();

      const r = await service.declencher(SESSION, 'ABC123XYZ4', {});
      expect(r.position).toEqual({ latitude: 4.061, longitude: 9.771 });
    });

    it('un second appui ne cree pas de doublon', async () => {
      base.premier
        .mockResolvedValueOnce(trajetEnCours)
        .mockResolvedValueOnce({ id: 'al-1', declenchee_le: new Date() });

      const r = await service.declencher(SESSION, 'ABC123XYZ4', {});
      expect(r.deja).toBe(true);
      expect(r.id).toBe('al-1');
      expect(sms.envoyer).not.toHaveBeenCalled();
    });

    it('ne previent l\'autorite que si elle s\'y est engagee', async () => {
      base.premier
        .mockResolvedValueOnce(trajetEnCours).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(contexte).mockResolvedValueOnce(null);
      scenarioNormal({ autoriteRecoit: false });
      const sans = await service.declencher(SESSION, 'ABC123XYZ4', {});
      expect(sans.destinatairesPrevenus).toBe(2);

      sms.envoyer.mockClear();
      base.premier
        .mockResolvedValueOnce(trajetEnCours).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(contexte).mockResolvedValueOnce(null);
      scenarioNormal({ autoriteRecoit: true });
      const avec = await service.declencher(SESSION, 'ABC123XYZ4', {});
      expect(avec.destinatairesPrevenus).toBe(3);
    });

    it('reste enregistree meme sans aucun proche', async () => {
      base.premier
        .mockResolvedValueOnce(trajetEnCours).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(contexte).mockResolvedValueOnce(null);
      scenarioNormal({ proches: 0 });

      const r = await service.declencher(SESSION, 'ABC123XYZ4', {});
      expect(r.etat).toBe('active');
      expect(r.destinatairesPrevenus).toBe(0);
      expect(r.message).toMatch(/enregistrée/);
    });

    it('refuse le trajet d\'une autre session', async () => {
      base.premier.mockResolvedValueOnce({ ...trajetEnCours, session_passager: 'autre-session-xyz' });
      await expect(service.declencher(SESSION, 'ABC123XYZ4', {}))
        .rejects.toThrow(ForbiddenException);
    });

    it('refuse un trajet deja termine', async () => {
      base.premier.mockResolvedValueOnce({ ...trajetEnCours, etat: 'termine' });
      await expect(service.declencher(SESSION, 'ABC123XYZ4', {}))
        .rejects.toThrow(ConflictException);
    });
  });

  describe('annuler', () => {
    it('rassure tous ceux qui avaient ete alertes', async () => {
      base.premier
        .mockResolvedValueOnce({ ...trajetEnCours, etat: 'alerte' })
        .mockResolvedValueOnce({ id: 'al-1' });
      client.query.mockImplementation(async (sql: string) => {
        if (/FROM alerte_destinataire/.test(sql)) {
          return { rowCount: 2, rows: [
            { telephone: '+237699452100' }, { telephone: '+237699452101' },
          ]};
        }
        return { rowCount: 1, rows: [] };
      });

      const r = await service.annuler(SESSION, 'ABC123XYZ4', {});

      expect(r.etat).toBe('annulee');
      expect(r.destinatairesInformes).toBe(2);
      expect(sms.envoyer).toHaveBeenCalledTimes(2);
      expect(sms.envoyer.mock.calls[0][0].categorie).toBe('annulation');
      expect(sms.envoyer.mock.calls[0][0].contenu).toMatch(/fausse alerte/i);
    });

    it('rend le trajet a son cours normal', async () => {
      base.premier
        .mockResolvedValueOnce({ ...trajetEnCours, etat: 'alerte' })
        .mockResolvedValueOnce({ id: 'al-1' });
      client.query.mockResolvedValue({ rowCount: 0, rows: [] });

      await service.annuler(SESSION, 'ABC123XYZ4', {});
      expect(client.query.mock.calls.some(
        (c) => /UPDATE trajet SET etat = 'en_cours'/.test(c[0]),
      )).toBe(true);
    });

    it('n\'exige aucun motif', async () => {
      base.premier
        .mockResolvedValueOnce({ ...trajetEnCours, etat: 'alerte' })
        .mockResolvedValueOnce({ id: 'al-1' });
      client.query.mockResolvedValue({ rowCount: 0, rows: [] });

      await expect(service.annuler(SESSION, 'ABC123XYZ4', {})).resolves.toBeDefined();
      const maj = client.query.mock.calls.find((c) => /etat = 'annulee'/.test(c[0]));
      expect(maj[1][1]).toBe('Annulée par le passager');
    });

    it('conserve l\'alerte annulee plutot que de l\'effacer', async () => {
      base.premier
        .mockResolvedValueOnce({ ...trajetEnCours, etat: 'alerte' })
        .mockResolvedValueOnce({ id: 'al-1' });
      client.query.mockResolvedValue({ rowCount: 0, rows: [] });

      await service.annuler(SESSION, 'ABC123XYZ4', {});
      expect(client.query.mock.calls.some((c) => /DELETE FROM alerte/i.test(c[0]))).toBe(false);
    });

    it('refuse s\'il n\'y a pas d\'alerte active', async () => {
      base.premier
        .mockResolvedValueOnce(trajetEnCours)
        .mockResolvedValueOnce(null);
      await expect(service.annuler(SESSION, 'ABC123XYZ4', {}))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('clore', () => {
    it('exige que l\'agent releve de la bonne autorite', async () => {
      base.premier.mockResolvedValueOnce({ id: 'al-1', etat: 'active', autorite_id: 'aut-2' });
      await expect(service.clore('al-1', agent, { note: 'traite' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('laisse le superadmin clore n\'importe quelle alerte', async () => {
      base.premier.mockResolvedValueOnce({ id: 'al-1', etat: 'active', autorite_id: 'aut-9' });
      client.query.mockResolvedValue({ rowCount: 1, rows: [] });
      const admin: CompteAuthentifie = { id: 's-1', role: 'superadmin', autoriteId: null };
      await expect(service.clore('al-1', admin, { note: 'traite' })).resolves.toBeDefined();
    });

    it('trace la cloture dans le journal d\'audit', async () => {
      base.premier.mockResolvedValueOnce({ id: 'al-1', etat: 'active', autorite_id: 'aut-1' });
      client.query.mockResolvedValue({ rowCount: 1, rows: [] });

      await service.clore('al-1', agent, { note: 'Passager contacte' });
      const audit = client.query.mock.calls.find((c) => /journal_audit/.test(c[0]));
      expect(audit[1][0]).toBe('a-1');
      expect(audit[1][1]).toBe('al-1');
    });

    it('refuse de clore une alerte deja annulee', async () => {
      base.premier.mockResolvedValueOnce({ id: 'al-1', etat: 'annulee', autorite_id: 'aut-1' });
      await expect(service.clore('al-1', agent, { note: 'x' }))
        .rejects.toThrow(ConflictException);
    });
  });

  describe('lister', () => {
    it('cloisonne un agent a son autorite', async () => {
      await service.lister(agent, 'active');
      const [sql, parametres] = base.requete.mock.calls[0];
      expect(sql).toContain('c.autorite_id = $2');
      expect(parametres).toEqual(['active', 'aut-1']);
    });

    it('ne cloisonne pas le superadmin', async () => {
      await service.lister({ id: 's-1', role: 'superadmin', autoriteId: null }, 'active');
      const [sql, parametres] = base.requete.mock.calls[0];
      expect(sql).not.toContain('autorite_id = $2');
      expect(parametres).toEqual(['active']);
    });
  });
});
