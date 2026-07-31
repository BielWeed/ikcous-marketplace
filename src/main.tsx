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
import { initHeaderToastInterceptor } from "@/utils/headerToast";
import App from "./App.tsx";

// Apply client visual branding
applyBranding();

// Initialize external PWA health monitor
initSentinel();

// Initialize Dynamic Header Toast Interceptor
initHeaderToastInterceptor();

// PWA health monitor initialized above

// A auditoria de ambiente vive em `@/lib/env`, que roda antes daqui por ser dependência
// de `@/lib/supabase`. Escrever a validação neste ponto não funcionava: imports ES são
// hoisted, então o módulo do Supabase já tinha explodido antes desta linha ser alcançada.

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
          <App />
        </NotificationProvider>
      </AuthProvider>
    </GlobalErrorBoundary>
  </StrictMode>,
);
