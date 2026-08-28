-- =====================================================================
--  Migration du 28 aout 2026 — reference de relais call center
--
--  Contexte : le numero du chauffeur ne sort plus d'aucun point de l'API
--  passager. Le besoin legitime — joindre le chauffeur pour un objet
--  oublie — passe desormais par un call center, qui met en relation sur
--  presentation d'une reference de dossier.
--
--  Cette reference est portee par le trajet et doit etre stable : le
--  passager qui rappelle une seconde fois doit tomber sur le meme
--  dossier, pas en ouvrir un nouveau. D'ou la contrainte d'unicite.
--
--  A appliquer sur toute base creee avant cette date. Les nouvelles
--  installations recoivent la colonne directement par 001_schema.sql ;
--  ce fichier est idempotent et peut donc etre execute sans risque dans
--  les deux cas.
--
--  Usage :  psql -d securitaxi -v ON_ERROR_STOP=1 -f db/migrations/2026-08-28_reference_relais.sql
-- =====================================================================

BEGIN;

ALTER TABLE trajet
    ADD COLUMN IF NOT EXISTS reference_relais text;

-- La contrainte d'unicite est ajoutee separement : ADD COLUMN IF NOT
-- EXISTS ne la reapplique pas sur une colonne deja presente.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'trajet'::regclass
           AND conname  = 'trajet_reference_relais_key'
    ) THEN
        ALTER TABLE trajet
            ADD CONSTRAINT trajet_reference_relais_key UNIQUE (reference_relais);
    END IF;
END $$;

COMMENT ON COLUMN trajet.reference_relais IS
    'Reference donnee au passager pour joindre le call center apres la '
    'course (objet oublie). Le numero du chauffeur n''est jamais '
    'divulgue : l''operateur fait le relais. Creee a la premiere demande.';

COMMIT;
