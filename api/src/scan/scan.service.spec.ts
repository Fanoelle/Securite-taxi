import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ScanService } from './scan.service';
import { BaseService } from '../base/base.service';

describe('ScanService', () => {
  let service: ScanService;
  let base: { premier: jest.Mock };

  const ligneVerifie = {
    jeton: 'F4M2XQP',
    nom: 'NGONO', prenom: 'Paul Bertrand',
    photo_chemin: 'abc.jpg',
    statut: 'verifie',
    reference_licence: '0447-DLA',
    chauffeur_inscrit_le: '2019-03-14T00:00:00Z',
    plaque: 'LT452AB', marque: 'Toyota', modele: 'Corolla', couleur: 'Jaune',
    plaque_recoupee: true,
    ville: 'Douala',
    autorite_nom: 'Commune de Douala V',
    verifie_le: '2026-03-14T10:00:00Z',
  };

  beforeEach(async () => {
    base = { premier: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [ScanService, { provide: BaseService, useValue: base }],
    }).compile();
    service = module.get(ScanService);
  });

  it('formate la plaque pour affichage', async () => {
    base.premier.mockResolvedValue(ligneVerifie);
    const r = await service.resoudre('F4M2XQP');
    expect(r.vehicule.plaque).toBe('LT 452 AB');
  });

  it('normalise le jeton avant la recherche', async () => {
    base.premier.mockResolvedValue(ligneVerifie);
    await service.resoudre('  f4m2xqp  ');
    expect(base.premier).toHaveBeenCalledWith(expect.any(String), ['F4M2XQP']);
  });

  it('interroge la vue publique, jamais la table chauffeur', async () => {
    base.premier.mockResolvedValue(ligneVerifie);
    await service.resoudre('F4M2XQP');
    const sql = base.premier.mock.calls[0][0] as string;
    expect(sql).toContain('v_scan_public');
    expect(sql).not.toMatch(/FROM\s+chauffeur/i);
  });

  it('n expose aucune donnee sensible', async () => {
    base.premier.mockResolvedValue({
      ...ligneVerifie,
      date_naissance: '1986-07-12',
      telephone: '+237699452108',
cni: 'X123',
    });
    const r = await service.resoudre('F4M2XQP');
    const json = JSON.stringify(r);
    expect(json).not.toContain('1986-07-12');
    expect(json).not.toContain('+237699452108');
    expect(json).not.toContain('X123');
  });

  it('marque un chauffeur verifie sans avertissement', async () => {
    base.premier.mockResolvedValue(ligneVerifie);
    const r = await service.resoudre('F4M2XQP');
    expect(r.statut.verifie).toBe(true);
    expect(r.statut.libelle).toBe('VÉRIFIÉ');
    expect(r.statut.avertissement).toBeNull();
  });

  it('avertit pour un chauffeur declare', async () => {
    base.premier.mockResolvedValue({ ...ligneVerifie, statut: 'declare',
                                     reference_licence: null, autorite_nom: null });
    const r = await service.resoudre('F4M2XQP');
    expect(r.statut.verifie).toBe(false);
    expect(r.statut.libelle).toBe('NON VÉRIFIÉ');
    expect(r.statut.avertissement).toContain('pas encore été contrôlés');
  });

  it('avertit fortement pour un compte suspendu', async () => {
    base.premier.mockResolvedValue({ ...ligneVerifie, statut: 'suspendu' });
    const r = await service.resoudre('F4M2XQP');
    expect(r.statut.verifie).toBe(false);
    expect(r.statut.avertissement).toContain('déconseillé');
  });

  it('ne considere jamais un statut inconnu comme verifie', async () => {
    base.premier.mockResolvedValue({ ...ligneVerifie, statut: 'nimporte_quoi' });
    const r = await service.resoudre('F4M2XQP');
    expect(r.statut.verifie).toBe(false);
  });

  it('rejette un jeton inconnu avec un message utile', async () => {
    base.premier.mockResolvedValue(null);
    await expect(service.resoudre('INCONNU')).rejects.toThrow(NotFoundException);
  });
});
