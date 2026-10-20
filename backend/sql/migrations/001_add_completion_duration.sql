-- Migration: Add completion_duration_seconds to payments table
-- This tracks the time between payment creation and confirmation

ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS completion_duration_seconds integer;

COMMENT ON COLUMN payments.completion_duration_seconds IS 
'Duration in seconds between payment creation (created_at) and confirmation. NULL for pending payments.';
