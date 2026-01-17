-- StarCG Market Tracker Database Migration v3 - Deduplication
-- Prevents duplicate price records for cleaner data
-- Run this AFTER migration_v2.sql

-- ============================================
-- 1. Add deduplication columns
-- ============================================

-- For market listings: hash of unique identifiers
-- Same item + same stall + same price = same listing
ALTER TABLE price_snapshots
ADD COLUMN IF NOT EXISTS listing_key TEXT;

-- For transactions: the unique transaction ID from the API
ALTER TABLE price_snapshots
ADD COLUMN IF NOT EXISTS transaction_id INTEGER;

-- ============================================
-- 2. Create unique indexes for deduplication
-- ============================================

-- For market listings: prevent duplicates with same item/stall/price combo
-- We use listing_key which is: item_id:stall_cdkey:price:pricetype
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_listing_unique
ON price_snapshots(listing_key)
WHERE source = 'market' AND listing_key IS NOT NULL;

-- For transactions: prevent duplicate transaction records
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_transaction_unique
ON price_snapshots(transaction_id)
WHERE source = 'transaction' AND transaction_id IS NOT NULL;

-- ============================================
-- 3. Function to generate listing key
-- ============================================
CREATE OR REPLACE FUNCTION generate_listing_key(
  p_item_id UUID,
  p_stall_cdkey TEXT,
  p_price INTEGER,
  p_pricetype SMALLINT
)
RETURNS TEXT AS $$
BEGIN
  RETURN p_item_id::TEXT || ':' || p_stall_cdkey || ':' || p_price::TEXT || ':' || p_pricetype::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- 4. Upsert function for market listings
-- Returns: 'inserted' or 'updated'
-- ============================================
CREATE OR REPLACE FUNCTION upsert_market_listing(
  p_item_id UUID,
  p_price INTEGER,
  p_pricetype SMALLINT,
  p_server SMALLINT,
  p_stall_name TEXT,
  p_stall_cdkey TEXT,
  p_coords TEXT,
  p_quantity INTEGER DEFAULT 1
)
RETURNS TEXT AS $$
DECLARE
  v_listing_key TEXT;
  v_result TEXT;
BEGIN
  -- Generate the listing key
  v_listing_key := generate_listing_key(p_item_id, p_stall_cdkey, p_price, p_pricetype);

  -- Try to update existing record first
  UPDATE price_snapshots
  SET
    quantity = p_quantity,
    recorded_at = NOW(),
    server = p_server,
    stall_name = p_stall_name,
    coords = p_coords
  WHERE listing_key = v_listing_key
    AND source = 'market';

  IF FOUND THEN
    v_result := 'updated';
  ELSE
    -- Insert new record
    INSERT INTO price_snapshots (
      item_id, price, pricetype, server, stall_name, stall_cdkey,
      coords, quantity, source, listing_key, recorded_at
    )
    VALUES (
      p_item_id, p_price, p_pricetype, p_server, p_stall_name, p_stall_cdkey,
      p_coords, p_quantity, 'market', v_listing_key, NOW()
    );
    v_result := 'inserted';
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. Upsert function for transactions
-- Returns: 'inserted' or 'skipped' (if already exists)
-- ============================================
CREATE OR REPLACE FUNCTION upsert_transaction(
  p_item_id UUID,
  p_transaction_id INTEGER,
  p_price INTEGER,
  p_pricetype SMALLINT,
  p_stall_name TEXT,
  p_stall_cdkey TEXT,
  p_quantity INTEGER DEFAULT 1,
  p_recorded_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TEXT AS $$
BEGIN
  -- Check if transaction already exists
  IF EXISTS (
    SELECT 1 FROM price_snapshots
    WHERE transaction_id = p_transaction_id
      AND source = 'transaction'
  ) THEN
    RETURN 'skipped';
  END IF;

  -- Insert new transaction
  INSERT INTO price_snapshots (
    item_id, price, pricetype, server, stall_name, stall_cdkey,
    coords, quantity, source, transaction_id, recorded_at
  )
  VALUES (
    p_item_id, p_price, p_pricetype, 0, p_stall_name, p_stall_cdkey,
    '', p_quantity, 'transaction', p_transaction_id, p_recorded_at
  );

  RETURN 'inserted';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. Clean up old duplicate data (optional)
-- Run this manually if you want to dedupe existing data
-- ============================================
-- This query identifies duplicates:
-- SELECT item_id, stall_cdkey, price, pricetype, COUNT(*), MAX(recorded_at)
-- FROM price_snapshots
-- WHERE source = 'market'
-- GROUP BY item_id, stall_cdkey, price, pricetype
-- HAVING COUNT(*) > 1;

-- ============================================
-- 7. Grant permissions
-- ============================================
GRANT EXECUTE ON FUNCTION generate_listing_key(UUID, TEXT, INTEGER, SMALLINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION upsert_market_listing(UUID, INTEGER, SMALLINT, SMALLINT, TEXT, TEXT, TEXT, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION upsert_transaction(UUID, INTEGER, INTEGER, SMALLINT, TEXT, TEXT, INTEGER, TIMESTAMPTZ) TO anon, authenticated, service_role;

-- ============================================
-- Summary:
-- ============================================
-- Market listings (source = 'market'):
--   - listing_key = item_id:stall_cdkey:price:pricetype
--   - Same key = same listing, just update recorded_at
--   - This prevents inflation from repeated refreshes
--
-- Transactions (source = 'transaction'):
--   - transaction_id = unique ID from API
--   - Each sale is recorded only once
--   - Historical data is clean and accurate
