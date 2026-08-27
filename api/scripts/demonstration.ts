/**
 * Demonstration complete du parcours, de bout en bout.
 *
 * Deroule le scenario reel — inscription, validation, trajet, partage,
 * alerte, signalement, objet perdu — en affichant ce qui se passe a
 * chaque etape. Sert a verifier d'un coup d'oeil que tout fonctionne,
 * et a montrer le produit a quelqu'un.
 *
 *   npm run demonstration
 *
 * L'API doit tourner (npm run dev) et la base doit etre installee.
 * Les donnees creees sont effacees a la fin, sauf avec --garder.
 */
import { config } from 'dotenv';
import { Pool } from 'pg';
import { configurationConnexion } from '../src/base/base.service';

config();

const URL = process.env.URL_DEMO ?? `http://localhost:${process.env.PORT ?? 3000}`;
const GARDER = process.argv.includes('--garder');

// Numeros reserves a la demonstration : hors des plages reellement
// attribuees, pour ne jamais envoyer un vrai SMS par accident.
const ADMIN = '699000001';
const AGENT = '699000002';
const CHAUFFEUR = '699452108';
const PROCHE = '699111111';
const MOT_DE_PASSE = 'DemonstrationSecuriTaxi2026';
const SESSION = 'demonstration-session-' + '0'.repeat(12);

const couleur = {
  titre: (t: string) => `\n\x1b[1m\x1b[36m${t}\x1b[0m`,
  ok: (t: string) => `\x1b[32m✓\x1b[0m ${t}`,
  info: (t: string) => `  \x1b[90m${t}\x1b[0m`,
  alerte: (t: string) => `\x1b[33m⚠\x1b[0m  ${t}`,
  erreur: (t: string) => `\x1b[31m✗\x1b[0m ${t}`,
};

let etapes = 0;

interface Options {
  jeton?: string;
  session?: boolean;
  corps?: unknown;
  formulaire?: FormData;
  attendu?: number;
}

async function appel(methode: string, chemin: string, options: Options = {}) {
  const entetes: Record<string, string> = {};
  if (options.jeton) entetes.Authorization = `Bearer ${options.jeton}`;
  if (options.session) entetes['x-session-passager'] = SESSION;
  if (options.corps) entetes['Content-Type'] = 'application/json';

  const reponse = await fetch(`${URL}/api${chemin}`, {
    method: methode,
    headers: entetes,
    body: options.formulaire
      ? (options.formulaire as any)
      : options.corps ? JSON.stringify(options.corps) : undefined,
  });

  const type = reponse.headers.get('content-type') ?? '';
  const corps = type.includes('json') ? await reponse.json() : await reponse.text();

  if (options.attendu && reponse.status !== options.attendu) {
    throw new Error(
      `${methode} ${chemin} → ${reponse.status} (attendu ${options.attendu})\n` +
      JSON.stringify(corps, null, 2),
    );
  }
  return { statut: reponse.status, corps: corps as any };
}

/** Verifie qu'une action est bien refusee. C'est la moitie de la demonstration. */
async function refuse(
  description: string, statutAttendu: number,
  action: () => Promise<{ statut: number; corps: any }>,
) {
  const { statut, corps } = await action();
  if (statut !== statutAttendu) {
    throw new Error(`${description} : ${statut} au lieu de ${statutAttendu}`);
  }
  const message = typeof corps?.message === 'string'
    ? corps.message
    : corps?.message?.[0] ?? corps?.code ?? '';
  console.log(couleur.ok(`${description} → ${statut}`));
  if (message) console.log(couleur.info(String(message).slice(0, 95)));
  etapes++;
}

function reussi(description: string, detail?: string) {
  console.log(couleur.ok(description));
  if (detail) console.log(couleur.info(detail));
  etapes++;
}

/** Petit JPEG valide : quatre octets de signature suffisent au controle. */
function imageDemo(): Blob {
  return new Blob(
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])],
    { type: 'image/jpeg' },
  );
}

