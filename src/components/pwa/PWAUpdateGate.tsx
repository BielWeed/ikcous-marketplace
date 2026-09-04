import { useAuth } from "@/hooks/useAuth";
import { useRealtimeUpdate } from "@/hooks/useRealtimeUpdate";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import type { View } from "@/types";
import { useCallback } from "react";

import { UpdateNotification } from "./UpdateNotification";

// O aviso de atualização nunca interrompe o fechamento de um pedido (decisão
// do dono, 03/09): nessas telas ele fica armado e aparece na próxima tela
// segura. O pagamento é etapa do checkout — não existe view separada.
const TELAS_DE_COMPRA: ReadonlySet<View> = new Set([
  "cart",
  "checkout",
  "address-form",
]);

// Viveu dentro do App.tsx até 04/09/2026; ganhou arquivo próprio para a
// regra do "não interromper a compra" ser testável sem montar o App inteiro.
export function PWAUpdateManager({
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
}
