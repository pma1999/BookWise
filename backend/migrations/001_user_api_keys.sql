-- Migration 001: Create user_api_keys table
-- Run this in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/ullvzzjmogjzfnnlqpoz/sql
--
-- The table stores each authenticated user's Gemini API key.
-- RLS ensures every user can only read and write their own row.
-- The key is accessed directly from the Angular frontend using the
-- user's session JWT — no backend service_role key required.

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id    UUID        NOT NULL,
  api_key    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_api_keys_pkey PRIMARY KEY (user_id)
);

-- Enable Row Level Security
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

-- Users can SELECT, INSERT, UPDATE and DELETE only their own row
CREATE POLICY "Users can manage their own API key"
  ON user_api_keys
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
