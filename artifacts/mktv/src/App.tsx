import React, { useEffect, useRef, useState } from "react";
import ChartWidget from "./ChartWidget";
import { apiUrl } from "./lib/api";

/* ─── YT Types ────────────────────────────────────────────────────────────── */
declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: () => void;
  }
}

/* ─── Load YT IFrame API (idempotent) ────────────────────────────────────── */
let _ytApiPromise: Promise<void> | null = null;
function loadYTApi(): Promise<void> {
  if (_ytApiPromise) return _ytApiPromise;
  _ytApiPromise = new Promise<void>((resolve) => {
    if (window.YT?.Player) { resolve(); return; }
    window.onYouTubeIframeAPIReady = resolve;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return _ytApiPromise;
}

/* ─── Channels ────────────────────────────────────────────────────────────── */
const FALLBACK_IDS: Record<string, string> = {
  bloomberg: "QB5BNdBFujE",
  schwab:    "THKWCO6ZNts",
  yahoo:     "KQp-e_XQnDE",
  nbc:       "",
  cbs:       "",
  abc:       "",
  fox:       "",
};

const CHANNELS = [
  {
    key: "bloomberg", name: "BLOOMBERG",  label: "Bloomberg\nTelevision",
    schedule: null,
    ytUrl: "https://www.youtube.com/@markets",
    channelId: "UCIALMKvObZNtJ6AmdCLP7Lg",
    useLiveChannel: true,
  },
  {
    key: "schwab",    name: "SCHWAB NET.", label: "Schwab\nNetwork",
    schedule: null,
    ytUrl: "https://www.youtube.com/@SchwabNetwork",
  },
  {
    key: "yahoo",     name: "YAHOO FIN.", label: "Yahoo Finance",
    schedule: "Weekdays 9am – 5pm ET",
    ytUrl: "https://www.youtube.com/@YahooFinance",
  },
  {
    key: "news",      name: "NEWS",        label: "News",
    schedule: null,
    ytUrl: "",
  },
];

/* ─── News sub-channels ───────────────────────────────────────────────────── */
const NEWS_SUBS = [
  { key: "nbc", label: "NBC", ytUrl: "https://www.youtube.com/@NBCNews",    channelId: "UCeY0bbntWzzVIaj2z3QigXg" },
  { key: "cbs", label: "CBS", ytUrl: "https://www.youtube.com/@CBSNews",    channelId: "UC8p1vwvWtl6T73JiExfWs1g" },
  { key: "abc", label: "ABC", ytUrl: "https://www.youtube.com/@ABCNews",    channelId: "UCBi2mrWuNuyYy4gbM6fU18Q" },
  { key: "fox", label: "FOX", ytUrl: "https://www.youtube.com/@LiveNOWfox", channelId: "UCSbs5Of1OMMIT8XH0RQUX6g" },
] as const;
type NewsSub = typeof NEWS_SUBS[number]["key"];

/* ─── Ticker ──────────────────────────────────────────────────────────────── */
type TickerRow = [string, string, string, "up" | "dn" | "fl"];

interface SavedTicker { symbol: string; display: string; name: string; }

const DEFAULT_TICKERS: SavedTicker[] = [
  { symbol: "SPY",      display: "SPY",  name: "S&P 500 ETF" },
  { symbol: "QQQ",      display: "QQQ",  name: "Nasdaq 100 ETF" },
  { symbol: "DIA",      display: "DIA",  name: "Dow Jones ETF" },
  { symbol: "IWM",      display: "IWM",  name: "Russell 2000 ETF" },
  { symbol: "TSLA",     display: "TSLA", name: "Tesla" },
  { symbol: "AAPL",     display: "AAPL", name: "Apple" },
  { symbol: "NVDA",     display: "NVDA", name: "Nvidia" },
  { symbol: "AMZN",     display: "AMZN", name: "Amazon" },
  { symbol: "MSFT",     display: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL",    display: "GOOGL",name: "Alphabet" },
  { symbol: "META",     display: "META", name: "Meta" },
  { symbol: "JPM",      display: "JPM",  name: "JPMorgan" },
  { symbol: "GS",       display: "GS",   name: "Goldman Sachs" },
  { symbol: "BTC-USD",  display: "BTC",  name: "Bitcoin" },
  { symbol: "ETH-USD",  display: "ETH",  name: "Ethereum" },
  { symbol: "^VIX",     display: "VIX",  name: "Volatility Index" },
  { symbol: "DX-Y.NYB", display: "DXY",  name: "US Dollar Index" },
  { symbol: "CL=F",     display: "WTI",  name: "WTI Crude Oil" },
  { symbol: "GC=F",     display: "GOLD", name: "Gold Futures" },
  { symbol: "^TNX",     display: "10Y",  name: "10-Yr Treasury" },
];

/* ─── useLocalStorage ─────────────────────────────────────────────────────── */
function useLocalStorage<T>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : defaultValue;
    } catch { return defaultValue; }
  });
  const set = (v: T) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  };
  return [value, set];
}

