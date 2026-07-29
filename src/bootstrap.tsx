import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AuthProvider } from '@/contexts/AuthContext'
import { HelmetProvider } from 'react-helmet-async'
import { GlobalErrorBoundary } from '@/components/ui/custom/GlobalErrorBoundary'
import { NotificationProvider } from '@/contexts/NotificationContext'

/**
 * Árvore React da aplicação.
 *
 * Este módulo é carregado dinamicamente por `main.tsx`, e só depois que a
 * auditoria de ambiente passa. O motivo: os imports acima puxam `@/lib/supabase`
 * pela cadeia dos contextos, e esse módulo lança erro quando faltam as
 * variáveis do Supabase. Como imports estáticos são avaliados antes do corpo do
 * módulo, mantê-los em `main.tsx` faria o erro estourar antes da auditoria
 * rodar — deixando a tela branca com o spinner do index.html girando sem fim.
 */
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
