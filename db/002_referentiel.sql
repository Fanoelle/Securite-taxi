-- =====================================================================
--  Referentiel : regions et principales villes du Cameroun
-- =====================================================================

INSERT INTO region (code, nom) VALUES
    ('AD', 'Adamaoua'),
    ('CE', 'Centre'),
    ('ES', 'Est'),
    ('EN', 'Extreme-Nord'),
    ('LT', 'Littoral'),
    ('NO', 'Nord'),
    ('NW', 'Nord-Ouest'),
    ('OU', 'Ouest'),
    ('SU', 'Sud'),
    ('SW', 'Sud-Ouest')
ON CONFLICT (code) DO NOTHING;

INSERT INTO ville (region_code, nom) VALUES
    ('LT', 'Douala'),      ('LT', 'Nkongsamba'),  ('LT', 'Edea'),
    ('CE', 'Yaounde'),     ('CE', 'Mbalmayo'),    ('CE', 'Obala'),
    ('OU', 'Bafoussam'),   ('OU', 'Dschang'),     ('OU', 'Mbouda'),
    ('NW', 'Bamenda'),
    ('SW', 'Buea'),        ('SW', 'Limbe'),       ('SW', 'Kumba'),
    ('NO', 'Garoua'),
    ('EN', 'Maroua'),      ('EN', 'Kousseri'),
    ('AD', 'Ngaoundere'),
    ('ES', 'Bertoua'),
    ('SU', 'Ebolowa'),     ('SU', 'Kribi')
ON CONFLICT (region_code, nom) DO NOTHING;
