-- Migration 001: Create user_api_keys table
-- Run this on the Supabase database:
--   psql "postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres"
-- Or paste into the Supabase SQL Editor at:
--   https://supabase.com/dashboard/project/ullvzzjmogjzfnnlqpoz/sql

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id       UUID        NOT NULL,
  encrypted_key TEXT        NOT NULL,
  key_hint      TEXT        NOT NULL,   -- e.g. "AIza...4Xz2" – never the full key
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_api_keys_pkey PRIMARY KEY (user_id)
);

-- Enable Row Level Security.
-- The backend uses the service_role key (which bypasses RLS).
-- No client-facing policies are added, so direct frontend access is denied.
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;
