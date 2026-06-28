import { Router } from "express";

const router = Router();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

router.get("/chart/:symbol", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const symbol = req.params.symbol;
  const interval = String(req.query.interval ?? "1m");
  const range    = String(req.query.range    ?? "1d");

  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Yahoo ${r.status}`);

    const json: any = await r.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("No result");

    const timestamps: number[]  = result.timestamp ?? [];
    const quote                  = result.indicators?.quote?.[0] ?? {};
    const meta                   = result.meta ?? {};

    const bars = timestamps
      .map((t, i) => ({
        time:   t,
        open:   quote.open?.[i]   as number | null,
        high:   quote.high?.[i]   as number | null,
        low:    quote.low?.[i]    as number | null,
        close:  quote.close?.[i]  as number | null,
        volume: quote.volume?.[i] as number | null,
      }))
      .filter(b => b.close !== null && b.close !== undefined);

    const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? bars[0]?.close ?? 0;
    const price:     number = meta.regularMarketPrice ?? bars[bars.length - 1]?.close ?? 0;
    const change    = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    res.json({ symbol: meta.symbol ?? symbol, name: meta.shortName ?? symbol, bars, price, change, changePct });
  } catch {
    res.status(503).json({ error: "Failed to fetch chart data" });
  }
});

export default router;
