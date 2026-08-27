import { Test } from '@nestjs/testing';
import {
  NotFoundException, ForbiddenException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { SignalementsService } from './signalements.service';
import { BaseService } from '../base/base.service';
import { SmsService } from '../sms/sms.service';
import { CompteAuthentifie } from '../auth/jwt.strategie';

describe('SignalementsService', () => {
  let service: SignalementsService;
  let base: { premier: jest.Mock; requete: jest.Mock; transaction: jest.Mock };
  let sms: { envoyer: jest.Mock };
  let client: { query: jest.Mock };

  const SESSION = 'session-passager-abcdef123456';
  const agent: CompteAuthentifie = { id: 'a-1', role: 'agent', autoriteId: 'aut-1' };
  const admin: CompteAuthentifie = { id: 's-1', role: 'superadmin', autoriteId: null };

  const trajet = {
    id: 't-1', chauffeur_id: 'ch-1', code_qr_id: 'qr-1',
    session_passager: SESSION,
  };

  beforeEach(async () => {
    client = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
    base = {
      premier: jest.fn(),
      requete: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((operation) => operation(client)),
    };
    sms = { envoyer: jest.fn().mockResolvedValue('sms-1') };

    const module = await Test.createTestingModule({
      providers: [
        SignalementsService,
        { provide: BaseService, useValue: base },
        { provide: SmsService, useValue: sms },
      ],
    }).compile();
    service = module.get(SignalementsService);
  });

  describe('creer', () => {
    it('rattache le signalement au chauffeur du trajet', async () => {
      base.premier
        .mockResolvedValueOnce(trajet)
        .mockResolvedValueOnce({ id: 'sig-1', etat: 'ouvert', cree_le: new Date() });

      const r = await service.creer(SESSION, {
        motif: 'plaque_differente', jetonSuivi: 'ABC123XYZ4',
      });

      expect(r.etat).toBe('ouvert');
      const insertion = base.premier.mock.calls[1][1];
      expect(insertion[0]).toBe('t-1');    // trajet
      expect(insertion[1]).toBe('ch-1');   // chauffeur
    });

    it('exige un recit pour un motif de comportement', async () => {
      await expect(service.creer(SESSION, { motif: 'comportement' }))
        .rejects.toThrow(BadRequestException);
      await expect(service.creer(SESSION, { motif: 'autre', description: '  ' }))
        .rejects.toThrow(/description est nécessaire/);
    });

    it('accepte un motif factuel sans description', async () => {
      base.premier
        .mockResolvedValueOnce(trajet)
        .mockResolvedValueOnce({ id: 'sig-1', etat: 'ouvert', cree_le: new Date() });

      await expect(service.creer(SESSION, {
        motif: 'photo_differente', jetonSuivi: 'ABC123XYZ4',
      })).resolves.toBeDefined();
    });

    it('refuse de signaler le trajet d\'une autre session', async () => {
      base.premier.mockResolvedValueOnce({ ...trajet, session_passager: 'autre-session' });
      await expect(service.creer(SESSION, {
        motif: 'comportement', description: 'x', jetonSuivi: 'ABC123XYZ4',
      })).rejects.toThrow(ForbiddenException);
    });

    it('accepte un signalement portant sur un QR seul', async () => {
      base.premier
        .mockResolvedValueOnce({ id: 'qr-9', chauffeur_id: 'ch-9' })
        .mockResolvedValueOnce({ id: 'sig-2', etat: 'ouvert', cree_le: new Date() });

      const r = await service.creer(SESSION, { motif: 'qr_suspect', jetonQr: 'X98QD6R' });
      expect(r.etat).toBe('ouvert');
    });

    it('traite a part un QR totalement inconnu', async () => {
      base.premier.mockResolvedValueOnce(null);   // QR absent de la base

      const r = await service.creer(SESSION, { motif: 'qr_suspect', jetonQr: 'FAUX123' }) as any;

      expect(r.qrInconnu).toBe(true);
      expect(r.message).toMatch(/ne provient pas de la plateforme/);
      expect(r.message).toMatch(/117/);           // numero de la police
      const trace = base.requete.mock.calls[0];
      expect(trace[0]).toContain('signalement.qr_inconnu');
    });

    it('refuse un signalement sans cible', async () => {
      await expect(service.creer(SESSION, { motif: 'photo_differente' }))
        .rejects.toThrow(/Précisez le trajet/);
    });

    it('renvoie le numero d\'urgence dans sa reponse', async () => {
      base.premier
        .mockResolvedValueOnce(trajet)
        .mockResolvedValueOnce({ id: 'sig-1', etat: 'ouvert', cree_le: new Date() });
      const r = await service.creer(SESSION, {
        motif: 'plaque_differente', jetonSuivi: 'ABC123XYZ4',
      });
      expect(r.message).toContain('117');
    });
  });

  describe('traiter', () => {
    const ouvert = {
      id: 'sig-1', etat: 'ouvert', chauffeur_id: 'ch-1',
      motif: 'comportement', autorite_id: 'aut-1', ville_id: 'v-1',
    };

    it('exige une note pour conclure', async () => {
      for (const etat of ['fonde', 'non_fonde', 'clos'] as const) {
        await expect(service.traiter('sig-1', agent, { etat }))
          .rejects.toThrow(/note de traitement est obligatoire/);
      }
      expect(base.transaction).not.toHaveBeenCalled();
    });

    it('n\'exige pas de note pour une simple mise en examen', async () => {
      base.premier.mockResolvedValueOnce(ouvert).mockResolvedValueOnce({ '?column?': 1 });
      await expect(service.traiter('sig-1', agent, { etat: 'en_examen' }))
        .resolves.toBeDefined();
    });

    it('suspend le chauffeur et revoque son QR', async () => {
      base.premier.mockResolvedValueOnce(ouvert).mockResolvedValueOnce({ '?column?': 1 });

      const r = await service.traiter('sig-1', agent, {
        etat: 'fonde', note: 'Faits confirmés par deux témoins',
        suspendreChauffeur: true,
      });

      expect(r.chauffeurSuspendu).toBe(true);
      expect(client.query.mock.calls.some((c) => /statut = 'suspendu'/.test(c[0]))).toBe(true);
      expect(client.query.mock.calls.some(
        (c) => /UPDATE code_qr SET actif = false/.test(c[0]),
      )).toBe(true);
    });

    it('refuse une suspension sans conclusion de bien-fonde', async () => {
      await expect(service.traiter('sig-1', agent, {
        etat: 'non_fonde', note: 'x', suspendreChauffeur: true,
      })).rejects.toThrow(/jugé fondé/);
    });

    it('refuse de suspendre quand aucun chauffeur n\'est identifie', async () => {
      base.premier
        .mockResolvedValueOnce({ ...ouvert, chauffeur_id: null })
        .mockResolvedValueOnce({ '?column?': 1 });
      await expect(service.traiter('sig-1', agent, {
        etat: 'fonde', note: 'x', suspendreChauffeur: true,
      })).rejects.toThrow(/aucun chauffeur identifié/);
    });

    it('ne suspend pas quand ce n\'est pas demande', async () => {
      base.premier.mockResolvedValueOnce(ouvert).mockResolvedValueOnce({ '?column?': 1 });
      const r = await service.traiter('sig-1', agent, { etat: 'fonde', note: 'Avertissement' });
      expect(r.chauffeurSuspendu).toBe(false);
      expect(client.query.mock.calls.some((c) => /statut = 'suspendu'/.test(c[0]))).toBe(false);
    });

    it('refuse de retraiter un signalement deja conclu', async () => {
      base.premier.mockResolvedValueOnce({ ...ouvert, etat: 'fonde' })
        .mockResolvedValueOnce({ '?column?': 1 });
      await expect(service.traiter('sig-1', agent, { etat: 'clos', note: 'x' }))
        .rejects.toThrow(ConflictException);
    });

    it('refuse un agent d\'une autre ville', async () => {
      base.premier.mockResolvedValueOnce(ouvert).mockResolvedValueOnce(null);
      await expect(service.traiter('sig-1', agent, { etat: 'clos', note: 'x' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('laisse tout agent traiter un signalement sans chauffeur', async () => {
      base.premier.mockResolvedValueOnce({ ...ouvert, chauffeur_id: null, ville_id: null });
      await expect(service.traiter('sig-1', agent, { etat: 'clos', note: 'Faux code' }))
        .resolves.toBeDefined();
    });

    it('trace la suspension distinctement dans l\'audit', async () => {
      base.premier.mockResolvedValueOnce(ouvert).mockResolvedValueOnce({ '?column?': 1 });
      await service.traiter('sig-1', agent, {
        etat: 'fonde', note: 'x', suspendreChauffeur: true,
      });
      const audit = client.query.mock.calls.find((c) => /journal_audit/.test(c[0]));
      expect(audit[1][1]).toBe('signalement.fonde_avec_suspension');
    });
  });

  describe('objets perdus', () => {
    const trajetComplet = {
      id: 't-1', session_passager: SESSION, chauffeur_id: 'ch-1',
      nom: 'NGONO', prenom: 'Paul', telephone_chauffeur: '+237699452108',
      plaque: 'LT452AB',
    };

    it('previent le chauffeur par SMS', async () => {
      base.premier
        .mockResolvedValueOnce(trajetComplet)
        .mockResolvedValueOnce({ id: 'o-1', etat: 'declare', cree_le: new Date() });

      await service.declarerObjetPerdu(SESSION, 'ABC123XYZ4', {
        description: 'Sac a dos noir',
      });

      expect(sms.envoyer).toHaveBeenCalledTimes(1);
      const envoi = sms.envoyer.mock.calls[0][0];
      expect(envoi.telephone).toBe('+237699452108');
      expect(envoi.contenu).toContain('LT 452 AB');
      expect(envoi.contenu).toContain('Sac a dos noir');
    });

    it('accepte une declaration sans numero de rappel', async () => {
      base.premier
        .mockResolvedValueOnce(trajetComplet)
        .mockResolvedValueOnce({ id: 'o-1', etat: 'declare', cree_le: new Date() });

      await service.declarerObjetPerdu(SESSION, 'ABC123XYZ4', { description: 'Parapluie' });
      expect(base.premier.mock.calls[1][1][2]).toBeNull();
    });

    it('refuse un numero de rappel mal forme', async () => {
      base.premier.mockResolvedValueOnce(trajetComplet);
      await expect(service.declarerObjetPerdu(SESSION, 'ABC123XYZ4', {
        description: 'Sac', telephoneContact: '123',
      })).rejects.toThrow(BadRequestException);
    });

    it('refuse le trajet d\'une autre session', async () => {
      base.premier.mockResolvedValueOnce({ ...trajetComplet, session_passager: 'autre' });
      await expect(service.declarerObjetPerdu(SESSION, 'ABC123XYZ4', { description: 'Sac' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('rappelle le passager quand l\'objet est retrouve', async () => {
      base.premier.mockResolvedValueOnce({
        id: 'o-1', etat: 'declare', telephone_contact: '+237699111111',
        compte_id: 'c-1', plaque: 'LT452AB',
      });

      await service.repondreObjetPerdu('o-1', { id: 'c-1', role: 'chauffeur', autoriteId: null }, {
        etat: 'retrouve', reponse: 'Je le depose au commissariat',
      });

      expect(sms.envoyer).toHaveBeenCalledTimes(1);
      expect(sms.envoyer.mock.calls[0][0].contenu).toMatch(/retrouve/);
    });

    it('n\'envoie pas de SMS pour un simple accuse de reception', async () => {
      base.premier.mockResolvedValueOnce({
        id: 'o-1', etat: 'declare', telephone_contact: '+237699111111',
        compte_id: 'c-1', plaque: 'LT452AB',
      });
      await service.repondreObjetPerdu('o-1', { id: 'c-1', role: 'chauffeur', autoriteId: null }, {
        etat: 'vu_chauffeur',
      });
      expect(sms.envoyer).not.toHaveBeenCalled();
    });

    it('n\'envoie rien si le passager n\'a pas laisse de numero', async () => {
      base.premier.mockResolvedValueOnce({
        id: 'o-1', etat: 'declare', telephone_contact: null,
        compte_id: 'c-1', plaque: 'LT452AB',
      });
      await service.repondreObjetPerdu('o-1', { id: 'c-1', role: 'chauffeur', autoriteId: null }, {
        etat: 'non_retrouve',
      });
      expect(sms.envoyer).not.toHaveBeenCalled();
    });

    it('refuse a un chauffeur de repondre sur le trajet d\'un autre', async () => {
      base.premier.mockResolvedValueOnce({
        id: 'o-1', etat: 'declare', telephone_contact: null,
        compte_id: 'c-99', plaque: 'LT452AB',
      });
      await expect(service.repondreObjetPerdu('o-1',
        { id: 'c-1', role: 'chauffeur', autoriteId: null }, { etat: 'retrouve' },
      )).rejects.toThrow(ForbiddenException);
    });
  });

  describe('lister', () => {
    it('cloisonne un agent a son autorite', async () => {
      await service.lister(agent, 'ouvert');
      const [sql, parametres] = base.requete.mock.calls[0];
      expect(sql).toContain('c.autorite_id = $2');
      expect(parametres).toEqual(['ouvert', 'aut-1']);
    });

    it('ne cloisonne pas le superadmin', async () => {
      await service.lister(admin, 'ouvert');
      expect(base.requete.mock.calls[0][1]).toEqual(['ouvert']);
    });
  });
});
