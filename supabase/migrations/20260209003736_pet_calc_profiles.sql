-- Migration V6: Pet calculator saved profiles
-- Stores pet calculator configurations for later retrieval

CREATE TABLE IF NOT EXISTS pet_calc_profiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  profile_data JSONB NOT NULL,
  -- Denormalized fields for display without parsing JSONB
  pet_name TEXT,
  level INTEGER NOT NULL DEFAULT 120,
  card_rank INTEGER NOT NULL DEFAULT 0,
  mod_grade INTEGER NOT NULL DEFAULT 0,
  rate NUMERIC(5,3) NOT NULL DEFAULT 0.2,
  rand_sum INTEGER,
  is_reversed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for listing profiles ordered by save time
CREATE INDEX IF NOT EXISTS idx_pet_calc_profiles_saved_at ON pet_calc_profiles (saved_at DESC);

-- Enable RLS but allow all access (no auth in this app)
ALTER TABLE pet_calc_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to pet_calc_profiles"
  ON pet_calc_profiles
  FOR ALL
  USING (true)
  WITH CHECK (true);
