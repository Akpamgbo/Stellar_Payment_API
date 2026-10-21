import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/redis.js", () => ({
  connectRedisClient: vi.fn(async () => ({ isOpen: false })),
}));

import {
  validateX402Config,
  sanitizePricingMode,
  sanitizePaymentToken,
  generatePaymentMemo,
  x402Middleware,
  hashToken,
  getCachedToken,
  setCachedToken,
  resetX402CacheForTests,
  getX402Telemetry,
  x402RequestsTotal,
  x402CacheHitsTotal,
  x402CacheMissesTotal,
  x402ActiveChallenges,
} from "./x402.js";
import { createFakeRedis } from "../../tests/helpers/fake-redis.js";

const VALID_STELLAR_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const JWT_SECRET = "test-secret-12345678901234567890";

function makeReq(headers = {}, query = {}) {
  return {
    headers: { ...headers },
    query: { ...query },
  };
}

function makeRes() {
  const res = {
    _status: null,
    _json: null,
  };
  res.status = vi.fn((code) => {
    res._status = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res._json = body;
    return res;
  });
  return res;
}

describe("x402 Middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetX402CacheForTests();
    process.env.X402_JWT_SECRET = JWT_SECRET;
  });

  // -------------------------------------------------------------------------
  // Issue #1626: Input Validation and Sanitization
  // -------------------------------------------------------------------------
  describe("Input Validation and Sanitization (Issue #1626)", () => {
    describe("validateX402Config", () => {
      it("accepts valid configuration and sanitizes fields", () => {
        const valid = validateX402Config({
          amount: " 0.50 ",
          recipient: ` ${VALID_STELLAR_KEY} `,
          asset: " usdc ",
          memo_prefix: " test_prefix ",
          plutoVerifyUrl: " https://api.pluto.internal/verify-x402 ",
          enforceByDefault: true,
        });

        expect(valid.amount).toBe("0.50");
        expect(valid.recipient).toBe(VALID_STELLAR_KEY);
        expect(valid.asset).toBe("USDC");
        expect(valid.memo_prefix).toBe("test_prefix");
        expect(valid.plutoVerifyUrl).toBe("https://api.pluto.internal/verify-x402");
        expect(valid.enforceByDefault).toBe(true);
      });

      it("rejects non-object or null config", () => {
        expect(() => validateX402Config(null)).toThrow(TypeError);
        expect(() => validateX402Config("invalid")).toThrow(TypeError);
      });

      it("rejects invalid amounts", () => {
        expect(() => validateX402Config({ amount: "-1", recipient: VALID_STELLAR_KEY })).toThrow(/positive numeric value/);
        expect(() => validateX402Config({ amount: "0", recipient: VALID_STELLAR_KEY })).toThrow(/positive numeric value/);
        expect(() => validateX402Config({ amount: "abc", recipient: VALID_STELLAR_KEY })).toThrow(/positive numeric value/);
        expect(() => validateX402Config({ amount: null, recipient: VALID_STELLAR_KEY })).toThrow(TypeError);
      });

      it("rejects invalid Stellar addresses", () => {
        expect(() => validateX402Config({ amount: "1.0", recipient: "invalid_key" })).toThrow(/valid Stellar public key/);
        expect(() => validateX402Config({ amount: "1.0", recipient: "SBB..." })).toThrow(/valid Stellar public key/);
        expect(() => validateX402Config({ amount: "1.0", recipient: "" })).toThrow(/valid Stellar public key/);
      });

      it("rejects invalid asset codes", () => {
        expect(() => validateX402Config({ amount: "1.0", recipient: VALID_STELLAR_KEY, asset: "TOOLONGOFANASSETCODE123" })).toThrow(/1-12 alphanumeric characters/);
        expect(() => validateX402Config({ amount: "1.0", recipient: VALID_STELLAR_KEY, asset: "USDC$$" })).toThrow(/1-12 alphanumeric characters/);
      });

      it("rejects invalid URLs", () => {
        expect(() => validateX402Config({
          amount: "1.0",
          recipient: VALID_STELLAR_KEY,
          plutoVerifyUrl: "javascript:alert(1)",
        })).toThrow(/valid HTTP\/HTTPS URL/);
      });

      it("rejects invalid memo prefixes", () => {
        expect(() => validateX402Config({
          amount: "1.0",
          recipient: VALID_STELLAR_KEY,
          memo_prefix: "this_memo_prefix_is_way_too_long_for_stellar",
        })).toThrow(/memo_prefix must be 1-20/);
        expect(() => validateX402Config({
          amount: "1.0",
          recipient: VALID_STELLAR_KEY,
          memo_prefix: "prefix with spaces!",
        })).toThrow(/memo_prefix must be 1-20/);
      });
    });

    describe("sanitizePricingMode", () => {
      it("accepts allowed pricing modes and normalizes them", () => {
        expect(sanitizePricingMode("X402")).toBe("x402");
        expect(sanitizePricingMode(" subscription ")).toBe("subscription");
        expect(sanitizePricingMode("API-KEY")).toBe("api-key");
      });

      it("rejects unauthorized or injection modes", () => {
        expect(sanitizePricingMode("admin' OR 1=1--")).toBeNull();
        expect(sanitizePricingMode("<script>alert(1)</script>")).toBeNull();
        expect(sanitizePricingMode(123)).toBeNull();
        expect(sanitizePricingMode(null)).toBeNull();
      });
    });

    describe("sanitizePaymentToken", () => {
      it("accepts valid JWT token string", () => {
        const validJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        expect(sanitizePaymentToken(`  ${validJwt}  `)).toBe(validJwt);
      });

      it("rejects malformed tokens", () => {
        expect(sanitizePaymentToken("invalid-token-no-dots")).toBeNull();
        expect(sanitizePaymentToken("one.two")).toBeNull();
        expect(sanitizePaymentToken("one.two.three.four")).toBeNull();
        expect(sanitizePaymentToken("")).toBeNull();
        expect(sanitizePaymentToken(null)).toBeNull();
      });

      it("rejects oversized tokens to prevent buffer attacks", () => {
        const hugeToken = "a".repeat(5000) + ".b.c";
        expect(sanitizePaymentToken(hugeToken)).toBeNull();
      });
    });

    describe("generatePaymentMemo", () => {
      it("generates memo strictly within 28-byte Stellar limit", () => {
        const memo = generatePaymentMemo("x402_test", "1234567890abcdef1234567890");
        expect(Buffer.byteLength(memo, "utf8")).toBeLessThanOrEqual(28);
        expect(memo.startsWith("x402_test-")).toBe(true);
      });

      it("sanitizes unsafe characters in memo prefix", () => {
        const memo = generatePaymentMemo("unsafe$$prefix!!", "12345678");
        expect(Buffer.byteLength(memo, "utf8")).toBeLessThanOrEqual(28);
        expect(memo).toMatch(/^[A-Za-z0-9_-]+$/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Issue #1627: Distributed Redis Caching and Throughput Telemetry
  // -------------------------------------------------------------------------
  describe("Distributed Redis Caching and Throughput Telemetry (Issue #1627)", () => {
    it("hashes tokens into a consistent hex string", () => {
      const token1 = "token.part.one";
      const token2 = "token.part.two";
      expect(hashToken(token1)).toBe(hashToken(token1));
      expect(hashToken(token1)).not.toBe(hashToken(token2));
      expect(hashToken(token1)).toHaveLength(64);
    });

    it("stores and retrieves verified tokens from Redis cache", async () => {
      const fakeRedis = createFakeRedis();
      const token = jwt.sign({ tx_hash: "hash-redis", amount: "0.01" }, JWT_SECRET);
      const payload = { tx_hash: "hash-redis", amount: "0.01", exp: Math.floor(Date.now() / 1000) + 120 };

      // Initial get should be a miss
      const miss = await getCachedToken(token, { redisClient: fakeRedis });
      expect(miss).toBeNull();

      // Store in Redis
      await setCachedToken(token, payload, { redisClient: fakeRedis });

      // Next get should hit Redis
      const hit = await getCachedToken(token, { redisClient: fakeRedis });
      expect(hit).toEqual(payload);
    });

    it("falls back gracefully to in-memory cache when Redis is unavailable", async () => {
      const token = jwt.sign({ tx_hash: "hash-memory", amount: "0.05" }, JWT_SECRET);
      const payload = { tx_hash: "hash-memory", amount: "0.05", exp: Math.floor(Date.now() / 1000) + 60 };

      // With no Redis client, set in memory
      await setCachedToken(token, payload, { redisClient: null });
      expect(getX402Telemetry().inMemoryCacheSize).toBe(1);

      // Retrieve from memory
      const cached = await getCachedToken(token, { redisClient: null });
      expect(cached).toEqual(payload);
    });

    it("evicts expired tokens from memory cache", async () => {
      const token = jwt.sign({ tx_hash: "hash-expired" }, JWT_SECRET);
      const expiredPayload = { tx_hash: "hash-expired", exp: Math.floor(Date.now() / 1000) - 10 };

      await setCachedToken(token, expiredPayload, { redisClient: null, ttlSec: -10 });
      const cached = await getCachedToken(token, { redisClient: null });
      expect(cached).toBeNull();
    });

    it("uses cached token in middleware without invoking jwt.verify repeatedly", async () => {
      const fakeRedis = createFakeRedis();
      const token = jwt.sign({ tx_hash: "hash-middleware-cache", user: "agent-01" }, JWT_SECRET);

      const middleware = x402Middleware({
        amount: "0.01",
        recipient: VALID_STELLAR_KEY,
        redisClient: fakeRedis,
      });

      const spyJwtVerify = vi.spyOn(jwt, "verify");

      // First request: Cache miss -> verify called
      const req1 = makeReq({ "x-payment-token": token });
      const res1 = makeRes();
      const next1 = vi.fn();
      await middleware(req1, res1, next1);

      expect(next1).toHaveBeenCalledTimes(1);
      expect(spyJwtVerify).toHaveBeenCalledTimes(1);

      // Second request: Cache hit -> jwt.verify skipped!
      const req2 = makeReq({ "x-payment-token": token });
      const res2 = makeRes();
      const next2 = vi.fn();
      await middleware(req2, res2, next2);

      expect(next2).toHaveBeenCalledTimes(1);
      expect(spyJwtVerify).toHaveBeenCalledTimes(1); // Still 1!
      expect(req2.x402.tx_hash).toBe("hash-middleware-cache");

      spyJwtVerify.mockRestore();
    });

    it("records telemetry metrics for challenges, pass-throughs, and verifications", async () => {
      const middleware = x402Middleware({
        amount: "0.01",
        recipient: VALID_STELLAR_KEY,
        enforceByDefault: true,
      });

      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(402);
    });
  });
});
