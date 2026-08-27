-- =====================================================================
--  Vues applicatives
-- =====================================================================

-- Vue publique du scan : STRICTEMENT ce que le passager a le droit de voir.
-- Aucune piece d'identite, aucune adresse, aucun numero personnel.
-- L'API ne doit jamais requeter les tables sources pour cet usage.
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
    c.statut_change_le  AS verifie_le
FROM code_qr q
JOIN chauffeur c ON c.id = q.chauffeur_id AND c.supprime_le IS NULL
JOIN vehicule  v ON v.chauffeur_id = c.id AND v.actif
JOIN ville     vl ON vl.id = c.ville_id
LEFT JOIN autorite a ON a.id = c.autorite_id
WHERE q.actif;

COMMENT ON VIEW v_scan_public IS
    'Projection publique du scan. Ne jamais y ajouter de donnee sensible : '
    'cette vue est la frontiere entre le dossier du chauffeur et le passager.';


-- File de validation vue par un agent, avec l'anciennete du dossier.
CREATE OR REPLACE VIEW v_file_validation AS
SELECT
    c.id                AS chauffeur_id,
    c.nom, c.prenom, c.photo_chemin, c.statut,
    vl.nom              AS ville,
    vl.id               AS ville_id,
    v.plaque, v.marque, v.modele, v.couleur,
    c.cree_le           AS depose_le,
    now() - c.cree_le   AS anciennete,
    (now() - c.cree_le) > interval '48 hours' AS urgent,
    (SELECT count(*) FROM document d WHERE d.chauffeur_id = c.id)                       AS documents_deposes,
    (SELECT count(*) FROM document d WHERE d.chauffeur_id = c.id AND d.verdict = 'lisible') AS documents_valides,
    (SELECT count(*) FROM document d WHERE d.chauffeur_id = c.id
                                       AND d.verdict IN ('illisible','expire','non_conforme')) AS documents_problematiques
FROM chauffeur c
JOIN ville vl ON vl.id = c.ville_id
LEFT JOIN vehicule v ON v.chauffeur_id = c.id AND v.actif
WHERE c.statut IN ('declare','en_examen')
  AND c.supprime_le IS NULL;


-- Derniere position connue de chaque trajet actif (pour la vue du proche).
CREATE OR REPLACE VIEW v_trajet_position_actuelle AS
SELECT DISTINCT ON (t.id)
    t.id                AS trajet_id,
    t.jeton_suivi,
    t.etat,
    t.demarre_le,
    p.latitude,
    p.longitude,
    p.mesure_le,
    now() - p.mesure_le AS fraicheur
FROM trajet t
LEFT JOIN position_trajet p ON p.trajet_id = t.id
WHERE t.etat IN ('en_cours','alerte')
ORDER BY t.id, p.mesure_le DESC;
