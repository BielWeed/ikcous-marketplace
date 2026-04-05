import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { RefreshCcw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught fatal error:', error, errorInfo);

        // Log to PWA forensics if available
        try {
            const logs = JSON.parse(localStorage.getItem('pwa_forensics') || '[]');
            const newLog = {
                t: new Date().toISOString(),
                m: 'FATAL_APP_CRASH',
                d: { error: error.message, stack: error.stack, componentStack: errorInfo.componentStack }
            };
            localStorage.setItem('pwa_forensics', JSON.stringify([newLog, ...logs].slice(0, 10)));
            localStorage.setItem('pwa_reload_reason', `Fatal Crash: ${error.message.substring(0, 50)}...`);
        } catch (e) {
            console.error('Failed to write forensic log', e);
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
                <div className="h-[100dvh] w-full bg-zinc-950 flex flex-col items-center justify-center p-6 text-center antialiased">
                    <div className="w-16 h-16 inset-0 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                    </div>

                    <h1 className="text-2xl font-black text-white tracking-tight mb-2">
                        Erro Fatal Detectado
                    </h1>

                    <p className="text-zinc-400 max-w-sm mb-8 text-sm leading-relaxed">
                        A aplicação encontrou um estado inválido instável na renderização. Nossa equipe técnica já foi alertada silenciosamente desta falha de estabilidade.
                    </p>

                    <Button
                        onClick={this.handleReset}
                        className="bg-white text-black hover:bg-zinc-200 rounded-full px-8 h-12 font-bold tracking-wide"
                    >
                        <RefreshCcw className="w-4 h-4 mr-2" />
                        Reiniciar Sessão (Recovery)
                    </Button>

                    {import.meta.env.DEV && this.state.error && (
                        <div className="mt-12 p-4 bg-red-950/30 border border-red-900/50 rounded-xl text-left w-full max-w-2xl overflow-auto max-h-64">
                            <p className="text-red-400 font-mono text-xs whitespace-pre-wrap">
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
