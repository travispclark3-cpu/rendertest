/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Render API URL, set in Vercel env vars at build time. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
