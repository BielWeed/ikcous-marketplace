/**
 * O MOMENTO SEGURO — a regra única de "posso recarregar o app agora?"
 * (atualização única e obrigatória, 16/10/2026).
 *
 * A atualização é obrigatória e não tem soneca, então a proteção da compra
 * deixa de ser "esconder o aviso" e vira "só recarregar quando nada sensível
 * está em andamento". Esta função não lê DOM nem storage: quem chama lê o
 * mundo e passa os fatos — assim a regra inteira é testável por tabela. A
 * única leitura própria é o registro de operações sensíveis (memória do
 * processo), usado quando o chamador não informa o fato.
 *
 * Duas perguntas moram aqui e NÃO podem ser confundidas:
 *   · `livre` — nada sensível em andamento nesta aba (compra, pagamento,
 *     trabalho não salvo, operação sensível). É a resposta que uma aba dá às
 *     outras: a aba parada numa tela segura está livre, mesmo sem ponto de
 *     parada.
 *   · `instalarAgora` — livre E a pessoa está num PONTO DE PARADA (a tela
 *     mudou, ou o documento foi para segundo plano). Só isto dispara a
 *     instalação: nunca no meio de uma tela parada.
 *
 * Ponto de parada é OPORTUNIDADE, nunca licença: os bloqueios vencem sempre.
 */
import { haOperacaoSensivel } from "./operacao-sensivel";

// Telas em que o aviso/instalação nunca interrompe o fechamento de um pedido
// (decisão do dono, 03/09, que antes morava no PWAUpdateGate). O pagamento é
// etapa do checkout — não existe view separada.
// - order-success: o pedido só está fechado quando o cliente VÊ a confirmação
//   (achado 1 do laudo Claude de 04/09).
// - auth/login: caminho real do convidado no meio do pagamento — escolher
//   pagar online sem conta leva a "auth", e sair do checkout apaga o
//   formulário digitado (só o CEP persiste).
export const TELAS_DE_COMPRA: ReadonlySet<string> = new Set([
  "cart",
  "checkout",
  "address-form",
  "order-success",
  "auth",
  "login",
]);

export type MotivoDeBloqueio =
  | "tela-de-compra"
  | "pedido-pendente-do-checkout"
  | "trabalho-nao-salvo"
  | "operacao-sensivel";

export interface EntradaDoMomento {
  /** A tela atual (`currentView` do App). */
  readonly view: string;
  /** O mesmo sinal de formulário/venda sujos que o App mantém (isAdminDirty):
   * PDV com cupom montado, produto em edição, banner em rascunho. */
  readonly adminDirty: boolean;
  /** Há um pedido guardado na aba esperando pagamento (PIX com QR na tela
   * que o cliente foi pagar no app do banco). Vale mesmo fora do checkout. */
  readonly pedidoPendenteDoCheckout: boolean;
  /** O documento está em segundo plano (`document.visibilityState` hidden). */
  readonly documentoOculto: boolean;
  /** A tela mudou desde a última avaliação (a pessoa navegou). */
  readonly trocouDeTela: boolean;
  /** Há operação sensível marcada (upload, fila offline, gravação de venda).
   * Omitido = lê o registro de `operacao-sensivel.ts`. */
  readonly operacaoSensivel?: boolean;
}

export interface DecisaoDoMomento {
  /** Sem bloqueio, E num ponto de parada. */
  readonly instalarAgora: boolean;
  /** Sem bloqueio (ponto de parada não importa): a resposta às outras abas. */
  readonly livre: boolean;
  readonly pontoDeParada: boolean;
  readonly bloqueio: MotivoDeBloqueio | null;
}

export function decidirMomentoSeguro(
  entrada: EntradaDoMomento,
): DecisaoDoMomento {
  const operacaoSensivel = entrada.operacaoSensivel ?? haOperacaoSensivel();

  let bloqueio: MotivoDeBloqueio | null = null;
  if (TELAS_DE_COMPRA.has(entrada.view)) {
    bloqueio = "tela-de-compra";
  } else if (entrada.pedidoPendenteDoCheckout) {
    bloqueio = "pedido-pendente-do-checkout";
  } else if (entrada.adminDirty) {
    bloqueio = "trabalho-nao-salvo";
  } else if (operacaoSensivel) {
    bloqueio = "operacao-sensivel";
  }

  const livre = bloqueio === null;
  const pontoDeParada = entrada.documentoOculto || entrada.trocouDeTela;
  return {
    instalarAgora: livre && pontoDeParada,
    livre,
    pontoDeParada,
    bloqueio,
  };
}
