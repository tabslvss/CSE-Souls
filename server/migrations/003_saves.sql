-- Up to three saves per account. A save is a whole character: class, looks, stats, dust, and what it
-- has found. The account keeps its name, picture, kill record and achievements.
CREATE TABLE character_saves (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot          SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 3),
    class_id      VARCHAR(20) NOT NULL,
    appearance    JSONB NOT NULL DEFAULT '{}',
    level         INT NOT NULL DEFAULT 1,
    xp            BIGINT NOT NULL DEFAULT 0,
    binary_dust   BIGINT NOT NULL DEFAULT 0 CHECK (binary_dust >= 0),
    strength      INT NOT NULL DEFAULT 10 CHECK (strength <= 40),
    dexterity     INT NOT NULL DEFAULT 10 CHECK (dexterity <= 40),
    arcane        INT NOT NULL DEFAULT 10 CHECK (arcane <= 40),
    speed         INT NOT NULL DEFAULT 10 CHECK (speed <= 40),
    stamina       INT NOT NULL DEFAULT 10 CHECK (stamina <= 40),
    health        INT NOT NULL DEFAULT 10 CHECK (health <= 40),
    respawn_grace INT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, slot)
);
CREATE INDEX character_saves_level_idx ON character_saves (level DESC, xp DESC);

-- Everyone's existing character becomes their first save, with nothing changed.
INSERT INTO character_saves (user_id, slot, class_id, appearance, level, xp, binary_dust,
                             strength, dexterity, arcane, speed, stamina, health, updated_at)
SELECT user_id, 1, class_id, appearance, level, xp, binary_dust,
       strength, dexterity, arcane, speed, stamina, health, updated_at
FROM player_profiles
WHERE class_id IS NOT NULL;

ALTER TABLE player_profiles
    ADD COLUMN active_slot SMALLINT NOT NULL DEFAULT 1 CHECK (active_slot BETWEEN 1 AND 3);

-- Moved above, so there's only one place these can be read from.
ALTER TABLE player_profiles
    DROP COLUMN class_id,
    DROP COLUMN appearance,
    DROP COLUMN level,
    DROP COLUMN xp,
    DROP COLUMN binary_dust,
    DROP COLUMN strength,
    DROP COLUMN dexterity,
    DROP COLUMN arcane,
    DROP COLUMN speed,
    DROP COLUMN stamina,
    DROP COLUMN health;

-- Chests opened so far belong to the first save. A chest row with no character can't have paid anything out.
ALTER TABLE opened_chests ADD COLUMN slot SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE opened_chests ALTER COLUMN slot DROP DEFAULT;
DELETE FROM opened_chests o
WHERE NOT EXISTS (SELECT 1 FROM character_saves c WHERE c.user_id = o.user_id AND c.slot = o.slot);
ALTER TABLE opened_chests DROP CONSTRAINT opened_chests_pkey;
ALTER TABLE opened_chests ADD PRIMARY KEY (user_id, slot, chest_id);
ALTER TABLE opened_chests
    ADD CONSTRAINT opened_chests_save_fkey
    FOREIGN KEY (user_id, slot) REFERENCES character_saves (user_id, slot) ON DELETE CASCADE;

-- The primary key is what makes lighting a grace twice do nothing.
CREATE TABLE discovered_graces (
    user_id       UUID NOT NULL,
    slot          SMALLINT NOT NULL,
    grace_id      INT NOT NULL,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, slot, grace_id),
    FOREIGN KEY (user_id, slot) REFERENCES character_saves (user_id, slot) ON DELETE CASCADE
);

INSERT INTO achievements (id, name, description, sort_order) VALUES
    ('first_grace',   'Warm Light',    'Light a Binary Grace.',                     25),
    ('first_upgrade', 'Stronger Code', 'Raise a stat with Binary Dust.',            27);
