"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { localeToLanguageTag } from "@/i18n/config";

interface DensityPoint {
  date: string;
  count: number;
}

function intensityForCount(count: number, maxCount: number) {
  if (count <= 0 || maxCount <= 0) return 0;
  const ratio = count / maxCount;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

const CELL_COLORS = [
  "#0f172a",
  "#123b35",
  "#17685c",
  "#22a18a",
  "#5ef2c0",
];

// ─── Optimistic state with rollback (#1545) ──────────────────────────────────
// When new data arrives that is empty or structurally invalid (e.g. a failed
// refetch returned an empty array), keep showing the last known good snapshot
// instead of wiping the grid.

function isUsableData(data: DensityPoint[]): boolean {
  return Array.isArray(data) && data.some((d) => d.date && d.count > 0);
}

function useOptimisticData(incoming: DensityPoint[]): DensityPoint[] {
  const [snapshot, setSnapshot] = useState<DensityPoint[]>(incoming);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (incoming === snapshot) return;
    if (isUsableData(incoming)) {
      setPending(false);
      setSnapshot(incoming);
    } else if (incoming.length === 0 && snapshot.length > 0) {
      // Empty payload after a previous good snapshot → optimistic rollback.
      setPending(false);
      // Keep snapshot; do NOT clear the grid.
    } else {
      setSnapshot(incoming);
    }
  }, [incoming, snapshot]);

  return snapshot;
}

