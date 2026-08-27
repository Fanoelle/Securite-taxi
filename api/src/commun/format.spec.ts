import {
  normaliserPlaque, formaterPlaque, plaqueValide,
  normaliserTelephone, formaterTelephone, genererJeton,
} from './format';

describe('plaques', () => {
  it('normalise les saisies courantes', () => {
    expect(normaliserPlaque('LT 452 AB')).toBe('LT452AB');
    expect(normaliserPlaque('lt452ab')).toBe('LT452AB');
    expect(normaliserPlaque('LT-452-AB')).toBe('LT452AB');
  });

  it('formate pour affichage', () => {
    expect(formaterPlaque('LT452AB')).toBe('LT 452 AB');
    expect(formaterPlaque('CE771QD')).toBe('CE 771 QD');
  });

  it('rejette les formats invalides', () => {
    expect(plaqueValide('LT452AB')).toBe(true);
    expect(plaqueValide('LT 452 AB')).toBe(true);
    expect(plaqueValide('L452AB')).toBe(false);
    expect(plaqueValide('LT452AB1')).toBe(false);
    expect(plaqueValide('')).toBe(false);
  });

  it('laisse intacte une plaque non conforme au formatage', () => {
    expect(formaterPlaque('INCONNU')).toBe('INCONNU');
  });
});

describe('telephones', () => {
  it('accepte les formes courantes camerounaises', () => {
    expect(normaliserTelephone('699452108')).toBe('+237699452108');
    expect(normaliserTelephone('6 99 45 21 08')).toBe('+237699452108');
    expect(normaliserTelephone('+237 6 99 45 21 08')).toBe('+237699452108');
    expect(normaliserTelephone('237699452108')).toBe('+237699452108');
  });

  it('accepte les fixes commencant par 2', () => {
    expect(normaliserTelephone('233421234')).toBe('+237233421234');
  });

  it('rejette les numeros invalides', () => {
    expect(normaliserTelephone('12345')).toBeNull();
    expect(normaliserTelephone('799452108')).toBeNull();   // prefixe 7 inexistant
    expect(normaliserTelephone('69945210')).toBeNull();    // 8 chiffres
    expect(normaliserTelephone('6994521089')).toBeNull();  // 10 chiffres
  });

  it('formate pour affichage', () => {
    expect(formaterTelephone('+237699452108')).toBe('+237 6 99 45 21 08');
  });
});

describe('jetons', () => {
  it('respecte la longueur demandee', () => {
    expect(genererJeton(7)).toHaveLength(7);
    expect(genererJeton(4)).toHaveLength(4);
  });

  it('evite les caracteres ambigus', () => {
    const echantillon = Array.from({ length: 400 }, () => genererJeton(10)).join('');
    expect(echantillon).not.toMatch(/[01OIL]/);
  });

  it('ne produit pas de collision evidente', () => {
    const jetons = new Set(Array.from({ length: 1000 }, () => genererJeton(7)));
    expect(jetons.size).toBeGreaterThan(995);
  });
});
