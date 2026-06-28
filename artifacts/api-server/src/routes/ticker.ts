import { Router } from "express";

const router = Router();

interface TickerItem {
  yahooSymbol: string;
  symbol: string;
  price: string;
  change: string;
  direction: "up" | "dn" | "fl";
}

interface SearchResult {
  symbol: string;
  display: string;
  name: string;
  type: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/* ─── Search ──────────────────────────────────────────────────────────────── */
router.get("/ticker/search", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const q = String(req.query.q ?? "").trim();
  if (!q) { res.json({ results: [] }); return; }

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!r.ok) throw new Error(`Search ${r.status}`);

    const json: unknown = await r.json();
    const quotes: any[] = (json as any)?.quotes ?? [];

    const results: SearchResult[] = quotes
      .filter((q: any) => q.quoteType && q.symbol)
      .map((q: any) => ({
        symbol: q.symbol,
        display: toDisplay(q.symbol),
        name: q.shortname || q.longname || q.symbol,
        type: q.typeDisp || q.quoteType || "",
      }));

    res.json({ results });
  } catch {
    res.status(503).json({ results: [] });
  }
});

/* ─── Quotes ──────────────────────────────────────────────────────────────── */
function toDisplay(sym: string): string {
  if (sym.endsWith("-USD")) return sym.replace("-USD", "");
  if (sym.startsWith("^"))  return sym.slice(1);
  if (sym.endsWith("=F"))   return sym.replace("=F", "");
  if (sym.includes(".NYB")) return "DXY";
  return sym;
}

function formatPrice(price: number, sym: string): string {
  const isYield = sym.startsWith("^TNX") || sym.startsWith("^IRX");
  if (isYield) return price.toFixed(2) + "%";
  if (price >= 10_000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1_000)  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return price.toFixed(2);
}

function formatChange(pct: number, abs: number, sym: string): string {
  const isYield = sym.startsWith("^TNX") || sym.startsWith("^IRX");
  if (isYield) return `${abs >= 0 ? "+" : ""}${abs.toFixed(3)}`;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

async function fetchOne(yahooSym: string): Promise<TickerItem | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=5d`;
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;

    const json: unknown = await r.json();
    const result  = (json as any)?.chart?.result?.[0];
    if (!result) return null;

    const price: number = result.meta.regularMarketPrice;
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

    if (!price || closes.length < 2) return null;

    const validCloses = closes.filter((c: number) => c != null);
    if (validCloses.length < 2) return null;

    const prevClose = validCloses[validCloses.length - 2];
    const abs = price - prevClose;
    const pct = (abs / prevClose) * 100;
    const direction: "up" | "dn" | "fl" = pct > 0.05 ? "up" : pct < -0.05 ? "dn" : "fl";

    return {
      yahooSymbol: yahooSym,
      symbol: toDisplay(yahooSym),
      price:  formatPrice(price, yahooSym),
      change: formatChange(pct, abs, yahooSym),
      direction,
    };
  } catch {
    return null;
  }
}

const symbolCache = new Map<string, { item: TickerItem; fetchedAt: number }>();
const CACHE_TTL = 15_000;

router.get("/ticker", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const raw = String(req.query.symbols ?? "").trim();
  const requested = raw
    ? raw.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  if (requested.length === 0) {
    res.json({ items: [] });
    return;
  }

  const now = Date.now();
  const needFetch = requested.filter(s => {
    const cached = symbolCache.get(s);
    return !cached || now - cached.fetchedAt >= CACHE_TTL;
  });

  if (needFetch.length > 0) {
    const fresh = await Promise.all(needFetch.map(fetchOne));
    fresh.forEach((item, i) => {
      if (item) symbolCache.set(needFetch[i], { item, fetchedAt: now });
    });
  }

  const items: TickerItem[] = requested
    .map(s => symbolCache.get(s)?.item)
    .filter((item): item is TickerItem => item != null);

  res.json({ items });
});

export default router;