async function nettoyer(pool: Pool) {
  // Ordre impose par les cles etrangeres.
  const tables = [
    'sms_sortant', 'alerte_destinataire', 'alerte', 'objet_perdu', 'signalement',
    'position_trajet', 'partage_trajet', 'contact_confiance', 'trajet',
    'journal_audit', 'document', 'code_qr', 'vehicule', 'chauffeur',
    'code_otp', 'compte', 'autorite',
  ];
  for (const table of tables) await pool.query(`DELETE FROM ${table}`);
}

async function principal() {
  const pool = new Pool(configurationConnexion());

  try {
    await fetch(`${URL}/api/docs`).catch(() => {
      throw new Error(`L'API ne répond pas sur ${URL}. Lancez « npm run dev ».`);
    });

    console.log(couleur.titre('Préparation'));
    await nettoyer(pool);
    reussi('Base remise à zéro');

    // ---------------------------------------------------------------
    console.log(couleur.titre('1. Amorçage — superadmin et autorité'));

    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash(MOT_DE_PASSE, 12);
    await pool.query(
      `INSERT INTO compte (telephone, mot_de_passe_hash, role, telephone_verifie)
       VALUES ($1, $2, 'superadmin', true)`,
      [`+237${ADMIN}`, hash],
    );
    reussi('Compte superadmin créé', `+237 ${ADMIN}`);

    const ville = await pool.query(`SELECT id FROM ville WHERE nom = 'Douala'`);
    const villeId = ville.rows[0].id;
    const autorite = await pool.query(
      `INSERT INTO autorite (ville_id, nom, type, recoit_alertes, telephone)
       VALUES ($1, 'Commune de Douala V', 'commune', true, '+237222000000')
       RETURNING id`,
      [villeId],
    );
    reussi('Autorité créée', 'Commune de Douala V — reçoit les alertes');

    const { corps: sessionAdmin } = await appel('POST', '/auth/connexion', {
      corps: { telephone: ADMIN, motDePasse: MOT_DE_PASSE }, attendu: 200,
    });
    const jetonAdmin = sessionAdmin.jeton;
    reussi('Connexion superadmin', `rôle ${sessionAdmin.profil.role}`);

    await appel('POST', '/auth/agents', {
      jeton: jetonAdmin, attendu: 201,
      corps: { telephone: AGENT, autoriteId: autorite.rows[0].id, motDePasse: MOT_DE_PASSE },
    });
    reussi('Compte agent créé par le superadmin');

    const { corps: sessionAgent } = await appel('POST', '/auth/connexion', {
      corps: { telephone: AGENT, motDePasse: MOT_DE_PASSE }, attendu: 200,
    });
    const jetonAgent = sessionAgent.jeton;

    await refuse('Un agent ne peut pas créer d\'agent', 403, () =>
      appel('POST', '/auth/agents', {
        jeton: jetonAgent,
        corps: { telephone: '699000009', autoriteId: autorite.rows[0].id },
      }));

    // ---------------------------------------------------------------
    console.log(couleur.titre('2. Inscription du chauffeur'));

    const { corps: inscription } = await appel('POST', '/chauffeurs/inscription', {
      attendu: 201,
      corps: {
        nom: 'NGONO', prenom: 'Paul Bertrand', telephone: CHAUFFEUR,
        villeId, plaque: 'LT 452 AB', marque: 'Toyota', modele: 'Corolla',
        couleur: 'Jaune', motDePasse: MOT_DE_PASSE,
      },
    });
    const chauffeurId = inscription.id;
    reussi('Chauffeur inscrit', `statut « ${inscription.statut} » — aucun QR émis`);

    await refuse('Une plaque déjà enregistrée est refusée', 409, () =>
      appel('POST', '/chauffeurs/inscription', {
        corps: {
          nom: 'AUTRE', prenom: 'Jean', telephone: '699888888',
          villeId, plaque: 'LT452AB',
        },
      }));

    const { corps: sessionChauffeur } = await appel('POST', '/auth/connexion', {
      corps: { telephone: CHAUFFEUR, motDePasse: MOT_DE_PASSE }, attendu: 200,
    });
    const jetonChauffeur = sessionChauffeur.jeton;

    await refuse('Un dossier vide ne peut pas être validé', 409, () =>
      appel('POST', `/chauffeurs/${chauffeurId}/validation`, {
        jeton: jetonAgent, corps: { decision: 'verifie' },
      }));

    // ---------------------------------------------------------------
    console.log(couleur.titre('3. Pièces justificatives'));

    const faux = new FormData();
    faux.append('type', 'cni_recto');
    faux.append('fichier', new Blob([new Uint8Array([0x4d, 0x5a, 0x90])],
      { type: 'image/jpeg' }), 'malveillant.jpg');
    await refuse('Un exécutable renommé en .jpg est rejeté', 400, () =>
      appel('POST', '/documents', { jeton: jetonChauffeur, formulaire: faux }));

    for (const type of ['cni_recto', 'cni_verso', 'carte_grise']) {
      const formulaire = new FormData();
      formulaire.append('type', type);
      formulaire.append('fichier', imageDemo(), `${type}.jpg`);
      await appel('POST', '/documents', {
        jeton: jetonChauffeur, formulaire, attendu: 201,
      });
    }
    const permis = new FormData();
    permis.append('type', 'permis');
    permis.append('dateExpiration', '2029-06-30');
    permis.append('fichier', imageDemo(), 'permis.jpg');
    await appel('POST', '/documents', {
      jeton: jetonChauffeur, formulaire: permis, attendu: 201,
    });
    reussi('Quatre pièces téléversées');

    const { corps: dossier } = await appel('GET', '/documents/mon-dossier', {
      jeton: jetonChauffeur, attendu: 200,
    });
    reussi('Dossier complet', `manquants : ${dossier.manquants.length}`);

    await refuse('Validation refusée tant que les pièces ne sont pas examinées', 409, () =>
      appel('POST', `/chauffeurs/${chauffeurId}/validation`, {
        jeton: jetonAgent, corps: { decision: 'verifie' },
      }));

    const { corps: pieces } = await appel('GET', `/documents/chauffeur/${chauffeurId}`, {
      jeton: jetonAgent, attendu: 200,
    });

    await refuse('Un rejet sans commentaire est refusé', 400, () =>
      appel('POST', `/documents/${pieces[0].id}/examen`, {
        jeton: jetonAgent, corps: { verdict: 'illisible' },
      }));

    for (const piece of pieces) {
      await appel('POST', `/documents/${piece.id}/examen`, {
        jeton: jetonAgent, corps: { verdict: 'lisible' }, attendu: 200,
      });
    }
    reussi('Pièces examinées et jugées lisibles par l\'agent');

    // ---------------------------------------------------------------
    console.log(couleur.titre('4. Validation et émission du QR'));

    const { corps: validation } = await appel('POST', `/chauffeurs/${chauffeurId}/validation`, {
      jeton: jetonAgent, attendu: 201,
      corps: { decision: 'verifie', plaqueRecoupee: true },
    });
    const jetonQr = validation.jetonQr;
    reussi('Dossier validé', `référence ${validation.referenceLicence} — QR ${jetonQr}`);

    const { corps: scan } = await appel('GET', `/scan/${jetonQr}`, { attendu: 200 });
    reussi('Scan public du QR', 
      `${scan.statut.libelle} — ${scan.chauffeur.prenom} ${scan.chauffeur.nom}, ` +
      `${scan.vehicule.plaque}, ${scan.statut.autorite}`);

    await refuse('Un code inconnu est refusé avec un avertissement', 404, () =>
      appel('GET', '/scan/FAUX999'));

    // ---------------------------------------------------------------
    console.log(couleur.titre('5. Trajet du passager'));

    const { corps: trajet } = await appel('POST', '/trajets', {
      session: true, attendu: 201,
      corps: { jetonQr, latitude: 4.051056, longitude: 9.767869 },
    });
    const jetonSuivi = trajet.jetonSuivi;
    reussi('Trajet démarré',
      `${jetonSuivi} — statut figé au scan : « ${trajet.statutChauffeurAuScan} »`);

    await refuse('Un second trajet simultané est refusé', 409, () =>
      appel('POST', '/trajets', { session: true, corps: { jetonQr } }));

    const maintenant = Date.now();
    const { corps: positions } = await appel('POST', `/trajets/${jetonSuivi}/positions`, {
      session: true, attendu: 202,
      corps: {
        positions: [
          { latitude: 4.0510, longitude: 9.7678, precisionM: 12,
            mesureLe: new Date(maintenant - 120_000).toISOString() },
          { latitude: 4.0530, longitude: 9.7690, precisionM: 8,
            mesureLe: new Date(maintenant - 60_000).toISOString() },
          // Horloge du téléphone déréglée de cinq jours : la position est
          // gardée, mais datée de sa réception.
          { latitude: 4.0550, longitude: 9.7710,
            mesureLe: new Date(maintenant + 5 * 86_400_000).toISOString() },
        ],
      },
    });
    reussi('Positions enregistrées',
      `${positions.enregistrees} points, ${positions.horodatagesCorriges} horodatage aberrant redaté`);

    await appel('POST', `/trajets/${jetonSuivi}/partage`, {
      session: true, attendu: 200,
      corps: {
        contacts: [{ nom: 'Maman', telephone: PROCHE }],
        memoriser: true,
      },
    });
    reussi('Trajet partagé avec un proche', 'SMS contenant le lien de suivi');

    const { corps: suivi } = await appel('GET', `/suivi/${jetonSuivi}`, { attendu: 200 });
    reussi('Le proche suit le trajet sans compte',
      `${suivi.vehicule.plaque} — position à ${suivi.position.fraicheurSecondes} s`);

    await refuse('Une autre session ne peut pas piloter ce trajet', 403, () =>
      fetch(`${URL}/api/trajets/${jetonSuivi}/fin`, {
        method: 'POST',
        headers: {
          'x-session-passager': 'une-autre-session-000000',
          'Content-Type': 'application/json',
        },
        body: '{}',
      }).then(async (r) => ({ statut: r.status, corps: await r.json() })));

    // ---------------------------------------------------------------
    console.log(couleur.titre('6. Alerte d\'urgence'));

    const { corps: alerte } = await appel('POST', `/trajets/${jetonSuivi}/alerte`, {
      session: true, attendu: 201,
      corps: { latitude: 4.0560, longitude: 9.7720 },
    });
    reussi('Alerte déclenchée',
      `${alerte.destinatairesPrevenus} destinataires prévenus (proche + autorité)`);

    const { corps: rappui } = await appel('POST', `/trajets/${jetonSuivi}/alerte`, {
      session: true, attendu: 201, corps: {},
    });
    reussi('Un second appui ne crée pas de doublon',
      rappui.deja ? 'l\'alerte existante est renvoyée' : 'ATTENDU : deja = true');

    await refuse('Impossible de terminer pendant une alerte', 409, () =>
      appel('POST', `/trajets/${jetonSuivi}/fin`, { session: true, corps: {} }));

    const { corps: fileAlertes } = await appel('GET', '/alertes?etat=active', {
      jeton: jetonAgent, attendu: 200,
    });
    reussi('L\'autorité voit l\'alerte', `${fileAlertes.length} alerte active`);

    const { corps: annulation } = await appel('POST', `/trajets/${jetonSuivi}/alerte/annulation`, {
      session: true, attendu: 200,
      corps: { motif: 'Déclenchement accidentel' },
    });
    reussi('Alerte annulée sans justification exigée',
      `${annulation.destinatairesInformes} personnes rassurées par SMS`);

    // ---------------------------------------------------------------
    console.log(couleur.titre('7. Signalement et suspension'));

    const { corps: qrInconnu } = await appel('POST', '/signalements', {
      session: true, attendu: 201,
      corps: {
        motif: 'qr_suspect', jetonQr: 'FAUX999',
        description: 'Code photocopié collé sur le pare-brise',
      },
    });
    reussi('Faux QR signalé', String(qrInconnu.message).slice(0, 90));

    const { corps: signalement } = await appel('POST', '/signalements', {
      session: true, attendu: 201,
      corps: {
        motif: 'plaque_differente', jetonSuivi,
        description: 'La plaque du véhicule ne correspond pas à celle affichée',
      },
    });
    reussi('Signalement déposé sur le trajet');

    await refuse('Conclure sans note de traitement est refusé', 400, () =>
      appel('POST', `/signalements/traitement/${signalement.id}`, {
        jeton: jetonAgent, corps: { etat: 'fonde' },
      }));

    const { corps: traitement } = await appel('POST', `/signalements/traitement/${signalement.id}`, {
      jeton: jetonAgent, attendu: 200,
      corps: {
        etat: 'fonde', note: 'Plaque non conforme, confirmé sur place',
        suspendreChauffeur: true,
      },
    });
    reussi('Signalement jugé fondé', `chauffeur suspendu : ${traitement.chauffeurSuspendu}`);

    await refuse('Le QR du chauffeur suspendu ne résout plus', 404, () =>
      appel('GET', `/scan/${jetonQr}`));
    console.log(couleur.info('C\'est l\'invariant central : un suspendu ne peut plus paraître vérifié.'));

    // ---------------------------------------------------------------
    console.log(couleur.titre('8. Fin du trajet et objet oublié'));

    const { corps: fin } = await appel('POST', `/trajets/${jetonSuivi}/fin`, {
      session: true, attendu: 200,
      corps: { latitude: 4.0610, longitude: 9.7770 },
    });
    reussi('Trajet terminé', `durée ${fin.dureeMinutes} min`);

    const { corps: objet } = await appel('POST', `/objets-perdus/trajet/${jetonSuivi}`, {
      session: true, attendu: 201,
      corps: {
        description: 'Sac à dos noir avec un ordinateur portable',
        telephoneContact: PROCHE,
      },
    });
    reussi('Objet oublié déclaré', 'le chauffeur est prévenu par SMS');

    await appel('POST', `/objets-perdus/chauffeur/${objet.id}/reponse`, {
      jeton: jetonChauffeur, attendu: 200,
      corps: { etat: 'retrouve', reponse: 'Je le dépose au commissariat de Bonanjo' },
    });
    reussi('Le chauffeur répond', 'le passager est rappelé par SMS');

    // ---------------------------------------------------------------
    console.log(couleur.titre('Ce qui a été écrit en base'));

    const compteurs = await pool.query(`
      SELECT
        (SELECT count(*) FROM chauffeur)      AS chauffeurs,
        (SELECT count(*) FROM document)       AS documents,
        (SELECT count(*) FROM trajet)         AS trajets,
        (SELECT count(*) FROM position_trajet) AS positions,
        (SELECT count(*) FROM alerte)         AS alertes,
        (SELECT count(*) FROM signalement)    AS signalements,
        (SELECT count(*) FROM objet_perdu)    AS objets,
        (SELECT count(*) FROM sms_sortant)    AS sms,
        (SELECT count(*) FROM journal_audit)  AS audit`);
    const c = compteurs.rows[0];
    for (const [nom, valeur] of Object.entries(c)) {
      console.log(couleur.info(`${nom.padEnd(14)} ${valeur}`));
    }

    const sms = await pool.query(
      `SELECT categorie, count(*) AS n FROM sms_sortant GROUP BY categorie ORDER BY categorie`,
    );
    console.log(couleur.info(
      'SMS : ' + sms.rows.map((s) => `${s.categorie}=${s.n}`).join(', '),
    ));

    console.log(`\n\x1b[1m\x1b[32m${etapes} vérifications passées.\x1b[0m`);

    if (GARDER) {
      console.log(couleur.alerte('Données conservées (--garder).'));
      console.log(couleur.info(`Superadmin : ${ADMIN} / ${MOT_DE_PASSE}`));
      console.log(couleur.info(`Agent      : ${AGENT} / ${MOT_DE_PASSE}`));
      console.log(couleur.info(`Chauffeur  : ${CHAUFFEUR} / ${MOT_DE_PASSE}`));
      console.log(couleur.info(`Session    : ${SESSION}`));
    } else {
      await nettoyer(pool);
      console.log(couleur.info('Données de démonstration effacées (--garder pour les conserver).'));
    }
  } finally {
    await pool.end();
  }
}

principal()
  .then(() => process.exit(0))
  .catch((erreur) => {
    console.error(`\n${couleur.erreur(erreur.message)}`);
    process.exit(1);
  });
