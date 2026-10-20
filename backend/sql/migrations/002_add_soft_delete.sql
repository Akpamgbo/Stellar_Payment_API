-- Migration: Add soft delete capability to payments table
-- Preserves financial audit logs by marking records as deleted instead of removing them

ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS payments_deleted_at_idx ON payments(deleted_at);

COMMENT ON COLUMN payments.deleted_at IS 
'Timestamp when payment was soft-deleted. NULL for active payments. Soft-deleted payments are filtered from normal queries but preserved for audit logs.';
