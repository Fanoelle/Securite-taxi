import { Test } from '@nestjs/testing';
import {
  NotFoundException, ForbiddenException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrajetsService } from './trajets.service';
import { BaseService } from '../base/base.service';
import { SmsService } from '../sms/sms.service';

describe('TrajetsService', () => {
  let service: TrajetsService;
  let base: { premier: jest.Mock; requete: jest.Mock; transaction: jest.Mock };
  let sms: { envoyer: jest.Mock };
  let client: { query: jest.Mock };

  const SESSION = 'session-passager-abcdef123456';

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
        TrajetsService,
        { provide: BaseService, useValue: base },
        { provide: SmsService, useValue: sms },
        { provide: ConfigService, useValue: { get: (_: string, d?: any) => d } },
      ],
    }).compile();
    service = module.get(TrajetsService);
  });

  describe('demarrer', () => {
    const qr = {
      code_qr_id: 'qr-1', chauffeur_id: 'ch-1',
      statut: 'verifie', vehicule_id: 'v-1',
    };

    it('refuse un QR inconnu', async () => {
      base.premier.mockResolvedValue(null);
      await expect(service.demarrer(SESSION, { jetonQr: 'INCONNU' }))
        .rejects.toThrow(NotFoundException);
    });

    it('fige le statut du chauffeur au moment du scan', async () => {
      base.premier.mockResolvedValue({ ...qr, statut: 'suspendu' });
      client.query
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // aucun trajet en cours
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // jeton libre
        .mockResolvedValueOnce({ rowCount: 1, rows: [{
          id: 't-1', jeton_suivi: 'ABC123XYZ4', demarre_le: new Date(), etat: 'en_cours',
        }] });

      const r = await service.demarrer(SESSION, { jetonQr: 'X98QD6R' });

      expect(r.statutChauffeurAuScan).toBe('suspendu');
      const insertion = client.query.mock.calls.find((c) => /INSERT INTO trajet/.test(c[0]));
      expect(insertion[1]).toContain('suspendu');
    });

    it('refuse un second trajet simultane', async () => {
      base.premier.mockResolvedValue(qr);
      client.query.mockResolvedValueOnce({
        rowCount: 1, rows: [{ jeton_suivi: 'DEJA123456' }],
      });
      await expect(service.demarrer(SESSION, { jetonQr: 'X98QD6R' }))
        .rejects.toThrow(ConflictException);
    });

    it('normalise le jeton avant la recherche', async () => {
      base.premier.mockResolvedValue(null);
      await service.demarrer(SESSION, { jetonQr: '  x98qd6r ' }).catch(() => {});
      expect(base.premier.mock.calls[0][1]).toEqual(['X98QD6R']);
    });
  });

  describe('enregistrerPositions', () => {
    const enCours = {
      id: 't-1', etat: 'en_cours', session_passager: SESSION, demarre_le: new Date(),
    };

    it('conserve un horodatage plausible', async () => {
      base.premier.mockResolvedValue(enCours);
      const mesureLe = new Date(Date.now() - 60_000).toISOString();

      const r = await service.enregistrerPositions(SESSION, 'ABC123XYZ4', {
        positions: [{ latitude: 4.05, longitude: 9.76, mesureLe }],
      });

      expect(r.horodatagesCorriges).toBe(0);
      const envoye = JSON.parse(base.requete.mock.calls[0][1][1]);
      expect(envoye[0].mesureLe).toBe(new Date(mesureLe).toISOString());
    });

    it('redate une position dont l\'horloge derive de plusieurs jours', async () => {
      base.premier.mockResolvedValue(enCours);
      const absurde = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();

      const r = await service.enregistrerPositions(SESSION, 'ABC123XYZ4', {
        positions: [{ latitude: 4.05, longitude: 9.76, mesureLe: absurde }],
      });

      expect(r.horodatagesCorriges).toBe(1);
      const envoye = JSON.parse(base.requete.mock.calls[0][1][1]);
      expect(new Date(envoye[0].mesureLe).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('accepte un lot accumule hors ligne', async () => {
      base.premier.mockResolvedValue(enCours);
      const positions = Array.from({ length: 200 }, (_, i) => ({
        latitude: 4.05, longitude: 9.76,
        mesureLe: new Date(Date.now() - i * 10_000).toISOString(),
      }));

      const r = await service.enregistrerPositions(SESSION, 'ABC123XYZ4', { positions });

      expect(r.enregistrees).toBe(200);
      expect(base.requete).toHaveBeenCalledTimes(1);  // un seul aller-retour
    });

    it('accepte encore des positions pendant une alerte', async () => {
      base.premier.mockResolvedValue({ ...enCours, etat: 'alerte' });
      await expect(service.enregistrerPositions(SESSION, 'ABC123XYZ4', {
        positions: [{ latitude: 4.05, longitude: 9.76, mesureLe: new Date().toISOString() }],
      })).resolves.toBeDefined();
    });

    it('refuse des positions sur un trajet termine', async () => {
      base.premier.mockResolvedValue({ ...enCours, etat: 'termine' });
      await expect(service.enregistrerPositions(SESSION, 'ABC123XYZ4', {
        positions: [{ latitude: 4.05, longitude: 9.76, mesureLe: new Date().toISOString() }],
      })).rejects.toThrow(ConflictException);
    });

    it('refuse d\'agir sur le trajet d\'une autre session', async () => {
      base.premier.mockResolvedValue({ ...enCours, session_passager: 'quelqu-un-dautre-123456' });
      await expect(service.enregistrerPositions(SESSION, 'ABC123XYZ4', {
        positions: [{ latitude: 4.05, longitude: 9.76, mesureLe: new Date().toISOString() }],
      })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('partager', () => {
    const enCours = {
      id: 't-1', etat: 'en_cours', session_passager: SESSION, demarre_le: new Date(),
    };
    const details = {
      nom: 'NGONO', prenom: 'Paul', statut: 'verifie', plaque: 'LT452AB',
    };

    it('envoie un SMS par proche, avec le lien de suivi', async () => {
      base.premier.mockResolvedValueOnce(enCours).mockResolvedValueOnce(details);
      client.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'p-1' }] });

      const r = await service.partager(SESSION, 'ABC123XYZ4', {
        contacts: [
          { nom: 'Maman', telephone: '699452108' },
          { nom: 'Frere', telephone: '677889900' },
        ],
      });

      expect(sms.envoyer).toHaveBeenCalledTimes(2);
      expect(r.partages).toHaveLength(2);
      const message = sms.envoyer.mock.calls[0][0].contenu;
      expect(message).toContain('ABC123XYZ4');
      expect(message).toContain('LT 452 AB');
    });

    it('refuse un numero mal forme sans rien enregistrer', async () => {
      base.premier.mockResolvedValueOnce(enCours).mockResolvedValueOnce(details);
      await expect(service.partager(SESSION, 'ABC123XYZ4', {
        contacts: [{ nom: 'Maman', telephone: '12345' }],
      })).rejects.toThrow(BadRequestException);
      expect(sms.envoyer).not.toHaveBeenCalled();
    });

    it('ne memorise les contacts que si demande', async () => {
      base.premier.mockResolvedValueOnce(enCours).mockResolvedValueOnce(details);
      client.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'p-1' }] });

      await service.partager(SESSION, 'ABC123XYZ4', {
        contacts: [{ nom: 'Maman', telephone: '699452108' }],
      });
      expect(client.query.mock.calls.some((c) => /contact_confiance/.test(c[0]))).toBe(false);

      client.query.mockClear();
      base.premier.mockResolvedValueOnce(enCours).mockResolvedValueOnce(details);
      await service.partager(SESSION, 'ABC123XYZ4', {
        contacts: [{ nom: 'Maman', telephone: '699452108' }], memoriser: true,
      });
      expect(client.query.mock.calls.some((c) => /contact_confiance/.test(c[0]))).toBe(true);
    });

    it('refuse de partager un trajet termine', async () => {
      base.premier.mockResolvedValueOnce({ ...enCours, etat: 'termine' });
      await expect(service.partager(SESSION, 'ABC123XYZ4', {
        contacts: [{ nom: 'Maman', telephone: '699452108' }],
      })).rejects.toThrow(ConflictException);
    });
  });

  describe('terminer', () => {
    const enCours = {
      id: 't-1', etat: 'en_cours', session_passager: SESSION, demarre_le: new Date(),
    };

    it('calcule la duree du trajet', async () => {
      const demarre = new Date(Date.now() - 25 * 60_000);
      base.premier
        .mockResolvedValueOnce(enCours)
        .mockResolvedValueOnce({ demarre_le: demarre, termine_le: new Date() });

      const r = await service.terminer(SESSION, 'ABC123XYZ4', {});
      expect(r.etat).toBe('termine');
      expect(r.dureeMinutes).toBe(25);
    });

    it('refuse de terminer tant qu\'une alerte est active', async () => {
      base.premier.mockResolvedValueOnce({ ...enCours, etat: 'alerte' });
      await expect(service.terminer(SESSION, 'ABC123XYZ4', {}))
        .rejects.toThrow(/alerte/i);
    });

    it('refuse de terminer deux fois', async () => {
      base.premier.mockResolvedValueOnce({ ...enCours, etat: 'termine' });
      await expect(service.terminer(SESSION, 'ABC123XYZ4', {}))
        .rejects.toThrow(ConflictException);
    });
  });

  describe('suivrePublic', () => {
    it('n\'expose pas la session du passager', async () => {
      base.premier
        .mockResolvedValueOnce({
          id: 't-1', jeton_suivi: 'ABC123XYZ4', etat: 'en_cours',
          demarre_le: new Date(), termine_le: null,
          statut_chauffeur_au_scan: 'verifie',
          nom: 'NGONO', prenom: 'Paul', photo_chemin: null,
          reference_licence: '0001-DLA',
          plaque: 'LT452AB', marque: 'Toyota', modele: 'Corolla', couleur: 'Jaune',
          ville: 'Douala',
        })
        .mockResolvedValueOnce(null);

      const r = await service.suivrePublic('ABC123XYZ4');
      expect(JSON.stringify(r)).not.toContain('session');
      expect(r.vehicule.plaque).toBe('LT 452 AB');
    });

    it('indique la fraicheur de la derniere position', async () => {
      base.premier
        .mockResolvedValueOnce({
          id: 't-1', jeton_suivi: 'ABC123XYZ4', etat: 'en_cours',
          demarre_le: new Date(), statut_chauffeur_au_scan: 'verifie',
          nom: 'N', prenom: 'P', plaque: 'LT452AB', ville: 'Douala',
        })
        .mockResolvedValueOnce({
          latitude: '4.051056', longitude: '9.767869',
          mesure_le: new Date(Date.now() - 45_000), recu_le: new Date(),
        });

      const r = await service.suivrePublic('ABC123XYZ4');
      expect(r.position!.latitude).toBe(4.051056);
      expect(r.position!.fraicheurSecondes).toBeGreaterThanOrEqual(44);
      expect(r.position!.fraicheurSecondes).toBeLessThanOrEqual(46);
    });

    it('refuse un lien de suivi inconnu', async () => {
      base.premier.mockResolvedValue(null);
      await expect(service.suivrePublic('INCONNU')).rejects.toThrow(NotFoundException);
    });
  });
});
