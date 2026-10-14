import { AdminErrorState } from "@/components/admin/AdminErrorState";
import { Button } from "@/components/ui/button";
import { tentarDeNovoAbaQueNaoBaixou } from "@/lib/recarga-de-aba-que-falhou";
import { ehErroDeChunk } from "@/lib/recuperacao-chunk";
import { RefreshCcw, WifiOff } from "lucide-react";
import { Component, createRef } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
  /** Chunk: o que a última tentativa provou — a frase só fala de conexão
   * quando a rede de fato está ruim. */
  chunkAviso: "nenhum" | "sem-rede" | "esgotado" | "pagina-ficou";
  verificando: boolean;
}

export class LocalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    showDetails: false,
    chunkAviso: "nenhum",
    verificando: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      showDetails: false,
      chunkAviso: "nenhum",
      verificando: false,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      "[LocalErrorBoundary] Intercepted render error:",
      error,
      errorInfo,
    );
  }

  /** Tela que não baixou: o navegador memoriza a falha do import, então
   * "tentar de novo" é RECARREGAR (com rede provada e guarda de laço) — ver
   * `recarga-de-aba-que-falhou`. Rede ruim: não recarrega, só avisa. */
  private readonly handleTentarDeNovoChunk = async () => {
    if (this.state.verificando) return;
    this.setState({ verificando: true });
    const resultado = await tentarDeNovoAbaQueNaoBaixou();
    // "pagina-ficou": a página continua viva depois do prazo (aviso do
    // navegador recusado, ou recarga lenta) — o botão volta, e a frase passa
    // a dizer "ainda carregando" porque uma recarga pode estar a caminho
    // (a guarda não muda). A recarga que acontece de fato nunca chega aqui.
    this.setState({ verificando: false, chunkAviso: resultado });
  };

  /** O aviso de chunk, para levar o foco quando o botão some ("esgotado"):
   * sem isso o foco do teclado/leitor de tela cairia no vazio. */
  private readonly avisoRef = createRef<HTMLDivElement>();

  public componentDidUpdate(_props: Props, anterior: State) {
    if (
      this.state.chunkAviso === "esgotado" &&
      anterior.chunkAviso !== "esgotado"
    ) {
      this.avisoRef.current?.focus();
    }
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      showDetails: false,
      chunkAviso: "nenhum",
      verificando: false,
    });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      if (ehErroDeChunk(this.state.error?.message)) {
        // Tela que não baixou: frase de cliente, não de painel. Só fala de
        // conexão quando a rede está de fato ruim; sem recargas sobrando,
        // pede para fechar e abrir o app (sem prometer rede).
        const { chunkAviso, verificando } = this.state;
        const semRede =
          chunkAviso === "sem-rede" ||
          (typeof navigator !== "undefined" && navigator.onLine === false);
        const esgotado = chunkAviso === "esgotado";
        // Cores só por tokens do tema: a loja pode estar em tema claro
        // (cores fixas de tema escuro davam contraste ~1,5:1 sobre branco).
        return (
          <div
            ref={this.avisoRef}
            tabIndex={-1}
            role="alert"
            className="flex w-full flex-col items-center justify-center gap-4 p-6 text-center outline-none"
          >
            <WifiOff
              className="size-8 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <p className="max-w-xs text-sm leading-relaxed text-foreground">
              Não conseguimos carregar esta tela.{" "}
              {esgotado
                ? "Feche e abra o app de novo (ou recarregue a página)."
                : semRede
                  ? "Verifique sua conexão."
                  : chunkAviso === "pagina-ficou"
                    ? "Ainda carregando… se nada mudar, use o botão de novo."
                    : "Use o botão Tentar de novo."}
            </p>
            {!esgotado && (
              <Button
                variant="outline"
                onClick={this.handleTentarDeNovoChunk}
                disabled={verificando}
                className="h-12 rounded-full px-8 font-bold tracking-wide"
              >
                <RefreshCcw
                  className={`mr-2 size-4 ${verificando ? "animate-spin" : ""}`}
                />
                Tentar de novo
              </Button>
            )}
          </div>
        );
      }

      return (
        <div className="flex w-full flex-col items-center justify-center space-y-4 duration-300 animate-in fade-in">
          <AdminErrorState
            title="Falha Operacional"
            message="Ocorreu um erro ao carregar este bloco de controle."
            onRetry={this.handleReset}
          />

          {this.state.error && (
            <div className="w-full max-w-md space-y-2 text-center">
              <button
                type="button"
                onClick={this.toggleDetails}
                className="text-[9px] font-black uppercase tracking-wider text-zinc-500 transition-colors hover:text-white"
              >
                {this.state.showDetails
                  ? "Ocultar Detalhes"
                  : "Visualizar Detalhes Técnicos"}
              </button>

              {this.state.showDetails && (
                <pre className="custom-scrollbar max-h-36 overflow-x-auto rounded-xl border border-white/5 bg-black/60 p-3 text-left font-mono text-[9px] text-red-400/90 duration-200 animate-in fade-in zoom-in-95">
                  {this.state.error.stack || this.state.error.message}
                </pre>
              )}
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
