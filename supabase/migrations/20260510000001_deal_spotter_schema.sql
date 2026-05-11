-- Deal spotter schema additions
-- See docs/superpowers/specs/2026-05-10-deal-spotter-design.md

-- Extend items with auto-discovery + cached server stats + image
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_auto_discovered BOOLEAN DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS median_gold_value INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS median_crystal_value INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS min_sold_gold INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS min_sold_crystal INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_sold_gold INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_sold_crystal INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS sample_count_gold INTEGER DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS sample_count_crystal INTEGER DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_history_refresh TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS trend6m_cache JSONB;
ALTER TABLE items ADD COLUMN IF NOT EXISTS trend6m_cached_at TIMESTAMPTZ;

-- Indices for the leaderboard / deals queries (used by Plan 2)
CREATE INDEX IF NOT EXISTS idx_items_auto_discovered ON items(is_auto_discovered) WHERE is_auto_discovered = TRUE;
CREATE INDEX IF NOT EXISTS idx_items_median_gold ON items(median_gold_value DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_items_last_history_refresh ON items(last_history_refresh ASC NULLS FIRST);

-- Derived exchange rate table (gold per crystal, from 魔幣箱 transactions)
CREATE TABLE IF NOT EXISTS derived_exchange_rate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gold_per_crystal NUMERIC(10,2) NOT NULL,
  source_item_name TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  median_crystal_price INTEGER NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_derived_exchange_rate_computed_at ON derived_exchange_rate(computed_at DESC);

ALTER TABLE derived_exchange_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to derived_exchange_rate" ON derived_exchange_rate FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON derived_exchange_rate TO anon, authenticated, service_role;
