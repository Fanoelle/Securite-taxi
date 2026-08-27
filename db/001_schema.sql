-- =====================================================================
--  Plateforme de securite des transports en commun - Cameroun
--  Schema initial  |  PostgreSQL 14+
--
--  Conventions :
--   - identifiants techniques en uuid (jamais exposes tels quels au public)
--   - horodatages en timestamptz, l'application travaille en Africa/Douala
--   - montants et coordonnees en numeric (jamais float pour du metier)
--   - suppression logique (supprime_le) partout ou une trace est utile
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- emails insensibles a la casse

-- Option (si PostGIS installe un jour) : remplacer latitude/longitude par
-- une colonne geography(Point,4326) et indexer en GIST.
-- CREATE EXTENSION IF NOT EXISTS postgis;


-- =====================================================================
--  1. REFERENTIEL TERRITORIAL
-- =====================================================================

CREATE TABLE region (
    code            text PRIMARY KEY,             -- 'LT', 'CE', 'OU'...
    nom             text NOT NULL
);

COMMENT ON TABLE region IS
    'Les 10 regions du Cameroun. Le code sert aussi de prefixe de plaque.';

CREATE TABLE ville (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    region_code     text NOT NULL REFERENCES region(code),
    nom             text NOT NULL,
    UNIQUE (region_code, nom)
);

