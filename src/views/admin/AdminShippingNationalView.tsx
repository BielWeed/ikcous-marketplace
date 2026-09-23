import type { View } from "@/types";
import { AdminShippingView } from "@/views/admin/AdminShippingView";
import { memo } from "react";

interface AdminShippingNationalViewProps {
  onNavigate?: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

/**
 * Rota `admin-shipping-national` — CASCA (T4 unificação, 23/09/2026). A
 * tela própria de "Estratégias do frete nacional" morreu poucas horas
 * depois de nascer: o cabeçalho transbordava e o pedido do dono foi trazer
 * tudo de volta para a tela de Frete, em painéis recolhíveis. Link, F5 e
 * "Voltar" antigos que ainda apontam para esta rota continuam funcionando
 * — só que abrindo a MESMA `AdminShippingView`, com o painel "Fora da
 * cidade" (que agora contém a estratégia nacional inteira) já expandido.
 *
 * Menor mudança de roteamento possível: nem `App.tsx` (o pai declarado do
 * popstate continua sendo `admin-shipping`) nem `AdminArea.tsx` (o `case`
 * e o lazy import continuam apontando para este arquivo, pelo mesmo nome
 * exportado) precisaram mudar.
 */
export const AdminShippingNationalView = memo(
  function AdminShippingNationalView({
    onNavigate,
    active,
    onSetDirty,
  }: Readonly<AdminShippingNationalViewProps>) {
    return (
      <AdminShippingView
        onNavigate={onNavigate}
        active={active}
        onSetDirty={onSetDirty}
        painelInicial="nacional"
      />
    );
  },
);
