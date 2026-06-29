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

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface ChartData { bars: Bar[]; price: number; change: number; changePct: number; name: string; }
interface Hit { symbol: string; display: string; name: string; type: string; }
interface Sym { symbol: string; display: string; name: string; }

const DEFAULT: Sym = { symbol: "^GSPC", display: "SPX", name: "S&P 500" };
const CHART_TZ = "America/New_York";
const ALL_RANGE_IDX = RANGES.length - 1;

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

function usePersistedSym(key: string): [Sym, (s: Sym) => void] {
  const [sym, setSym] = useState<Sym>(() => {
    try {
      const raw = localStorage.getItem(`mktv:chart-sym:${key}`);
      return raw ? (JSON.parse(raw) as Sym) : DEFAULT;
    } catch { return DEFAULT; }
  });
  const set = (s: Sym) => {
    setSym(s);
    try { localStorage.setItem(`mktv:chart-sym:${key}`, JSON.stringify(s)); } catch { /* ignore */ }
  };
  return [sym, set];
}

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" };

/* ─── ChartWidget ──────────────────────────────────────────────────────────── */
export default function ChartWidget({ panelKey }: { panelKey: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Area"> | null>(null);

  const [sym,      setSym]      = usePersistedSym(panelKey);
  const [rangeIdx, setRangeIdx] = useState(ALL_RANGE_IDX);
  const [data,     setData]     = useState<ChartData | null>(null);
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

  /* ── Create chart once ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;
    const tzOpts = chartTimeOptions(false);
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
      rightPriceScale: { borderColor: "#1a2030" },
      timeScale:        { borderColor: "#1a2030", secondsVisible: false, ...tzOpts.timeScale },
      localization:     tzOpts.localization,
      crosshair: {
        vertLine: { color: "#4a5570", labelBackgroundColor: "#1a2030" },
        horzLine: { color: "#4a5570", labelBackgroundColor: "#1a2030" },
      },
      autoSize: true,
    });

    const area = chart.addAreaSeries({
      lineColor: "#22c97a",
      topColor:  "rgba(34,201,122,0.22)",
      bottomColor: "rgba(34,201,122,0.0)",
      lineWidth: 2,
      priceLineColor: "#22c97a",
      lastValueVisible: true,
    });

    chartRef.current  = chart;
    seriesRef.current = area;

    return () => {
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []);

  /* ── Fetch data & poll ─────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    async function load() {
      try {
        const res = await fetch(apiUrl(`/api/chart/${encodeURIComponent(sym.symbol)}?interval=${rng.interval}&range=${rng.range}`));
        if (!res.ok) throw new Error();
        const json: ChartData = await res.json();
        if (cancelled) return;
        setData(json);
        if (seriesRef.current && json.bars.length) {
          seriesRef.current.setData(
            json.bars.map(b => ({ time: b.time as UTCTimestamp, value: b.close }))
          );
        }
        if (chartRef.current) {
          chartRef.current.applyOptions(chartTimeOptions(rng.timeVisible));
          chartRef.current.timeScale().fitContent();
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const iv = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [sym.symbol, rng.interval, rng.range, rng.timeVisible]);

  /* ── Symbol search ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r  = await fetch(apiUrl(`/api/ticker/search?q=${encodeURIComponent(query)}`));
        const j  = await r.json();
        setResults(j.results ?? []);
      } catch { setResults([]); }
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

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

  function selectSymbol(hit: Hit) {
    setSym({ symbol: hit.symbol, display: hit.display, name: hit.name });
    setQuery("");
    setResults([]);
    setDropOpen(false);
  }

  const pct      = data?.changePct ?? 0;
  const flat     = Math.abs(pct) <= 0.09;
  const symColor = !data ? "#4a5570" : flat ? "#4a5570" : pct > 0 ? "#22c97a" : "#e84444";
  const clr      = symColor;
  const sign     = (data?.change ?? 0) >= 0 ? "+" : "";

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "#080d14", overflow: "hidden" }}>

      {/* ── Search bar ──────────────────────────────────────────────────── */}
      <div ref={dropRef} style={{ position: "relative", flexShrink: 0, padding: "5px 8px", borderBottom: "1px solid #1a2030" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0d1018", border: "1px solid #2a2f3d", borderRadius: 5, padding: "0 10px" }}>
          <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: "#4a5570", flexShrink: 0 }}>
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <div style={{ flex: 1, position: "relative" }}>
            {!query && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 6, pointerEvents: "none" }}>
                <span style={{ ...mono, fontSize: 10, fontWeight: 700, color: symColor }}>{sym.display}</span>
                <span style={{ fontSize: 10, color: "#2a2f3d" }}>·</span>
                <span style={{ fontSize: 10, color: symColor, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sym.name}</span>
              </div>
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setDropOpen(true); }}
              onFocus={() => setDropOpen(true)}
              placeholder=""
              style={{ width: "100%", background: "none", border: "none", outline: "none", color: "#fff", ...mono, fontSize: 10, padding: "7px 0" }}
            />
          </div>
          {query && (
            <button onClick={() => { setQuery(""); setResults([]); }} style={{ background: "none", border: "none", color: "#4a5570", cursor: "pointer", padding: 0, display: "flex" }}>
              <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, fill: "currentColor" }}><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          )}
        </div>

        {dropOpen && (results.length > 0 || searching) && (
          <div style={{ position: "absolute", top: "calc(100%)", left: 8, right: 8, background: "#0d1018", border: "1px solid #2a2f3d", borderRadius: 5, zIndex: 20, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,.6)" }}>
            {searching && results.length === 0 && (
              <div style={{ padding: "9px 12px", ...mono, fontSize: 10, color: "#4a5570" }}>Searching…</div>
            )}
            {results.map(hit => {
              const dir = quoteColors[hit.symbol];
              const hc  = dir === "up" ? "#22c97a" : dir === "dn" ? "#e84444" : "#4a5570";
              return (
                <button
                  key={hit.symbol}
                  onClick={() => selectSymbol(hit)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 12px", background: "none", border: "none", borderBottom: "1px solid #1a2030", cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#ffffff0a")}
                  onMouseLeave={e => (e.currentTarget.style.background = "none")}
                >
                  <span style={{ ...mono, fontSize: 10, fontWeight: 700, color: hc, minWidth: 52 }}>{hit.display}</span>
                  <span style={{ fontSize: 10, color: hc, opacity: 0.7, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hit.name}</span>
                  <span style={{ fontSize: 9, color: "#333", flexShrink: 0 }}>{hit.type}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Price header ────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, padding: "4px 10px 2px", display: "flex", alignItems: "baseline", gap: 8, minHeight: 26 }}>
        {data && (
          <>
            <span style={{ ...mono, fontSize: 15, fontWeight: 700, color: "#fff" }}>
              {data.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span style={{ ...mono, fontSize: 10, color: clr }}>
              {sign}{data.change.toFixed(2)}&nbsp;({sign}{data.changePct.toFixed(2)}%)
            </span>
            <span style={{ ...mono, fontSize: 9, color: "#333", marginLeft: "auto" }}>~30s delay</span>
          </>
        )}
        {loading && !data && (
          <span style={{ ...mono, fontSize: 10, color: "#4a5570" }}>Loading…</span>
        )}
        {error && !data && (
          <span style={{ ...mono, fontSize: 10, color: "#e84444" }}>Failed to load</span>
        )}
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
        {loading && data && (
          <span style={{ ...mono, fontSize: 9, color: "#333", alignSelf: "center" }}>updating…</span>
        )}
      </div>
    </div>
  );
}
