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
import { applyBranding } from "@/config/branding";
import { initSentinel } from "@/pwa-sentinel";
import { initHeaderToastInterceptor } from "@/utils/headerToast";

// Apply client visual branding
applyBranding();

// Initialize external PWA health monitor
initSentinel();

// Initialize Dynamic Header Toast Interceptor
initHeaderToastInterceptor();

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

// Environment Audit (Alpha Zero)
//
// Nenhum import estático deste arquivo pode alcançar `@/lib/supabase`: aquele
// módulo lança erro quando as variáveis faltam, e imports são avaliados antes
// do corpo deste arquivo. A árvore React vive em `./bootstrap` e só é importada
// depois que a auditoria passa.
const rootElement = document.getElementById("root");
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const missing = [
  (!SUPABASE_URL || SUPABASE_URL.includes("undefined")) && "VITE_SUPABASE_URL",
  (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("undefined")) &&
    "VITE_SUPABASE_ANON_KEY",
].filter(Boolean) as string[];

if (missing.length > 0) {
  // O splash do Silent Guardian cobre a tela toda (inset 0, z-index 10000) e só
  // some quando o App.tsx sinaliza que carregou — o que nunca acontece aqui.
  // Sem isso, o erro fica escondido atrás de um splash parado.
  (globalThis as any).removeSilentGuardianLoader();

  if (rootElement) {
    const root = createRoot(rootElement);
    root.render(
      <div className="flex h-svh flex-col items-center justify-center bg-red-600 p-10 text-center font-sans text-white">
        <h1 className="mb-5 text-4xl font-black">🚨 ERRO DE AMBIENTE</h1>
        <p className="max-w-sm text-lg leading-relaxed">
          As chaves do banco de dados (Supabase) não foram detectadas neste
          build.
        </p>
        <ul className="mt-6 mb-2 list-none p-0 font-mono text-sm">
          {missing.map((name) => (
            <li key={name} className="mb-1">
              ❌ {name}
            </li>
          ))}
        </ul>
        <p className="max-w-sm text-sm leading-relaxed opacity-90">
          Defina {missing.length > 1 ? "essas variáveis" : "essa variável"} no
          ambiente de deploy e publique de novo — o Vite embute os valores no
          build, então alterá-las exige um novo deploy.
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
  console.error(
    `[AlphaZero] Missing Supabase configuration: ${missing.join(", ")}`,
  );
} else {
  void import("./bootstrap");
}
