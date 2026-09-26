import type { View } from "@/types";

interface AdminFinanceiroViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
  onSetBackOverride?: (fn: (() => void) | null) => void;
}

// Esqueleto do registro no roteador — o conteúdo da tela chega na tarefa
// própria do plano 2026-09-26-painel-cartao-e-devolucoes.
export function AdminFinanceiroView(_props: AdminFinanceiroViewProps) {
  return (
    <div className="h-auto bg-[#09090b] pb-admin lg:pb-12 text-white">
      <h1 className="px-6 pt-6 text-2xl font-black">Financeiro</h1>
    </div>
  );
}