/* ─── Clock ───────────────────────────────────────────────────────────────── */
function ClockET() {
  const [t, setT] = useState("");
  useEffect(() => {
    function tick() {
      const now = new Date();
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const mon = now.getMonth() + 1;
      const offset = mon >= 3 && mon <= 11 ? -4 : -5;
      const et = new Date(utc + 3600000 * offset);
      const h = et.getHours(), m = et.getMinutes(), s = et.getSeconds();
      const ap = h >= 12 ? "PM" : "AM";
      const hh = ((h % 12) || 12).toString().padStart(2, "0");
      setT(`${hh}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")} ${ap} ET`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "var(--dim)", marginLeft: "auto", whiteSpace: "nowrap" }}>
      {t}
    </span>
  );
}

/* ─── Ticker Tape ─────────────────────────────────────────────────────────── */
function TickerItem({ sym, val, chg, dir }: { sym: string; val: string; chg: string; dir: "up"|"dn"|"fl" }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0 14px", borderRight: "1px solid var(--bdr)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, flexShrink: 0 }}>
      <b style={{ color: "#fff" }}>{sym}</b>
      <span style={{ color: "var(--txt)" }}>{val}</span>
      <span style={{ color: dir === "up" ? "#22c97a" : dir === "dn" ? "#e84444" : "var(--dim)" }}>{chg}</span>
    </span>
  );
}

