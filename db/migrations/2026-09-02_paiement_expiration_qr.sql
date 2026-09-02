-- =====================================================================
--  Migration du 2 septembre 2026 — paiement et expiration du code QR
--
--  Le code QR cesse d'etre seulement une preuve de controle : il devient
--  aussi une preuve de paiement, valable six mois.
--
--  Deux decisions structurent ce fichier.
--
--  1. On encaisse APRES la validation, jamais avant. L'agent examine les
--     pieces et valide le dossier ; le QR n'est emis qu'une fois les
--     frais regles. Encaisser d'abord obligerait a rembourser un dossier
--     rejete — donc une procedure, un litige possible, et du code pour
--     le gerer. Ici, un dossier rejete n'a rien encaisse.
--
--  2. L'expiration est portee par la base, pas par le code applicatif.
--     Un QR expire doit cesser d'etre scannable meme si aucune tache de
--     fond ne tourne, meme si l'API redemarre : la vue publique filtre
--     sur la date, elle ne lit pas un drapeau qu'un traitement aurait
--     du mettre a jour. Un balayage nocturne qui ne s'execute pas
--     laisserait sinon des QR expires paraitre valides — exactement le
--     mensonge que le produit ne doit pas commettre.
--
--  A appliquer sur toute base creee avant cette date. Idempotent.
--
--  Usage :  psql -d securitaxi -v ON_ERROR_STOP=1 -f db/migrations/2026-09-02_paiement_expiration_qr.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Les frais d'emission
--
-- Le montant n'est pas fige dans le code : il est porte par l'autorite,
-- qui peut le faire evoluer sans redeploiement. Une commune peut aussi
-- pratiquer un tarif different d'une autre.
--
-- numeric, jamais float : c'est de l'argent.
-- ---------------------------------------------------------------------
ALTER TABLE autorite
    ADD COLUMN IF NOT EXISTS frais_qr_fcfa   numeric(10,0),
    ADD COLUMN IF NOT EXISTS validite_qr_mois integer NOT NULL DEFAULT 6;

ALTER TABLE autorite
    DROP CONSTRAINT IF EXISTS autorite_frais_positifs;
ALTER TABLE autorite
    ADD CONSTRAINT autorite_frais_positifs
    CHECK (frais_qr_fcfa IS NULL OR frais_qr_fcfa >= 0);

ALTER TABLE autorite
    DROP CONSTRAINT IF EXISTS autorite_validite_bornee;
ALTER TABLE autorite
    ADD CONSTRAINT autorite_validite_bornee
    CHECK (validite_qr_mois BETWEEN 1 AND 60);

COMMENT ON COLUMN autorite.frais_qr_fcfa IS
    'Frais d''emission du code QR, en FCFA. NULL = tarif non encore fixe, '
    'l''emission est alors refusee : mieux vaut bloquer que d''encaisser '
    'un montant arbitraire.';
COMMENT ON COLUMN autorite.validite_qr_mois IS
    'Duree de validite du QR emis, en mois. Six par defaut.';

