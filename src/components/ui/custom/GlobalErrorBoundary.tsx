import { Button } from "@/components/ui/button";
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";
import { gravaMotivoDeRecarga } from "@/lib/motivo-de-recarga";
import {
  ehErroDeChunk,
  executarRecuperacaoChunk,
  reportarErroChunk,
} from "@/lib/recuperacao-chunk";
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
  /** Prazo da tela "Atualizando o Aplicativo" vencido: revela a saída manual
   * (botão) para quem a recarga automática não salvou. */
  saidaChunkLiberada: boolean;
}

/** Quanto tempo a tela de espera do chunk pode ficar só com a rodinha antes
 * de oferecer uma saída manual. Espera curta é honesta; espera sem fim é
 * trava — a pessoa só saía fechando o app na marra. */
const PRAZO_SAIDA_CHUNK_MS = 4000;

// Issue #92: a guarda e a decisão de chunk NÃO moram mais aqui. O boundary
// é a PORTA DE UI e o primeiro capturador; a decisão (check-and-set na
// chave única, escada ciclo-do-SW → purge seletivo) vive em
// @/lib/recuperacao-chunk, consumida também pelos canais 'error' e
// 'unhandledrejection' do main.tsx e pelo sentinela.

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    chunkSemInternet: false,
    saidaChunkLiberada: false,
  };

  private temporizadorSaidaChunk: ReturnType<typeof setTimeout> | null = null;

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught fatal error:", error, errorInfo);

    // Issue #92: UM mecanismo, UMA chave. A decisão é SÍNCRONA
    // (check-and-set) — entre este boundary e os canais do main.tsx
    // ('error'/'unhandledrejection'), quem chega primeiro é o dono; quem
    // chega segundo só acompanha a UI.
    if (ehErroDeChunk(error.message)) {
      // Laudo #2 (P-3): sem internet, o chunk falhou porque a rede caiu — o
      // service worker está servindo do cache e NENHUM reload conserta isso.
      // Recarregar aqui só engata o loop de recargas e, na segunda falha,
      // exibiria a tela "Atualizando o Aplicativo" eterna (e mentirosa).
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        console.warn(
          "[GlobalErrorBoundary] Chunk error SEM internet: tela honesta de offline, cache preservado.",
        );
        this.setState({ chunkSemInternet: true });
        return;
      }

      const decisao = reportarErroChunk();
      // Dono: executa a escada (ciclo do SW → purge seletivo com rede
      // verificada). A execução é async, mas o dono NÃO cai no laudo de
      // crash abaixo — o motivo nominal correto é gravado por quem navega.
      if (decisao.dono) {
        void executarRecuperacaoChunk(decisao).then((resultado) => {
          // Purge nomeado, mas a sonda recusou a rede (portal cativo, DNS
          // mentindo): NADA foi apagado — a tela honesta de offline vale
          // aqui também, não só quando o onLine já estava falso.
          if (resultado === "sem-rede-verificada") {
            this.setState({ chunkSemInternet: true });
          }
        });
        this.armaPrazoDeSaidaChunk();
        return;
      }

      // Espectador: outra porta já engajou a recuperação. Sem prazo, o
      // render() ficaria na rodinha "Atualizando o Aplicativo" para sempre.
      this.armaPrazoDeSaidaChunk();
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

  public componentWillUnmount() {
    if (this.temporizadorSaidaChunk !== null) {
      clearTimeout(this.temporizadorSaidaChunk);
      this.temporizadorSaidaChunk = null;
    }
  }

  /** Só existe na tela de chunk com internet: passado o prazo, a espera vira
   * escolha (o botão aparece). Nunca é armado no caminho feliz. */
  private readonly armaPrazoDeSaidaChunk = () => {
    if (this.temporizadorSaidaChunk !== null) return;
    this.temporizadorSaidaChunk = setTimeout(() => {
      this.temporizadorSaidaChunk = null;
      this.setState({ saidaChunkLiberada: true });
    }, PRAZO_SAIDA_CHUNK_MS);
  };

  private readonly handleRecarregarPagina = () => {
    // Saída manual da espera: SÓ recarrega. Nada de handleReset nem de purga
    // — carrinho e sessão do cliente não podem morrer por um chunk que não
    // baixou.
    // Motivo nominal: a causa é o módulo que não carregou, e não o crash
    // genérico que o log forense gravou no caminho de fall-through.
    gravaMotivoDeRecarga("recuperacao-erro-modulo");
    window.location.reload();
  };

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
      const isChunkError = ehErroDeChunk(this.state.error?.message);

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
            {/* Região viva sempre montada: o leitor de tela precisa dela no ar
                ANTES de o conteúdo aparecer para conseguir anunciá-lo. */}
            <div
              aria-live="polite"
              className="flex flex-col items-center justify-center"
            >
              {this.state.saidaChunkLiberada && (
                <>
                  <p className="mt-6 max-w-xs text-xs leading-relaxed text-zinc-400">
                    A atualização está demorando mais do que o normal. Você pode
                    recarregar a página — seu carrinho e seu login continuam
                    salvos.
                  </p>
                  <Button
                    onClick={this.handleRecarregarPagina}
                    className="mt-6 h-12 rounded-full bg-white px-8 font-bold tracking-wide text-black hover:bg-zinc-200"
                  >
                    <RefreshCcw className="mr-2 size-4" />
                    Recarregar a página
                  </Button>
                </>
              )}
            </div>
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
