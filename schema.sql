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
