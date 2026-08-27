/**
 * Jeu de donnees de developpement.
 *
 * Cree des comptes et des dossiers dans des etats varies, pour explorer
 * l'API a la main sans rejouer tout le parcours a chaque fois.
 *
 *   npm run jeu-de-donnees            # cree le jeu
 *   npm run jeu-de-donnees -- --vider # efface tout
 *
 * Refuse de s'executer si NODE_ENV vaut « production ».
 */
import { config } from 'dotenv';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { configurationConnexion } from '../src/base/base.service';
import { genererJeton } from '../src/commun/format';

config();

const MOT_DE_PASSE = 'DeveloppementSecuriTaxi2026';
const SESSION = 'session-developpement-' + '0'.repeat(12);

const TABLES = [
  'sms_sortant', 'alerte_destinataire', 'alerte', 'objet_perdu', 'signalement',
  'position_trajet', 'partage_trajet', 'contact_confiance', 'trajet',
  'journal_audit', 'document', 'code_qr', 'vehicule', 'chauffeur',
  'code_otp', 'compte', 'autorite',
];

/**
 * Les chauffeurs couvrent les etats qu'un agent rencontre reellement :
 * un dossier vide qui vient d'arriver, un dossier complet en attente
 * d'examen, un dossier valide, et un compte suspendu.
 */
const CHAUFFEURS = [
  {
    nom: 'NGONO', prenom: 'Paul Bertrand', telephone: '699452108',
    plaque: 'LT452AB', marque: 'Toyota', modele: 'Corolla', couleur: 'Jaune',
    etat: 'verifie' as const,
  },
  {
    nom: 'MBALLA', prenom: 'Alphonse', telephone: '677334455',
    plaque: 'LT781CD', marque: 'Nissan', modele: 'Sunny', couleur: 'Jaune',
    etat: 'complet_non_examine' as const,
  },
  {
    nom: 'FOUDA', prenom: 'Jean-Claude', telephone: '695112233',
    plaque: 'LT223EF', marque: 'Hyundai', modele: 'Accent', couleur: 'Blanc',
    etat: 'dossier_vide' as const,
  },
  {
    nom: 'ATANGANA', prenom: 'Michel', telephone: '698776655',
    plaque: 'CE554GH', marque: 'Toyota', modele: 'Yaris', couleur: 'Jaune',
    etat: 'suspendu' as const,
  },
];

const PIECES = ['cni_recto', 'cni_verso', 'permis', 'carte_grise'];

async function vider(pool: Pool) {
  for (const table of TABLES) await pool.query(`DELETE FROM ${table}`);
}

