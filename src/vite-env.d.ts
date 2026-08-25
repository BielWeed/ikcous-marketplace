/// <reference types="vite/client" />

// Identidade por build (ver src/config/branding.ts): env de build vence,
// branding.json é o fallback. Opcionais de propósito — no dev sem .env.local
// elas são undefined e o JSON segue como fonte.
interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_BRAND_PRIMARY?: string;
  readonly VITE_BRAND_SECONDARY?: string;
  readonly VITE_BRAND_ACCENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
