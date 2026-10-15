/**
 * Lote R1 do reembolso (15/10/2026, plano `reembolso-ab-plano-20261015.md`):
 * o que o PAINEL sabe de uma linha de `order_refunds` que parou sem o dinheiro
 * confirmado — e o que pode fazer com ela.
 *
 * A regra "o dinheiro pode ter saído" e a conta do saldo moram SÓ no servidor
 * (função `order_refund__pode_ter_saido` e RPC `pedido_reembolsos_e_saldo`).
 * Este arquivo NUNCA recalcula nada: lê o que o banco devolveu e decide qual
 * BOTÃO a tela mostra. Antes do R1 a tela copiava a conta do saldo e
 * oferecia "Tentar de novo" numa linha cujo envio podia ter chegado ao
 * Mercado Pago — com chave nova, o MP não deduplica e o cliente recebia em
 * dobro.
 *
 * O contrato com o banco fica TODO aqui (nomes das RPCs, parâmetros, frase de
 * confirmação), num lugar só: se a migration 20261241 mudar um nome, muda
 * aqui e em nenhum outro arquivo.
 */

/** Nomes das RPCs do contrato R1. */
export const RPC_DO_REEMBOLSO_R1 = {
  /** `(p_order_id uuid) → jsonb` — saldo + linhas com o veredito do servidor. */
  saldo: "pedido_reembolsos_e_saldo",
  /** Saída dos 7 dias na DEVOLUÇÃO (PIX, ou cartão sem prova). */
  porForaAposEsperaDaDevolucao:
    "admin_devolucao_reembolso_por_fora_apos_espera",
  /** Saída dos 7 dias no PEDIDO CANCELADO. */
  porForaAposEsperaDoPedido: "registrar_estorno_manual_apos_espera",
  /** "Já devolvi por fora" normal da devolução (linha que NÃO pode ter saído). */
  porForaDaDevolucao: "admin_devolucao_reembolso_por_fora",
} as const;

/**
 * Frase que o lojista digita para usar a saída dos 7 dias. O servidor confere
 * a mesma frase (`p_confirmacao`); a tela só libera o botão quando o texto
 * digitado bate EXATAMENTE, e manda esta constante — nunca o texto cru.
 */
export const FRASE_DE_CONFIRMACAO_POR_FORA = "DEVOLVI POR FORA";

/** Parâmetros das RPCs dos 7 dias — um objeto só, fácil de ajustar ao banco. */
export const parametrosPorForaAposEspera = {
  devolucao: (devolucaoId: string, refundEsperado: string) => ({
    p_devolucao_id: devolucaoId,
    p_refund_esperado: refundEsperado,
    p_confirmacao: FRASE_DE_CONFIRMACAO_POR_FORA,
  }),
  pedido: (orderId: string, refundEsperado: string) => ({
    p_order_id: orderId,
    p_refund_esperado: refundEsperado,
    p_confirmacao: FRASE_DE_CONFIRMACAO_POR_FORA,
  }),
};

type RespostaDeRpc = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;

/**
 * Chama uma RPC do contrato R1 que ainda não está em `database.types.ts` (o
 * executor da migration regenera os tipos; este lote não edita aquele
 * arquivo). Recebe o cliente por parâmetro para este módulo seguir puro.
 */
export function chamarRpcDoR1(
  cliente: { rpc: unknown },
  nome: string,
  argumentos: Record<string, unknown>,
): RespostaDeRpc {
  const rpc = cliente.rpc as (
    nome: string,
    argumentos: Record<string, unknown>,
  ) => RespostaDeRpc;
  return rpc.call(cliente, nome, argumentos);
}

export const AVISO_DE_DOBRO =
  "Se o Mercado Pago ainda processar esta devolução, o cliente recebe em dobro.";

export const TEXTO_CONFIRMANDO =
  "A loja está confirmando com o Mercado Pago, não repita.";

export const BOTAO_POR_FORA_APOS_ESPERA =
  "Já devolvi por fora (depois de 7 dias)";

export const TEXTO_JA_POR_FORA = "Você já registrou que devolveu por fora.";

