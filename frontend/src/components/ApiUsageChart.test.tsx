/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ApiUsageChart from "./ApiUsageChart";

// ─── Captured Recharts Props ──────────────────────────────────────────────────
let capturedProps: {
  responsiveContainer?: any;
  barChart?: any;
  bar?: any;
  xAxis?: any;
  yAxis?: any;
  tooltip?: any;
} = {};

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children, height, width }: any) => {
    capturedProps.responsiveContainer = { height, width };
    return (
      <div data-testid="responsive-container" data-height={height} data-width={width}>
        {children}
      </div>
    );
  },
  BarChart: ({ children, data, margin }: any) => {
    capturedProps.barChart = { data, margin };
    return (
      <div
        data-testid="bar-chart"
        data-points={data?.length}
        data-margin={JSON.stringify(margin)}
      >
        {children}
      </div>
    );
  },
  Bar: ({ dataKey, fill, maxBarSize, radius }: any) => {
    capturedProps.bar = { dataKey, fill, maxBarSize, radius };
    return (
      <div
        data-testid="bar"
        data-key={dataKey}
        data-fill={fill}
        data-maxbarsize={maxBarSize}
      />
    );
  },
  XAxis: ({ dataKey, minTickGap, tickFormatter, style, interval }: any) => {
    capturedProps.xAxis = { dataKey, minTickGap, tickFormatter, style, interval };
    return (
      <div
        data-testid="x-axis"
        data-key={dataKey}
        data-mintickgap={minTickGap}
        data-fontsize={style?.fontSize}
      />
    );
  },
  YAxis: ({ width, tickFormatter, style, allowDecimals }: any) => {
    capturedProps.yAxis = { width, tickFormatter, style, allowDecimals };
    return (
      <div
        data-testid="y-axis"
        data-width={width}
        data-fontsize={style?.fontSize}
      />
    );
  },
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: ({ formatter, labelFormatter, contentStyle, itemStyle, labelStyle }: any) => {
    capturedProps.tooltip = { formatter, labelFormatter, contentStyle, itemStyle, labelStyle };
    return <div data-testid="tooltip" />;
  },
}));

// ─── Mock next-intl ───────────────────────────────────────────────────────────
let mockLocale = "en";
vi.mock("next-intl", () => ({
  useLocale: () => mockLocale,
}));

// ─── Mock merchant store ──────────────────────────────────────────────────────
let mockApiKey: string | null = "merchant-secret-key-123";
vi.mock("@/lib/merchant-store", () => ({
  useMerchantApiKey: () => mockApiKey,
}));

// ─── Viewport MatchMedia Mock Helper ──────────────────────────────────────────
let currentMediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;
let isCurrentMatches = false;

function setViewport(width: number) {
  isCurrentMatches = width <= 640;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isCurrentMatches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((event: string, cb: any) => {
      if (event === "change") currentMediaQueryListener = cb;
    }),
    removeEventListener: vi.fn((event: string, cb: any) => {
      if (event === "change" && currentMediaQueryListener === cb) {
        currentMediaQueryListener = null;
      }
    }),
    dispatchEvent: vi.fn(),
  }));
}

const MOCK_DAILY_METRICS = {
  daily: [
    { date: "2026-10-15T00:00:00.000Z", requests: 120 },
    { date: "2026-10-16T00:00:00.000Z", requests: 250 },
    { date: "2026-10-17T00:00:00.000Z", requests: 310 },
    { date: "2026-10-18T00:00:00.000Z", requests: 95 },
    { date: "2026-10-19T00:00:00.000Z", requests: 430 },
    { date: "2026-10-20T00:00:00.000Z", requests: 620 },
    { date: "2026-10-21T00:00:00.000Z", requests: 175 },
  ],
};

