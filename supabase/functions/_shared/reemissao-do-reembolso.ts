/**
 * A reemissão do reembolso de uma devolução, do lado do servidor (14/10/2026).
 *
 * O banco decide criar × adotar × parar (`reemitir_reembolso_da_devolucao`,
 * migration 20261225000000, só `service_role`, com o ator admin ATUAL). O que
 * ele não consegue é perguntar ao Mercado Pago — e a pergunta TEM de vir antes:
 * recriar a linha sem saber se o dinheiro já saiu paga a cliente duas vezes.
 *
 * Esta função faz a ponte, e só ela:
 *   1. lê a devolução, a linha que a tela mostrava (`refund_esperado`), o pedido
 *      e os ids de reembolso que as OUTRAS linhas do pedido já reivindicaram;
 *   2. consulta o MP (GET) em três respostas (`consultarReembolsoDoPedido`);
 *   3. INDETERMINADA (GET falhou, rede, forma estranha, reembolso sem dono): para
 *      aqui — o banco nem é chamado, nenhuma linha nasce;
 *   4. achou / provou que não existe: entrega ao banco, que confere tudo de novo
 *      SOB TRAVA (estado da linha, valor, prazo, saldo, devolução do painel).
 *
 * Nenhuma regra de decisão do banco é repetida aqui (D3/D8 do laudo). Nunca faz
 * POST: a tentativa nova (`reemitido`) nasce `solicitado` e é executada depois
 * pela ação normal da edge (`{ refund_id }`) ou pelo cron — com a chave dela.
 */

import { type ConsultaDoReembolso, consultarReembolsoDoPedido, type PedidoParaEstorno } from "./estorno.ts";

export type RespostaDaReemissao = { http: number; corpo: Record<string, unknown> };

// deno-lint-ignore no-explicit-any
type ClienteSupabase = any;

const falhaDeLeitura: RespostaDaReemissao = {
  http: 500,
  corpo: { erro: "Não consegui ler a devolução agora. Tente novamente em instantes." },
};

export async function reemitirReembolsoDaDevolucao(args: {
  supabase: ClienteSupabase;
  devolucaoId: string;
  refundEsperado: string;
  /** O admin ATUAL autenticado na requisição (nunca o JWT decodificado). */
  ator: string;
  token: string;
  buscar: typeof fetch;
}): Promise<RespostaDaReemissao> {
  const { supabase, devolucaoId, refundEsperado } = args;

  const { data: devolucao, error: erroDevolucao } = await supabase
    .from("devolucoes")
    .select("id, order_id")
    .eq("id", devolucaoId)
    .maybeSingle();
  if (erroDevolucao) {
    console.error("[reemissao] erro ao ler a devolução:", erroDevolucao);
    return falhaDeLeitura;
  }
  if (!devolucao) return { http: 404, corpo: { erro: "Devolução não encontrada." } };

  const { data: linha, error: erroLinha } = await supabase
    .from("order_refunds")
    .select("id, order_id, amount")
    .eq("id", refundEsperado)
    .maybeSingle();
  if (erroLinha) {
    console.error("[reemissao] erro ao ler a linha de reembolso:", erroLinha);
    return falhaDeLeitura;
  }
  if (!linha) return { http: 404, corpo: { erro: "Reembolso não encontrado." } };
  // A linha que a tela mostrava não é desta devolução: o mesmo vocabulário do banco.
  if (linha.order_id !== devolucao.order_id) {
    return { http: 200, corpo: { resultado: "reembolso_mudou", detalhe: "outra_linha" } };
  }

  const { data: pedido, error: erroPedido } = await supabase
    .from("marketplace_orders")
    .select("id, gateway_payment_id, total, valor_estornado, payment_status, paid_at, status")
    .eq("id", devolucao.order_id)
    .maybeSingle();
  if (erroPedido || !pedido) {
    console.error("[reemissao] erro ao ler o pedido:", erroPedido ?? devolucao.order_id);
    return falhaDeLeitura;
  }

  const { data: reivindicadas, error: erroIds } = await supabase
    .from("order_refunds")
    .select("mp_refund_id")
    .eq("order_id", devolucao.order_id)
    .neq("id", refundEsperado)
    .not("mp_refund_id", "is", null);
  if (erroIds) {
    console.error("[reemissao] erro ao ler os reembolsos já reivindicados:", erroIds);
    return falhaDeLeitura;
  }

  const pedidoParaConsulta: PedidoParaEstorno = {
    id: String(pedido.id),
    gateway_payment_id: String(pedido.gateway_payment_id ?? ""),
    total: Number(pedido.total),
    valor_estornado: Number(pedido.valor_estornado ?? 0),
    payment_status: pedido.payment_status ?? null,
    paid_at: pedido.paid_at ?? null,
    status: String(pedido.status),
  };
  const consulta: ConsultaDoReembolso = await consultarReembolsoDoPedido({
    buscar: args.buscar,
    token: args.token,
    pedido: pedidoParaConsulta,
    valor: Number(linha.amount),
    idsJaReivindicados: (reivindicadas ?? [])
      .map((r: { mp_refund_id: unknown }) => r.mp_refund_id)
      .filter((id: unknown): id is string => typeof id === "string"),
  });
  if (consulta.resultado === "indeterminado") {
    return { http: 200, corpo: { resultado: "indeterminado", detalhe: "consulta_inconclusiva" } };
  }

  const { data, error } = await supabase.rpc("reemitir_reembolso_da_devolucao", {
    p_devolucao_id: devolucaoId,
    p_ator: args.ator,
    p_refund_esperado: refundEsperado,
    p_consulta: consulta,
  });
  if (error) {
    const codigo = String((error as { code?: unknown }).code ?? "");
    const mensagem = String((error as { message?: unknown }).message ?? "");
    if (codigo === "42501") return { http: 403, corpo: { erro: "Não autorizado: apenas administradores reemitem o reembolso." } };
    if (codigo === "P0002") return { http: 404, corpo: { erro: mensagem } };
    if (codigo === "22023") return { http: 409, corpo: { erro: mensagem } };
    console.error("[reemissao] reemitir_reembolso_da_devolucao falhou:", error);
    return { http: 500, corpo: { erro: "Não consegui reemitir o reembolso agora. Tente novamente em instantes." } };
  }
  if (!data || typeof data !== "object" || typeof (data as Record<string, unknown>).resultado !== "string") {
    console.error("[reemissao] resposta ilegível do banco");
    return { http: 500, corpo: { erro: "Resposta inesperada ao reemitir o reembolso." } };
  }
  return { http: 200, corpo: data as Record<string, unknown> };
}
