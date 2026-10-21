/**
 * x402 Payment Required middleware for PLUTO.
 *
 * Custom implementation using standard Stellar USDC transfers.
 * Works with any Stellar wallet — no Soroban contract account needed.
 *
 * Flow:
 *   1. Client hits protected endpoint → gets 402 with payment details
 *   2. Client sends USDC on Stellar with the provided memo
 *   3. Client calls POST /api/verify-x402 { tx_hash } → gets JWT
 *   4. Client retries with X-Payment-Token: <jwt> → gets access
 */

import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger.js";

const USDC_ISSUER =
  process.env.USDC_ISSUER ||
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Valid pricing mode whitelist to prevent injection or bypass */
export const ALLOWED_PRICING_MODES = new Set([
  "x402",
  "subscription",
  "api-key",
  "free",
  "metered",
]);

/** Stellar public address regex (G followed by 55 base32 chars) */
export const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

/** Positive decimal amount regex (e.g. "0.01", "10", "1.5") */
export const POSITIVE_AMOUNT_REGEX = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Asset code regex (1-12 alphanumeric characters) */
export const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;

/** Safe memo prefix regex (alphanumeric, underscore, hyphen) */
export const MEMO_PREFIX_REGEX = /^[A-Za-z0-9_-]+$/;

/** JWT format regex (three base64url segments) */
export const JWT_FORMAT_REGEX =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Maximum length for payment token to prevent ReDoS/buffer abuse */
export const MAX_TOKEN_LENGTH = 4096;

/** Maximum length for memo prefix */
export const MAX_MEMO_PREFIX_LENGTH = 20;

/**
 * Validate and sanitize x402 middleware configuration.
 *
 * @param {object} config
 * @returns {object} Sanitized configuration
 */
export function validateX402Config(config) {
  if (!config || typeof config !== "object") {
    throw new TypeError("x402 configuration must be a non-null object");
  }

  const {
    amount,
    recipient,
    asset = "USDC",
    plutoVerifyUrl = `${process.env.PAYMENT_LINK_BASE?.replace(":3000", ":4000") || "http://localhost:4000"}/api/verify-x402`,
    memo_prefix = "x402",
    enforceByDefault = false,
  } = config;

  // Validate amount
  if (amount == null || typeof amount !== "string" && typeof amount !== "number") {
    throw new TypeError("x402 config: amount is required and must be a string or number");
  }
  const cleanAmount = String(amount).trim();
  if (
    !POSITIVE_AMOUNT_REGEX.test(cleanAmount) ||
    Number.parseFloat(cleanAmount) <= 0
  ) {
    throw new Error(
      `x402 config: amount must be a positive numeric value, received "${amount}"`
    );
  }

  // Validate recipient
  if (typeof recipient !== "string") {
    throw new TypeError("x402 config: recipient is required and must be a Stellar address string");
  }
  const cleanRecipient = recipient.trim();
  if (!STELLAR_ADDRESS_REGEX.test(cleanRecipient)) {
    throw new Error(
      `x402 config: recipient must be a valid Stellar public key (56 characters starting with G), received "${recipient}"`
    );
  }

  // Validate asset
  if (typeof asset !== "string") {
    throw new TypeError("x402 config: asset must be a string");
  }
  const cleanAsset = asset.trim().toUpperCase();
  if (!ASSET_CODE_REGEX.test(cleanAsset)) {
    throw new Error(
      `x402 config: asset must be 1-12 alphanumeric characters, received "${asset}"`
    );
  }

  // Validate plutoVerifyUrl
  if (typeof plutoVerifyUrl !== "string") {
    throw new TypeError("x402 config: plutoVerifyUrl must be a string URL");
  }
  const cleanVerifyUrl = plutoVerifyUrl.trim();
  try {
    const parsed = new URL(cleanVerifyUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Protocol must be http: or https:");
    }
  } catch (err) {
    throw new Error(
      `x402 config: plutoVerifyUrl must be a valid HTTP/HTTPS URL, received "${plutoVerifyUrl}": ${err.message}`
    );
  }

  // Validate memo_prefix
  if (typeof memo_prefix !== "string") {
    throw new TypeError("x402 config: memo_prefix must be a string");
  }
  const cleanMemoPrefix = memo_prefix.trim();
  if (
    !MEMO_PREFIX_REGEX.test(cleanMemoPrefix) ||
    cleanMemoPrefix.length > MAX_MEMO_PREFIX_LENGTH
  ) {
    throw new Error(
      `x402 config: memo_prefix must be 1-${MAX_MEMO_PREFIX_LENGTH} alphanumeric, hyphen, or underscore characters, received "${memo_prefix}"`
    );
  }

  return {
    amount: cleanAmount,
    recipient: cleanRecipient,
    asset: cleanAsset,
    plutoVerifyUrl: cleanVerifyUrl,
    memo_prefix: cleanMemoPrefix,
    enforceByDefault: Boolean(enforceByDefault),
  };
}