// ─── Focus trap helper (#1543) ───────────────────────────────────────────────

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function trapFocus(container: HTMLElement, e: React.KeyboardEvent) {
  if (e.key !== "Tab") return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === first) {
    // normal Tab from first → second (no preventDefault)
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DensityGrid({ data }: { data: DensityPoint[] }) {
  const t = useTranslations("paymentMetrics");
  const locale = localeToLanguageTag(useLocale());

  // #1545: optimistic rollback
  const stableData = useOptimisticData(data);

  // #1543 / #1546: focus and selection state
  const [focusedCol, setFocusedCol] = useState(0);
  const [focusedRow, setFocusedRow] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ col: number; row: number; entry: DensityPoint } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // #1544: touch gesture tracking
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { weeks, monthLabels, totalCount, maxCount } = useMemo(() => {
    const values = stableData.slice(-364);
    const normalized = values.length === 364 ? values : stableData;
    const padded = [...normalized];

    while (padded.length < 364) {
      padded.unshift({ date: "", count: 0 });
    }

    const weekColumns: DensityPoint[][] = [];
    for (let index = 0; index < padded.length; index += 7) {
      weekColumns.push(padded.slice(index, index + 7));
    }

    const labels: Array<{ label: string; column: number }> = [];
    let lastMonth = "";
    weekColumns.forEach((week, column) => {
      const firstDatedCell = week.find((entry) => entry.date);
      if (!firstDatedCell) return;
      const monthLabel = new Date(firstDatedCell.date).toLocaleDateString(
        locale,
        { month: "short" },
      );
      if (monthLabel !== lastMonth) {
        labels.push({ label: monthLabel, column });
        lastMonth = monthLabel;
      }
    });

    return {
      weeks: weekColumns,
      monthLabels: labels,
      totalCount: stableData.reduce((sum, entry) => sum + entry.count, 0),
      maxCount: stableData.reduce((max, entry) => Math.max(max, entry.count), 0),
    };
  }, [stableData, locale]);

  const weekdayLabels = [
    t("heatmapWeekdays.sun"),
    t("heatmapWeekdays.mon"),
    t("heatmapWeekdays.tue"),
    t("heatmapWeekdays.wed"),
    t("heatmapWeekdays.thu"),
    t("heatmapWeekdays.fri"),
    t("heatmapWeekdays.sat"),
  ];

  // ─── Keyboard navigation (#1546) ─────────────────────────────────────────

  const focusCell = useCallback((col: number, row: number) => {
    const key = `${col}-${row}`;
    const el = cellRefs.current.get(key);
    if (el) el.focus();
    setFocusedCol(col);
    setFocusedRow(row);
  }, []);

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const maxCol = weeks.length - 1;
      const maxRow = 6;
      let nextCol = focusedCol;
      let nextRow = focusedRow;

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          nextCol = Math.min(focusedCol + 1, maxCol);
          break;
        case "ArrowLeft":
          e.preventDefault();
          nextCol = Math.max(focusedCol - 1, 0);
          break;
        case "ArrowDown":
          e.preventDefault();
          nextRow = Math.min(focusedRow + 1, maxRow);
          break;
        case "ArrowUp":
          e.preventDefault();
          nextRow = Math.max(focusedRow - 1, 0);
          break;
        case "Home":
          e.preventDefault();
          nextCol = 0;
          break;
        case "End":
          e.preventDefault();
          nextCol = maxCol;
          break;
        case "PageDown":
          e.preventDefault();
          nextCol = Math.min(focusedCol + 4, maxCol);
          break;
        case "PageUp":
          e.preventDefault();
          nextCol = Math.max(focusedCol - 4, 0);
          break;
        case "Enter":
        case " ": {
          e.preventDefault();
          const entry = weeks[focusedCol]?.[focusedRow];
          if (entry) {
            setSelectedCell({ col: focusedCol, row: focusedRow, entry });
            setDrawerOpen(true);
          }
          return;
        }
        case "Escape":
          if (drawerOpen) {
            e.preventDefault();
            setDrawerOpen(false);
            setSelectedCell(null);
            focusCell(focusedCol, focusedRow);
          }
          return;
        default:
          return;
      }

      if (nextCol !== focusedCol || nextRow !== focusedRow) {
        focusCell(nextCol, nextRow);
      }
    },
    [focusedCol, focusedRow, weeks, drawerOpen, focusCell],
  );

  // ─── Focus trap in drawer (#1543) ─────────────────────────────────────────

  const handleDrawerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setDrawerOpen(false);
      setSelectedCell(null);
      return;
    }
    if (drawerRef.current) trapFocus(drawerRef.current, e);
  }, []);

  // Move focus into the drawer when it opens
  useEffect(() => {
    if (drawerOpen && drawerRef.current) {
      const first = drawerRef.current.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }
  }, [drawerOpen]);

  // ─── Touch gestures (#1544) ───────────────────────────────────────────────

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStart.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStart.current.x;
      const dy = touch.clientY - touchStart.current.y;
      const dt = Date.now() - touchStart.current.time;
      touchStart.current = null;

      // Horizontal swipe: navigate columns
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2 && dt < 500) {
        const maxCol = weeks.length - 1;
        const nextCol =
          dx < 0
            ? Math.min(focusedCol + 3, maxCol)
            : Math.max(focusedCol - 3, 0);
        focusCell(nextCol, focusedRow);
        return;
      }

      // Vertical swipe on drawer: close
      if (drawerOpen && dy > 60 && Math.abs(dy) > Math.abs(dx) * 2) {
        setDrawerOpen(false);
        setSelectedCell(null);
      }
    },
    [focusedCol, focusedRow, weeks.length, drawerOpen, focusCell],
  );

  // ─── Cell activation ──────────────────────────────────────────────────────

  const openCell = useCallback(
    (col: number, row: number, entry: DensityPoint) => {
      setFocusedCol(col);
      setFocusedRow(row);
      setSelectedCell({ col, row, entry });
      setDrawerOpen(true);
    },
    [],
  );

  const selectedDateFormatted = useMemo(() => {
    if (!selectedCell?.entry.date) return t("heatmapEmptyDay");
    return new Date(selectedCell.entry.date).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [selectedCell, locale, t]);

  return (
    <div
      className="rounded-xl border border-white/10 bg-black/20 p-4"
      ref={gridRef}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white">
            {t("heatmapTitle")}
          </h4>
          <p className="text-xs text-slate-400">{t("heatmapSubtitle")}</p>
        </div>
        <p className="text-xs text-slate-400">
          {t("heatmapTotal", { count: totalCount })}
        </p>
      </div>

      {/* #1546: keyboard shortcut hint */}
      <p className="mt-1 text-[10px] text-slate-500" aria-live="polite">
        {t("heatmapKeyboardHint")}
      </p>

      <div
        className="mt-4 overflow-x-auto"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="min-w-[760px]">
          <div className="mb-2 ml-12 grid grid-flow-col auto-cols-[12px] gap-1 text-[10px] text-slate-500">
            {weeks.map((_, column) => {
              const label = monthLabels.find((entry) => entry.column === column);
              return <span key={column}>{label?.label ?? ""}</span>;
            })}
          </div>

          <div className="flex gap-2">
            <div className="mt-[2px] grid grid-rows-7 gap-1 text-[10px] text-slate-500">
              {weekdayLabels.map((label) => (
                <span
                  key={label}
                  className="flex h-3 items-center justify-end pr-1"
                >
                  {label}
                </span>
              ))}
            </div>

            {/* #1543: role="grid" with row/gridcell semantics */}
            <div
              role="grid"
              aria-label={t("heatmapAriaLabel")}
              aria-rowcount={7}
              aria-colcount={weeks.length}
              onKeyDown={handleGridKeyDown}
              style={{
                display: "grid",
                gridAutoFlow: "column",
                gridTemplateRows: "repeat(7, 13px)",
                gap: 2,
              }}
            >
              {weeks.map((week, column) =>
                week.map((entry, row) => {
                  const intensity = intensityForCount(entry.count, maxCount);
                  const formattedDate = entry.date
                    ? new Date(entry.date).toLocaleDateString(locale, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : t("heatmapEmptyDay");
                  const cellKey = `${column}-${row}`;
                  const isFocused = column === focusedCol && row === focusedRow;

                  return (
                    <div key={cellKey} role="row">
                      <button
                        ref={(el) => {
                          if (el) cellRefs.current.set(cellKey, el);
                        }}
                        role="gridcell"
                        tabIndex={isFocused ? 0 : -1}
                        aria-label={
                          entry.date
                            ? t("heatmapTooltip", {
                                count: entry.count,
                                date: formattedDate,
                              })
                            : t("heatmapEmptyDay")
                        }
                        aria-selected={isFocused}
                        className="block h-[11px] w-[11px] rounded-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                        style={{ backgroundColor: CELL_COLORS[intensity] }}
                        onFocus={() => {
                          setFocusedCol(column);
                          setFocusedRow(row);
                        }}
                        onClick={() => openCell(column, row, entry)}
                      />
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-slate-500">
        <span>{t("heatmapLegendLess")}</span>
        {CELL_COLORS.map((color, index) => (
          <span
            key={color}
            className="h-3 w-3 rounded-[3px] border border-white/10"
            style={{
              backgroundColor: color,
              boxShadow: index === CELL_COLORS.length - 1 ? "0 0 12px rgba(94, 242, 192, 0.2)" : undefined,
            }}
          />
        ))}
        <span>{t("heatmapLegendMore")}</span>
      </div>

      {/* #1543 + #1544: accessible detail drawer (bottom sheet on mobile) */}
      {drawerOpen && selectedCell && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={t("heatmapDrawerTitle")}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onKeyDown={handleDrawerKeyDown}
        >
          <div
            ref={drawerRef}
            className="w-full max-w-sm rounded-t-2xl border border-white/10 bg-[#0f172a] p-5 sm:rounded-2xl"
          >
            <div className="flex items-start justify-between">
              <h5 className="text-sm font-semibold text-white">
                {t("heatmapDrawerTitle")}
              </h5>
              <button
                onClick={() => {
                  setDrawerOpen(false);
                  setSelectedCell(null);
                }}
                aria-label={t("heatmapDrawerClose")}
                className="rounded p-1 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-400">{t("heatmapDrawerDate")}</dt>
                <dd className="text-white">{selectedDateFormatted}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">{t("heatmapDrawerCount")}</dt>
                <dd className="text-white">
                  {t("heatmapTooltip", {
                    count: selectedCell.entry.count,
                    date: selectedDateFormatted,
                  })}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[10px] text-slate-500">
              {t("heatmapDrawerHint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
