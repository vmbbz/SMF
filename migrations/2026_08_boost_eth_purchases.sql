-- boost_eth_purchases: records ETH payments on Base chain for boost pack credits
-- Generated: 2026-08-19
-- Unique constraint on tx_hash guarantees idempotent crediting.

CREATE TABLE IF NOT EXISTS boost_eth_purchases (
    id             BIGSERIAL PRIMARY KEY,
    tx_hash        TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL,
    pack_id        TEXT NOT NULL,
    boosts_credited INTEGER NOT NULL,
    eth_wei        BIGINT NOT NULL,
    block_number   BIGINT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boost_eth_purchases_wallet_created
    ON boost_eth_purchases (wallet_address, created_at DESC);
