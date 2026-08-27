/**
 * Création du premier compte superadmin.
 *
 * Sans lui, personne ne peut créer d'agent, et aucun dossier ne peut être
 * validé : c'est l'amorçage de la plateforme. À exécuter une seule fois,
 * après l'installation de la base.
 *
 *   npx ts-node scripts/creer-superadmin.ts 699452108
 *
 * Le mot de passe est demandé de façon interactive : il ne doit jamais
 * apparaître dans l'historique du shell ni dans la liste des processus.
 */
import { Pool } from 'pg';
import { createInterface } from 'readline';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import { normaliserTelephone, formaterTelephone } from '../src/commun/format';
import { configurationConnexion } from '../src/base/base.service';

config();

/**
 * Saisie au clavier.
 *
 * La lecture s'appuie sur l'evenement `line` plutot que sur
 * `readline.question()` : enchainer deux `question()` ne resout jamais la
 * seconde lorsque l'entree est redirigee plutot que tapee au clavier, ce
 * qui rendrait ce script inutilisable en installation automatisee.
 *
 * Le masquage du mot de passe coupe l'echo du terminal lui-meme
 * (`setRawMode`), comme le fait `sudo`. Hors terminal il n'y a pas
 * d'echo a couper, et la lecture se fait normalement.
 */
const lecture = createInterface({ input: process.stdin });

const lignesEnAttente: string[] = [];
const lecteursEnAttente: Array<(ligne: string) => void> = [];

lecture.on('line', (ligne) => {
  const lecteur = lecteursEnAttente.shift();
  if (lecteur) lecteur(ligne);
  else lignesEnAttente.push(ligne);
});

function demander(question: string, masque = false): Promise<string> {
  const entree = process.stdin;
  const masquable = masque && entree.isTTY;

  process.stdout.write(question);
  if (masquable) entree.setRawMode(true);

  return new Promise((resoudre) => {
    const recevoir = (ligne: string) => {
      if (masquable) {
        entree.setRawMode(false);
        process.stdout.write('\n');
      }
      resoudre(ligne.trim());
    };

    const prete = lignesEnAttente.shift();
    if (prete !== undefined) recevoir(prete);
    else lecteursEnAttente.push(recevoir);
  });
}

async function principal() {
  const saisie = process.argv[2];
  if (!saisie) {
    throw new Error('Usage : npx ts-node scripts/creer-superadmin.ts <telephone>');
  }

  const telephone = normaliserTelephone(saisie);
  if (!telephone) {
    throw new Error('Numéro invalide. Format attendu : 6XXXXXXXX ou 2XXXXXXXX.');
  }

  const motDePasse = await demander('Mot de passe : ', true);
  if (motDePasse.length < 12) {
    throw new Error(
      'Ce compte peut créer des agents et certifier des chauffeurs : ' +
      'douze caractères au minimum.',
    );
  }
  if (motDePasse !== await demander('Confirmer     : ', true)) {
    throw new Error('Les deux saisies diffèrent.');
  }

  const pool = new Pool(configurationConnexion());

  try {
    const existant = await pool.query(
      'SELECT id, role FROM compte WHERE telephone = $1', [telephone],
    );
    if (existant.rowCount) {
      throw new Error(
        `Ce numéro est déjà enregistré (rôle : ${existant.rows[0].role}).`,
      );
    }

    const hash = await bcrypt.hash(motDePasse, 12);
    const compte = await pool.query(
      `INSERT INTO compte (telephone, mot_de_passe_hash, role, telephone_verifie)
       VALUES ($1, $2, 'superadmin', true) RETURNING id`,
      [telephone, hash],
    );

    await pool.query(
      `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
       VALUES ($1, 'superadmin.cree', 'compte', $1, $2)`,
      [compte.rows[0].id, JSON.stringify({ amorcage: true })],
    );

    console.log(`\nCompte superadmin créé : ${formaterTelephone(telephone)}`);
    console.log(`Identifiant : ${compte.rows[0].id}`);
    console.log('\nConnexion : POST /api/auth/connexion');
  } finally {
    await pool.end();
  }
}

principal()
  .then(() => {
    lecture.close();
    process.exit(0);
  })
  .catch((erreur) => {
    lecture.close();
    console.error(`Échec : ${erreur.message}`);
    process.exit(1);
  });
