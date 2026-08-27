-- =====================================================================
--  Activation optionnelle de PostGIS
--
--  A executer APRES 001_schema.sql, une fois le paquet installe :
--      sudo apt install postgresql-14-postgis-3 postgresql-14-postgis-3-scripts
--
--  Ce script est IDEMPOTENT et sans effet si PostGIS est absent :
--  le schema fonctionne parfaitement sans lui (latitude/longitude en numeric).
--  PostGIS n'apporte que les requetes spatiales (rayon, proximite, distance).
-- =====================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
        RAISE NOTICE 'PostGIS absent : le schema reste en latitude/longitude numeric. Rien a faire.';
        RETURN;
    END IF;

    CREATE EXTENSION IF NOT EXISTS postgis;
    RAISE NOTICE 'PostGIS active.';

    -- --- Colonnes geographiques derivees -----------------------------
    -- On GARDE latitude/longitude comme source de verite (l'API ecrit
    -- dedans) et on ajoute un point geographique maintenu par declencheur.
    -- Aucune migration de donnees, aucun code applicatif a changer.

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'position_trajet' AND column_name = 'point') THEN
        ALTER TABLE position_trajet ADD COLUMN point geography(Point, 4326);
        CREATE INDEX idx_position_point ON position_trajet USING GIST (point);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'alerte' AND column_name = 'point') THEN
        ALTER TABLE alerte ADD COLUMN point geography(Point, 4326);
        CREATE INDEX idx_alerte_point ON alerte USING GIST (point);
    END IF;
END
$$;


-- --- Maintien automatique des colonnes geographiques -----------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
        RETURN;
    END IF;

    CREATE OR REPLACE FUNCTION maj_point_geographique() RETURNS trigger AS $f$
    BEGIN
        IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
            NEW.point := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
        ELSE
            NEW.point := NULL;
        END IF;
        RETURN NEW;
    END;
    $f$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_position_point ON position_trajet;
    CREATE TRIGGER trg_position_point
        BEFORE INSERT OR UPDATE OF latitude, longitude ON position_trajet
        FOR EACH ROW EXECUTE FUNCTION maj_point_geographique();

    DROP TRIGGER IF EXISTS trg_alerte_point ON alerte;
    CREATE TRIGGER trg_alerte_point
        BEFORE INSERT OR UPDATE OF latitude, longitude ON alerte
        FOR EACH ROW EXECUTE FUNCTION maj_point_geographique();

    -- Remplissage des lignes deja presentes.
    UPDATE position_trajet SET latitude = latitude WHERE point IS NULL AND latitude IS NOT NULL;
    UPDATE alerte          SET latitude = latitude WHERE point IS NULL AND latitude IS NOT NULL;

    RAISE NOTICE 'Declencheurs geographiques installes.';
END
$$;


-- --- Fonctions spatiales utiles --------------------------------------
-- Alertes actives dans un rayon donne : ce qu'un agent municipal ouvre
-- en premier quand il prend son poste.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
        RETURN;
    END IF;

    CREATE OR REPLACE FUNCTION alertes_proches(
        p_latitude  numeric,
        p_longitude numeric,
        p_rayon_m   integer DEFAULT 5000
    )
    RETURNS TABLE (
        alerte_id      uuid,
        trajet_id      uuid,
        distance_m     double precision,
        declenchee_le  timestamptz
    ) AS $f$
        SELECT a.id, a.trajet_id,
               ST_Distance(a.point,
                   ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography),
               a.declenchee_le
        FROM alerte a
        WHERE a.etat = 'active'
          AND a.point IS NOT NULL
          AND ST_DWithin(a.point,
                  ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
                  p_rayon_m)
        ORDER BY 3;
    $f$ LANGUAGE sql STABLE;

    -- Distance totale parcourue sur un trajet (km), pour les statistiques.
    CREATE OR REPLACE FUNCTION distance_trajet_km(p_trajet_id uuid)
    RETURNS numeric AS $f$
        WITH ordonnees AS (
            SELECT point, LAG(point) OVER (ORDER BY mesure_le) AS precedent
            FROM position_trajet
            WHERE trajet_id = p_trajet_id AND point IS NOT NULL
        )
        SELECT round((COALESCE(SUM(ST_Distance(point, precedent)), 0) / 1000)::numeric, 2)
        FROM ordonnees WHERE precedent IS NOT NULL;
    $f$ LANGUAGE sql STABLE;

    RAISE NOTICE 'Fonctions spatiales installees.';
END
$$;
