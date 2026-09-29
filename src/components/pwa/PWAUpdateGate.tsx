import { useAuth } from "@/hooks/useAuth";
import { useRealtimeUpdate } from "@/hooks/useRealtimeUpdate";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import type { View } from "@/types";
import { memo, useCallback, useEffect, useState } from "react";

import { UpdateNotification } from "./UpdateNotification";

// UpdateNotification-138: o modal era sem saída porque `needRefresh` (o
// `updateAvailable` abaixo) NUNCA volta a false sozinho (useUpdateCheck.ts
// descarta o setter) — uma vez true, ficava true para sempre. "Depois"
// precisa de um sinal PRÓPRIO, independente do hook, para segurar o aviso.
//
// Guardado em storage (não só em estado do componente) porque o lojista
// pode trocar de tela sem desmontar o gate (ele vive acima da troca de
// view), mas TAMBÉM porque um F5 no meio da hora não pode reabrir o modal
// na cara dele — senão o "Depois" vira teatro.
const CHAVE_SNOOZE = "pwa_update_snooze_until";
const UMA_HORA_MS = 60 * 60 * 1000;

// Lê o soneca de QUALQUER um dos dois storages (o mais no futuro vence) —
// modo privado/anônimo pode bloquear um dos dois, e a instrução pede os
// dois com try/catch em vez de escolher um só.
function lerSnoozeArmazenado(): number {
  let doLocal = 0;
  let daSessao = 0;
  try {
    doLocal = Number(localStorage.getItem(CHAVE_SNOOZE)) || 0;
  } catch {
    // Storage indisponível (modo privado, política do navegador): sem
    // soneca lembrado, o aviso segue o comportamento de hoje.
  }
  try {
    daSessao = Number(sessionStorage.getItem(CHAVE_SNOOZE)) || 0;
  } catch {
    // idem
  }
  return Math.max(doLocal, daSessao);
}

function gravarSnoozeArmazenado(ate: number): void {
  try {
    localStorage.setItem(CHAVE_SNOOZE, String(ate));
  } catch {
    // Sem persistir entre reloads não é o fim do mundo: o estado em
    // memória (abaixo) já esconde o aviso nesta sessão de componente.
  }
  try {
    sessionStorage.setItem(CHAVE_SNOOZE, String(ate));
  } catch {
    // idem
  }
}

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
  adminDirty,
}: {
  readonly currentView: View;
  /** UpdateNotification-138: o MESMO sinal de formulário sujo que o App já
   * mantém (isAdminDirty, App.tsx). Com trabalho não salvo em tela, o aviso
   * fica ARMADO (needRefresh não muda) e aparece assim que o trabalho
   * termina — não cobre o formulário no meio da edição. Opcional: quem não
   * passar (dublês de teste antigos) tem o comportamento de sempre. */
  readonly adminDirty?: boolean;
}) {
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

  // O instante-limite mora em storage (lido só na primeira montagem, sem
  // Date.now no corpo da função — regra de pureza do render); `emSoneca` é
  // que decide o `show`, e SÓ é escrito de dentro de efeito/callback.
  const [sonecaAte, setSonecaAte] = useState<number>(() =>
    lerSnoozeArmazenado(),
  );
  const [emSoneca, setEmSoneca] = useState(false);

  // Calcula "ainda vale?" e rearma sozinho quando o prazo vence — sem isto,
  // um lojista parado na MESMA view por 1h só veria o aviso voltar no
  // próximo evento (troca de tela, ping do realtime), e "Depois" pareceria
  // "nunca mais".
  useEffect(() => {
    if (sonecaAte <= 0) {
      setEmSoneca(false);
      return;
    }
    const restanteMs = sonecaAte - Date.now();
    if (restanteMs <= 0) {
      setEmSoneca(false);
      setSonecaAte(0);
      return;
    }
    setEmSoneca(true);
    const temporizador = setTimeout(() => {
      setEmSoneca(false);
      setSonecaAte(0);
    }, restanteMs);
    return () => clearTimeout(temporizador);
  }, [sonecaAte]);

  const handleSnooze = useCallback(() => {
    const ate = Date.now() + UMA_HORA_MS;
    gravarSnoozeArmazenado(ate);
    setSonecaAte(ate);
  }, []);

  return (
    <UpdateNotification
      show={
        updateAvailable &&
        !TELAS_DE_COMPRA.has(currentView) &&
        !emSoneca &&
        !adminDirty
      }
      onUpdate={() => performNuclearPurge(true)}
      onSnooze={handleSnooze}
      newVersion={newVersion}
    />
  );
});
