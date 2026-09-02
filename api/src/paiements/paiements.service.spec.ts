import { Test } from '@nestjs/testing';
import { PaiementsService } from './paiements.service';
import { BaseService } from '../base/base.service';

/**
 * Ce que ces tests protegent : les regles qui font qu'un QR ne peut pas
 * etre obtenu sans avoir paye, et qu'un chauffeur qui a paye ne peut pas
 * se retrouver sans QR. Les deux erreurs sont graves, en sens inverse.
 */
describe('PaiementsService', () => {
  let service: PaiementsService;
  let base: { premier: jest.Mock; requete: jest.Mock; transaction: jest.Mock };
  let client: { query: jest.Mock };

  const CHAUFFEUR_VALIDE = {
    id: 'ch-1', statut: 'verifie', autorite_id: 'aut-1',
    frais_qr_fcfa: '5000', validite_qr_mois: 6,
    qr_id: null, expire_le: null,
  };

  /**
   * Les requetes sont routees par motif SQL plutot que par ordre
   * d'appel : un test qui compte les appels casse au premier ajout de
   * requete, meme si le comportement n'a pas change.
   */
  const monter = (options: {
    chauffeur?: any;
    referenceDejaPrise?: boolean;
    paiementEnCours?: any;
    paiement?: any;
    qrDuPaiement?: any;
  } = {}) => {
    const chauffeur = 'chauffeur' in options ? options.chauffeur : CHAUFFEUR_VALIDE;

    client.query.mockImplementation(async (sql: string, params?: any[]) => {
      // Chargement du chauffeur, verrouille.
      if (/FROM chauffeur c/.test(sql) && /FOR UPDATE OF c/.test(sql)) {
        return chauffeur
          ? { rowCount: 1, rows: [chauffeur] }
          : { rowCount: 0, rows: [] };
      }
      // Unicite de la reference de recu.
      if (/SELECT id FROM paiement WHERE reference_externe/.test(sql)) {
        return options.referenceDejaPrise
          ? { rowCount: 1, rows: [{ id: 'p-existant' }] }
          : { rowCount: 0, rows: [] };
      }
      // Paiement Mobile Money deja ouvert.
      if (/statut = 'en_attente'/.test(sql) && /SELECT/.test(sql)) {
        return options.paiementEnCours
          ? { rowCount: 1, rows: [options.paiementEnCours] }
          : { rowCount: 0, rows: [] };
      }
      // Chargement d'un paiement pour confirmation ou echec.
      if (/FROM paiement p/.test(sql) || /FROM paiement WHERE id/.test(sql)) {
        return options.paiement
          ? { rowCount: 1, rows: [options.paiement] }
          : { rowCount: 0, rows: [] };
      }
      // Le QR deja rattache a un paiement confirme.
      if (/SELECT jeton, expire_le FROM code_qr WHERE id/.test(sql)) {
        return options.qrDuPaiement
          ? { rowCount: 1, rows: [options.qrDuPaiement] }
          : { rowCount: 0, rows: [] };
      }
      // Unicite du jeton tire au sort : jamais pris, dans les tests.
      if (/SELECT 1 FROM code_qr WHERE jeton/.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (/INSERT INTO code_qr/.test(sql)) {
        return {
          rowCount: 1,
          rows: [{ id: 'qr-neuf', expire_le: new Date('2027-03-02') }],
        };
      }
      if (/INSERT INTO paiement/.test(sql)) {
        return { rowCount: 1, rows: [{ id: 'p-neuf' }] };
      }
      if (/FROM autorite WHERE id/.test(sql)) {
        return { rowCount: 1, rows: [{ id: 'aut-1', nom: 'Commune de Douala V' }] };
      }
      return { rowCount: 0, rows: [] };
    });
  };

  const sqlAppeles = () => client.query.mock.calls.map((c) => c[0] as string);
  const aExecute = (motif: RegExp) => sqlAppeles().some((s) => motif.test(s));

  beforeEach(async () => {
    client = { query: jest.fn() };
    base = {
      premier: jest.fn(),
      requete: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((operation) => operation(client)),
    };
    const module = await Test.createTestingModule({
      providers: [PaiementsService, { provide: BaseService, useValue: base }],
    }).compile();
    service = module.get(PaiementsService);
  });

  // ----------------------------------------------------------------
  describe('on encaisse apres la validation, jamais avant', () => {
    it('encaisse et emet le QR pour un dossier valide', async () => {
      monter();

      const r = await service.encaisserAuGuichet(
        'ch-1', { referenceRecu: 'RECU-001' }, 'agent-1', 'aut-1',
      );

      expect(r.montantFcfa).toBe(5000);
      expect(r.jetonQr).toHaveLength(7);
      expect(aExecute(/INSERT INTO code_qr/)).toBe(true);
    });

    it('refuse d\'encaisser un dossier non encore valide', async () => {
      monter({ chauffeur: { ...CHAUFFEUR_VALIDE, statut: 'en_examen' } });

      await expect(
        service.encaisserAuGuichet(
          'ch-1', { referenceRecu: 'RECU-002' }, 'agent-1', 'aut-1',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'DOSSIER_NON_VALIDE' }),
      });

      // Rien n'a ete encaisse : un dossier rejete n'aura rien a rembourser.
      expect(aExecute(/INSERT INTO paiement/)).toBe(false);
      expect(aExecute(/INSERT INTO code_qr/)).toBe(false);
    });

    it('refuse d\'encaisser un dossier rejete', async () => {
      monter({ chauffeur: { ...CHAUFFEUR_VALIDE, statut: 'rejete' } });

      await expect(
        service.encaisserAuGuichet(
          'ch-1', { referenceRecu: 'RECU-003' }, 'agent-1', 'aut-1',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'DOSSIER_NON_VALIDE' }),
      });
    });
  });

  // ----------------------------------------------------------------
  describe('le montant ne vient jamais du client', () => {
    it('refuse d\'encaisser tant qu\'aucun tarif n\'est fixe', async () => {
      monter({ chauffeur: { ...CHAUFFEUR_VALIDE, frais_qr_fcfa: null } });

      await expect(
        service.encaisserAuGuichet(
          'ch-1', { referenceRecu: 'RECU-004' }, 'agent-1', 'aut-1',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'TARIF_NON_FIXE' }),
      });

      expect(aExecute(/INSERT INTO paiement/)).toBe(false);
    });

    it('prend le montant en base, pas celui que l\'appelant voudrait', async () => {
      monter({ chauffeur: { ...CHAUFFEUR_VALIDE, frais_qr_fcfa: '3000' } });

      const r = await service.encaisserAuGuichet(
        'ch-1', { referenceRecu: 'RECU-005' } as any, 'agent-1', 'aut-1',
      );

      expect(r.montantFcfa).toBe(3000);
    });
  });

  // ----------------------------------------------------------------
  describe('un paiement ne compte qu\'une fois', () => {
    it('refuse un numero de recu deja encaisse', async () => {
      monter({ referenceDejaPrise: true });

      await expect(
        service.encaisserAuGuichet(
          'ch-1', { referenceRecu: 'RECU-001' }, 'agent-1', 'aut-1',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'RECU_DEJA_ENCAISSE' }),
      });

      expect(aExecute(/INSERT INTO code_qr/)).toBe(false);
    });

    it('refuse d\'encaisser quand le QR est encore valide', async () => {
      const dansSixMois = new Date(Date.now() + 180 * 86400_000);
      monter({
        chauffeur: { ...CHAUFFEUR_VALIDE, qr_id: 'qr-1', expire_le: dansSixMois },
      });

      await expect(
        service.encaisserAuGuichet(
          'ch-1', { referenceRecu: 'RECU-006' }, 'agent-1', 'aut-1',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'QR_ENCORE_VALIDE' }),
      });
    });

    it('accepte d\'encaisser quand le QR precedent a expire', async () => {
      const hier = new Date(Date.now() - 86400_000);
      monter({
        chauffeur: { ...CHAUFFEUR_VALIDE, qr_id: 'qr-vieux', expire_le: hier },
      });

      const r = await service.encaisserAuGuichet(
        'ch-1', { referenceRecu: 'RECU-007' }, 'agent-1', 'aut-1',
      );

      expect(r.jetonQr).toHaveLength(7);
      // L'ancien QR est revoque : deux QR actifs voudraient dire deux verites.
      expect(aExecute(/UPDATE code_qr\s+SET actif = false/)).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  describe('cloisonnement par autorite', () => {
    it('refuse a un agent d\'encaisser pour une autre commune', async () => {
      monter();

      await expect(
        service.encaisserAuGuichet(
          'ch-1', { referenceRecu: 'RECU-008' }, 'agent-1', 'aut-AUTRE',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTRE_AUTORITE' }),
      });
    });

    it('laisse passer un superadmin sans autorite de rattachement', async () => {
      monter();

      const r = await service.encaisserAuGuichet(
        'ch-1', { referenceRecu: 'RECU-009' }, 'super-1', null,
      );

      expect(r.jetonQr).toHaveLength(7);
    });
  });

  // ----------------------------------------------------------------
  describe('Mobile Money : ouvrir n\'est pas payer', () => {
    it('ouvre un paiement en attente sans emettre de QR', async () => {
      monter();

      const r = await service.ouvrirMobileMoney(
        'ch-1', { operateur: 'mtn', telephonePayeur: '699452108' }, 'ch-1',
      );

      expect(r.statut).toBe('en_attente');
      // Le point essentiel : rien n'est emis tant que rien n'est confirme.
      expect(aExecute(/INSERT INTO code_qr/)).toBe(false);
    });

    it('renvoie le paiement deja ouvert au lieu d\'en creer un second', async () => {
      monter({
        paiementEnCours: {
          id: 'p-encours', montant_fcfa: '5000',
          operateur: 'mtn', cree_le: new Date(),
        },
      });

      const r = await service.ouvrirMobileMoney(
        'ch-1', { operateur: 'mtn', telephonePayeur: '699452108' }, 'ch-1',
      );

      expect(r.paiementId).toBe('p-encours');
      expect(r.reprise).toBe(true);
      // Quelqu'un dont le reseau a coupe ne doit pas etre debite deux fois.
      expect(aExecute(/INSERT INTO paiement/)).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  describe('confirmation', () => {
    it('confirme un paiement en attente et emet le QR', async () => {
      monter({
        paiement: {
          id: 'p-1', chauffeur_id: 'ch-1', statut: 'en_attente',
          montant_fcfa: '5000', qr_id: null, validite_qr_mois: 6,
        },
      });

      const r = await service.confirmer('p-1', 'MTN-REF-999', 'agent-1');

      expect(r.statut).toBe('confirme');
      expect(r.deja).toBe(false);
      expect(r.jetonQr).toHaveLength(7);
    });

    it('confirmer deux fois n\'emet pas deux QR', async () => {
      monter({
        paiement: {
          id: 'p-1', chauffeur_id: 'ch-1', statut: 'confirme',
          montant_fcfa: '5000', qr_id: 'qr-1', validite_qr_mois: 6,
        },
        qrDuPaiement: { jeton: 'ABCDEFG', expire_le: new Date('2027-03-02') },
      });

      const r = await service.confirmer('p-1', 'MTN-REF-999', 'agent-1');

      expect(r.deja).toBe(true);
      expect(r.jetonQr).toBe('ABCDEFG');
      // Les webhooks Mobile Money arrivent en double : un doublon ne doit
      // pas ouvrir un second droit.
      expect(aExecute(/INSERT INTO code_qr/)).toBe(false);
    });

    it('refuse de confirmer un paiement echoue', async () => {
      monter({
        paiement: {
          id: 'p-1', chauffeur_id: 'ch-1', statut: 'echoue',
          montant_fcfa: '5000', qr_id: null, validite_qr_mois: 6,
        },
      });

      await expect(service.confirmer('p-1', null, 'agent-1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PAIEMENT_NON_CONFIRMABLE' }),
      });
    });
  });

  // ----------------------------------------------------------------
  describe('echec motive', () => {
    it('refuse un echec sans motif', async () => {
      monter();

      await expect(service.marquerEchoue('p-1', '   ', 'agent-1'))
        .rejects.toThrow(/motiv/i);
    });

    it('refuse de declarer echoue un paiement deja confirme', async () => {
      monter({
        paiement: { id: 'p-1', chauffeur_id: 'ch-1', statut: 'confirme' },
      });

      await expect(
        service.marquerEchoue('p-1', 'annulation demandee', 'agent-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PAIEMENT_DEJA_CONFIRME' }),
      });
    });
  });
});
