import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AdminErrorStateProps {
    readonly title?: string;
    readonly message?: string;
    readonly onRetry?: () => void;
    readonly isLoading?: boolean;
}

export const AdminErrorState = React.memo(function AdminErrorState({
    title = 'Algo deu errado',
    message = 'Não foi possível carregar os dados. Verifique sua conexão e tente novamente.',
    onRetry,
    isLoading = false
}: AdminErrorStateProps) {
    return (
        <div className="flex flex-col items-center justify-center p-8 text-center min-h-[300px] bg-[#121214]/40 border border-white/5 rounded-[2rem] space-y-6 max-w-lg mx-auto my-6 animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
                <AlertCircle className="w-8 h-8" />
            </div>
            
            <div className="space-y-2">
                <h3 className="text-base font-black text-white uppercase tracking-wider">{title}</h3>
                <p className="text-xs text-zinc-400 leading-relaxed max-w-sm">{message}</p>
            </div>
            
            {onRetry && (
                <Button
                    onClick={onRetry}
                    disabled={isLoading}
                    className="h-10 px-6 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white border border-white/10 font-bold text-[10px] uppercase tracking-widest transition-all active:scale-95 flex items-center gap-2"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    <span>{isLoading ? 'Recarregando...' : 'Tentar Novamente'}</span>
                </Button>
            )}
        </div>
    );
});
