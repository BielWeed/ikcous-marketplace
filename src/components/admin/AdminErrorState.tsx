import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
import React from "react";

interface AdminErrorStateProps {
  readonly title?: string;
  readonly message?: string;
  readonly onRetry?: () => void;
  readonly isLoading?: boolean;
}

export const AdminErrorState = React.memo(function AdminErrorState({
  title = "Algo deu errado",
  message = "Não foi possível carregar os dados. Verifique sua conexão e tente novamente.",
  onRetry,
  isLoading = false,
}: AdminErrorStateProps) {
  return (
    <div className="mx-auto my-6 flex min-h-[300px] max-w-lg flex-col items-center justify-center space-y-6 rounded-[2rem] border border-white/5 bg-[#121214]/40 p-8 text-center duration-300 animate-in fade-in zoom-in-95">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
        <AlertCircle className="size-8" />
      </div>

      <div className="space-y-2">
        <h3 className="text-base font-black uppercase tracking-wider text-white">
          {title}
        </h3>
        <p className="max-w-sm text-xs leading-relaxed text-zinc-400">
          {message}
        </p>
      </div>

      {onRetry && (
        <Button
          onClick={onRetry}
          disabled={isLoading}
          className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-zinc-900 px-6 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-zinc-800 active:scale-95"
        >
          <RefreshCw
            className={`size-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
          <span>{isLoading ? "Recarregando..." : "Tentar Novamente"}</span>
        </Button>
      )}
    </div>
  );
});