/**
 * Sanitize pricing mode string against whitelist and control characters.
 *
 * @param {unknown} mode
 * @returns {string|null} Sanitized mode or null if invalid/unrecognized
 */
export function sanitizePricingMode(mode) {
  if (typeof mode !== "string") return null;
  const cleaned = mode.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return ALLOWED_PRICING_MODES.has(cleaned) ? cleaned : null;
}

/**
 * Sanitize and validate payment token string.
 *
 * @param {unknown} token
 * @returns {string|null} Trimmed token if format is valid, null otherwise
 */
export function sanitizePaymentToken(token) {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  if (!JWT_FORMAT_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Generate a bounded Stellar memo conforming to the 28-byte UTF-8 limit.
 *
 * @param {string} prefix
 * @param {string} requestId
 * @returns {string} Safe Stellar memo string
 */
export function generatePaymentMemo(prefix, requestId) {
  const separator = "-";
  const maxMemoBytes = 28;
  const minIdBytes = 4;

  let memoPrefix = String(prefix || "x402").replace(/[^A-Za-z0-9_-]/g, "");
  if (!memoPrefix) memoPrefix = "x402";

  const separatorBytes = Buffer.byteLength(separator, "utf8");
  const maxPrefixBytes = Math.max(1, maxMemoBytes - separatorBytes - minIdBytes);

  while (Buffer.byteLength(memoPrefix, "utf8") > maxPrefixBytes) {
    memoPrefix = memoPrefix.slice(0, -1);
  }

  const prefixBytes = Buffer.byteLength(memoPrefix, "utf8");
  const maxIdBytes = Math.max(minIdBytes, maxMemoBytes - prefixBytes - separatorBytes);
  const cleanId = String(requestId).replace(/[^A-Za-z0-9]/g, "");
  const idPart = cleanId.slice(0, maxIdBytes);

  return `${memoPrefix}${separator}${idPart}`;
}

/**
 * Create x402 middleware with comprehensive input validation and sanitization.
 *
 * @param {object} config
 * @param {string} config.amount          - USDC amount required (e.g. "0.01")
 * @param {string} config.recipient       - Provider's Stellar address (G...)
 * @param {string} [config.asset]         - Asset code, defaults to "USDC"
 * @param {string} [config.plutoVerifyUrl] - URL of /api/verify-x402
 * @param {string} [config.memo_prefix]   - Memo prefix, defaults to "x402"
 * @param {boolean} [config.enforceByDefault] - If true, always challenge when token is absent
 */
export function x402Middleware(config) {
  const validatedConfig = validateX402Config(config);
  const {
    amount,
    recipient,
    asset,
    plutoVerifyUrl,
    memo_prefix,
    enforceByDefault,
  } = validatedConfig;

  const jwtSecret = process.env.X402_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("X402_JWT_SECRET env variable is required for x402 middleware");
  }

  return function requirePayment(req, res, next) {
    // 1. Sanitize payment token
    const rawToken = req.headers["x-payment-token"];
    let token = null;

    if (rawToken !== undefined) {
      token = sanitizePaymentToken(rawToken);
      if (rawToken && !token) {
        logger?.warn?.(
          { rawTokenSnippet: String(rawToken).slice(0, 16) },
          "x402: malformed or oversized X-Payment-Token rejected during sanitization"
        );
      }
    }

    // 2. Sanitize and validate pricing mode from header and query
    const modeHeader = sanitizePricingMode(req.headers["x-pluto-pricing-mode"]);
    const modeQuery = sanitizePricingMode(req.query?.pricing_mode);
    const requestedX402 = modeHeader === "x402" || modeQuery === "x402";

    // 3. Process sanitized payment token
    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret);
        req.x402 = payload;
        return next();
      } catch (err) {
        logger?.debug?.(
          { err: err.message },
          "x402: payment token verification failed or expired"
        );
        // Token invalid or expired — fall through to 402 challenge
      }
    }

    // Dual-mode behavior:
    // - Subscription/API-key mode: pass through
    // - x402 mode: challenge with 402
    if (!enforceByDefault && !requestedX402) {
      return next();
    }

    // 4. Generate sanitized memo
    const requestId = randomUUID().replace(/-/g, "");
    const memo = generatePaymentMemo(memo_prefix, requestId);

    return res.status(402).json({
      x402: true,
      error: "Payment required",
      amount,
      asset,
      network: "stellar-testnet",
      recipient,
      asset_issuer: USDC_ISSUER,
      memo,
      verify_url: plutoVerifyUrl,
      instructions: `Send exactly ${amount} ${asset} to ${recipient} with memo "${memo}", then POST { tx_hash, expected_amount, expected_recipient, memo } to ${plutoVerifyUrl} to receive an access token, then retry this request with header X-Payment-Token: <token>`,
    });
  };
}
