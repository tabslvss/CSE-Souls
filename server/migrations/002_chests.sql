-- Each account opens each chest once. The primary key is what makes a double open impossible,
-- even if two connections race, because the reward is granted in the same statement as the insert.
CREATE TABLE opened_chests (
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chest_id  INT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, chest_id)
);
