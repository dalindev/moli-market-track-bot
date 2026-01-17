-- StarCG Market Tracker Database Migration v2
-- Adds: quantity tracking, exchange rate history, daily price summaries
-- Run this AFTER the initial schema.sql

-- ============================================
-- 1. Add quantity to price_snapshots
-- ============================================
ALTER TABLE price_snapshots
ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

-- ============================================
-- 2. Exchange Rates Table
-- Track crystal-to-gold ratio over time
-- Based on 魔幣箱（100萬） which is 1M gold
-- ============================================
CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date DATE NOT NULL UNIQUE,
  gold_per_crystal DECIMAL(10,2) NOT NULL,  -- Gold coins per 1 crystal
  source_item_name TEXT DEFAULT '魔幣箱（100萬）',
  source_item_price INTEGER,  -- Price in crystals (e.g., 3800)
  source_type TEXT CHECK (source_type IN ('market', 'transaction')),
  sample_count INTEGER DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates(rate_date DESC);

-- Insert default exchange rate (1M gold / 3800 crystals ≈ 263 gold per crystal)
-- Adjust based on actual market data
INSERT INTO exchange_rates (rate_date, gold_per_crystal, source_item_price, source_type, notes)
VALUES (CURRENT_DATE, 263.16, 3800, 'market', 'Default estimated rate')
ON CONFLICT (rate_date) DO NOTHING;

