import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught fatal error:", error, errorInfo);

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
      localStorage.setItem(
        "pwa_reload_reason",
        `Fatal Crash: ${error.message.substring(0, 50)}...`,
      );
    } catch (e) {
      console.error("Failed to write forensic log", e);
    }
  }

  private handleReset = () => {
    // Clear potentially corrupted application state
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-950 p-6 text-center antialiased">
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
