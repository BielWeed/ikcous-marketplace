import { createRoot } from 'react-dom/client'

// Suppress Recharts "should be greater than 0" console warning which happens during initial layout calculations
const originalWarn = console.warn;
console.warn = (...args) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('should be greater than 0') || (args[0].includes('width') && args[0].includes('height') && args[0].includes('chart')))
  ) {
    return;
  }
  originalWarn(...args);
};

// Headless sandbox safety: prevent Chromium Service Worker native crashes
if (
  typeof navigator !== 'undefined' && (
    navigator.userAgent.toLowerCase().includes('headless') ||
    navigator.userAgent.toLowerCase().includes('playwright') ||
    globalThis.location?.search?.includes('disable_sw')
  )
) {
  try {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
      writable: true
    });
    console.log('[Sandbox] Headless environment detected. Service Worker registration bypassed.');
  } catch {
    // Fallback if read-only
  }
}

import './index.css'
import { initSentinel } from '@/pwa-sentinel'

// Initialize external PWA health monitor
initSentinel();

// Fade out loader once React is ready to take over
// This is now exposed to be called by App.tsx for total synchronization
(globalThis as any).removeSilentGuardianLoader = () => {
  const loader = document.getElementById('silent-guardian-loader');
  if (loader) {
    loader.style.opacity = '0';
    setTimeout(() => loader.remove(), 500);
  }
};

// Environment Audit (Alpha Zero)
//
// Nenhum import estático deste arquivo pode alcançar `@/lib/supabase`: aquele
// módulo lança erro quando as variáveis faltam, e imports são avaliados antes
// do corpo deste arquivo. A árvore React vive em `./bootstrap` e só é importada
// depois que a auditoria passa.
const rootElement = document.getElementById('root');
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const missing = [
  (!SUPABASE_URL || SUPABASE_URL.includes('undefined')) && 'VITE_SUPABASE_URL',
  (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('undefined')) && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean) as string[];

if (missing.length > 0) {
  if (rootElement) {
    const root = createRoot(rootElement);
    root.render(
      <div className="flex flex-col items-center justify-center h-svh bg-red-600 text-white p-10 font-sans text-center">
        <h1 className="text-4xl font-black mb-5">🚨 ERRO DE AMBIENTE</h1>
        <p className="text-lg max-w-sm leading-relaxed">
          As chaves do banco de dados (Supabase) não foram detectadas neste build.
        </p>
        <ul className="mt-6 mb-2 list-none p-0 font-mono text-sm">
          {missing.map(name => (
            <li key={name} className="mb-1">❌ {name}</li>
          ))}
        </ul>
        <p className="text-sm max-w-sm leading-relaxed opacity-90">
          Defina {missing.length > 1 ? 'essas variáveis' : 'essa variável'} no
          ambiente de deploy e publique de novo — o Vite embute os valores no
          build, então alterá-las exige um novo deploy.
        </p>
        <button
          onClick={() => { localStorage.clear(); sessionStorage.clear(); globalThis.location.reload(); }}
          className="mt-8 px-8 py-4 bg-white text-red-600 border-none rounded-xl font-bold cursor-pointer transition-transform active:scale-95"
        >
          LIMPAR E TENTAR DE NOVO
        </button>
      </div>
    );
  }
  console.error(`[AlphaZero] Missing Supabase configuration: ${missing.join(', ')}`);
} else {
  void import('./bootstrap');
}
