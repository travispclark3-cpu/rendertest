import React, { useEffect, useRef, useState } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { apiUrl } from "./lib/api";

/* ─── Range config ─────────────────────────────────────────────────────────── */
const RANGES = [
  { label: "1D", range: "1d",  interval: "1m",  timeVisible: true  },
  { label: "5D", range: "5d",  interval: "5m",  timeVisible: true  },
  { label: "1M", range: "1mo", interval: "30m", timeVisible: false },
  { label: "3M", range: "3mo", interval: "1d",  timeVisible: false },
  { label: "6M", range: "6mo", interval: "1d",  timeVisible: false },
  { label: "1Y",  range: "1y",  interval: "1d",  timeVisible: false },
  { label: "5Y",  range: "5y",  interval: "1wk", timeVisible: false },
  { label: "ALL", range: "max", interval: "1mo", timeVisible: false },
] as const;

const MAX_SYMBOLS = 10;

const CHART_COLORS = [
  "#22c97a", "#3b82f6", "#f59e0b", "#e84444", "#a855f7",
  "#06b6d4", "#f97316", "#ec4899", "#84cc16", "#6366f1",
];

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface ChartData { bars: Bar[]; price: number; change: number; changePct: number; name: string; }
interface Hit { symbol: string; display: string; name: string; type: string; }
interface ChartSym { symbol: string; display: string; name: string; color: string; }

const DEFAULT_SYMBOLS: ChartSym[] = [
  { symbol: "^GSPC", display: "SPX", name: "S&P 500", color: CHART_COLORS[0] },
];

const CHART_TZ = "America/New_York";
const STORAGE_KEY = "mktv:chart-symbols";

function formatChartTime(ts: number, withTime: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHART_TZ,
    ...(withTime
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : { month: "short", day: "numeric", year: "2-digit" }),
  }).format(new Date(ts * 1000));
}

function chartTimeOptions(timeVisible: boolean) {
  const fmt = (time: unknown) =>
    typeof time === "number" ? formatChartTime(time, timeVisible) : String(time);
  return {
    timeScale: { timeVisible, tickMarkFormatter: fmt },
    localization: { timeFormatter: fmt },
  };
}

function normalizeBars(bars: Bar[]): { time: UTCTimestamp; value: number }[] {
  if (bars.length === 0) return [];
  const base = bars[0].close;
  if (base === 0) return [];
  return bars.map(b => ({
    time: b.time as UTCTimestamp,
    value: ((b.close - base) / base) * 100,
  }));
}

