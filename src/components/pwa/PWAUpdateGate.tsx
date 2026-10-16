import { useAuth } from "@/hooks/useAuth";
import { useRealtimeUpdate } from "@/hooks/useRealtimeUpdate";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { useInstaladorNoPontoDeParada } from "@/lib/atualizacao/instalador";
import {
  recarregarAposAssumir,
  useRecargaPendente,
} from "@/lib/atualizacao/recarga-pendente";
import { gravaVersaoEsperadaDaAtualizacao } from "@/lib/motivo-de-recarga";
import { nucleoSemver } from "@/lib/versao-do-servidor";
import type { View } from "@/types";
import { memo, useCallback } from "react";

declare const __APP_VERSION__: string;
const VERSAO_DO_APP =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";

// ATUALIZAÇÃO ÚNICA E OBRIGATÓRIA (16/10/2026). Este componente não desenha
// mais nada: não há cartão, faixa, "Depois" nem soneca. Ele ORQUESTRA — quando
// o app descobre uma versão nova, o estado vira "aguardando" e a instalação só
// acontece num ponto de parada (a tela mudou ou o app foi para segundo plano),
// com nada sensível em andamento nesta aba, com as outras abas livres e com a
// trava de 2 tentativas liberada. Quem MOSTRA "instalando"/"instalou" é a ilha
// (Onda 2), lendo `useEstadoDaAtualizacao`.
//
// Todas as regras de "quando" moram em @/lib/atualizacao (testáveis sem o
// módulo virtual do PWA). A lista das telas de compra que nunca são
// interrompidas — antes aqui — é `TELAS_DE_COMPRA` em momento-seguro.ts.
//
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
  /** O MESMO sinal de formulário sujo que o App já mantém (isAdminDirty,
   * App.tsx): PDV com cupom montado, produto em edição. Com trabalho não salvo
   * em tela, NADA é instalado. Opcional: quem não passar (dublês de teste
   * antigos) tem "sem trabalho sujo". */
  readonly adminDirty?: boolean;
}) {
  const { user } = useAuth();
  const {
    checkUpdate,
    updateAvailable,
    newVersion,
    isMandatory,
    performNuclearPurge,
  } = useUpdateCheck();
  // O service worker novo JÁ assumiu (onNeedReload do plugin): só falta
  // recarregar esta aba — com o mesmo veto de momento seguro.
  const recargaPendente = useRecargaPendente();

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

  // O que a ilha mostra: o núcleo semver legível da versão nova. Sem versão
  // legível, ou com o MESMO núcleo da instalada (build novo da mesma release),
  // não há versão a mostrar — nunca um fragmento de hash nem a seta "1.5.0 →
  // 1.5.0".
  const nucleoNovo = nucleoSemver(newVersion);
  const versaoNova =
    nucleoNovo && nucleoNovo !== nucleoSemver(VERSAO_DO_APP)
      ? nucleoNovo
      : null;

  // A chave da trava de tentativas: a versão-alvo completa quando o servidor a
  // disse; do contrário, "a que veio da versão instalada".
  const alvo = newVersion ?? `desconhecida-de-${VERSAO_DO_APP}`;

  const instalar = useCallback(() => {
    if (recargaPendente) {
      recarregarAposAssumir(VERSAO_DO_APP);
      return;
    }
    // A tentativa carrega a versão que espera encontrar; o boot só anuncia
    // sucesso se o que chegou for compatível com ela.
    gravaVersaoEsperadaDaAtualizacao(nucleoNovo);
    // O apply: o do service worker, ou a purga de versão obrigatória quando
    // há uma pendente (o nome do export é histórico — ver useUpdateCheck).
    return performNuclearPurge(true);
  }, [recargaPendente, nucleoNovo, performNuclearPurge]);

  useInstaladorNoPontoDeParada({
    ativo: updateAvailable || recargaPendente,
    modo: recargaPendente ? "so-recarregar" : "instalar",
    alvo,
    // O teto de 2 tentativas por build de ORIGEM não depende do alvo: trocar
    // a chave (versão real, desconhecida, versão arbitrária do realtime) não
    // dá tentativas a mais.
    origem: VERSAO_DO_APP,
    versaoNova,
    view: currentView,
    adminDirty: adminDirty ?? false,
    instalar,
    // Versão mínima obrigatória detectada no BOOT: o ponto de parada já está
    // satisfeito (as proteções de pagamento/venda continuam valendo). Detectada
    // depois do boot, o instalador ignora isto e espera um ponto de parada.
    pontoDeParadaInicial: isMandatory === true,
  });

  return null;
});
