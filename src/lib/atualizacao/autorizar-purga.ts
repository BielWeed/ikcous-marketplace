/**
 * AUTORIZAÇÃO DA PURGA DE VERSÃO OBRIGATÓRIA — tudo o que acontece ANTES do
 * ponto sem volta (apagar service worker, caches e IndexedDB). Atualização
 * única e obrigatória, 16/10/2026.
 *
 * Extraída do useUpdateCheck por dois motivos: o hook não pode ser montado nos
 * testes (importa o módulo virtual do PWA), e esta é justamente a parte que
 * decide se um aparelho fica sem app. Aqui ela é função com dependências
 * injetadas e comportamento provado por teste.
 *
 * A ordem é o contrato:
 *   1. navegador offline → adia (AtualizacaoAdiada, nada gasto);
 *   2. momento NÃO seguro (operação sensível, tela de compra, pedido pendente,
 *      trabalho não salvo) → adia;
 *   3. RELÊ /version.json AGORA: a prova de rede de minutos atrás não vale — o
 *      aparelho pode ter ficado sem internet depois dela, e apagar o app sem
 *      rede o deixa sem app. Não legível → adia;
 *   4. RECONFERE o momento seguro DEPOIS da leitura: ela pode demorar, e a
 *      pessoa entra em pagamento ou venda no meio da espera. É o último passo
 *      antes de gastar a trava, sem nenhum `await` entre os dois;
 *   5. a trava existente (máx. 2 purgas por versão exigida) é conferida, gasta
 *      e CONFIRMADA lendo de volta. Esgotada, ou storage que não grava ou não
 *      confirma → Error comum (repetir não conserta; a tentativa conta);
 *   6. só então o log de diagnóstico do próximo boot.
 * Se esta função resolve, quem chamou pode apagar. Se lança, NADA foi apagado.
 */
import { AtualizacaoAdiada } from "./adiamento";

export interface PedidoDeAutorizacao {
  /** A versão mínima exigida (config.minAppVersion). */
  readonly requerida: string;
  /** A versão instalada (para o log). */
  readonly versaoLocal: string;
  /** `navigator.onLine` (indefinido = o ambiente não informa). */
  readonly online: boolean | undefined;
  /** O momento seguro COMPLETO, lido ao vivo (a mesma regra do instalador:
   * `true` = nada sensível em andamento). Chamado antes E depois da leitura de
   * rede. */
  readonly momentoSeguroAgora: () => boolean;
  /** Lê /version.json agora (null = não legível). Pode lançar. */
  readonly lerVersaoDoServidor: () => Promise<string | null>;
  readonly lerTrava: () => { required: string; count: number };
  /** Grava a trava. Pode lançar (quota, SecurityError). */
  readonly gravarTrava: (required: string, count: number) => void;
  readonly gravarLog: (texto: string) => void;
  /** Purgas permitidas por versão exigida (hoje 2). */
  readonly maximo: number;
}

export async function autorizarPurgaObrigatoria(
  pedido: PedidoDeAutorizacao,
): Promise<void> {
  if (pedido.online === false) {
    throw new AtualizacaoAdiada("Purge obrigatório adiado: sem rede.");
  }
  if (!pedido.momentoSeguroAgora()) {
    throw new AtualizacaoAdiada(
      "Purge obrigatório adiado: momento não seguro (compra, venda ou operação sensível).",
    );
  }

  let versaoDoServidor: string | null = null;
  try {
    versaoDoServidor = await pedido.lerVersaoDoServidor();
  } catch {
    versaoDoServidor = null;
  }
  if (versaoDoServidor === null) {
    throw new AtualizacaoAdiada(
      "Purge obrigatório adiado: /version.json não legível agora.",
    );
  }

  // A leitura acima é de rede e pode demorar: o momento de antes não vale mais.
  // Daqui até gastar a trava não há nenhum `await`.
  if (!pedido.momentoSeguroAgora()) {
    throw new AtualizacaoAdiada(
      "Purge obrigatório adiado: a pessoa entrou em momento não seguro durante a leitura da rede.",
    );
  }

  const guardada = pedido.lerTrava();
  const tentativas =
    guardada.required === pedido.requerida ? guardada.count : 0;
  if (tentativas >= pedido.maximo) {
    throw new Error(
      `Purge obrigatório já tentado ${tentativas}x para ${pedido.requerida}.`,
    );
  }

  try {
    pedido.gravarTrava(pedido.requerida, tentativas + 1);
  } catch {
    throw new Error("Purge obrigatório recusado: a trava não grava.");
  }
  const confirmada = pedido.lerTrava();
  if (
    confirmada.required !== pedido.requerida ||
    confirmada.count !== tentativas + 1
  ) {
    throw new Error("Purge obrigatório recusado: a trava não confirmou.");
  }

  pedido.gravarLog(
    `Version Mismatch: ${pedido.versaoLocal} -> ${pedido.requerida}`,
  );
}