function usePersistedSymbols(): [ChartSym[], (s: ChartSym[]) => void] {
  const [symbols, setSymbols] = useState<ChartSym[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_SYMBOLS;
      const parsed = JSON.parse(raw) as ChartSym[];
      return parsed.slice(0, MAX_SYMBOLS);
    } catch { return DEFAULT_SYMBOLS; }
  });
  const set = (s: ChartSym[]) => {
    const next = s.slice(0, MAX_SYMBOLS);
    setSymbols(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  return [symbols, set];
}

function nextColor(used: ChartSym[]): string {
  const usedColors = new Set(used.map(s => s.color));
  return CHART_COLORS.find(c => !usedColors.has(c)) ?? CHART_COLORS[used.length % CHART_COLORS.length];
}

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" };

/* ─── ChartWidget ──────────────────────────────────────────────────────────── */
export default function ChartWidget() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const fitKeyRef    = useRef("");

  const [symbols,  setSymbols]  = usePersistedSymbols();
  const [rangeIdx, setRangeIdx] = useState(0);
  const [quotes,   setQuotes]   = useState<Record<string, { changePct: number }>>({});
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(false);

  const [query,      setQuery]      = useState("");
  const [results,    setResults]    = useState<Hit[]>([]);
  const [searching,  setSearching]  = useState(false);
  const [dropOpen,   setDropOpen]   = useState(false);
  const [quoteColors, setQuoteColors] = useState<Record<string, "up" | "dn" | "fl">>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef  = useRef<HTMLDivElement>(null);

  const rng = RANGES[rangeIdx];
  const atMax = symbols.length >= MAX_SYMBOLS;

  /* ── Create chart once ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;
    const tzOpts = chartTimeOptions(true);
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#080d14" },
        textColor: "#8a9ab8",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "#1a2030" },
        horzLines: { color: "#1a2030" },
      },
      rightPriceScale: {
        borderColor: "#1a2030",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale:        { borderColor: "#1a2030", secondsVisible: false, ...tzOpts.timeScale },
      localization:     { ...tzOpts.localization, priceFormatter: (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(2)}%` },
      crosshair: {
        vertLine: { color: "#4a5570", labelBackgroundColor: "#1a2030" },
        horzLine: { color: "#4a5570", labelBackgroundColor: "#1a2030" },
      },
      autoSize: true,
    });

    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current.clear();
    };
  }, []);

  /* ── Sync series with symbol list ──────────────────────────────────────── */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const existing = seriesRef.current;
    const symSet = new Set(symbols.map(s => s.symbol));

    for (const [sym, series] of existing) {
      if (!symSet.has(sym)) {
        chart.removeSeries(series);
        existing.delete(sym);
      }
    }

    for (const s of symbols) {
      if (!existing.has(s.symbol)) {
        const series = chart.addLineSeries({
          color: s.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: true,
        });
        existing.set(s.symbol, series);
      } else {
        existing.get(s.symbol)!.applyOptions({ color: s.color });
      }
    }
  }, [symbols]);

  /* ── Fetch data & poll ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError(false);

    async function load() {
      try {
        const responses = await Promise.all(
          symbols.map(s =>
            fetch(apiUrl(`/api/chart/${encodeURIComponent(s.symbol)}?interval=${rng.interval}&range=${rng.range}`))
              .then(r => r.ok ? r.json() as Promise<ChartData> : Promise.reject())
              .then(json => ({ sym: s, json }))
          )
        );
        if (cancelled) return;

        const nextQuotes: Record<string, { changePct: number }> = {};
        for (const { sym, json } of responses) {
          const series = seriesRef.current.get(sym.symbol);
          if (series && json.bars.length) {
            series.setData(normalizeBars(json.bars));
          }
          nextQuotes[sym.symbol] = { changePct: json.changePct };
        }
        setQuotes(nextQuotes);

        if (chartRef.current) {
          chartRef.current.applyOptions(chartTimeOptions(rng.timeVisible));
          const fitKey = `${symbols.map(s => s.symbol).join(",")}:${rng.range}:${rng.interval}`;
          if (fitKeyRef.current !== fitKey) {
            fitKeyRef.current = fitKey;
            requestAnimationFrame(() => chartRef.current?.timeScale().fitContent());
          }
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const iv = setInterval(load, 5_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [symbols, rng.interval, rng.range, rng.timeVisible]);

  /* ── Symbol search ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r  = await fetch(apiUrl(`/api/ticker/search?q=${encodeURIComponent(query)}`));
        const j  = await r.json();
        const added = new Set(symbols.map(s => s.symbol));
        setResults((j.results ?? []).filter((h: Hit) => !added.has(h.symbol)));
      } catch { setResults([]); }
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, symbols]);

  /* ── Fetch quote colors for search results ────────────────────────────── */
  useEffect(() => {
    if (results.length === 0) { setQuoteColors({}); return; }
    const syms = results.map(h => h.symbol).join(",");
    fetch(apiUrl(`/api/ticker?symbols=${encodeURIComponent(syms)}`))
      .then(r => r.json())
      .then(j => {
        const map: Record<string, "up" | "dn" | "fl"> = {};
        for (const item of j.items ?? []) map[item.yahooSymbol] = item.direction;
        setQuoteColors(map);
      })
      .catch(() => {});
  }, [results]);

  /* ── Click-outside to close dropdown ──────────────────────────────────── */
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
        setQuery("");
        setResults([]);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function addSymbol(hit: Hit) {
    if (symbols.some(s => s.symbol === hit.symbol) || symbols.length >= MAX_SYMBOLS) return;
    setSymbols([...symbols, {
      symbol: hit.symbol,
      display: hit.display,
      name: hit.name,
      color: nextColor(symbols),
    }]);
    setQuery("");
    setResults([]);
    setDropOpen(false);
  }

  function removeSymbol(sym: string) {
    setSymbols(symbols.filter(s => s.symbol !== sym));
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#080d14", overflow: "hidden" }}>

      {/* ── Toolbar: search + legend ──────────────────────────────────────── */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderBottom: "1px solid #1a2030", minHeight: 34 }}>
        <div ref={dropRef} style={{ position: "relative", width: 200, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#0d1018", border: "1px solid #2a2f3d", borderRadius: 5, padding: "0 8px" }}>
            <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, fill: "#4a5570", flexShrink: 0 }}>
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setDropOpen(true); }}
              onFocus={() => setDropOpen(true)}
              placeholder={atMax ? "Max 10 symbols" : "Add symbol…"}
              disabled={atMax}
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: atMax ? "#333" : "#fff", ...mono, fontSize: 10, padding: "6px 0" }}
            />
          </div>

          {dropOpen && !atMax && (results.length > 0 || searching) && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#0d1018", border: "1px solid #2a2f3d", borderRadius: 5, zIndex: 20, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,.6)" }}>
              {searching && results.length === 0 && (
                <div style={{ padding: "9px 12px", ...mono, fontSize: 10, color: "#4a5570" }}>Searching…</div>
              )}
              {results.map(hit => {
                const dir = quoteColors[hit.symbol];
                const hc  = dir === "up" ? "#22c97a" : dir === "dn" ? "#e84444" : "#4a5570";
                return (
                  <button
                    key={hit.symbol}
                    onClick={() => addSymbol(hit)}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 12px", background: "none", border: "none", borderBottom: "1px solid #1a2030", cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#ffffff0a")}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >
                    <span style={{ ...mono, fontSize: 10, fontWeight: 700, color: hc, minWidth: 52 }}>{hit.display}</span>
                    <span style={{ fontSize: 10, color: hc, opacity: 0.7, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hit.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1, alignItems: "center", overflow: "hidden" }}>
          {symbols.map(s => {
            const pct = quotes[s.symbol]?.changePct ?? 0;
            const flat = Math.abs(pct) <= 0.09;
            const pctClr = flat ? "#4a5570" : pct > 0 ? "#22c97a" : "#e84444";
            const sign = pct >= 0 ? "+" : "";
            return (
              <div
                key={s.symbol}
                title={s.name}
                style={{ display: "flex", alignItems: "center", gap: 5, background: "#0d1018", border: "1px solid #1a2030", borderRadius: 4, padding: "2px 6px 2px 4px" }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                <span style={{ ...mono, fontSize: 9, fontWeight: 700, color: s.color }}>{s.display}</span>
                <span style={{ ...mono, fontSize: 9, color: pctClr }}>{sign}{pct.toFixed(2)}%</span>
                {symbols.length > 1 && (
                  <button
                    onClick={() => removeSymbol(s.symbol)}
                    style={{ background: "none", border: "none", color: "#333", cursor: "pointer", padding: 0, display: "flex", lineHeight: 1 }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#e84444")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#333")}
                    title={`Remove ${s.display}`}
                  >
                    <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, fill: "currentColor" }}>
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <span style={{ ...mono, fontSize: 9, color: "#333", flexShrink: 0 }}>
          {loading && symbols.length > 0 ? "updating…" : error ? "error" : `${symbols.length}/${MAX_SYMBOLS}`}
        </span>
      </div>

      {/* ── Chart canvas ────────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", minHeight: 0 }} />

      {/* ── Range buttons ───────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, display: "flex", gap: 2, padding: "4px 8px", borderTop: "1px solid #1a2030" }}>
        {RANGES.map((r, i) => (
          <button
            key={r.label}
            onClick={() => setRangeIdx(i)}
            style={{
              ...mono,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.06em",
              padding: "3px 8px",
              borderRadius: 3,
              border: "none",
              cursor: "pointer",
              background: rangeIdx === i ? "#22c97a" : "transparent",
              color:      rangeIdx === i ? "#000"    : "#4a5570",
              transition: "background .15s, color .15s",
            }}
          >
            {r.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ ...mono, fontSize: 9, color: "#333", alignSelf: "center" }}>% change · 5s refresh</span>
      </div>
    </div>
  );
}
