import { useAuth } from "@/hooks/useAuth";
import { useRealtimeUpdate } from "@/hooks/useRealtimeUpdate";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import type { View } from "@/types";
import { memo, useCallback } from "react";

import { UpdateNotification } from "./UpdateNotification";

// O aviso de atualização nunca interrompe o fechamento de um pedido (decisão
// do dono, 03/09): nessas telas ele fica armado e aparece na próxima tela
// segura. O pagamento é etapa do checkout — não existe view separada.
// - order-success: o pedido só está fechado quando o cliente VÊ a confirmação
//   (e a casa já a trata como não-perturbe: App esconde banner/nav ali) —
//   sem ela, todo update que chegasse no checkout estouraria exatamente na
//   confirmação (achado 1 do laudo Claude de 04/09).
// - auth/login: caminho real do convidado no meio do pagamento — escolher
//   pagar online sem conta leva a "auth" (CheckoutView.tsx:2252,2786) e sair
//   do checkout apaga o formulário digitado (só o CEP persiste).
const TELAS_DE_COMPRA: ReadonlySet<View> = new Set([
  "cart",
  "checkout",
  "address-form",
  "order-success",
  "auth",
  "login",
]);

// Viveu dentro do App.tsx até 04/09/2026; ganhou arquivo próprio para a
// regra do "não interromper a compra" ser testável sem montar o App inteiro.
// memo (laudo Claude, ressalva do re-render): montado dentro do AppContent,
// ele re-renderizaria a cada scroll da vitrine; com a prop primitiva, só
// quando a tela muda — que é a única coisa que importa para o gate.
export const PWAUpdateManager = memo(function PWAUpdateManager({
  currentView,
}: { readonly currentView: View }) {
  const { user } = useAuth();
  const { checkUpdate, updateAvailable, newVersion, performNuclearPurge } =
    useUpdateCheck();

  const handleUpdate = useCallback(
    (newVer?: string) => {
      console.log(
        `[RealtimeUpdate] Update ping detected (${newVer || "no-ver"}). Triggering deep checkUpdate...`,
      );
      checkUpdate(newVer);
    },
    [checkUpdate],
  );

  useRealtimeUpdate(handleUpdate, user?.id);

  return (
    <UpdateNotification
      show={updateAvailable && !TELAS_DE_COMPRA.has(currentView)}
      onUpdate={() => performNuclearPurge(true)}
      newVersion={newVersion}
    />
  );
});
