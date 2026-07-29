import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Suppress Recharts "should be greater than 0" console warning which happens during initial layout calculations
const originalWarn = console.warn;
console.warn = (...args) => {
  if (
    typeof args[0] === "string" &&
    (args[0].includes("should be greater than 0") ||
      (args[0].includes("width") &&
        args[0].includes("height") &&
        args[0].includes("chart")))
  ) {
    return;
  }
  originalWarn(...args);
};

// Headless sandbox safety: prevent Chromium Service Worker native crashes
if (
  typeof navigator !== "undefined" &&
  (navigator.userAgent.toLowerCase().includes("headless") ||
    navigator.userAgent.toLowerCase().includes("playwright") ||
    globalThis.location?.search?.includes("disable_sw"))
) {
  try {
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    console.log(
      "[Sandbox] Headless environment detected. Service Worker registration bypassed.",
    );
  } catch {
    // Fallback if read-only
  }
}

import "./index.css";
import { GlobalErrorBoundary } from "@/components/ui/custom/GlobalErrorBoundary";
import { applyBranding } from "@/config/branding";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { initSentinel } from "@/pwa-sentinel";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";

// Apply client visual branding
applyBranding();

// Initialize external PWA health monitor
initSentinel();

// PWA health monitor initialized above

// Environment Audit (Alpha Zero)
const rootElement = document.getElementById("root");
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

if (!SUPABASE_URL || SUPABASE_URL.includes("undefined")) {
  if (rootElement) {
    const root = createRoot(rootElement);
    root.render(
      <div className="flex h-svh flex-col items-center justify-center bg-red-600 p-10 text-center font-sans text-white">
        <h1 className="mb-5 text-4xl font-black">🚨 ERRO DE AMBIENTE</h1>
        <p className="max-w-sm text-lg leading-relaxed">
          As chaves do banco de dados (Supabase) não foram detectadas no seu
          dispositivo.
          <br />
          <br />
          Isso acontece quando o PWA está servindo uma versão zumbi ou o build
          falhou silenciosamente.
        </p>
        <button
          onClick={() => {
            localStorage.clear();
            sessionStorage.clear();
            globalThis.location.reload();
          }}
          className="mt-8 cursor-pointer rounded-xl border-none bg-white px-8 py-4 font-bold text-red-600 transition-transform active:scale-95"
        >
          LIMPAR E TENTAR DE NOVO
        </button>
      </div>,
    );
  }
  throw new Error("[AlphaZero] Missing Supabase Configuration");
}

// Initial removal attempt, App.tsx will call this again once data is ready
// No longer needed here as App.tsx handles synchronization

// Fade out loader once React is ready to take over
// This is now exposed to be called by App.tsx for total synchronization
(globalThis as any).removeSilentGuardianLoader = () => {
  const loader = document.getElementById("silent-guardian-loader");
  const fill = document.getElementById("guardian-progress-fill");
  const pct = document.getElementById("guardian-progress-pct");

  if (loader) {
    // Clear any active artificial interval
    if ((globalThis as any).guardianProgressInterval) {
      clearInterval((globalThis as any).guardianProgressInterval);
    }

    // Complete the progress bar to 100%
    if (fill) fill.style.width = "100%";
    if (pct) pct.textContent = "100%";

    // Fade out after a short delay to let the user see the completed bar (250ms)
    setTimeout(() => {
      loader.style.opacity = "0";
      setTimeout(() => loader.remove(), 500);
    }, 250);
  }
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <AuthProvider>
        <NotificationProvider>
          <HelmetProvider>
            <App />
          </HelmetProvider>
        </NotificationProvider>
      </AuthProvider>
    </GlobalErrorBoundary>
  </StrictMode>,
);
