/** Base URL for the API server (e.g. https://your-app.onrender.com). Leave empty for same-origin /api. */
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

/** Build a full API path. Works in dev (Vite proxy), on Vercel + Render (VITE_API_URL), or Replit (same host). */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}
