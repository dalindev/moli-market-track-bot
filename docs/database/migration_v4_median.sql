-- StarCG Market Tracker Database Migration v4 - Median Price & Override
-- Uses median instead of average for more accurate pricing
-- Adds ability to manually override the reference price
-- Run this AFTER migration_v3_dedup.sql

-- ============================================
-- 1. Add price override to tracked_items
-- ============================================

-- User can set a custom reference price that overrides calculated median
ALTER TABLE tracked_items
ADD COLUMN IF NOT EXISTS price_override INTEGER;

-- ============================================
-- 2. Update price_statistics to store median
-- ============================================

-- Rename avg_price_gold to median_price_gold for clarity
-- (keeping avg_price_gold for backwards compatibility, will use for median)
COMMENT ON COLUMN price_statistics.avg_price_gold IS 'Median price in gold (7-day), not average';

-- ============================================
-- 3. Updated function to calculate TRIMMED MEDIAN
-- Removes top 10% and bottom 10% outliers for better accuracy
-- ============================================
CREATE OR REPLACE FUNCTION update_price_statistics(p_item_id UUID)
RETURNS VOID AS $$
DECLARE
  v_trimmed_median INTEGER;
  v_min_price INTEGER;
  v_max_price INTEGER;
  v_count INTEGER;
  v_last_price INTEGER;
  v_last_pricetype SMALLINT;
  v_last_at TIMESTAMPTZ;
  v_exchange_rate DECIMAL(10,2);
BEGIN
  -- Get current exchange rate (default 263 if none)
  SELECT COALESCE(
    (SELECT gold_per_crystal FROM exchange_rates ORDER BY rate_date DESC LIMIT 1),
    263
  ) INTO v_exchange_rate;

  -- Calculate TRIMMED median price (remove top/bottom 10%)
  -- This gives more accurate "real" market price by excluding outliers
  WITH normalized_prices AS (
    SELECT
      CASE WHEN pricetype = 1 THEN price * v_exchange_rate ELSE price END AS gold_price,
      PERCENT_RANK() OVER (ORDER BY
        CASE WHEN pricetype = 1 THEN price * v_exchange_rate ELSE price END
      ) AS pct_rank
    FROM price_snapshots
    WHERE item_id = p_item_id
      AND recorded_at >= NOW() - INTERVAL '7 days'
  ),
  trimmed_prices AS (
    SELECT gold_price
    FROM normalized_prices
    WHERE pct_rank >= 0.10 AND pct_rank <= 0.90  -- Remove top/bottom 10%
  )
  SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gold_price)::INTEGER
  INTO v_trimmed_median
  FROM trimmed_prices;

  -- Get min/max from full data (not trimmed) for reference
  SELECT
    MIN(CASE WHEN pricetype = 1 THEN price * v_exchange_rate ELSE price END)::INTEGER,
    MAX(CASE WHEN pricetype = 1 THEN price * v_exchange_rate ELSE price END)::INTEGER,
    COUNT(*)::INTEGER
  INTO v_min_price, v_max_price, v_count
  FROM price_snapshots
  WHERE item_id = p_item_id
    AND recorded_at >= NOW() - INTERVAL '7 days';

  -- If trimmed median is null (not enough data), use regular median
  IF v_trimmed_median IS NULL AND v_count > 0 THEN
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
        CASE WHEN pricetype = 1 THEN price * v_exchange_rate ELSE price END
      )::INTEGER
    INTO v_trimmed_median
    FROM price_snapshots
    WHERE item_id = p_item_id
      AND recorded_at >= NOW() - INTERVAL '7 days';
  END IF;

  -- Get last seen price
  SELECT price, pricetype, recorded_at
  INTO v_last_price, v_last_pricetype, v_last_at
  FROM price_snapshots
  WHERE item_id = p_item_id
  ORDER BY recorded_at DESC
  LIMIT 1;

  -- Upsert statistics
  INSERT INTO price_statistics (
    item_id, avg_price_gold, min_price_7d, max_price_7d,
    transaction_count_7d, last_seen_price, last_seen_pricetype,
    last_seen_at, updated_at
  )
  VALUES (
    p_item_id, v_trimmed_median, v_min_price, v_max_price,
    v_count, v_last_price, v_last_pricetype,
    v_last_at, NOW()
  )
  ON CONFLICT (item_id) DO UPDATE SET
    avg_price_gold = EXCLUDED.avg_price_gold,
    min_price_7d = EXCLUDED.min_price_7d,
    max_price_7d = EXCLUDED.max_price_7d,
    transaction_count_7d = EXCLUDED.transaction_count_7d,
    last_seen_price = EXCLUDED.last_seen_price,
    last_seen_pricetype = EXCLUDED.last_seen_pricetype,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. Grant permissions
-- ============================================
GRANT EXECUTE ON FUNCTION update_price_statistics(UUID) TO anon, authenticated, service_role;

-- ============================================
-- Summary:
-- ============================================
-- 1. tracked_items.price_override: User can set custom reference price
--    - If set, alerts use this instead of calculated median
--    - Useful for items with volatile prices or when median is off
--
-- 2. price_statistics.avg_price_gold now stores MEDIAN, not average
--    - More robust against outliers (e.g., pet with 1M vs 1K price)
--    - Uses PostgreSQL's PERCENTILE_CONT for true median
--
-- Usage in app:
--   referencePrice = tracked_item.price_override ?? price_statistics.avg_price_gold
