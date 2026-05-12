-- Allow anon-key clients to delete price_snapshots.
-- Required because market sweep clears prior 'source=market' rows before
-- inserting fresh ones. Without this policy, RLS silently swallows the delete
-- (returns 0 rows affected, no error), then the INSERT collides with the
-- still-present rows on idx_snapshots_listing_unique.

DROP POLICY IF EXISTS "Public delete for price_snapshots" ON price_snapshots;
CREATE POLICY "Public delete for price_snapshots"
  ON price_snapshots FOR DELETE
  USING (true);

DROP POLICY IF EXISTS "Public delete for items" ON items;
CREATE POLICY "Public delete for items"
  ON items FOR DELETE
  USING (true);