-- ============================================
-- 3. Daily Price Summary Table
-- Aggregated daily statistics for efficient queries
-- ============================================
CREATE TABLE IF NOT EXISTS daily_price_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,

  -- Gold coin prices (pricetype = 0)
  gold_avg_price INTEGER,
  gold_min_price INTEGER,
  gold_max_price INTEGER,
  gold_listing_count INTEGER DEFAULT 0,
  gold_total_quantity INTEGER DEFAULT 0,

  -- Crystal prices (pricetype = 1, raw values)
  crystal_avg_price INTEGER,
  crystal_min_price INTEGER,
  crystal_max_price INTEGER,
  crystal_listing_count INTEGER DEFAULT 0,
  crystal_total_quantity INTEGER DEFAULT 0,

  -- Combined stats (crystal converted to gold)
  combined_avg_gold INTEGER,  -- Using exchange rate
  combined_min_gold INTEGER,
  combined_max_gold INTEGER,
  total_listing_count INTEGER DEFAULT 0,
  total_quantity INTEGER DEFAULT 0,

  -- Exchange rate used for this day
  exchange_rate_used DECIMAL(10,2),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(item_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_summary_item_date ON daily_price_summary(item_id, summary_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_summary_date ON daily_price_summary(summary_date DESC);

-- ============================================
-- 4. Update price_statistics function to use dynamic exchange rate
-- ============================================
CREATE OR REPLACE FUNCTION update_price_statistics(p_item_id UUID)
RETURNS void AS $$
DECLARE
  v_stats RECORD;
  v_last RECORD;
  v_crystal_rate DECIMAL(10,2);
BEGIN
  -- Get current exchange rate (use latest available or default to 263)
  SELECT COALESCE(
    (SELECT gold_per_crystal FROM exchange_rates ORDER BY rate_date DESC LIMIT 1),
    263.16
  ) INTO v_crystal_rate;

  -- Calculate 7-day statistics
  SELECT
    AVG(CASE WHEN pricetype = 0 THEN price ELSE price * v_crystal_rate END)::INTEGER as avg_gold,
    MIN(CASE WHEN pricetype = 0 THEN price ELSE price * v_crystal_rate END)::INTEGER as min_gold,
    MAX(CASE WHEN pricetype = 0 THEN price ELSE price * v_crystal_rate END)::INTEGER as max_gold,
    COUNT(*) as txn_count
  INTO v_stats
  FROM price_snapshots
  WHERE item_id = p_item_id
    AND recorded_at > NOW() - INTERVAL '7 days';

  -- Get last seen price
  SELECT price, pricetype, recorded_at
  INTO v_last
  FROM price_snapshots
  WHERE item_id = p_item_id
  ORDER BY recorded_at DESC
  LIMIT 1;

  -- Upsert statistics
  INSERT INTO price_statistics (
    item_id,
    avg_price_gold,
    min_price_7d,
    max_price_7d,
    transaction_count_7d,
    last_seen_price,
    last_seen_pricetype,
    last_seen_at,
    updated_at
  )
  VALUES (
    p_item_id,
    v_stats.avg_gold,
    v_stats.min_gold,
    v_stats.max_gold,
    v_stats.txn_count,
    v_last.price,
    v_last.pricetype,
    v_last.recorded_at,
    NOW()
  )
  ON CONFLICT (item_id) DO UPDATE SET
    avg_price_gold = v_stats.avg_gold,
    min_price_7d = v_stats.min_gold,
    max_price_7d = v_stats.max_gold,
    transaction_count_7d = v_stats.txn_count,
    last_seen_price = v_last.price,
    last_seen_pricetype = v_last.pricetype,
    last_seen_at = v_last.recorded_at,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. Function to update daily price summary
-- Call this at end of each day or during cron job
-- ============================================
CREATE OR REPLACE FUNCTION update_daily_price_summary(p_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER AS $$
DECLARE
  v_crystal_rate DECIMAL(10,2);
  v_items_updated INTEGER := 0;
BEGIN
  -- Get exchange rate for this date
  SELECT COALESCE(
    (SELECT gold_per_crystal FROM exchange_rates WHERE rate_date <= p_date ORDER BY rate_date DESC LIMIT 1),
    263.16
  ) INTO v_crystal_rate;

  -- Upsert daily summaries for all items with data on this date
  INSERT INTO daily_price_summary (
    item_id, summary_date,
    gold_avg_price, gold_min_price, gold_max_price, gold_listing_count, gold_total_quantity,
    crystal_avg_price, crystal_min_price, crystal_max_price, crystal_listing_count, crystal_total_quantity,
    combined_avg_gold, combined_min_gold, combined_max_gold, total_listing_count, total_quantity,
    exchange_rate_used
  )
  SELECT
    item_id,
    p_date,
    -- Gold prices
    AVG(CASE WHEN pricetype = 0 THEN price END)::INTEGER,
    MIN(CASE WHEN pricetype = 0 THEN price END),
    MAX(CASE WHEN pricetype = 0 THEN price END),
    COUNT(CASE WHEN pricetype = 0 THEN 1 END),
    COALESCE(SUM(CASE WHEN pricetype = 0 THEN quantity END), 0),
    -- Crystal prices
    AVG(CASE WHEN pricetype = 1 THEN price END)::INTEGER,
    MIN(CASE WHEN pricetype = 1 THEN price END),
    MAX(CASE WHEN pricetype = 1 THEN price END),
    COUNT(CASE WHEN pricetype = 1 THEN 1 END),
    COALESCE(SUM(CASE WHEN pricetype = 1 THEN quantity END), 0),
    -- Combined (crystal converted to gold)
    AVG(CASE WHEN pricetype = 0 THEN price ELSE price * v_crystal_rate END)::INTEGER,
    MIN(CASE WHEN pricetype = 0 THEN price ELSE price * v_crystal_rate END)::INTEGER,
    MAX(CASE WHEN pricetype = 0 THEN price ELSE price * v_crystal_rate END)::INTEGER,
    COUNT(*),
    COALESCE(SUM(quantity), 0),
    v_crystal_rate
  FROM price_snapshots
  WHERE DATE(recorded_at) = p_date
  GROUP BY item_id
  ON CONFLICT (item_id, summary_date) DO UPDATE SET
    gold_avg_price = EXCLUDED.gold_avg_price,
    gold_min_price = EXCLUDED.gold_min_price,
    gold_max_price = EXCLUDED.gold_max_price,
    gold_listing_count = EXCLUDED.gold_listing_count,
    gold_total_quantity = EXCLUDED.gold_total_quantity,
    crystal_avg_price = EXCLUDED.crystal_avg_price,
    crystal_min_price = EXCLUDED.crystal_min_price,
    crystal_max_price = EXCLUDED.crystal_max_price,
    crystal_listing_count = EXCLUDED.crystal_listing_count,
    crystal_total_quantity = EXCLUDED.crystal_total_quantity,
    combined_avg_gold = EXCLUDED.combined_avg_gold,
    combined_min_gold = EXCLUDED.combined_min_gold,
    combined_max_gold = EXCLUDED.combined_max_gold,
    total_listing_count = EXCLUDED.total_listing_count,
    total_quantity = EXCLUDED.total_quantity,
    exchange_rate_used = EXCLUDED.exchange_rate_used,
    updated_at = NOW();

  GET DIAGNOSTICS v_items_updated = ROW_COUNT;
  RETURN v_items_updated;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. Function to update exchange rate from market data
-- ============================================
CREATE OR REPLACE FUNCTION update_exchange_rate_from_item(
  p_crystal_price INTEGER,  -- Price of 魔幣箱（100萬） in crystals
  p_source_type TEXT DEFAULT 'market'
)
RETURNS DECIMAL(10,2) AS $$
DECLARE
  v_gold_per_crystal DECIMAL(10,2);
BEGIN
  -- 魔幣箱（100萬） = 1,000,000 gold
  -- If sold for p_crystal_price crystals, then:
  -- gold_per_crystal = 1,000,000 / p_crystal_price
  v_gold_per_crystal := 1000000.0 / p_crystal_price;

  -- Upsert today's exchange rate
  INSERT INTO exchange_rates (rate_date, gold_per_crystal, source_item_price, source_type, sample_count)
  VALUES (CURRENT_DATE, v_gold_per_crystal, p_crystal_price, p_source_type, 1)
  ON CONFLICT (rate_date) DO UPDATE SET
    gold_per_crystal = (
      -- Weighted average with existing samples
      (exchange_rates.gold_per_crystal * exchange_rates.sample_count + v_gold_per_crystal)
      / (exchange_rates.sample_count + 1)
    ),
    source_item_price = p_crystal_price,
    sample_count = exchange_rates.sample_count + 1,
    updated_at = NOW();

  RETURN v_gold_per_crystal;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. RLS Policies for new tables
-- ============================================
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_price_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access for exchange_rates"
  ON exchange_rates FOR SELECT USING (true);

CREATE POLICY "Service role insert for exchange_rates"
  ON exchange_rates FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role update for exchange_rates"
  ON exchange_rates FOR UPDATE USING (true);

CREATE POLICY "Public read access for daily_price_summary"
  ON daily_price_summary FOR SELECT USING (true);

CREATE POLICY "Service role insert for daily_price_summary"
  ON daily_price_summary FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role update for daily_price_summary"
  ON daily_price_summary FOR UPDATE USING (true);

-- Grant function execution
GRANT EXECUTE ON FUNCTION update_daily_price_summary(DATE) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_exchange_rate_from_item(INTEGER, TEXT) TO anon, authenticated, service_role;

-- ============================================
-- Summary of new structure:
-- ============================================
--
-- exchange_rates: Daily crystal-to-gold ratio
--   - Tracks 魔幣箱（100萬） prices to derive real exchange rate
--   - Weighted average when multiple samples per day
--   - Used for all gold-equivalent calculations
--
-- daily_price_summary: Aggregated daily stats per item
--   - Separates gold and crystal prices
--   - Combined stats using exchange rate
--   - Efficient for historical charts
--
-- price_snapshots: Now includes quantity
--   - How many items available at each price point