/**
 * Confirmação FORTE da saída dos 7 dias: mostra o risco de pagar em dobro e
 * exige digitar a frase fixa (diálogo nativo, o mesmo padrão do `confirm`
 * que o painel já usa para dinheiro — e sem componente novo no pacote do
 * painel, que está no limite de tamanho). Só `true` com a frase EXATA.
 * A frase é só um freio de tela; quem decide se a saída vale é o servidor.
 */
export function confirmouPorForaAposEspera(valor: string): boolean {
  const digitado = globalThis.prompt(
    `${AVISO_DE_DOBRO} Registrar que você já devolveu ${valor} por outro meio? Para confirmar, digite ${FRASE_DE_CONFIRMACAO_POR_FORA}`,
  );
  return digitado?.trim() === FRASE_DE_CONFIRMACAO_POR_FORA;
}

const MUDOU_SEM_GRAVAR = "O reembolso mudou. Os dados foram atualizados.";

/** Aviso de cada recusa das saídas dos 7 dias (nada foi gravado). */
const RECUSAS_DA_SAIDA: ReadonlyMap<unknown, string> = new Map([
  [
    "aguarde",
    "Ainda não passaram 7 dias do último pedido ao Mercado Pago. Nada foi registrado.",
  ],
  [
    "sem_espera",
    "Nada saiu por este reembolso: use o botão de sempre, sem esperar. Nada foi registrado.",
  ],
  [
    "em_andamento",
    "O reembolso ainda está em andamento no Mercado Pago. Nada foi registrado.",
  ],
]);

/**
 * Lê o retorno das duas saídas dos 7 dias (migration 20261241). Quando o
 * servidor RECUSA (antes dos 7 dias, linha em que nada saiu, linha que mudou,
 * já resolvida...), ele NÃO dá erro: devolve `{resultado, detalhe}` em jsonb.
 * Só `combinado` (devolução) e `registrado` (pedido cancelado) gravaram a
 * saída; qualquer outro `resultado`, ou forma inesperada, = nada gravado, e a
 * tela não pode dizer "registrado".
 */
export function lerSaidaAposEspera(
  v: unknown,
): { gravou: true } | { gravou: false; aviso: string } {
  const resultado = ehObjeto(v) ? v.resultado : undefined;
  if (resultado === "combinado" || resultado === "registrado") {
    return { gravou: true };
  }
  return {
    gravou: false,
    aviso: RECUSAS_DA_SAIDA.get(resultado) ?? MUDOU_SEM_GRAVAR,
  };
}

type StatusDaLinha =
  | "solicitado"
  | "em_processamento"
  | "concluido"
  | "falhou"
  | "recusado";

const STATUS_DA_LINHA: readonly StatusDaLinha[] = [
  "solicitado",
  "em_processamento",
  "concluido",
  "falhou",
  "recusado",
];

/** Uma linha como o SERVIDOR a julgou (`pedido_reembolsos_e_saldo.linhas[]`). */
export interface LinhaDoSaldo {
  id: string;
  status: StatusDaLinha;
  amount: number;
  /** Veredito do servidor: o envio desta linha pode ter chegado ao MP. */
  pode_ter_saido: boolean;
  /** Marca gravada pelo servidor DEPOIS que a saída dos 7 dias foi usada. */
  por_fora_liberado_em: string | null;
  /**
   * Servidor: a ESPERA dos 7 dias desta linha passou. A porta ainda confere o
   * resto (linha do sistema, outra linha em andamento...) e pode recusar — a
   * tela mostra a RESPOSTA da porta, nunca promete pelo campo.
   */
  por_fora_apos_espera_liberado: boolean;
  /**
   * Servidor: o reembolso manual tomou o lugar desta linha. Aqui
   * `pode_ter_saido = false` quer dizer "não conta como dúvida", NÃO "o
   * dinheiro não saiu" — a linha não ganha "Tentar de novo" nem a saída.
   */
  substituida_por_manual: boolean;
  eh_pix: boolean;
}