async function principal() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Ce script ne doit jamais être exécuté en production.');
  }

  const pool = new Pool(configurationConnexion());

  try {
    if (process.argv.includes('--vider')) {
      await vider(pool);
      console.log('Jeu de données effacé.');
      return;
    }

    await vider(pool);
    const hash = await bcrypt.hash(MOT_DE_PASSE, 12);

    const douala = (await pool.query(`SELECT id FROM ville WHERE nom = 'Douala'`)).rows[0].id;
    const yaounde = (await pool.query(`SELECT id FROM ville WHERE nom = 'Yaounde'`)).rows[0].id;

    // Deux autorites : de quoi verifier qu'un agent ne voit pas les
    // dossiers de la ville voisine.
    const autoriteDouala = (await pool.query(
      `INSERT INTO autorite (ville_id, nom, type, recoit_alertes, telephone)
       VALUES ($1, 'Commune de Douala V', 'commune', true, '+237222000000')
       RETURNING id`, [douala],
    )).rows[0].id;

    const autoriteYaounde = (await pool.query(
      `INSERT INTO autorite (ville_id, nom, type, recoit_alertes)
       VALUES ($1, 'Commune de Yaoundé II', 'commune', false)
       RETURNING id`, [yaounde],
    )).rows[0].id;

    await pool.query(
      `INSERT INTO compte (telephone, mot_de_passe_hash, role, telephone_verifie)
       VALUES ('+237699000001', $1, 'superadmin', true)`, [hash],
    );
    await pool.query(
      `INSERT INTO compte (telephone, mot_de_passe_hash, role, autorite_id, telephone_verifie)
       VALUES ('+237699000002', $1, 'agent', $2, true)`, [hash, autoriteDouala],
    );
    await pool.query(
      `INSERT INTO compte (telephone, mot_de_passe_hash, role, autorite_id, telephone_verifie)
       VALUES ('+237699000003', $1, 'agent', $2, true)`, [hash, autoriteYaounde],
    );

    const cree: Array<{ nom: string; etat: string; jetonQr?: string }> = [];

    for (const c of CHAUFFEURS) {
      const villeId = c.plaque.startsWith('CE') ? yaounde : douala;

      const compte = await pool.query(
        `INSERT INTO compte (telephone, mot_de_passe_hash, role, telephone_verifie)
         VALUES ($1, $2, 'chauffeur', true) RETURNING id`,
        [`+237${c.telephone}`, hash],
      );

      const statut = c.etat === 'verifie' ? 'verifie'
        : c.etat === 'suspendu' ? 'suspendu'
        : c.etat === 'complet_non_examine' ? 'en_examen'
        : 'declare';

      const reference = ['verifie', 'suspendu'].includes(statut)
        ? `${String(cree.length + 1).padStart(4, '0')}-DLA` : null;

      const chauffeur = await pool.query(
        `INSERT INTO chauffeur
           (compte_id, nom, prenom, ville_id, statut, reference_licence,
            autorite_id, motif_suspension, statut_change_le)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
        [compte.rows[0].id, c.nom, c.prenom, villeId, statut, reference,
         reference ? autoriteDouala : null,
         c.etat === 'suspendu' ? 'Signalement fondé : comportement inapproprié' : null],
      );
      const chauffeurId = chauffeur.rows[0].id;

      await pool.query(
        `INSERT INTO vehicule (chauffeur_id, plaque, marque, modele, couleur, plaque_recoupee)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [chauffeurId, c.plaque, c.marque, c.modele, c.couleur, c.etat === 'verifie'],
      );

      // Les pieces ne sont pas ecrites sur disque : ce jeu sert a
      // explorer les etats, pas a tester le stockage. Les chemins
      // pointent vers rien, et c'est assume.
      if (c.etat !== 'dossier_vide') {
        for (const type of PIECES) {
          const verdict = c.etat === 'complet_non_examine' ? null : 'lisible';
          await pool.query(
            `INSERT INTO document (chauffeur_id, type, chemin, verdict, date_expiration)
             VALUES ($1, $2, $3, $4, $5)`,
            [chauffeurId, type, `00/inexistant-${type}.jpg`, verdict,
             type === 'permis' ? '2029-06-30' : null],
          );
        }
      }

      let jetonQr: string | undefined;
      if (c.etat === 'verifie') {
        jetonQr = genererJeton(7);
        await pool.query(
          'INSERT INTO code_qr (chauffeur_id, jeton) VALUES ($1, $2)',
          [chauffeurId, jetonQr],
        );
      }
      if (c.etat === 'suspendu') {
        await pool.query(
          `INSERT INTO code_qr (chauffeur_id, jeton, actif, revoque_le, motif_revocation)
           VALUES ($1, $2, false, now(), 'chauffeur suspendu')`,
          [chauffeurId, genererJeton(7)],
        );
      }

      cree.push({ nom: `${c.prenom} ${c.nom}`, etat: c.etat, jetonQr });
    }

    const largeur = 62;
    console.log('\n\x1b[1mJeu de données de développement\x1b[0m');
    console.log('─'.repeat(largeur));
    console.log(`Mot de passe commun : ${MOT_DE_PASSE}`);
    console.log(`Session passager    : ${SESSION}`);
    console.log('─'.repeat(largeur));
    console.log('699000001  superadmin');
    console.log('699000002  agent — Commune de Douala V (reçoit les alertes)');
    console.log('699000003  agent — Commune de Yaoundé II');
    console.log('─'.repeat(largeur));
    for (const [i, c] of cree.entries()) {
      const tel = CHAUFFEURS[i].telephone;
      console.log(`${tel}  ${c.nom.padEnd(22)} ${c.etat}`);
      if (c.jetonQr) console.log(`           → QR ${c.jetonQr} — scannable`);
    }
    console.log('─'.repeat(largeur));
    console.log('Pour commencer :');
    const scannable = cree.find((c) => c.jetonQr);
    if (scannable) {
      console.log(`  curl localhost:3000/api/scan/${scannable.jetonQr}`);
    }
    console.log('  Documentation interactive : http://localhost:3000/api/docs\n');
  } finally {
    await pool.end();
  }
}

principal()
  .then(() => process.exit(0))
  .catch((erreur) => {
    console.error(`Échec : ${erreur.message}`);
    process.exit(1);
  });
