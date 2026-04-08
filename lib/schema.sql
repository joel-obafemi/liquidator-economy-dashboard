-- Liquidator Economy Database Schema

CREATE TABLE IF NOT EXISTS scan_state (
  scanner_name TEXT PRIMARY KEY,
  last_scanned_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO scan_state (scanner_name, last_scanned_block)
VALUES ('aave_v3', 0), ('spark', 0)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS token_metadata (
  address TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_cache (
  token_address TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  price_usd DOUBLE PRECISION NOT NULL,
  source TEXT DEFAULT 'defillama',
  PRIMARY KEY (token_address, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_price_cache_ts ON price_cache(timestamp);

CREATE TABLE IF NOT EXISTS liquidation_events (
  id SERIAL PRIMARY KEY,
  protocol TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index BIGINT NOT NULL DEFAULT 0,
  block_number BIGINT NOT NULL,
  block_timestamp BIGINT NOT NULL,
  liquidator TEXT NOT NULL,
  borrower TEXT NOT NULL,
  collateral_asset TEXT NOT NULL,
  debt_asset TEXT NOT NULL,
  collateral_symbol TEXT NOT NULL,
  debt_symbol TEXT NOT NULL,
  debt_to_cover NUMERIC NOT NULL,
  liquidated_collateral_amount NUMERIC NOT NULL,
  receive_a_token BOOLEAN DEFAULT false,
  debt_amount_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  collateral_amount_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  gross_profit_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  gas_used BIGINT,
  gas_price_gwei DOUBLE PRECISION,
  gas_cost_eth DOUBLE PRECISION DEFAULT 0,
  gas_cost_usd DOUBLE PRECISION DEFAULT 0,
  net_profit_usd DOUBLE PRECISION DEFAULT 0,
  UNIQUE (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_liq_protocol ON liquidation_events(protocol);
CREATE INDEX IF NOT EXISTS idx_liq_block ON liquidation_events(block_number);
CREATE INDEX IF NOT EXISTS idx_liq_timestamp ON liquidation_events(block_timestamp);
CREATE INDEX IF NOT EXISTS idx_liq_liquidator ON liquidation_events(liquidator);
CREATE INDEX IF NOT EXISTS idx_liq_borrower ON liquidation_events(borrower);
CREATE INDEX IF NOT EXISTS idx_liq_collateral_asset ON liquidation_events(collateral_asset);
CREATE INDEX IF NOT EXISTS idx_liq_debt_asset ON liquidation_events(debt_asset);
CREATE INDEX IF NOT EXISTS idx_liq_gross_profit ON liquidation_events(gross_profit_usd);
