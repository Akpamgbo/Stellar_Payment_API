import { describe, expect, it, vi } from "vitest";
import {
  __testUtils,
  getMerchantApiUsage,
  recordMerchantApiUsage,
} from "./api-usage.js";

describe("recordMerchantApiUsage", () => {
  it("increments endpoint hit count in the merchant monthly hash", async () => {
    const hIncrBy = vi.fn().mockResolvedValue(1);
    const expire = vi.fn().mockResolvedValue(1);
    const redisClient = { hIncrBy, expire };

    const req = {
      method: "GET",
      originalUrl: "/api/payments/123?foo=bar",
      url: "/api/payments/123?foo=bar",
    };

    await recordMerchantApiUsage({
      merchantId: "merchant-1",
      req,
      now: new Date("2026-03-10T12:00:00.000Z"),
      redisClient,
    });

    expect(hIncrBy).toHaveBeenCalledWith(
      "merchant:usage:merchant-1:2026-03",
      "GET /api/payments/:id",
      1,
    );
    expect(expire).toHaveBeenCalledWith(
      "merchant:usage:merchant-1:2026-03",
      34560000,
    );
  });
});

describe("getMerchantApiUsage", () => {
  it("returns sorted monthly usage grouped by endpoint", async () => {
    const scanIterator = vi.fn().mockImplementation(async function* () {
      yield "merchant:usage:merchant-1:2026-03";
      yield "merchant:usage:merchant-1:2026-02";
    });

    const hGetAll = vi
      .fn()
      .mockResolvedValueOnce({
        "GET /api/payments": "12",
        "POST /api/create-payment": "3",
      })
      .mockResolvedValueOnce({
        "GET /api/payments": "7",
      });

    const redisClient = {
      scanIterator,
      hGetAll,
    };

    const result = await getMerchantApiUsage({
      merchantId: "merchant-1",
      redisClient,
    });

    expect(result).toEqual({
      merchant_id: "merchant-1",
      usage: [
        {
          month: "2026-03",
          total_hits: 15,
          endpoints: [
            { endpoint: "GET /api/payments", hits: 12 },
            { endpoint: "POST /api/create-payment", hits: 3 },
          ],
        },
        {
          month: "2026-02",
          total_hits: 7,
          endpoints: [{ endpoint: "GET /api/payments", hits: 7 }],
        },
      ],
    });
  });

  it("returns only the requested month when month filter is provided", async () => {
    const hGetAll = vi.fn().mockResolvedValue({
      "GET /api/metrics/summary": "2",
    });

    const redisClient = {
      scanIterator: vi.fn(),
      hGetAll,
    };

    const result = await getMerchantApiUsage({
      merchantId: "merchant-1",
      month: "2026-03",
      redisClient,
    });

    expect(result).toEqual({
      merchant_id: "merchant-1",
      usage: [
        {
          month: "2026-03",
          total_hits: 2,
          endpoints: [{ endpoint: "GET /api/metrics/summary", hits: 2 }],
        },
      ],
    });
    expect(redisClient.scanIterator).not.toHaveBeenCalled();
  });
});

describe("__testUtils", () => {
  it("normalises dynamic path segments", () => {
    expect(__testUtils.normaliseEndpointPath("/api/payments/123")).toBe(
      "/api/payments/:id",
    );

    expect(
      __testUtils.normaliseEndpointPath(
        "/api/payments/550e8400-e29b-41d4-a716-446655440000/verify",
      ),
    ).toBe("/api/payments/:id/verify");
  });
});
