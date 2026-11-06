-- Accounts. Written only by the auth server. password_hash is a salted bcrypt hash.
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(20) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX users_username_lower_idx ON users (LOWER(username));

-- class_id stays NULL until the player finishes character creation.
CREATE TABLE player_profiles (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    avatar_file TEXT,
    class_id    VARCHAR(20),
    appearance  JSONB NOT NULL DEFAULT '{}',
    level       INT NOT NULL DEFAULT 1,
    xp          BIGINT NOT NULL DEFAULT 0,
    binary_dust BIGINT NOT NULL DEFAULT 0,
    strength    INT NOT NULL DEFAULT 10,
    dexterity   INT NOT NULL DEFAULT 10,
    arcane      INT NOT NULL DEFAULT 10,
    speed       INT NOT NULL DEFAULT 10,
    stamina     INT NOT NULL DEFAULT 10,
    health      INT NOT NULL DEFAULT 10,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE player_stats (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enemies_killed  INT NOT NULL DEFAULT 0,
    animals_hunted  INT NOT NULL DEFAULT 0,
    boss_kills      INT NOT NULL DEFAULT 0,
    boss_damage     BIGINT NOT NULL DEFAULT 0,
    deaths          INT NOT NULL DEFAULT 0
);

CREATE TABLE achievements (
    id          VARCHAR(40) PRIMARY KEY,
    name        VARCHAR(80) NOT NULL,
    description TEXT NOT NULL,
    sort_order  INT NOT NULL
);

CREATE TABLE user_achievements (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id VARCHAR(40) NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, achievement_id)
);

INSERT INTO achievements (id, name, description, sort_order) VALUES
    ('welcome',         'Welcome',         'Create your account.',                     10),
    ('profile_picture', 'Show Your Face',  'Set a profile picture.',                   20),
    ('first_blood',     'First Blood',     'Kill your first enemy.',                   30),
    ('beast_hunter',    'Beast Hunter',    'Hunt 10 animals.',                         40),
    ('grave_walker',    'Grave Walker',    'Defeat 25 undead enemies.',                50),
    ('boss_slayer',     'Boss Slayer',     'Help defeat the Ashen Sovereign.',         60),
    ('unbroken',        'Unbroken',        'Defeat the boss without dying in the fight.', 70);

-- Every account always has a profile, stats and its first achievement, no matter
-- which service created it.
CREATE FUNCTION init_new_player() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO player_profiles (user_id) VALUES (NEW.id);
    INSERT INTO player_stats (user_id) VALUES (NEW.id);
    INSERT INTO user_achievements (user_id, achievement_id) VALUES (NEW.id, 'welcome');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_init_player
    AFTER INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION init_new_player();

CREATE INDEX player_stats_boss_kills_idx  ON player_stats (boss_kills DESC, boss_damage DESC);
CREATE INDEX player_stats_boss_damage_idx ON player_stats (boss_damage DESC);
CREATE INDEX player_stats_kills_idx       ON player_stats (enemies_killed DESC);
CREATE INDEX player_profiles_level_idx    ON player_profiles (level DESC, xp DESC);
