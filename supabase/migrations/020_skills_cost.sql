-- Migration 020: Add cost to skills table
ALTER TABLE skills ADD COLUMN IF NOT EXISTS cost integer;
