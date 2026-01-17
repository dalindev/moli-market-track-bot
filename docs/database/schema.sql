-- StarCG Market Tracker Database Schema
-- Run this in Supabase SQL Editor to create all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Items table (unique by name)
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,              -- Traditional Chinese (from API)
  name_simplified TEXT,                    -- Simplified Chinese for search matching
  item_type TEXT NOT NULL CHECK (item_type IN ('item', 'pet')),
  item_id INTEGER,                         -- ITEM_ID from API (nullable for pets)
  base_image_number INTEGER,               -- For displaying item icons
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_name_simplified ON items(name_simplified);

-- 2. Price Snapshots table (historical prices)
CREATE TABLE IF NOT EXISTS price_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price INTEGER NOT NULL,
  pricetype SMALLINT NOT NULL CHECK (pricetype IN (0, 1)), -- 0=金幣, 1=魔晶
  server SMALLINT NOT NULL CHECK (server BETWEEN 1 AND 5),
  stall_name TEXT NOT NULL,
  stall_cdkey TEXT NOT NULL,
  coords TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('market', 'transaction')),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_item_id ON price_snapshots(item_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_recorded_at ON price_snapshots(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_item_time ON price_snapshots(item_id, recorded_at DESC);

-- 3. Tracked Items table (user's watchlist)
CREATE TABLE IF NOT EXISTS tracked_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  alert_threshold INTEGER NOT NULL DEFAULT 50,  -- Percentage below average to alert
  target_price INTEGER,                         -- Optional target price
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_checked TIMESTAMPTZ DEFAULT NOW(),
  last_alert_at TIMESTAMPTZ,                    -- Prevent alert spam
  UNIQUE(item_id)
);

CREATE INDEX IF NOT EXISTS idx_tracked_active ON tracked_items(is_active) WHERE is_active = TRUE;

-- 4. Price Statistics table (computed averages)
CREATE TABLE IF NOT EXISTS price_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID UNIQUE NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  avg_price_gold INTEGER,                 -- 7-day average normalized to gold
  min_price_7d INTEGER,
  max_price_7d INTEGER,
  transaction_count_7d INTEGER,
  last_seen_price INTEGER,
  last_seen_pricetype SMALLINT,
  last_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_statistics_item ON price_statistics(item_id);

-- 5. Scan Logs table (monitoring background scans)
CREATE TABLE IF NOT EXISTS scan_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_type TEXT NOT NULL CHECK (scan_type IN ('full', 'tracked', 'transaction')),
  items_scanned INTEGER NOT NULL DEFAULT 0,
  prices_recorded INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_logs_started ON scan_logs(started_at DESC);

-- Function to update price statistics for an item
CREATE OR REPLACE FUNCTION update_price_statistics(p_item_id UUID)
RETURNS void AS $$
DECLARE
  v_stats RECORD;
  v_last RECORD;
  v_crystal_rate INTEGER := 333; -- 1 魔晶 = 333 金幣
BEGIN
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

-- Function to automatically update item's updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for items table
DROP TRIGGER IF EXISTS update_items_updated_at ON items;
CREATE TRIGGER update_items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (for future multi-user support)
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;

-- Public read access for all tables (anonymous users)
CREATE POLICY "Public read access for items"
  ON items FOR SELECT
  USING (true);

CREATE POLICY "Public read access for price_snapshots"
  ON price_snapshots FOR SELECT
  USING (true);

CREATE POLICY "Public read access for tracked_items"
  ON tracked_items FOR SELECT
  USING (true);

CREATE POLICY "Public read access for price_statistics"
  ON price_statistics FOR SELECT
  USING (true);

CREATE POLICY "Public read access for scan_logs"
  ON scan_logs FOR SELECT
  USING (true);

-- Public write access for tracked_items (single-user mode)
CREATE POLICY "Public insert for tracked_items"
  ON tracked_items FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update for tracked_items"
  ON tracked_items FOR UPDATE
  USING (true);

CREATE POLICY "Public delete for tracked_items"
  ON tracked_items FOR DELETE
  USING (true);

-- Service role policies for items and price data (managed by cron jobs)
CREATE POLICY "Service role insert for items"
  ON items FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role update for items"
  ON items FOR UPDATE
  USING (true);

CREATE POLICY "Service role insert for price_snapshots"
  ON price_snapshots FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role insert for price_statistics"
  ON price_statistics FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role update for price_statistics"
  ON price_statistics FOR UPDATE
  USING (true);

CREATE POLICY "Service role insert for scan_logs"
  ON scan_logs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role update for scan_logs"
  ON scan_logs FOR UPDATE
  USING (true);

-- Grant execute permission on functions
GRANT EXECUTE ON FUNCTION update_price_statistics(UUID) TO anon, authenticated, service_role;
