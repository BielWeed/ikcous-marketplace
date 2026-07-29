import { AdminErrorState } from "@/components/admin/AdminErrorState";
import { Component } from "react";
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

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      "[LocalErrorBoundary] Intercepted render error:",
      error,
      errorInfo,
    );
  }

  private handleReset = () => {
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
