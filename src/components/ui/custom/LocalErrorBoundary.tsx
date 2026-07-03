import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class LocalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[LocalErrorBoundary] Intercepted render error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="admin-glass p-8 sm:p-12 rounded-[2rem] border border-white/5 flex flex-col items-center justify-center text-center space-y-4 shadow-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-red-500/[0.01] pointer-events-none" />
          <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center text-red-500 animate-pulse">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1 relative z-10">
            <h4 className="text-xs font-black text-white uppercase tracking-[0.2em]">Falha na Renderização</h4>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest max-w-xs leading-relaxed">
              Ocorreu um erro ao carregar este bloco de controle.
            </p>
          </div>
          <Button
            onClick={this.handleReset}
            size="sm"
            className="h-9 px-4 rounded-xl bg-zinc-900 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
          >
            <RefreshCcw className="w-3.5 h-3.5 mr-2" />
            Tentar Novamente
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