function TickerTape({ tickers }: { tickers: SavedTicker[] }) {
  const [priceMap, setPriceMap] = useState<Map<string, { price: string; change: string; direction: "up"|"dn"|"fl" }>>(new Map());
  const measureRef = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(2);

  useEffect(() => {
    if (tickers.length === 0) return;
    async function refresh() {
      try {
        const syms = tickers.map(t => t.symbol).join(",");
        const res = await fetch(apiUrl(`/api/ticker?symbols=${encodeURIComponent(syms)}`));
        if (!res.ok) return;
        const data: { items: { yahooSymbol: string; symbol: string; price: string; change: string; direction: "up"|"dn"|"fl" }[] } = await res.json();
        const map = new Map<string, { price: string; change: string; direction: "up"|"dn"|"fl" }>();
        for (const item of data.items) {
          map.set(item.yahooSymbol, item);
          map.set(item.symbol, item);
        }
        setPriceMap(map);
      } catch { /* keep current */ }
    }
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [tickers]);

  const rows: TickerRow[] = tickers.map(t => {
    const p = priceMap.get(t.display) ?? priceMap.get(t.symbol);
    return [t.display, p?.price ?? "—", p?.change ?? "—", p?.direction ?? "fl"];
  });

  useEffect(() => {
    if (!measureRef.current || rows.length === 0) return;
    const oneWidth = measureRef.current.offsetWidth;
    if (oneWidth === 0) return;
    const needed = Math.ceil(window.innerWidth / oneWidth) + 1;
    setCopies(Math.max(2, needed));
  }, [rows.length, tickers]);

  if (rows.length === 0) return null;

  const repeated = Array.from({ length: copies }, () => rows).flat();
  const doubled = [...repeated, ...repeated];

  return (
    <div style={{ height: 30, minHeight: 30, background: "#04060a", borderBottom: "1px solid var(--bdr)", overflow: "hidden", display: "flex", alignItems: "center", flexShrink: 0, position: "relative" }}>
      <div ref={measureRef} style={{ position: "absolute", visibility: "hidden", display: "flex", pointerEvents: "none" }}>
        {rows.map(([sym, val, chg, dir], i) => (
          <TickerItem key={i} sym={sym} val={val} chg={chg} dir={dir} />
        ))}
      </div>
      <div style={{ display: "flex", animation: "scroll 90s linear infinite", whiteSpace: "nowrap" }}>
        {doubled.map(([sym, val, chg, dir], i) => (
          <TickerItem key={i} sym={sym} val={val} chg={chg} dir={dir} />
        ))}
      </div>
    </div>
  );
}

/* ─── Settings Panel ──────────────────────────────────────────────────────── */
interface SearchHit { symbol: string; display: string; name: string; type: string; }

function SettingsPanel({
  open,
  onClose,
  tickers,
  setTickers,
}: {
  open: boolean;
  onClose: () => void;
  tickers: SavedTicker[];
  setTickers: (v: SavedTicker[]) => void;
}) {
  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const tickersRef   = useRef(tickers);
  const inputRef     = useRef<HTMLInputElement>(null);

  useEffect(() => { tickersRef.current = tickers; }, [tickers]);

  useEffect(() => {
    if (!open) { setQuery(""); setResults([]); }
    else setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }

    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(apiUrl(`/api/ticker/search?q=${encodeURIComponent(q)}`), {
          signal: controller.signal,
        });
        const data: { results: SearchHit[] } = await res.json();
        setResults(data.results.filter(r => !tickersRef.current.some(t => t.symbol === r.symbol)));
      } catch (e: unknown) {
        if ((e as Error).name !== "AbortError") setResults([]);
      } finally {
        setSearching(false);
        abortRef.current = null;
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    };
  }, [query]);

  function addTicker(hit: SearchHit) {
    if (tickersRef.current.some(t => t.symbol === hit.symbol)) return;
    setResults([]);
    setQuery("");
    setTickers([...tickersRef.current, { symbol: hit.symbol, display: hit.display, name: hit.name }]);
  }

  function removeTicker(sym: string) {
    setTickers(tickers.filter(t => t.symbol !== sym));
  }

  function resetToDefault() {
    setTickers([...DEFAULT_TICKERS]);
  }

  const panelStyle: React.CSSProperties = {
    position: "fixed", top: 0, right: 0, height: "100%",
    width: 340, background: "#0b0e17", borderLeft: "1px solid var(--bdr)",
    display: "flex", flexDirection: "column", zIndex: 200,
    transform: open ? "translateX(0)" : "translateX(100%)",
    transition: "transform 0.22s cubic-bezier(.4,0,.2,1)",
    boxShadow: open ? "-6px 0 32px rgba(0,0,0,.7)" : "none",
  };

  const monoSm: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10 };

  return (
    <>
      {open && <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(0,0,0,.45)" }} />}
      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: "1px solid var(--bdr)", flexShrink: 0 }}>
          <span style={{ ...monoSm, fontSize: 11, color: "#fff", letterSpacing: "0.08em" }}>SETTINGS</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--dim)", cursor: "pointer", padding: 4, display: "flex" }}>
            <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: "currentColor" }}>
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "16px 16px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ ...monoSm, fontSize: 9, color: "var(--dim)", letterSpacing: "0.1em" }}>TICKER SYMBOLS</span>
            <button onClick={resetToDefault} style={{ ...monoSm, fontSize: 9, background: "none", border: "none", color: "#444", cursor: "pointer", letterSpacing: "0.06em" }}>RESET</button>
          </div>

          <div style={{ position: "relative", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", background: "#141820", border: "1px solid #2a2f3d", borderRadius: 6, padding: "0 10px", gap: 8 }}>
              <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: "var(--dim)", flexShrink: 0 }}>
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search symbol or company…"
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#fff", ...monoSm, padding: "9px 0" }}
              />
              {query && (
                <button onClick={() => { setQuery(""); setResults([]); }} style={{ background: "none", border: "none", color: "var(--dim)", cursor: "pointer", padding: 0, display: "flex" }}>
                  <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "currentColor" }}>
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              )}
            </div>

            {(results.length > 0 || searching) && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#141820", border: "1px solid #2a2f3d", borderRadius: 6, zIndex: 10, overflow: "hidden" }}>
                {searching && results.length === 0 && (
                  <div style={{ padding: "10px 12px", ...monoSm, color: "var(--dim)" }}>Searching…</div>
                )}
                {results.map(hit => (
                  <button
                    key={hit.symbol}
                    onClick={() => addTicker(hit)}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", background: "none", border: "none", borderBottom: "1px solid #1e2330", cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#ffffff0a")}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >
                    <span style={{ ...monoSm, color: "#fff", minWidth: 52 }}>{hit.display}</span>
                    <span style={{ fontSize: 10, color: "var(--dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hit.name}</span>
                    <span style={{ fontSize: 9, color: "#444", flexShrink: 0 }}>{hit.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {tickers.length === 0 && (
              <div style={{ ...monoSm, color: "#333", padding: "12px 0", textAlign: "center" }}>No tickers — search above to add</div>
            )}
            {tickers.map((t) => (
              <div
                key={t.symbol}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 5, background: "#0d1018" }}
              >
                <span style={{ ...monoSm, color: "#ccc", minWidth: 52 }}>{t.display}</span>
                <span style={{ fontSize: 10, color: "var(--dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                <button
                  onClick={() => removeTicker(t.symbol)}
                  style={{ background: "none", border: "none", color: "#333", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#e84444")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#333")}
                  title={`Remove ${t.display}`}
                >
                  <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "currentColor" }}>
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Panel ───────────────────────────────────────────────────────────────── */
type Status = "loading" | "live" | "offline" | "restricted";
type PanelMode = "stream" | "chart";

function Panel({ idx, ch, videoId, channelId, isActive, onSetAudio, subChannels, selectedSub, onSelectSub, mode, onToggleMode }: {
  idx: number;
  ch: typeof CHANNELS[0];
  videoId: string;
  channelId?: string;
  isActive: boolean;
  onSetAudio: (i: number) => void;
  subChannels?: typeof NEWS_SUBS;
  selectedSub?: string;
  onSelectSub?: (key: string) => void;
  mode: PanelMode;
  onToggleMode: () => void;
}) {
  const mountRef       = useRef<HTMLDivElement>(null);
  const playerRef      = useRef<YT.Player | null>(null);
  const isActiveRef    = useRef(isActive);
  // Prefer live channel embed when configured (always current broadcast)
  const useLiveChannel = "useLiveChannel" in ch && ch.useLiveChannel;
  const useChannelEmbed = !!channelId && (!videoId || useLiveChannel);
  const [status, setStatus]       = useState<Status>(videoId || useChannelEmbed ? "loading" : "offline");
  const [playing, setPlaying]     = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [menuOpen, setMenuOpen]   = useState(false);
  const [embedMuted, setEmbedMuted] = useState(true);

  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  useEffect(() => {
    if (useChannelEmbed) setEmbedMuted(true);
  }, [channelId, useChannelEmbed]);

  useEffect(() => {
    if (useChannelEmbed && !isActive) setEmbedMuted(true);
  }, [isActive, useChannelEmbed]);

  useEffect(() => {
    if (mode === "chart") {
      try { playerRef.current?.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
      setStatus("offline");
      setPlaying(false);
    }
  }, [mode]);

  // Channel-based iframe: treat as live immediately when it loads
  useEffect(() => {
    if (mode === "chart" || !useChannelEmbed) return;
    setStatus("live");
    setPlaying(true);
  }, [useChannelEmbed, mode]);

  useEffect(() => {
    if (mode === "chart") return;
    if (useChannelEmbed) return; // handled above
    if (!videoId) { setStatus("offline"); setPlaying(false); return; }
    setStatus("loading");
    setPlaying(false);
    let cancelled = false;

    loadYTApi().then(() => {
      if (cancelled || !mountRef.current) return;
      try { playerRef.current?.destroy(); } catch { /* ignore */ }
      playerRef.current = null;

      const divId = `yt-${idx}`;
      mountRef.current.id = divId;
      mountRef.current.innerHTML = "";

      playerRef.current = new window.YT.Player(divId, {
        videoId,
        width:  "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        } as YT.PlayerVars,
        events: {
          onReady(e: YT.PlayerEvent) {
            if (cancelled) return;
            try {
              e.target.mute();
              e.target.playVideo();
            } catch { /* ignore */ }
            setStatus("live");
          },
          onError() {
            if (cancelled) return;
            setStatus("offline");
          },
          onStateChange(e: YT.OnStateChangeEvent) {
            if (cancelled) return;
            if (e.data === window.YT.PlayerState.PLAYING) {
              setStatus("live");
              setPlaying(true);
              if (!isActiveRef.current) {
                try { e.target.mute(); } catch { /* ignore */ }
              }
            }
            if (e.data === window.YT.PlayerState.PAUSED ||
                e.data === window.YT.PlayerState.BUFFERING) {
              setPlaying(false);
            }
            if (e.data === window.YT.PlayerState.ENDED) {
              setPlaying(false);
              e.target.playVideo();
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      try { playerRef.current?.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, idx, useChannelEmbed]);

  useEffect(() => {
    if (!playerRef.current || useChannelEmbed) return;
    if (!isActive) {
      try { playerRef.current.mute(); } catch { /* not ready */ }
    }
  }, [isActive, useChannelEmbed]);

  function toggleMax() { setMaximized(m => !m); }

  const isNews = !!subChannels;
  const activeSub = subChannels?.find(s => s.key === selectedSub);
  const displayLabel = isNews && activeSub ? activeSub.label + " News" : ch.label;
  const lines = displayLabel.split("\n");
  const isLive = status === "live";

  const ytLink = isNews && activeSub
    ? activeSub.ytUrl
    : videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : ch.ytUrl;

  // Channel embed URL (muted on load for autoplay; unmute after user selects audio)
  const channelEmbedSrc = channelId
    ? `https://www.youtube.com/embed/live_stream?channel=${channelId}&autoplay=1&mute=${embedMuted ? 1 : 0}&controls=1&rel=0`
    : "";

  return (
    <div className={`panel${isActive ? " on" : ""}${maximized ? " maximized" : ""}${isNews ? " news" : ""}${mode === "chart" ? " chart-mode" : ""}`}>
      <div style={{ position: "absolute", inset: 0, display: mode === "chart" ? "none" : undefined }}>
        {useChannelEmbed ? (
          <iframe
            src={channelEmbedSrc}
            style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
          />
        ) : (
          <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
        )}
      </div>

      {mode === "chart" && (
        <div style={{ position: "absolute", inset: 0 }}>
          <ChartWidget panelKey={ch.key} />
        </div>
      )}

      {playing && mode === "stream" && <div style={{ position: "absolute", inset: 0, zIndex: 1 }} />}

      {isNews && (
        <div className="news-badge-corner">
          <span className="news-badge-text">NEWS</span>
          <button
            className="news-menu-btn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
            title="Switch network"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <circle cx="12" cy="5"  r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
          {menuOpen && (
            <div className="news-dropdown">
              {subChannels!.map(s => (
                <button
                  key={s.key}
                  className={`news-dropdown-item${s.key === selectedSub ? " active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onSelectSub?.(s.key); setMenuOpen(false); }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "stream" && (status === "offline" || status === "loading") && (
        <div className="offscreen">
          <div className={`off-icon${status === "loading" ? " spinning" : ""}`}>
            {status === "loading" ? (
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 2 }}>
                <circle cx="12" cy="12" r="10" strokeOpacity=".25" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: "currentColor" }}>
                <path d="M21 3L3 21l1.41 1.41L6.69 20H21V6.69l1.41-1.42L21 3zm-3 15H8.69L18 8.69V18zM3 17l2-2v-4l-2 2v4zm0-6l4-4V5L3 9v2zm6-6l-2 2h6.31L11 7H9z" />
              </svg>
            )}
          </div>
          <span className="off-lbl">{status === "loading" ? "Connecting…" : "Offline"}</span>
          {status === "offline" && (
            <span className="off-msg">
              {ch.schedule ? `Live ${ch.schedule}` : "Stream unavailable right now"}
            </span>
          )}
          {status === "offline" && ytLink && (
            <a href={ytLink} target="_blank" rel="noopener noreferrer" className="yt-link">
              OPEN ON YOUTUBE
            </a>
          )}
        </div>
      )}

      <div className="ov">
        {mode === "stream" && (
          <span className="oname">
            {lines.map((l, i) => (
              <React.Fragment key={i}>{l}{i < lines.length - 1 && <br />}</React.Fragment>
            ))}
          </span>
        )}

        {mode === "stream" && isLive && <span className="live-badge">LIVE</span>}
        {mode === "chart" && <span className="live-badge" style={{ background: "#22c97a" }}>CHART</span>}

        <button
          className="btn"
          onClick={(e) => { e.stopPropagation(); onToggleMode(); }}
          title={mode === "chart" ? "Switch to stream" : "Switch to chart"}
        >
          {mode === "chart" ? (
            <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "currentColor", pointerEvents: "none" }}>
              <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "currentColor", pointerEvents: "none" }}>
              <path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/>
            </svg>
          )}
        </button>

        {mode === "stream" && (
          <button
            className={`btn${isActive ? " on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onSetAudio(idx);
              if (useChannelEmbed) setEmbedMuted(false);
              else try { playerRef.current?.unMute(); } catch { /* not ready */ }
            }}
            title={isActive ? "Audio on" : "Switch audio here"}
          >
            {isActive ? (
              <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "currentColor", pointerEvents: "none" }}>
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "currentColor", pointerEvents: "none" }}>
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
              </svg>
            )}
          </button>
        )}

        <button
          className={`btn${maximized ? " on" : ""}`}
          onClick={(e) => { e.stopPropagation(); toggleMax(); }}
          title={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? (
            <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "currentColor", pointerEvents: "none" }}>
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "currentColor", pointerEvents: "none" }}>
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

/* ─── App ─────────────────────────────────────────────────────────────────── */
export default function App() {
  const [active, setActive]     = useState(0);
  const [ids, setIds]           = useState<Record<string, string>>(FALLBACK_IDS);
  const [newsSub, setNewsSub]   = useState<NewsSub>("nbc");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tickers, setTickers] = useLocalStorage<SavedTicker[]>(
    "mktv:tickers",
    DEFAULT_TICKERS,
  );
  const [panelModes, setPanelModes] = useState<Record<string, PanelMode>>({
    schwab: "chart",
  });

  function togglePanelMode(key: string) {
    setPanelModes(prev => ({ ...prev, [key]: prev[key] === "chart" ? "stream" : "chart" }));
  }

  useEffect(() => {
    async function refresh() {
      try {
        const res = await fetch(apiUrl("/api/live-streams"));
        if (!res.ok) return;
        const data: { streams: { name: string; videoId: string }[] } = await res.json();
        setIds(prev => {
          const next = { ...prev };
          for (const s of data.streams) { if (s.videoId) next[s.name] = s.videoId; }
          return next;
        });
      } catch { /* keep fallback */ }
    }
    refresh();
    const iv = setInterval(refresh, 30 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const activeChannel = CHANNELS[active];
  const audioName = activeChannel.key === "news"
    ? (NEWS_SUBS.find(s => s.key === newsSub)?.label ?? "NEWS") + " NEWS"
    : activeChannel.name;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden" }}>
      <div id="bar">
        <div id="logo">MARKETV<span className="live-flash">.live</span></div>
        <div className="sp" />
        <div id="aud">AUDIO&nbsp;<b>{audioName}</b></div>
        <ClockET />
        <button
          onClick={() => setSettingsOpen(o => !o)}
          title="Ticker settings"
          style={{ background: "none", border: "none", cursor: "pointer", color: settingsOpen ? "#22c97a" : "var(--dim)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 700, letterSpacing: 0, display: "flex", alignItems: "center", padding: "0 4px 0 12px", flexShrink: 0, lineHeight: 1 }}
        >$</button>
      </div>

      <TickerTape tickers={tickers} />

      <div id="grid">
        {CHANNELS.map((ch, i) => {
          const isNewsSlot = ch.key === "news";
          const videoId    = isNewsSlot ? (ids[newsSub] ?? "") : (ids[ch.key] ?? "");
          const mode       = panelModes[ch.key] ?? "stream";
          const activeSub  = isNewsSlot ? NEWS_SUBS.find(s => s.key === newsSub) : undefined;
          return (
            <Panel
              key={ch.key}
              idx={i}
              ch={ch}
              videoId={videoId}
              channelId={isNewsSlot ? activeSub?.channelId : ("channelId" in ch ? ch.channelId : undefined)}
              isActive={i === active}
              onSetAudio={setActive}
              subChannels={isNewsSlot ? NEWS_SUBS : undefined}
              selectedSub={isNewsSlot ? newsSub : undefined}
              onSelectSub={isNewsSlot ? (k) => setNewsSub(k as NewsSub) : undefined}
              mode={mode}
              onToggleMode={() => togglePanelMode(ch.key)}
            />
          );
        })}
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tickers={tickers}
        setTickers={setTickers}
      />
    </div>
  );
}
