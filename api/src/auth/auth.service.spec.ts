import { Test } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { BaseService } from '../base/base.service';
import { SmsService } from '../sms/sms.service';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let base: { premier: jest.Mock; requete: jest.Mock; transaction: jest.Mock };
  let sms: { envoyer: jest.Mock };
  let client: { query: jest.Mock };

  beforeEach(async () => {
    client = { query: jest.fn() };
    base = {
      premier: jest.fn(),
      requete: jest.fn().mockResolvedValue([]),
      // La transaction exécute l'opération avec un faux client.
      transaction: jest.fn((operation) => operation(client)),
    };
    sms = { envoyer: jest.fn().mockResolvedValue('sms-1') };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: BaseService, useValue: base },
        { provide: SmsService, useValue: sms },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('jeton.jwt') } },
        { provide: ConfigService, useValue: { get: (_: string, d?: any) => d } },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('demanderOtp', () => {
    it('refuse un numero mal forme', async () => {
      await expect(service.demanderOtp('12345')).rejects.toThrow(BadRequestException);
    });

    it('envoie un SMS contenant un code a six chiffres', async () => {
      base.premier
        .mockResolvedValueOnce(null)                          // pas d'OTP recent
        .mockResolvedValueOnce({ id: 'c-1', actif: true });   // compte existant

      await service.demanderOtp('699452108');

      expect(sms.envoyer).toHaveBeenCalledTimes(1);
      const envoi = sms.envoyer.mock.calls[0][0];
      expect(envoi.telephone).toBe('+237699452108');
      expect(envoi.categorie).toBe('otp');
      expect(envoi.contenu).toMatch(/\b\d{6}\b/);
    });

    it('ne stocke jamais le code en clair', async () => {
      base.premier
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'c-1', actif: true });

      await service.demanderOtp('699452108');

      const code = sms.envoyer.mock.calls[0][0].contenu.match(/\b(\d{6})\b/)[1];
      const insertion = client.query.mock.calls.find((c) => /INSERT INTO code_otp/.test(c[0]));
      expect(insertion[1][1]).not.toBe(code);
      expect(await bcrypt.compare(code, insertion[1][1])).toBe(true);
    });

    it('repond pareil pour un numero inconnu, sans envoyer de SMS', async () => {
      base.premier
        .mockResolvedValueOnce(null)   // pas d'OTP recent
        .mockResolvedValueOnce(null);  // compte inexistant

      const reponse = await service.demanderOtp('699452108');

      expect(sms.envoyer).not.toHaveBeenCalled();
      expect(reponse.message).toMatch(/Si ce numéro est enregistré/);
    });

    it('n\'envoie rien a un compte desactive', async () => {
      base.premier
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'c-1', actif: false });

      await service.demanderOtp('699452108');
      expect(sms.envoyer).not.toHaveBeenCalled();
    });

    it('refuse un renvoi trop rapproche', async () => {
      base.premier.mockResolvedValueOnce({ cree_le: new Date() });
      await expect(service.demanderOtp('699452108')).rejects.toThrow(BadRequestException);
      expect(sms.envoyer).not.toHaveBeenCalled();
    });
  });

  describe('verifierOtp', () => {
    const preparerOtp = async (code: string, tentatives = 0) => {
      const hash = await bcrypt.hash(code, 10);
      client.query.mockImplementation(async (sql: string) => {
        if (/FROM code_otp/.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'otp-1', code_hash: hash, tentatives }] };
        }
        if (/FROM compte WHERE telephone/.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'c-1' }] };
        }
        return { rowCount: 0, rows: [] };
      });
    };

    it('delivre un jeton pour un code correct', async () => {
      await preparerOtp('482915');
      base.premier
        .mockResolvedValueOnce({ id: 'c-1', role: 'chauffeur', autorite_id: null })  // delivrerJeton
        .mockResolvedValueOnce({                                                     // profil
          id: 'c-1', telephone: '+237699452108', role: 'chauffeur',
          autorite_id: null, telephone_verifie: true, chauffeur_id: null,
        });

      const r = await service.verifierOtp('699452108', '482915');
      expect(r.jeton).toBe('jeton.jwt');
      expect(r.profil.role).toBe('chauffeur');
    });

    it('marque le code consomme apres usage', async () => {
      await preparerOtp('482915');
      base.premier
        .mockResolvedValueOnce({ id: 'c-1', role: 'chauffeur', autorite_id: null })
        .mockResolvedValueOnce({ id: 'c-1', telephone: '+237699452108', role: 'chauffeur' });

      await service.verifierOtp('699452108', '482915');
      expect(client.query.mock.calls.some(
        (c) => /consomme_le = now\(\)/.test(c[0]) && c[1]?.[0] === 'otp-1',
      )).toBe(true);
    });

    it('rejette un code incorrect et compte la tentative', async () => {
      await preparerOtp('482915');
      await expect(service.verifierOtp('699452108', '000000'))
        .rejects.toThrow(UnauthorizedException);
      expect(client.query.mock.calls.some(
        (c) => /tentatives = tentatives \+ 1/.test(c[0]),
      )).toBe(true);
    });

    it('brule le code au-dela du quota de tentatives', async () => {
      await preparerOtp('482915', 5);
      await expect(service.verifierOtp('699452108', '482915'))
        .rejects.toThrow(/Trop de tentatives/);
    });

    it('rejette quand aucun code valide n\'existe', async () => {
      client.query.mockResolvedValue({ rowCount: 0, rows: [] });
      await expect(service.verifierOtp('699452108', '482915'))
        .rejects.toThrow(/expiré ou inexistant/);
    });
  });

  describe('connexionMotDePasse', () => {
    it('delivre un jeton pour un mot de passe correct', async () => {
      const hash = await bcrypt.hash('MotDePasse123', 12);
      base.premier
        .mockResolvedValueOnce({ id: 'a-1', mot_de_passe_hash: hash, role: 'agent', actif: true })
        .mockResolvedValueOnce({ id: 'a-1', role: 'agent', autorite_id: 'aut-1' })
        .mockResolvedValueOnce({
          id: 'a-1', telephone: '+237699452108', role: 'agent',
          autorite_id: 'aut-1', autorite_nom: 'Commune de Douala V',
        });

      const r = await service.connexionMotDePasse('699452108', 'MotDePasse123');
      expect(r.jeton).toBe('jeton.jwt');
      expect(r.profil.autorite).toEqual({ id: 'aut-1', nom: 'Commune de Douala V' });
    });

    it('donne le meme message qu\'un compte inconnu ou un mot de passe faux', async () => {
      const hash = await bcrypt.hash('MotDePasse123', 12);

      base.premier.mockResolvedValueOnce(null);
      const inconnu = await service.connexionMotDePasse('699452108', 'peu importe')
        .catch((e) => e.message);

      base.premier.mockResolvedValueOnce({
        id: 'a-1', mot_de_passe_hash: hash, role: 'agent', actif: true,
      });
      const faux = await service.connexionMotDePasse('699452108', 'MauvaisMotDePasse')
        .catch((e) => e.message);

      expect(inconnu).toBe(faux);
    });

    it('refuse un compte sans mot de passe defini', async () => {
      base.premier.mockResolvedValueOnce({
        id: 'c-1', mot_de_passe_hash: null, role: 'chauffeur', actif: true,
      });
      await expect(service.connexionMotDePasse('699452108', 'MotDePasse123'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('refuse un compte desactive', async () => {
      const hash = await bcrypt.hash('MotDePasse123', 12);
      base.premier.mockResolvedValueOnce({
        id: 'a-1', mot_de_passe_hash: hash, role: 'agent', actif: false,
      });
      await expect(service.connexionMotDePasse('699452108', 'MotDePasse123'))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  describe('creerAgent', () => {
    it('refuse une autorite inconnue', async () => {
      base.premier.mockResolvedValueOnce(null);
      await expect(service.creerAgent(
        { telephone: '699452108', autoriteId: 'aut-x' }, 'admin-1',
      )).rejects.toThrow(BadRequestException);
    });

    it('refuse un numero deja enregistre', async () => {
      base.premier.mockResolvedValueOnce({ id: 'aut-1' });
      client.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      await expect(service.creerAgent(
        { telephone: '699452108', autoriteId: 'aut-1' }, 'admin-1',
      )).rejects.toThrow(ConflictException);
    });

    it('trace la creation dans le journal d\'audit', async () => {
      base.premier.mockResolvedValueOnce({ id: 'aut-1' });
      client.query
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })          // numero libre
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'a-9' }] })  // insertion compte
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });         // audit

      const r = await service.creerAgent(
        { telephone: '699452108', autoriteId: 'aut-1', motDePasse: 'MotDePasseAgent123' },
        'admin-1',
      );

      expect(r.role).toBe('agent');
      const audit = client.query.mock.calls.find((c) => /journal_audit/.test(c[0]));
      expect(audit[1][0]).toBe('admin-1');
      expect(audit[1][1]).toBe('a-9');
    });
  });
});
