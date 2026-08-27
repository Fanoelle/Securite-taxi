/**
 * Normalisation des données saisies. Les règles de format vivent ici
 * plutôt que dispersées dans les contrôleurs.
 */

/**
 * Plaque : stockée sans espaces (LT452AB), affichée espacée (LT 452 AB).
 * Le format camerounais est : 2 lettres de région, 3 chiffres, 2 lettres.
 */
export function normaliserPlaque(saisie: string): string {
  return saisie.toUpperCase().replace(/[\s-]/g, '');
}

export function formaterPlaque(plaque: string): string {
  const p = normaliserPlaque(plaque);
  return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(p)
    ? `${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5)}`
    : plaque;
}

export function plaqueValide(saisie: string): boolean {
  return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(normaliserPlaque(saisie));
}

/**
 * Téléphone camerounais vers E.164 (+237XXXXXXXXX).
 * Accepte les formes courantes : 6 99 45 21 08, 699452108, 237699452108,
 * +237 6 99 45 21 08. Les mobiles commencent par 6, les fixes par 2.
 */
export function normaliserTelephone(saisie: string): string | null {
  const chiffres = saisie.replace(/[^\d]/g, '');
  let national = chiffres;

  if (chiffres.startsWith('237') && chiffres.length === 12) {
    national = chiffres.slice(3);
  }
  if (national.length !== 9) return null;
  if (!/^[26]/.test(national)) return null;

  return `+237${national}`;
}

export function formaterTelephone(e164: string): string {
  const n = e164.replace('+237', '');
  return n.length === 9
    ? `+237 ${n[0]} ${n.slice(1, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`
    : e164;
}

/**
 * Jeton public court, lisible à voix haute et sans ambiguïté visuelle :
 * ni 0/O, ni 1/I/L. Sert pour les QR et les liens de suivi.
 */
const ALPHABET_SANS_AMBIGUITE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function genererJeton(longueur = 7): string {
  const { randomInt } = require('crypto') as typeof import('crypto');
  let jeton = '';
  for (let i = 0; i < longueur; i++) {
    jeton += ALPHABET_SANS_AMBIGUITE[randomInt(ALPHABET_SANS_AMBIGUITE.length)];
  }
  return jeton;
}
