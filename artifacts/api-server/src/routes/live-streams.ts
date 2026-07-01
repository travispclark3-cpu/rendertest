import { Router } from "express";

const router = Router();

interface ChannelConfig {
  name: string;
  channelUrl: string;
  fallbackVideoId: string;
  alwaysOn: boolean;
}

const CHANNELS: ChannelConfig[] = [
  {
    name: "bloomberg",
    channelUrl: "https://www.youtube.com/channel/UCIALMKvObZNtJ6AmdCLP7Lg/live",
    fallbackVideoId: "QB5BNdBFujE",
    alwaysOn: true,
  },
  {
    name: "yahoo",
    channelUrl: "https://www.youtube.com/@YahooFinance/live",
    fallbackVideoId: "",
    alwaysOn: false,
  },
  {
    name: "nbc",
    channelUrl: "https://www.youtube.com/@NBCNews/live",
    fallbackVideoId: "",
    alwaysOn: true,
  },
  {
    name: "cbs",
    channelUrl: "https://www.youtube.com/@CBSNews/live",
    fallbackVideoId: "",
    alwaysOn: true,
  },
  {
    name: "abc",
    channelUrl: "https://www.youtube.com/@ABCNews/live",
    fallbackVideoId: "",
    alwaysOn: true,
  },
  {
    name: "fox",
    channelUrl: "https://www.youtube.com/@LiveNOWfox/live",
    fallbackVideoId: "",
    alwaysOn: true,
  },
];

const VIDEO_ID_RE = /"videoId":"([A-Za-z0-9_-]{11})"/g;
const YT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchLiveVideoId(channelUrl: string): Promise<string | null> {
  try {
    const res = await fetch(channelUrl, {
      headers: {
        "User-Agent": YT_UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const html = await res.text();

    const counts: Record<string, number> = {};
    let m: RegExpExecArray | null;
    VIDEO_ID_RE.lastIndex = 0;
    while ((m = VIDEO_ID_RE.exec(html)) !== null) {
      counts[m[1]] = (counts[m[1]] ?? 0) + 1;
    }

    if (Object.keys(counts).length === 0) return null;

    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best[0];
  } catch {
    return null;
  }
}

interface CacheEntry {
  videoId: string;
  fetchedAt: number;
}

const cache: Record<string, CacheEntry> = {};
const CACHE_TTL_MS = 30 * 60 * 1000;

async function getLiveVideoId(ch: ChannelConfig): Promise<string> {
  const now = Date.now();
  const cached = cache[ch.name];
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.videoId;
  }
  const id = await fetchLiveVideoId(ch.channelUrl);
  const videoId = id ?? ch.fallbackVideoId;
  cache[ch.name] = { videoId, fetchedAt: now };
  return videoId;
}

router.get("/live-streams", async (_req, res) => {
  const results = await Promise.all(
    CHANNELS.map(async (ch) => {
      const videoId = await getLiveVideoId(ch);
      return { name: ch.name, videoId, alwaysOn: ch.alwaysOn };
    })
  );
  res.json({ streams: results });
});

export default router;