describe("ApiUsageChart Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale = "en";
    mockApiKey = "merchant-secret-key-123";
    capturedProps = {};
    currentMediaQueryListener = null;
    setViewport(1024); // Desktop viewport by default

    (globalThis.fetch as any) = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_DAILY_METRICS,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Authentication & API Key States ──────────────────────────────────────
  describe("Authentication & API Key Handling", () => {
    it("renders unauthenticated prompt when API key is missing", () => {
      mockApiKey = null;
      render(<ApiUsageChart />);

      expect(
        screen.getByText("Register or log in to view API usage statistics.")
      ).toBeInTheDocument();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("fetches metrics with x-api-key header when API key is present", async () => {
      render(<ApiUsageChart />);

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/metrics/api-usage"),
          expect.objectContaining({
            headers: {
              "x-api-key": "merchant-secret-key-123",
            },
          })
        );
      });
    });
  });

  // ── 2. Loading and Error States ─────────────────────────────────────────────
  describe("Loading and Error States", () => {
    it("renders loading spinner while request is in flight", () => {
      (globalThis.fetch as any) = vi.fn().mockReturnValue(new Promise(() => {}));
      const { container } = render(<ApiUsageChart />);

      expect(container.querySelector(".animate-spin")).toBeInTheDocument();
      expect(screen.queryByText("API Usage - Last 7 Days")).not.toBeInTheDocument();
    });

    it("renders error message on HTTP failure response", async () => {
      (globalThis.fetch as any) = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      render(<ApiUsageChart />);

      await waitFor(() => {
        expect(
          screen.getByText("Failed to fetch usage data: 500")
        ).toBeInTheDocument();
      });
    });

    it("renders error message on network rejection", async () => {
      (globalThis.fetch as any) = vi
        .fn()
        .mockRejectedValue(new Error("Network connection dropped"));

      render(<ApiUsageChart />);

      await waitFor(() => {
        expect(screen.getByText("Network connection dropped")).toBeInTheDocument();
      });
    });
  });

  // ── 3. Empty and Populated Data States ───────────────────────────────────────
  describe("Data Rendering & Calculation", () => {
    it("renders empty state when no daily usage records are returned", async () => {
      (globalThis.fetch as any) = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ daily: [] }),
      });

      render(<ApiUsageChart />);

      await waitFor(() => {
        expect(screen.getByText("API Usage - Last 7 Days")).toBeInTheDocument();
        expect(screen.getByText("Total requests: 0")).toBeInTheDocument();
        expect(
          screen.getByText("No API usage data available")
        ).toBeInTheDocument();
      });
      expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
    });

    it("calculates total requests accurately and populates chart elements", async () => {
      render(<ApiUsageChart />);

      await waitFor(() => {
        expect(screen.getByText("API Usage - Last 7 Days")).toBeInTheDocument();
      });

      // Sum of MOCK_DAILY_METRICS: 120 + 250 + 310 + 95 + 430 + 620 + 175 = 2000
      expect(screen.getByText("Total requests: 2,000")).toBeInTheDocument();
      expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
      expect(capturedProps.barChart.data).toHaveLength(7);
      expect(capturedProps.bar.dataKey).toBe("requests");
      expect(capturedProps.bar.fill).toBe("#5ef2c0");
    });
  });

  // ── 4. Responsive Viewport Compact Mode ─────────────────────────────────────
  describe("Responsive Viewport Compact Mode", () => {
    it("applies desktop chart dimensions and tick configurations (>640px)", async () => {
      setViewport(1024);
      render(<ApiUsageChart />);

      await waitFor(() => {
        expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
      });

      expect(capturedProps.responsiveContainer.height).toBe(300);
      expect(capturedProps.bar.maxBarSize).toBe(32);
      expect(capturedProps.yAxis.width).toBe(44);
      expect(capturedProps.xAxis.minTickGap).toBe(16);
      expect(capturedProps.xAxis.style.fontSize).toBe("12px");

      // Verify date formatting on desktop includes day number
      const formattedTick = capturedProps.xAxis.tickFormatter("2026-10-15T00:00:00.000Z");
      expect(formattedTick).toMatch(/Oct 15|15 Oct/i);
    });

    it("applies compact mobile chart dimensions and tick configurations (<=640px)", async () => {
      setViewport(375);
      render(<ApiUsageChart />);

      await waitFor(() => {
        expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
      });

      expect(capturedProps.responsiveContainer.height).toBe(240);
      expect(capturedProps.bar.maxBarSize).toBe(22);
      expect(capturedProps.yAxis.width).toBe(32);
      expect(capturedProps.xAxis.minTickGap).toBe(28);
      expect(capturedProps.xAxis.style.fontSize).toBe("10px");

      // Verify date formatting in compact mode omits day
      const formattedTick = capturedProps.xAxis.tickFormatter("2026-10-15T00:00:00.000Z");
      expect(formattedTick).toMatch(/Oct/i);
      expect(formattedTick).not.toMatch(/15/);
    });

    it("dynamically adjusts layout on window resize / mediaQuery event", async () => {
      setViewport(1024);
      render(<ApiUsageChart />);

      await waitFor(() => {
        expect(capturedProps.responsiveContainer.height).toBe(300);
      });

      // Simulate viewport shrinking to mobile
      await act(async () => {
        if (currentMediaQueryListener) {
          currentMediaQueryListener({ matches: true } as MediaQueryListEvent);
        }
      });

      expect(capturedProps.responsiveContainer.height).toBe(240);
      expect(capturedProps.bar.maxBarSize).toBe(22);
    });
  });

  // ── 5. Localization & Tooltip Formatting ────────────────────────────────────
  describe("Localization & Tooltip Formatting", () => {
    it("formats tooltip values and labels correctly", async () => {
      render(<ApiUsageChart />);

      await waitFor(() => {
        expect(capturedProps.tooltip).toBeDefined();
      });

      const formattedValue = capturedProps.tooltip.formatter(1500);
      expect(formattedValue).toEqual(["1,500", "Requests"]);

      const formattedLabel = capturedProps.tooltip.labelFormatter("2026-10-15T00:00:00.000Z");
      expect(formattedLabel).toMatch(/Oct 15, 2026|15 Oct 2026/i);
    });

    it("formats YAxis and Tooltips with Spanish locale", async () => {
      mockLocale = "es";
      render(<ApiUsageChart />);

      await waitFor(() => {
        expect(capturedProps.yAxis).toBeDefined();
      });

      const formattedY = capturedProps.yAxis.tickFormatter(25000);
      expect(formattedY).toBeDefined();

      const formattedTooltipValue = capturedProps.tooltip.formatter(25000);
      expect(formattedTooltipValue[0]).toMatch(/25[.,\s]000/);
    });
  });

  // ── 6. Snapshot Tests ──────────────────────────────────────────────────────
  describe("Snapshot Tests", () => {
    it("matches snapshot when unauthenticated", () => {
      mockApiKey = null;
      const { container } = render(<ApiUsageChart />);
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot during loading state", () => {
      (globalThis.fetch as any) = vi.fn().mockReturnValue(new Promise(() => {}));
      const { container } = render(<ApiUsageChart />);
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot on error state", async () => {
      (globalThis.fetch as any) = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      const { container } = render(<ApiUsageChart />);
      await waitFor(() => screen.getByText("Failed to fetch usage data: 500"));
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot on empty data state", async () => {
      (globalThis.fetch as any) = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ daily: [] }),
      });
      const { container } = render(<ApiUsageChart />);
      await waitFor(() => screen.getByText("No API usage data available"));
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot on desktop populated state", async () => {
      setViewport(1024);
      const { container } = render(<ApiUsageChart />);
      await waitFor(() => screen.getByText("Total requests: 2,000"));
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot on mobile compact populated state", async () => {
      setViewport(375);
      const { container } = render(<ApiUsageChart />);
      await waitFor(() => screen.getByText("Total requests: 2,000"));
      expect(container).toMatchSnapshot();
    });
  });
});
