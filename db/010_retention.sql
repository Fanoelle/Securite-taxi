-- =====================================================================
--  Politique de conservation des donnees
--  Loi camerounaise n° 2024/017 sur la protection des donnees personnelles.
--
--  A executer quotidiennement (cron / pg_cron).
--  Regle : les traces GPS sont supprimees a 30 jours, SAUF si le trajet
--  est lie a une alerte ou un signalement en cours d'examen.
-- =====================================================================

CREATE OR REPLACE FUNCTION purger_positions_anciennes(jours integer DEFAULT 30)
RETURNS TABLE (trajets_purges bigint, positions_supprimees bigint) AS $$
DECLARE
    v_trajets   bigint := 0;
    v_positions bigint := 0;
BEGIN
    WITH cibles AS (
        SELECT t.id
        FROM trajet t
        WHERE t.demarre_le < now() - make_interval(days => jours)
          AND t.positions_purgees_le IS NULL
          -- On conserve tout ce qui est lie a un incident non clos.
          AND NOT EXISTS (
                SELECT 1 FROM alerte a
                WHERE a.trajet_id = t.id AND a.etat <> 'close')
          AND NOT EXISTS (
                SELECT 1 FROM signalement s
                WHERE s.trajet_id = t.id AND s.etat IN ('ouvert','en_examen','fonde'))
    ),
    suppression AS (
        DELETE FROM position_trajet p
        USING cibles c
        WHERE p.trajet_id = c.id
        RETURNING p.trajet_id
    ),
    marquage AS (
        UPDATE trajet t
        SET positions_purgees_le = now()
        FROM cibles c
        WHERE t.id = c.id
        RETURNING t.id
    )
    SELECT
        (SELECT count(*) FROM marquage),
        (SELECT count(*) FROM suppression)
    INTO v_trajets, v_positions;

    RETURN QUERY SELECT v_trajets, v_positions;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purger_positions_anciennes IS
    'Purge des traces GPS a 30 jours. Les trajets lies a une alerte active ou '
    'un signalement en examen sont preserves jusqu''a cloture du dossier.';


-- Purge des codes OTP consommes ou expires (aucune valeur au-dela de 24 h).
CREATE OR REPLACE FUNCTION purger_otp_expires()
RETURNS bigint AS $$
DECLARE v_n bigint;
BEGIN
    DELETE FROM code_otp
    WHERE cree_le < now() - interval '24 hours';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$ LANGUAGE plpgsql;
