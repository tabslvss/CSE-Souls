-- The first boss, Cinderhorn, the Great Bull. boss_slayer stays for the final boss still to come.
INSERT INTO achievements (id, name, description, sort_order) VALUES
    ('bull_slayer', 'Horn Breaker', 'Help defeat Cinderhorn, the Great Bull.', 55)
ON CONFLICT (id) DO NOTHING;