-- ---------------------------------------------------------------------
-- 2. Les paiements
--
-- Une ligne par tentative, pas seulement par succes : une trace de ce
-- qui a echoue vaut autant qu'une trace de ce qui a reussi, et c'est ce
-- qu'un chauffeur presentera s'il conteste avoir paye.
--
-- La reference externe est celle du prestataire (Mobile Money) ou du
-- recu de guichet. Unique quand elle existe : le meme paiement ne doit
-- pas pouvoir etre compte deux fois si une confirmation arrive en
-- double, ce qui est la norme avec les webhooks.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paiement (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chauffeur_id      uuid NOT NULL REFERENCES chauffeur(id) ON DELETE CASCADE,
    autorite_id       uuid REFERENCES autorite(id),
    montant_fcfa      numeric(10,0) NOT NULL CHECK (montant_fcfa >= 0),
    mode              text NOT NULL CHECK (mode IN ('mobile_money','guichet')),
    operateur         text CHECK (operateur IN ('mtn','orange')),
    telephone_payeur  text,
    reference_externe text,
    statut            text NOT NULL DEFAULT 'en_attente'
                      CHECK (statut IN ('en_attente','confirme','echoue','expire')),
    motif             text,
    -- Ce que le paiement a ouvert comme droit. Renseigne a la
    -- confirmation, jamais avant.
    qr_id             uuid REFERENCES code_qr(id) ON DELETE SET NULL,
    cree_le           timestamptz NOT NULL DEFAULT now(),
    confirme_le       timestamptz,

    -- Un paiement confirme dit quand il l'a ete ; un paiement echoue dit
    -- pourquoi. Sans cela, une ligne « echoue » sans motif ne permet de
    -- repondre a personne.
    CONSTRAINT paiement_confirme_date CHECK (
        (statut = 'confirme') = (confirme_le IS NOT NULL)),
    CONSTRAINT paiement_echec_motive CHECK (
        statut <> 'echoue' OR motif IS NOT NULL),
    -- Un paiement par Mobile Money sans operateur ne veut rien dire.
    CONSTRAINT paiement_operateur_requis CHECK (
        mode <> 'mobile_money' OR operateur IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS paiement_reference_unique
    ON paiement (reference_externe) WHERE reference_externe IS NOT NULL;
CREATE INDEX IF NOT EXISTS paiement_chauffeur_idx
    ON paiement (chauffeur_id, cree_le DESC);

COMMENT ON TABLE paiement IS
    'Frais d''emission du code QR. Une ligne par tentative, y compris les '
    'echecs : c''est la trace qu''un chauffeur presentera en cas de litige.';

-- ---------------------------------------------------------------------
-- 3. L'expiration du QR
--
-- expire_le est NULL pour les QR deja emis avant cette migration : ils
-- restent valables sans limite. Les faire expirer retroactivement
-- invaliderait du jour au lendemain des autocollants deja poses sur des
-- taxis, sans que le chauffeur ait ete prevenu ni ait pu payer.
-- ---------------------------------------------------------------------
ALTER TABLE code_qr
    ADD COLUMN IF NOT EXISTS expire_le timestamptz;

CREATE INDEX IF NOT EXISTS code_qr_expiration_idx
    ON code_qr (expire_le) WHERE actif;

COMMENT ON COLUMN code_qr.expire_le IS
    'Fin de validite. NULL = sans limite (QR emis avant l''instauration '
    'des frais). Un QR expire n''apparait plus dans v_scan_public.';

-- ---------------------------------------------------------------------
-- 4. La vue publique du scan
--
-- C'est ici que l'expiration mord reellement. Le filtre est sur la date,
-- pas sur un drapeau : aucun traitement de fond n'a besoin de tourner
-- pour qu'un QR expire cesse d'etre scannable.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_scan_public AS
SELECT
    q.jeton,
    c.id                AS chauffeur_id,
    c.nom,
    c.prenom,
    c.photo_chemin,
    c.statut,
    c.reference_licence,
    c.cree_le           AS chauffeur_inscrit_le,
    v.id                AS vehicule_id,
    v.plaque,
    v.marque,
    v.modele,
    v.couleur,
    v.plaque_recoupee,
    vl.nom              AS ville,
    a.nom               AS autorite_nom,
    c.statut_change_le  AS verifie_le,
    q.expire_le
FROM code_qr q
JOIN chauffeur c ON c.id = q.chauffeur_id AND c.supprime_le IS NULL
JOIN vehicule  v ON v.chauffeur_id = c.id AND v.actif
JOIN ville     vl ON vl.id = c.ville_id
LEFT JOIN autorite a ON a.id = c.autorite_id
WHERE q.actif
  AND (q.expire_le IS NULL OR q.expire_le > now());

COMMENT ON VIEW v_scan_public IS
    'Projection publique du scan. Ne jamais y ajouter de donnee sensible : '
    'cette vue est la frontiere entre le dossier du chauffeur et le passager. '
    'Le filtre sur expire_le fait qu''un QR perime cesse d''etre scannable '
    'sans qu''aucune tache de fond ait a s''executer.';

COMMIT;
