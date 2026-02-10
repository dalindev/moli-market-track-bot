-- Fix: allow server=0 for transaction records (transactions don't have server info)
-- The original CHECK constraint required server BETWEEN 1 AND 5

ALTER TABLE price_snapshots DROP CONSTRAINT IF EXISTS price_snapshots_server_check;
ALTER TABLE price_snapshots ADD CONSTRAINT price_snapshots_server_check CHECK (server BETWEEN 0 AND 5);

-- Also fix the upsert_transaction function to use server=1 as default
-- (in case other code still relies on server >= 1)
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

  -- Insert new transaction (server=0 means unknown/transaction)
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

GRANT EXECUTE ON FUNCTION upsert_transaction(UUID, INTEGER, INTEGER, SMALLINT, TEXT, TEXT, INTEGER, TIMESTAMPTZ) TO anon, authenticated, service_role;
