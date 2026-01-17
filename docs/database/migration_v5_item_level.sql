-- StarCG Market Tracker Database Migration v5 - Item Level Support
-- Adds item_level to distinguish items like 特殊改造圖D Lv5/6/7
-- Run this AFTER migration_v4_median.sql

-- ============================================
-- 1. Add item_level to items table
-- ============================================

-- Level meanings for 改造圖 items:
-- Lv5 = 普通 (Normal)
-- Lv6 = 银 (Silver)
-- Lv7 = 金 (Gold)

ALTER TABLE items
ADD COLUMN IF NOT EXISTS item_level SMALLINT;

-- Update unique constraint to include level
-- First drop the old constraint if it exists
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_name_key;

-- Create new unique constraint on name + level (null level is treated as distinct)
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_level
ON items (name, COALESCE(item_level, 0));

-- ============================================
-- 2. Add item_level to price_snapshots
-- ============================================

-- This allows tracking prices for specific item levels
ALTER TABLE price_snapshots
ADD COLUMN IF NOT EXISTS item_level SMALLINT;

-- Update listing_key generation to include level
-- The listing_key format becomes: item_id:stall_cdkey:price:pricetype:level
COMMENT ON COLUMN price_snapshots.listing_key IS 'Dedup key: item_id:stall_cdkey:price:pricetype[:level]';

-- ============================================
-- 3. Helper function to get level display name
-- ============================================

CREATE OR REPLACE FUNCTION get_item_level_suffix(level SMALLINT)
RETURNS TEXT AS $$
BEGIN
  CASE level
    WHEN 5 THEN RETURN '(普通)';
    WHEN 6 THEN RETURN '(银)';
    WHEN 7 THEN RETURN '(金)';
    ELSE RETURN NULL;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- Summary:
-- ============================================
-- 1. items.item_level: Stores the level (5=普通, 6=银, 7=金)
-- 2. Unique constraint now on (name, level) so same name + different level = different item
-- 3. price_snapshots.item_level: Track prices per level
-- 4. get_item_level_suffix(): Helper to display level name
--
-- Usage in app:
--   displayName = item.name + (get_item_level_suffix(item.level) || '')
--   e.g., "特殊改造圖D (金)" for level 7
