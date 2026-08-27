-- Stick Fighter: ELO & Leaderboard schema
-- Run once against a fresh Postgres database.

CREATE TABLE IF NOT EXISTS players (
    user_id   TEXT PRIMARY KEY,
    name      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS elo_ratings (
    user_id   TEXT NOT NULL REFERENCES players(user_id) ON DELETE CASCADE,
    category  TEXT NOT NULL CHECK (category IN ('voice', 'keyboard')),
    rating    REAL NOT NULL DEFAULT 1000,
    wins      INTEGER NOT NULL DEFAULT 0,
    losses    INTEGER NOT NULL DEFAULT 0,
    draws     INTEGER NOT NULL DEFAULT 0,
    matches   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, category)
);

CREATE INDEX IF NOT EXISTS idx_elo_category_rating
    ON elo_ratings (category, rating DESC);

CREATE TABLE IF NOT EXISTS match_history (
    id                    SERIAL PRIMARY KEY,
    winner_id             TEXT REFERENCES players(user_id),
    loser_id              TEXT REFERENCES players(user_id),
    category              TEXT NOT NULL CHECK (category IN ('voice', 'keyboard')),
    winner_rating_before  REAL NOT NULL,
    loser_rating_before   REAL NOT NULL,
    winner_rating_after   REAL NOT NULL,
    loser_rating_after    REAL NOT NULL,
    draw                  BOOLEAN NOT NULL DEFAULT FALSE,
    played_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_history_played_at
    ON match_history (played_at DESC);

-- Reward-candidate ratings are isolated by competitive league and input
-- division. Legacy elo_ratings remain available for historical display only.
CREATE TABLE IF NOT EXISTS competitive_ratings (
    wallet_address  TEXT NOT NULL REFERENCES players(user_id) ON DELETE CASCADE,
    league          TEXT NOT NULL CHECK (league IN ('skill', 'boosted')),
    input_category  TEXT NOT NULL CHECK (input_category IN ('voice', 'keyboard')),
    rating          REAL NOT NULL DEFAULT 1000,
    wins            INTEGER NOT NULL DEFAULT 0,
    losses          INTEGER NOT NULL DEFAULT 0,
    draws           INTEGER NOT NULL DEFAULT 0,
    matches         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (wallet_address, league, input_category)
);

CREATE INDEX IF NOT EXISTS idx_competitive_leaderboard
    ON competitive_ratings (league, input_category, rating DESC);

CREATE TABLE IF NOT EXISTS ranked_match_settlements (
    match_id          TEXT PRIMARY KEY,
    room_code         TEXT NOT NULL UNIQUE,
    league            TEXT NOT NULL CHECK (league IN ('skill', 'boosted')),
    input_category    TEXT NOT NULL CHECK (input_category IN ('voice', 'keyboard')),
    p1_wallet         TEXT NOT NULL REFERENCES players(user_id),
    p2_wallet         TEXT NOT NULL REFERENCES players(user_id),
    winner_player     SMALLINT CHECK (winner_player IN (1, 2)),
    result            TEXT NOT NULL CHECK (result IN ('p1_win', 'p2_win', 'draw')),
    reason            TEXT NOT NULL,
    p1_health         REAL NOT NULL,
    p2_health         REAL NOT NULL,
    server_tick       BIGINT NOT NULL,
    p1_boost_charges  INTEGER NOT NULL DEFAULT 0 CHECK (p1_boost_charges >= 0),
    p2_boost_charges  INTEGER NOT NULL DEFAULT 0 CHECK (p2_boost_charges >= 0),
    p1_rating_before  REAL NOT NULL,
    p2_rating_before  REAL NOT NULL,
    p1_rating_after   REAL NOT NULL,
    p2_rating_after   REAL NOT NULL,
    played_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (p1_wallet <> p2_wallet),
    CONSTRAINT ranked_match_settlements_boost_policy CHECK (
        (league = 'skill' AND p1_boost_charges = 0 AND p2_boost_charges = 0)
        OR
        (league = 'boosted' AND p1_boost_charges <= 3 AND p2_boost_charges <= 3)
    )
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ranked_match_settlements_boost_policy'
    ) THEN
        ALTER TABLE ranked_match_settlements
            ADD CONSTRAINT ranked_match_settlements_boost_policy CHECK (
                (league = 'skill' AND p1_boost_charges = 0 AND p2_boost_charges = 0)
                OR
                (league = 'boosted' AND p1_boost_charges <= 3 AND p2_boost_charges <= 3)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ranked_settlements_epoch
    ON ranked_match_settlements (league, input_category, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_ranked_settlements_p1
    ON ranked_match_settlements (p1_wallet, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_ranked_settlements_p2
    ON ranked_match_settlements (p2_wallet, played_at DESC);

-- ─────────────────────────────────────────────
-- Boost purchase ledger
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS player_boost_balances (
    wallet_address TEXT PRIMARY KEY,
    boosts INTEGER NOT NULL DEFAULT 15,
    total_purchased_boosts INTEGER NOT NULL DEFAULT 0,
    total_spent_boosts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boost_purchase_intents (
    intent_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    boosts_count INTEGER NOT NULL,
    mint_address TEXT NOT NULL,
    expected_smf_amount BIGINT NOT NULL,
    token_decimals INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    signature TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_boost_intents_wallet_created
    ON boost_purchase_intents (wallet_address, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_boost_intents_signature
    ON boost_purchase_intents (signature)
    WHERE signature IS NOT NULL;

CREATE TABLE IF NOT EXISTS boost_purchase_ledger (
    id BIGSERIAL PRIMARY KEY,
    intent_id TEXT NOT NULL UNIQUE REFERENCES boost_purchase_intents(intent_id) ON DELETE RESTRICT,
    signature TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    boosts_credited INTEGER NOT NULL,
    mint_address TEXT NOT NULL,
    burn_amount BIGINT NOT NULL,
    slot BIGINT,
    raw_tx JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boost_ledger_wallet_created
    ON boost_purchase_ledger (wallet_address, created_at DESC);

CREATE TABLE IF NOT EXISTS boost_consumption_ledger (
    id BIGSERIAL PRIMARY KEY,
    consume_id TEXT,
    wallet_address TEXT NOT NULL,
    units INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT 'hadouken',
    balance_after INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boost_consumption_wallet_created
    ON boost_consumption_ledger (wallet_address, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_boost_consumption_consume_id
    ON boost_consumption_ledger (consume_id)
    WHERE consume_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallet_auth_challenges (
    challenge_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    nonce TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_auth_challenges_wallet_created
    ON wallet_auth_challenges (wallet_address, created_at DESC);

CREATE TABLE IF NOT EXISTS wallet_auth_sessions (
    token_hash TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    challenge_id TEXT REFERENCES wallet_auth_challenges(challenge_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_auth_sessions_wallet_created
    ON wallet_auth_sessions (wallet_address, created_at DESC);

-- ─────────────────────────────────────────────
-- Public arena telemetry (privacy-safe, insert-only)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arena_director_events (
    event_id              TEXT PRIMARY KEY,
    decision_id           TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('selected', 'no_candidate')),
    policy_version        TEXT NOT NULL,
    generated_at          TIMESTAMPTZ NOT NULL,
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    selected_mint         TEXT NOT NULL DEFAULT '',
    selected_symbol       TEXT NOT NULL DEFAULT '',
    selected_score        DOUBLE PRECISION,
    candidate_count       INTEGER NOT NULL CHECK (candidate_count >= 0),
    market_data_state     TEXT NOT NULL CHECK (
        market_data_state IN ('fresh', 'degraded', 'stale', 'unavailable', 'unverified')
    ),
    provider_snapshots    JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_metrics      JSONB NOT NULL DEFAULT '{}'::jsonb,
    explanation           TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_arena_director_events_recorded
    ON arena_director_events (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_arena_director_events_token
    ON arena_director_events (selected_mint, recorded_at DESC)
    WHERE selected_mint <> '';

CREATE TABLE IF NOT EXISTS arena_match_events (
    event_id              TEXT PRIMARY KEY,
    match_id              TEXT NOT NULL DEFAULT '',
    room_code             TEXT NOT NULL,
    match_type            TEXT NOT NULL,
    ranked                BOOLEAN NOT NULL,
    league                TEXT NOT NULL DEFAULT '',
    input_category        TEXT NOT NULL DEFAULT '',
    winner_player         SMALLINT CHECK (winner_player IN (1, 2)),
    result                TEXT NOT NULL CHECK (result IN ('p1_win', 'p2_win', 'draw')),
    reason                TEXT NOT NULL,
    p1_health             DOUBLE PRECISION NOT NULL,
    p2_health             DOUBLE PRECISION NOT NULL,
    server_tick           BIGINT NOT NULL CHECK (server_tick >= 0),
    p1_boost_charges      INTEGER NOT NULL DEFAULT 0 CHECK (p1_boost_charges >= 0),
    p2_boost_charges      INTEGER NOT NULL DEFAULT 0 CHECK (p2_boost_charges >= 0),
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arena_match_events_recorded
    ON arena_match_events (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_arena_match_events_competition
    ON arena_match_events (ranked, league, input_category, recorded_at DESC);

CREATE TABLE IF NOT EXISTS arena_share_events (
    event_id              TEXT PRIMARY KEY,
    share_id              TEXT NOT NULL UNIQUE,
    mode                  TEXT NOT NULL CHECK (mode IN ('solo', 'pvp')),
    result                TEXT NOT NULL CHECK (result IN ('win', 'loss')),
    token_symbol          TEXT NOT NULL DEFAULT '',
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arena_share_events_recorded
    ON arena_share_events (recorded_at DESC);

CREATE OR REPLACE FUNCTION sticklash_reject_telemetry_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'StickLash telemetry tables are insert-only';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'arena_director_events_insert_only'
          AND tgrelid = 'arena_director_events'::regclass
    ) THEN
        CREATE TRIGGER arena_director_events_insert_only
        BEFORE UPDATE OR DELETE ON arena_director_events
        FOR EACH ROW EXECUTE FUNCTION sticklash_reject_telemetry_mutation();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'arena_match_events_insert_only'
          AND tgrelid = 'arena_match_events'::regclass
    ) THEN
        CREATE TRIGGER arena_match_events_insert_only
        BEFORE UPDATE OR DELETE ON arena_match_events
        FOR EACH ROW EXECUTE FUNCTION sticklash_reject_telemetry_mutation();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'arena_share_events_insert_only'
          AND tgrelid = 'arena_share_events'::regclass
    ) THEN
        CREATE TRIGGER arena_share_events_insert_only
        BEFORE UPDATE OR DELETE ON arena_share_events
        FOR EACH ROW EXECUTE FUNCTION sticklash_reject_telemetry_mutation();
    END IF;
END $$;
