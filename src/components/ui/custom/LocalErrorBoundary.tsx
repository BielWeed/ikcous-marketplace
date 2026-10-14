import { AdminErrorState } from "@/components/admin/AdminErrorState";
import { Button } from "@/components/ui/button";
import {
  ehErroDeChunk,
  recuperarSeAVersaoForOMotivo,
} from "@/lib/recuperacao-chunk";
import { reiniciarCargasQueFalharam } from "@/utils/lazyWithPreload";
import { RefreshCcw, WifiOff } from "lucide-react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/** Quanto tempo depois do "Tentar de novo" uma falha de chunk ainda conta
 * como "a tentativa falhou" (3G lento demora a desistir). */
const JANELA_DO_TENTAR_DE_NOVO_MS = 60000;

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

export class LocalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, showDetails: false };
  }

  /** Quando a cliente tocou em "Tentar de novo" (0 = não tocou). Um chunk que
   * falha DENTRO da janela é "falhou de novo"; fora dela é outra falha. */
  private tentouDeNovoEm = 0;

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      "[LocalErrorBoundary] Intercepted render error:",
      error,
      errorInfo,
    );
    // Segunda falha seguida: se a rede está provada e o arquivo não vem, é
    // versão nova — entra na escada de sempre. Rede ruim não gasta orçamento.
    if (
      ehErroDeChunk(error.message) &&
      this.tentouDeNovoEm > 0 &&
      Date.now() - this.tentouDeNovoEm < JANELA_DO_TENTAR_DE_NOVO_MS
    ) {
      this.tentouDeNovoEm = 0;
      void recuperarSeAVersaoForOMotivo();
    }
  }

  private handleReset = () => {
    if (ehErroDeChunk(this.state.error?.message)) {
      // Sem isto o React.lazy entrega a MESMA rejeição para sempre.
      reiniciarCargasQueFalharam();
      this.tentouDeNovoEm = Date.now();
    }
    this.setState({ hasError: false, error: null, showDetails: false });
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
        // Tela que não baixou (rede fraca): frase de cliente, não de painel.
        return (
          <div
            role="alert"
            className="flex w-full flex-col items-center justify-center gap-4 p-6 text-center"
          >
            <WifiOff className="size-8 text-amber-400" aria-hidden="true" />
            <p className="max-w-xs text-sm leading-relaxed text-zinc-300">
              Não conseguimos carregar esta tela. Verifique sua conexão.
            </p>
            <Button
              onClick={this.handleReset}
              className="h-12 rounded-full bg-white px-8 font-bold tracking-wide text-black hover:bg-zinc-200"
            >
              <RefreshCcw className="mr-2 size-4" />
              Tentar de novo
            </Button>
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
