import { Button } from "@/components/ui/button";
import { gravaMotivoDeRecarga } from "@/lib/motivo-de-recarga";
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";
import { AlertTriangle, RefreshCcw, WifiOff } from "lucide-react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** Laudo #2 (P-3): chunk error com a máquina SEM internet — rede caída,
   * não versão nova. Mostra tela honesta de offline em vez de recarregar em
   * loop sob a mentira "Instalando uma nova versão". */
  chunkSemInternet: boolean;
}

function isChunkLoadError(error: Error | null | undefined): boolean {
  if (!error?.message) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("loading chunk") ||
    msg.includes("chunkloaderror") ||
    msg.includes("importing a module script failed") ||
    msg.includes("css chunk load failed") ||
    msg.includes("unexpected token '<'")
  );
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    chunkSemInternet: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught fatal error:", error, errorInfo);

    // Automatic chunk reloading logic for Vite dynamic imports
    const isChunkError = isChunkLoadError(error);

    if (isChunkError) {
      // Laudo #2 (P-3): sem internet, o chunk falhou porque a rede caiu — o
      // service worker está servindo do cache e NENHUM reload conserta isso.
      // Recarregar aqui só engata o loop de recargas e, na segunda falha,
      // exibiria a tela "Atualizando o Aplicativo" eterna (e mentirosa).
      // Pílula irmã do useUpdateCheck (:352-363), que já checava onLine.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        console.warn(
          "[GlobalErrorBoundary] Chunk error SEM internet: tela honesta de offline, cache preservado.",
        );
        this.setState({ chunkSemInternet: true });
        return;
      }

      console.warn(
        "[GlobalErrorBoundary] Dynamic chunk import error caught. Attempting silent reload for update recovery...",
      );
      try {
        const lastReload = Number(
          sessionStorage.getItem("pwa_chunk_reload_time") || "0",
        );
        const now = Date.now();
        if (now - lastReload > 10000) {
          sessionStorage.setItem("pwa_chunk_reload_time", String(now));
          // Laudo #2 (P-1): motivo NOMINAL — recuperação de erro de módulo
          // não é atualização; o boot não anuncia "Sistema Atualizado".
          gravaMotivoDeRecarga("recuperacao-erro-modulo");
          window.location.reload();
          return;
        }
      } catch (e) {
        console.error("Failed to execute chunk error auto-reload", e);
      }
    }

    // Log to PWA forensics if available
    try {
      const logs = JSON.parse(localStorage.getItem("pwa_forensics") || "[]");
      const newLog = {
        t: new Date().toISOString(),
        m: "FATAL_APP_CRASH",
        d: {
          error: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
        },
      };
      localStorage.setItem(
        "pwa_forensics",
        JSON.stringify([newLog, ...logs].slice(0, 10)),
      );
      // Laudo #2 (P-1): motivo nominal de crash (o texto cru do erro não vai
      // mais para a tela do cliente como descrição de "Sistema Atualizado").
      gravaMotivoDeRecarga("recuperacao-crash");
    } catch (e) {
      console.error("Failed to write forensic log", e);
    }
  }

  private readonly handleReset = () => {
    // Purga SELETIVA: `localStorage.clear()` puro apagava a sessão do
    // Supabase (chaves `sb-`) e o carrinho (`marketplace_cart_v1`) junto com
    // o estado corrompido — a pessoa tocava no único botão da tela de erro e
    // saía sem sessão e sem o que tinha montado no carrinho. Preserva o que
    // está na lista branca; limpa o resto.
    try {
      for (const key of Object.keys(localStorage)) {
        if (!chaveSobreviveAPurga(key)) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.error(
        "[GlobalErrorBoundary] Falha ao limpar localStorage seletivamente",
        e,
      );
    }
    sessionStorage.clear();
    window.location.reload();
  };

  private readonly handleTentarNovamente = () => {
    // Saída da tela de offline: o lojista decide quando tentar de novo.
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      const isChunkError = isChunkLoadError(this.state.error);

      if (isChunkError && this.state.chunkSemInternet) {
        // Laudo #2 (P-3): honesto — sem sinal não há "nova versão" nenhuma
        // sendo instalada; o que há é a internet caída.
        return (
          <div className="flex size-full flex-col items-center justify-center bg-[#09090b] p-6 text-center antialiased">
            <div className="inset-0 mb-6 flex size-16 items-center justify-center rounded-full bg-amber-500/10">
              <WifiOff className="size-8 text-amber-400" />
            </div>
            <h1 className="mb-2 text-xl font-black tracking-tight text-white">
              Você está sem internet
            </h1>
            <p className="mb-8 max-w-xs text-xs leading-relaxed text-zinc-400">
              A loja não conseguiu carregar uma parte dela porque a conexão
              caiu. Quando a internet voltar, toque em "Tentar novamente".
            </p>
            <Button
              onClick={this.handleTentarNovamente}
              className="h-12 rounded-full bg-white px-8 font-bold tracking-wide text-black hover:bg-zinc-200"
            >
              <RefreshCcw className="mr-2 size-4" />
              Tentar novamente
            </Button>
          </div>
        );
      }

      if (isChunkError) {
        return (
          <div className="flex size-full flex-col items-center justify-center bg-[#09090b] p-6 text-center antialiased">
            <div className="size-10 animate-spin rounded-full border-3 border-white/10 border-t-admin-gold" />
            <h1 className="mt-6 text-sm font-black uppercase tracking-[0.2em] text-white">
              Atualizando o Aplicativo
            </h1>
            <p className="mt-2 max-w-xs text-xs leading-relaxed text-zinc-400">
              Instalando uma nova versão do marketplace. Isso levará apenas um
              instante...
            </p>
          </div>
        );
      }

      return (
        <div className="flex size-full flex-col items-center justify-center bg-zinc-950 p-6 text-center antialiased">
          <div className="inset-0 mb-6 flex size-16 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle className="size-8 text-red-500" />
          </div>

          <h1 className="mb-2 text-2xl font-black tracking-tight text-white">
            Erro Fatal Detectado
          </h1>

          <p className="mb-8 max-w-sm text-sm leading-relaxed text-zinc-400">
            A aplicação encontrou um estado inválido instável na renderização.
            Nossa equipe técnica já foi alertada silenciosamente desta falha de
            estabilidade.
          </p>

          <Button
            onClick={this.handleReset}
            className="h-12 rounded-full bg-white px-8 font-bold tracking-wide text-black hover:bg-zinc-200"
          >
            <RefreshCcw className="mr-2 size-4" />
            Reiniciar Sessão (Recovery)
          </Button>

          {import.meta.env.DEV && this.state.error && (
            <div className="mt-12 max-h-64 w-full max-w-2xl overflow-auto rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-left">
              <p className="whitespace-pre-wrap font-mono text-xs text-red-400">
                {this.state.error.stack}
              </p>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
