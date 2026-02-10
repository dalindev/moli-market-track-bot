-- Saved searches table (replaces localStorage market-saved-searches-v2)
CREATE TABLE IF NOT EXISTS saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL,
  exact BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint on term to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_searches_term ON saved_searches(term);

-- RLS
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to saved_searches" ON saved_searches FOR ALL USING (true) WITH CHECK (true);

-- Grant permissions
GRANT ALL ON saved_searches TO anon, authenticated, service_role;