-- Autorite de validation : commune, syndicat, delegation regionale.
-- C'est l'entite qui engage sa responsabilite en validant un chauffeur.
CREATE TABLE autorite (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ville_id        uuid NOT NULL REFERENCES ville(id),
    nom             text NOT NULL,                -- 'Commune de Douala V'
    type            text NOT NULL
                      CHECK (type IN ('commune','syndicat','delegation','interne')),
    -- Reception des alertes : engagement lourd, souvent refuse au depart.
    recoit_alertes  boolean NOT NULL DEFAULT false,
    telephone       text,
    actif           boolean NOT NULL DEFAULT true,
    cree_le         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN autorite.recoit_alertes IS
    'true seulement si l''autorite a formellement accepte de traiter les alertes en temps reel.';


-- =====================================================================
--  2. COMPTES ET ROLES
-- =====================================================================

-- Un compte = un acces authentifie (chauffeur ou agent). Le passager
-- n'a JAMAIS de compte : c'est un choix produit, pas un oubli.
CREATE TABLE compte (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    telephone           text NOT NULL UNIQUE,     -- format E.164 : +2376XXXXXXXX
    email               citext UNIQUE,
    mot_de_passe_hash   text,                     -- null si connexion par OTP seul
    role                text NOT NULL
                          CHECK (role IN ('chauffeur','agent','superadmin')),
    autorite_id         uuid REFERENCES autorite(id),  -- requis si role = agent
    telephone_verifie   boolean NOT NULL DEFAULT false,
    actif               boolean NOT NULL DEFAULT true,
    derniere_connexion  timestamptz,
    cree_le             timestamptz NOT NULL DEFAULT now(),
    modifie_le          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT agent_rattache_a_une_autorite
      CHECK (role <> 'agent' OR autorite_id IS NOT NULL),
    CONSTRAINT telephone_format_e164
      CHECK (telephone ~ '^\+237[26]\d{8}$')
);

CREATE INDEX idx_compte_role ON compte(role) WHERE actif;

-- Codes OTP pour la connexion par SMS (le mot de passe est optionnel :
-- beaucoup de chauffeurs n'auront pas d'email).
CREATE TABLE code_otp (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    telephone       text NOT NULL,
    code_hash       text NOT NULL,                -- jamais le code en clair
    tentatives      smallint NOT NULL DEFAULT 0,
    expire_le       timestamptz NOT NULL,
    consomme_le     timestamptz,
    cree_le         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_telephone ON code_otp(telephone, cree_le DESC);


-- =====================================================================
--  3. CHAUFFEURS ET VEHICULES
-- =====================================================================

CREATE TABLE chauffeur (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    compte_id           uuid NOT NULL UNIQUE REFERENCES compte(id) ON DELETE RESTRICT,

    nom                 text NOT NULL,
    prenom              text NOT NULL,
    date_naissance      date,
    lieu_naissance      text,
    ville_id            uuid NOT NULL REFERENCES ville(id),

    -- Photo affichee au passager. Le stockage est un chemin, pas un blob.
    photo_chemin        text,

    -- Reference interne attribuee A LA VALIDATION (ex : '0447-DLA').
    -- Nulle tant que le dossier n'est pas valide : c'est ce qui la rend credible.
    reference_licence   text UNIQUE,

    statut              text NOT NULL DEFAULT 'declare'
                          CHECK (statut IN ('declare','en_examen','verifie','certifie','suspendu','rejete')),
    autorite_id         uuid REFERENCES autorite(id),   -- qui a valide
    statut_change_le    timestamptz,
    motif_suspension    text,

    cree_le             timestamptz NOT NULL DEFAULT now(),
    modifie_le          timestamptz NOT NULL DEFAULT now(),
    supprime_le         timestamptz,

    CONSTRAINT reference_si_verifie
      CHECK (statut NOT IN ('verifie','certifie') OR reference_licence IS NOT NULL)
);

COMMENT ON COLUMN chauffeur.statut IS
    'declare = auto-inscrit, non controle. verifie = pieces controlees par un agent. '
    'certifie = confirme par une autorite partenaire. Le passager voit la difference.';

CREATE INDEX idx_chauffeur_statut ON chauffeur(statut) WHERE supprime_le IS NULL;
CREATE INDEX idx_chauffeur_ville  ON chauffeur(ville_id);

CREATE TABLE vehicule (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chauffeur_id        uuid NOT NULL REFERENCES chauffeur(id) ON DELETE CASCADE,

    -- Plaque normalisee SANS espaces en base ('LT452AB'), formatee a l'affichage.
    plaque              text NOT NULL,
    marque              text,
    modele              text,
    couleur             text,
    annee               smallint,

    -- La plaque a-t-elle ete recoupee avec la carte grise par un agent ?
    plaque_recoupee     boolean NOT NULL DEFAULT false,
    actif               boolean NOT NULL DEFAULT true,
    cree_le             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT plaque_normalisee CHECK (plaque ~ '^[A-Z]{2}[0-9]{3}[A-Z]{2}$')
);

-- Une plaque active ne peut appartenir qu'a un seul vehicule a la fois.
CREATE UNIQUE INDEX idx_vehicule_plaque_active
    ON vehicule(plaque) WHERE actif;

CREATE INDEX idx_vehicule_chauffeur ON vehicule(chauffeur_id) WHERE actif;


-- =====================================================================
--  4. DOCUMENTS JUSTIFICATIFS
--  Donnees sensibles : jamais exposees au passager, acces agent seulement.
-- =====================================================================

CREATE TABLE document (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chauffeur_id    uuid NOT NULL REFERENCES chauffeur(id) ON DELETE CASCADE,
    type            text NOT NULL
                      CHECK (type IN ('cni_recto','cni_verso','permis',
                                      'carte_grise','licence_transport','assurance')),
    chemin          text NOT NULL,
    -- Verdict de l'agent sur la lisibilite / validite de la piece.
    verdict         text CHECK (verdict IN ('lisible','illisible','expire','non_conforme')),
    commentaire     text,
    date_expiration date,                       -- permis, assurance
    examine_par     uuid REFERENCES compte(id),
    examine_le      timestamptz,
    cree_le         timestamptz NOT NULL DEFAULT now(),

    UNIQUE (chauffeur_id, type)
);

COMMENT ON TABLE document IS
    'Pieces justificatives. Acces strictement reserve aux agents validateurs. '
    'Purge obligatoire selon la politique de conservation (loi 2024/017).';


-- =====================================================================
--  5. CODE QR
--  Le QR encode un jeton court et opaque, jamais l'identifiant interne.
--  Revocable : si un QR est copie ou vole, on en emet un nouveau.
-- =====================================================================

CREATE TABLE code_qr (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chauffeur_id    uuid NOT NULL REFERENCES chauffeur(id) ON DELETE CASCADE,
    jeton           text NOT NULL UNIQUE,        -- ex : '0447DLA', court, sans ambiguite
    actif           boolean NOT NULL DEFAULT true,
    emis_le         timestamptz NOT NULL DEFAULT now(),
    revoque_le      timestamptz,
    motif_revocation text
);

-- Un seul QR actif par chauffeur.
CREATE UNIQUE INDEX idx_qr_chauffeur_actif
    ON code_qr(chauffeur_id) WHERE actif;

CREATE INDEX idx_qr_jeton ON code_qr(jeton) WHERE actif;


-- =====================================================================
--  6. TRAJETS
--  Le passager n'a pas de compte : il est identifie par un jeton de
--  session anonyme, stocke cote navigateur.
-- =====================================================================

CREATE TABLE trajet (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Jeton public court utilise dans l'URL de suivi (strk.cm/f4m2).
    jeton_suivi         text NOT NULL UNIQUE,

    chauffeur_id        uuid NOT NULL REFERENCES chauffeur(id),
    vehicule_id         uuid NOT NULL REFERENCES vehicule(id),
    code_qr_id          uuid REFERENCES code_qr(id),

    -- Photo du statut du chauffeur AU MOMENT du scan : si le chauffeur est
    -- suspendu plus tard, on doit savoir ce que le passager avait vu.
    statut_chauffeur_au_scan text NOT NULL,

    -- Session anonyme du passager (pas d'identite, pas de compte).
    session_passager    text NOT NULL,

    demarre_le          timestamptz NOT NULL DEFAULT now(),
    termine_le          timestamptz,
    etat                text NOT NULL DEFAULT 'en_cours'
                          CHECK (etat IN ('en_cours','termine','alerte','abandonne')),

    depart_latitude     numeric(9,6),
    depart_longitude    numeric(9,6),
    arrivee_latitude    numeric(9,6),
    arrivee_longitude   numeric(9,6),

    -- Purge des positions a 30 jours sauf incident (voir 010_retention.sql).
    positions_purgees_le timestamptz,

    CONSTRAINT coherence_fin
      CHECK (termine_le IS NULL OR termine_le >= demarre_le)
);

CREATE INDEX idx_trajet_chauffeur ON trajet(chauffeur_id, demarre_le DESC);
CREATE INDEX idx_trajet_en_cours  ON trajet(etat) WHERE etat = 'en_cours';
CREATE INDEX idx_trajet_jeton     ON trajet(jeton_suivi);

-- Positions GPS. Table volumineuse : une ligne toutes les 90 s par trajet actif.
CREATE TABLE position_trajet (
    id              bigserial PRIMARY KEY,
    trajet_id       uuid NOT NULL REFERENCES trajet(id) ON DELETE CASCADE,
    latitude        numeric(9,6) NOT NULL,
    longitude       numeric(9,6) NOT NULL,
    precision_m     smallint,
    -- Horodatage cote appareil : le telephone peut bufferiser hors reseau
    -- et tout envoyer d'un coup au retour du signal.
    mesure_le       timestamptz NOT NULL,
    recu_le         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT latitude_valide  CHECK (latitude  BETWEEN -90  AND 90),
    CONSTRAINT longitude_valide CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX idx_position_trajet ON position_trajet(trajet_id, mesure_le DESC);


-- =====================================================================
--  7. CONTACTS DE CONFIANCE ET PARTAGES
-- =====================================================================

-- Contacts memorises par navigateur (session anonyme), pas par compte.
CREATE TABLE contact_confiance (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_passager    text NOT NULL,
    nom                 text NOT NULL,
    telephone           text NOT NULL,
    cree_le             timestamptz NOT NULL DEFAULT now(),

    UNIQUE (session_passager, telephone),
    CONSTRAINT contact_telephone_e164
      CHECK (telephone ~ '^\+237[26]\d{8}$')
);

CREATE INDEX idx_contact_session ON contact_confiance(session_passager);

CREATE TABLE partage_trajet (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trajet_id           uuid NOT NULL REFERENCES trajet(id) ON DELETE CASCADE,
    nom_destinataire    text NOT NULL,
    telephone           text NOT NULL,
    -- Etat d'acheminement remonte par l'agregateur SMS.
    etat_sms            text NOT NULL DEFAULT 'en_attente'
                          CHECK (etat_sms IN ('en_attente','envoye','recu','echec')),
    envoye_le           timestamptz,
    consulte_le         timestamptz,             -- le proche a-t-il ouvert le lien ?
    cree_le             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partage_trajet ON partage_trajet(trajet_id);


-- =====================================================================
--  8. ALERTES
-- =====================================================================

CREATE TABLE alerte (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trajet_id           uuid NOT NULL REFERENCES trajet(id),
    declenchee_le       timestamptz NOT NULL DEFAULT now(),

    latitude            numeric(9,6),
    longitude           numeric(9,6),

    etat                text NOT NULL DEFAULT 'active'
                          CHECK (etat IN ('active','annulee','close')),
    -- Une fausse alerte reste tracee : c'est un signal produit, pas un dechet.
    annulee_le          timestamptz,
    motif_annulation    text,
    close_par           uuid REFERENCES compte(id),
    close_le            timestamptz,
    note_traitement     text
);

CREATE INDEX idx_alerte_active ON alerte(etat) WHERE etat = 'active';
CREATE INDEX idx_alerte_trajet ON alerte(trajet_id);

CREATE TABLE alerte_destinataire (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alerte_id       uuid NOT NULL REFERENCES alerte(id) ON DELETE CASCADE,
    type            text NOT NULL CHECK (type IN ('proche','autorite')),
    nom             text NOT NULL,
    telephone       text,
    autorite_id     uuid REFERENCES autorite(id),
    etat_sms        text NOT NULL DEFAULT 'en_attente'
                      CHECK (etat_sms IN ('en_attente','envoye','recu','echec')),
    envoye_le       timestamptz
);


-- =====================================================================
--  9. SIGNALEMENTS
--  Deux origines : incoherence au scan, ou probleme pendant le trajet.
-- =====================================================================

CREATE TABLE signalement (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trajet_id           uuid REFERENCES trajet(id),
    chauffeur_id        uuid REFERENCES chauffeur(id),
    code_qr_id          uuid REFERENCES code_qr(id),
    session_passager    text,

    motif               text NOT NULL
                          CHECK (motif IN ('photo_differente','plaque_differente',
                                           'qr_suspect','comportement','objet_perdu','autre')),
    description         text,

    etat                text NOT NULL DEFAULT 'ouvert'
                          CHECK (etat IN ('ouvert','en_examen','fonde','non_fonde','clos')),
    traite_par          uuid REFERENCES compte(id),
    traite_le           timestamptz,
    note_traitement     text,
    cree_le             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT signalement_cible
      CHECK (trajet_id IS NOT NULL OR chauffeur_id IS NOT NULL OR code_qr_id IS NOT NULL)
);

CREATE INDEX idx_signalement_ouvert ON signalement(etat) WHERE etat IN ('ouvert','en_examen');


-- =====================================================================
--  10. OBJETS PERDUS
--  Le cas d'usage frequent et non anxiogene : il porte l'adoption.
-- =====================================================================

CREATE TABLE objet_perdu (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trajet_id           uuid NOT NULL REFERENCES trajet(id),
    description         text NOT NULL,
    -- Numero du passager, saisi volontairement pour etre rappele.
    telephone_contact   text,
    etat                text NOT NULL DEFAULT 'declare'
                          CHECK (etat IN ('declare','vu_chauffeur','retrouve','non_retrouve')),
    reponse_chauffeur   text,
    cree_le             timestamptz NOT NULL DEFAULT now(),
    modifie_le          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_objet_trajet ON objet_perdu(trajet_id);


-- =====================================================================
--  11. SMS - FILE D'ENVOI
--  Le SMS est un canal de premiere classe, pas un repli : il doit etre
--  suivi, reessaye, et son cout mesure.
-- =====================================================================

CREATE TABLE sms_sortant (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    telephone       text NOT NULL,
    contenu         text NOT NULL,
    categorie       text NOT NULL
                      CHECK (categorie IN ('otp','partage','alerte','annulation','notification')),
    -- Une alerte passe avant un OTP quand la file est chargee.
    priorite        smallint NOT NULL DEFAULT 5,

    etat            text NOT NULL DEFAULT 'en_attente'
                      CHECK (etat IN ('en_attente','envoye','recu','echec','abandonne')),
    tentatives      smallint NOT NULL DEFAULT 0,
    fournisseur     text,                       -- 'nexah', 'kys', 'twilio'
    reference_ext   text,                       -- identifiant cote agregateur
    cout_fcfa       numeric(8,2),               -- suivi du budget SMS
    erreur          text,

    cree_le         timestamptz NOT NULL DEFAULT now(),
    envoye_le       timestamptz,

    -- Lien optionnel vers ce qui a motive l'envoi.
    alerte_id       uuid REFERENCES alerte(id),
    partage_id      uuid REFERENCES partage_trajet(id)
);

CREATE INDEX idx_sms_file ON sms_sortant(etat, priorite, cree_le)
    WHERE etat IN ('en_attente','echec');


-- =====================================================================
--  12. JOURNAL D'AUDIT
--  Obligation reglementaire ET protection : qui a vu quelle piece,
--  qui a valide qui, qui a consulte quelle position.
-- =====================================================================

CREATE TABLE journal_audit (
    id              bigserial PRIMARY KEY,
    compte_id       uuid REFERENCES compte(id),
    action          text NOT NULL,              -- 'chauffeur.valide', 'document.consulte'...
    entite          text NOT NULL,
    entite_id       uuid,
    details         jsonb,
    adresse_ip      inet,
    cree_le         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entite ON journal_audit(entite, entite_id, cree_le DESC);
CREATE INDEX idx_audit_compte ON journal_audit(compte_id, cree_le DESC);


-- =====================================================================
--  13. DECLENCHEURS - horodatage de modification
-- =====================================================================

CREATE OR REPLACE FUNCTION touch_modifie_le() RETURNS trigger AS $$
BEGIN
    NEW.modifie_le = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compte_touch     BEFORE UPDATE ON compte
    FOR EACH ROW EXECUTE FUNCTION touch_modifie_le();
CREATE TRIGGER trg_chauffeur_touch  BEFORE UPDATE ON chauffeur
    FOR EACH ROW EXECUTE FUNCTION touch_modifie_le();
CREATE TRIGGER trg_objet_touch      BEFORE UPDATE ON objet_perdu
    FOR EACH ROW EXECUTE FUNCTION touch_modifie_le();
