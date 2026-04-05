import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/contexts/AuthContext'
import { HelmetProvider } from 'react-helmet-async'
import { GlobalErrorBoundary } from '@/components/ui/custom/GlobalErrorBoundary'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { initSentinel } from '@/pwa-sentinel'

// Initialize external PWA health monitor
initSentinel();

// PWA health monitor initialized above

// Environment Audit (Alpha Zero)
const rootElement = document.getElementById('root');
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

if (!SUPABASE_URL || SUPABASE_URL.includes('undefined')) {
  if (rootElement) {
    const root = createRoot(rootElement);
    root.render(
      <div className="flex flex-col items-center justify-center h-svh bg-red-600 text-white p-10 font-sans text-center">
        <h1 className="text-4xl font-black mb-5">🚨 ERRO DE AMBIENTE</h1>
        <p className="text-lg max-w-sm leading-relaxed">
          As chaves do banco de dados (Supabase) não foram detectadas no seu dispositivo.<br /><br />
          Isso acontece quando o PWA está servindo uma versão zumbi ou o build falhou silenciosamente.
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
  throw new Error('[AlphaZero] Missing Supabase Configuration');
}

// Initial removal attempt, App.tsx will call this again once data is ready
// No longer needed here as App.tsx handles synchronization

// Fade out loader once React is ready to take over
// This is now exposed to be called by App.tsx for total synchronization
(globalThis as any).removeSilentGuardianLoader = () => {
  const loader = document.getElementById('silent-guardian-loader');
  if (loader) {
    loader.style.opacity = '0';
    setTimeout(() => loader.remove(), 500);
  }
};

createRoot(document.getElementById('root')!).render(
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
)