/** O retorno inteiro de `pedido_reembolsos_e_saldo` (valores em reais). */
export interface ReembolsosESaldo {
  total: number;
  valor_estornado: number;
  em_voo: number;
  em_duvida: number;
  manual: number;
  disponivel: number;
  linhas: LinhaDoSaldo[];
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function reais(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // `numeric` do Postgres pode chegar como texto dentro do jsonb.
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function lerLinha(v: unknown): LinhaDoSaldo | null {
  if (!ehObjeto(v)) return null;
  const amount = reais(v.amount);
  const liberado = v.por_fora_liberado_em ?? null;
  const ok =
    typeof v.id === "string" &&
    (STATUS_DA_LINHA as readonly unknown[]).includes(v.status) &&
    amount !== null &&
    typeof v.pode_ter_saido === "boolean" &&
    typeof v.eh_pix === "boolean" &&
    typeof v.por_fora_apos_espera_liberado === "boolean" &&
    typeof v.substituida_por_manual === "boolean" &&
    (liberado === null || typeof liberado === "string");
  return ok
    ? ({ ...v, amount, por_fora_liberado_em: liberado } as LinhaDoSaldo)
    : null;
}

/**
 * Lê o jsonb de `pedido_reembolsos_e_saldo`. Forma inesperada (campo faltando,
 * tipo errado, uma linha só que seja) devolve `null` — a tela trata como erro
 * de leitura, nunca como saldo: número de dinheiro de origem incerta não
 * aparece. O `disponivel` nunca sai negativo daqui (o servidor já devolve
 * `GREATEST(saldo, 0)`; esta é a segunda trava, para nenhuma tela mostrar
 * "Disponível: -R$ 100,00").
 */
export function lerReembolsosESaldo(v: unknown): ReembolsosESaldo | null {
  if (!ehObjeto(v) || !Array.isArray(v.linhas)) return null;
  const numeros = [
    v.total,
    v.valor_estornado,
    v.em_voo,
    v.em_duvida,
    v.manual,
    v.disponivel,
  ].map(reais);
  const linhas = v.linhas.map(lerLinha);
  if (numeros.includes(null) || linhas.includes(null)) return null;
  const [total, valor_estornado, em_voo, em_duvida, manual, disponivel] =
    numeros as number[];
  return {
    total,
    valor_estornado,
    em_voo,
    em_duvida,
    manual,
    disponivel: Math.max(0, disponivel),
    linhas: linhas as LinhaDoSaldo[],
  };
}

/** O que a tela pode oferecer numa linha, segundo o veredito do servidor. */
interface AcoesDaLinha {
  /** Parou (`falhou`/`recusado`) e o servidor diz que nada saiu: pode repetir. */
  podeRepetir: boolean;
  /** Parou e PODE ter saído: só o aviso "não repita". */
  confirmando: boolean;
  /** A espera dos 7 dias passou: "Já devolvi por fora (depois de 7 dias)". */
  porForaAposEspera: boolean;
  /**
   * A linha já foi resolvida por fora: a saída dos 7 dias foi usada
   * (`por_fora_liberado_em`) ou o reembolso manual a substituiu
   * (`substituida_por_manual`).
   */
  jaPorFora: boolean;
}

/**
 * Decide os botões de UMA linha a partir do veredito do servidor. A espera
 * dos 7 dias é do servidor (`por_fora_apos_espera_liberado`): a tela não
 * conta dias com o relógio do aparelho, e quem decide se a saída vale é a
 * porta (a tela mostra a resposta dela). Linha concluída nunca tem ação;
 * linha já resolvida por fora — marca dos 7 dias OU substituída pelo manual
 * — também não, só o aviso: na substituída o `pode_ter_saido = false` é "não
 * conta como dúvida", nunca "o dinheiro não saiu", e "Tentar de novo" ali
 * pagaria o cliente duas vezes.
 */
export function acoesDaLinha(
  linha: Pick<
    LinhaDoSaldo,
    | "status"
    | "pode_ter_saido"
    | "por_fora_liberado_em"
    | "por_fora_apos_espera_liberado"
    | "substituida_por_manual"
  >,
): AcoesDaLinha {
  const jaPorFora =
    linha.por_fora_liberado_em !== null || linha.substituida_por_manual;
  const parada =
    !jaPorFora && (linha.status === "falhou" || linha.status === "recusado");
  return {
    podeRepetir: parada && !linha.pode_ter_saido,
    confirmando: parada && linha.pode_ter_saido,
    porForaAposEspera:
      !jaPorFora &&
      linha.status !== "concluido" &&
      linha.por_fora_apos_espera_liberado,
    jaPorFora,
  };
}
