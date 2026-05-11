-- Cross-currency fair value (computed by stats-refresh)
-- See docs/superpowers/specs/2026-05-10-deal-spotter-design.md

ALTER TABLE items ADD COLUMN IF NOT EXISTS fair_value_gold INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS fair_value_source TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS fair_value_exchange_rate NUMERIC(10,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS fair_value_computed_at TIMESTAMPTZ;
