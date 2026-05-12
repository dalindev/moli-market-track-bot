-- Capture per-listing durability (耐久) for gear items.
-- A weapon listed at 50k gold with 1/100 durability is about to break and
-- has very little real value — needs to be visible in the deals view.
-- 0 means no durability concept (consumables, scrolls, etc.).

ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS durability INTEGER;
ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS max_durability INTEGER;
