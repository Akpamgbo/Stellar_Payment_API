import { z } from "zod";
import { pool } from "../lib/db.js";
import { logger } from "../lib/logger.js";

// ── Validation Schemas ──────────────────────────────────────────────────────
const MerchantIdSchema = z
  .string()
  .trim()
  .min(1, "merchantId must be a non-empty string")
  .max(128, "merchantId exceeds maximum length of 128 characters")
  .regex(
    /^[a-zA-Z0-9_\-:.@]+$/,
    "merchantId contains invalid characters"
  );

// ── Sanitization Helpers ─────────────────────────────────────────────────────

// ── Validation Functions ─────────────────────────────────────────────────────

/**
 * Strictly validates and sanitizes a merchant ID.
 * Returns { valid: true, merchantId } or { valid: false, error }
 */
export function validateAndSanitizeMerchantId(merchantId) {
  try {
    const parsed = MerchantIdSchema.parse(merchantId);
    return { valid: true, merchantId: parsed };
  } catch (err) {
    const errorMessage =
      err instanceof z.ZodError ? err.errors[0]?.message : "Invalid merchantId";
    return { valid: false, error: errorMessage };
  }
}

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Executes a callback within a transaction where the merchant context is set.
 * This ensures Row Level Security (RLS) is enforced for direct pg pool queries.
 * Includes payload sanitization and strict validation for merchantId.
 */
export async function withMerchantContext(merchantId, callback) {
  // Validate and sanitize merchantId
  const validation = validateAndSanitizeMerchantId(merchantId);
  if (!validation.valid) {
    logger.warn(
      { merchantId, error: validation.error },
      "[RLS] Invalid merchantId provided to withMerchantContext"
    );
    throw new Error(`Invalid merchantId: ${validation.error}`);
  }

  const sanitizedMerchantId = validation.merchantId;

  // Validate callback is a function
  if (typeof callback !== "function") {
    logger.warn(
      { merchantId: sanitizedMerchantId },
      "[RLS] Invalid callback provided to withMerchantContext"
    );
    throw new Error("callback must be a function");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.current_merchant_id = $1", [
      sanitizedMerchantId,
    ]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error(
        { rollbackErr: rollbackErr.message },
        "[RLS] Failed to rollback transaction"
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sanitizes a merchant ID for logging purposes (non-validation path).
 * This is useful when you need to safely include merchantId in logs
 * without throwing validation errors.
 */
export function sanitizeMerchantId(merchantId) {
  if (typeof merchantId !== "string") {
    return null;
  }
  const trimmed = merchantId.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return null;
  }
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_\-:.@]/g, "");
  return sanitized.length > 0 ? sanitized : null;
}
