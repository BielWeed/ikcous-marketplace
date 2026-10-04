/**
 * RECONSULTA PERIÓDICA DA CONTESTAÇÃO (chargeback) PRESA — FASE 2, R3 do Lote A
 * (04/10/2026). Chamada pelo cron `reconciliar-pagamentos`.
 *
 * O DEFEITO: uma reserva de contestação (linha `sistema` em `em_processamento`,
 * `mp_status = 'charged_back'`, criada por `registrar_contestacao_no_ledger`)
 * só se resolve quando o MP NOTIFICA a decisão do caso. Notificação perdida —
 * o MP só reenvia o que NÃO recebeu 2xx; um 200 "conservei e avisei" não se
 * repete — e a reserva trava o saldo do pedido (o lojista não consegue devolver
 * aquele dinheiro) para sempre, sem que nada a olhe de novo. Até hoje a
 * reconciliação IGNORAVA contestação de propósito ("o ledger da contestação é
 * do webhook").
 *
 * O QUE ESTA PEÇA FAZ: para a reserva parada há mais de N (6 h, abaixo),
 * reconsulta a ORDER no MP e entrega o resultado ao banco pelo MESMO caminho do
 * webhook — `registrarContestacao` (`contestacao.ts`), que consulta o CASO
 * (`GET /v1/chargebacks/{case_id}`), confere caso x pagamento x item e chama a
 * RPC `registrar_contestacao_no_ledger`, que decide o dinheiro sob a trava do
 * pedido. NENHUMA regra de dinheiro foi copiada para cá: este arquivo só
 * escolhe QUEM reconsultar e QUANDO. Só GET ao MP; nenhum POST.
 *
 * QUEM É RECONSULTADO: linha `sistema` + `em_processamento` + `charged_back`
 * com `updated_at` mais antigo que N. A linha de estorno do APP
 * (`solicitado_por <> 'sistema'`) nunca entra — é do executor de estorno.
 *
 * O PRAZO N = 6 HORAS. O MP reenvia notificação sem 2xx em 15 min, 30 min e
 * 6 h, depois a cada 48/96 h
 * (https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/payment-notifications):
 * 6 h é o ponto em que a janela rápida de reenvio já passou e a espera pelo
 * MP vira dias. Menos que isso reconsultaria casos que o próprio MP ainda vai
 * entregar; mais deixaria o saldo do lojista preso por um dia útil à toa. O
 * custo é pequeno e limitado: 2 GET (order + caso) por pedido com contestação
 * aberta, a cada 6 h, no máximo 10 pedidos por ciclo de 10 min.
 *
 * O RODÍZIO: reconsultada a reserva, `updated_at` é renovado (UPDATE condicional
 * `status = 'em_processamento'`, como o cron já faz nas linhas de estorno).
 * Caso ainda em análise não muda nada no banco — sem o toque, ele seria
 * reconsultado em TODO ciclo durante semanas e ocuparia a fila inteira. Falha
 * transitória (rede, 429, 5xx, deadlock) NÃO toca: a linha volta no próximo
 * ciclo (10 min), não em 6 h.
 *
 * O FRESH GATE (reler antes de agir): a lista do lote é um retrato velho
 * (o webhook pode concluir ou ajustar a linha entre a lista e a vez dela).
 * Por pedido, ANTES de qualquer chamada ao MP, as linhas presas são relidas
 * com o MESMO critério, inclusive a idade — linha que o webhook acabou de
 * mexer (`updated_at` novo) está viva, não presa. E o pedido é lido de novo:
 * `registrarContestacao` devolve o estado canônico depois de cada decisão, e
 * nada aqui decide com o que foi lido antes.
 *
 * O QUE NÃO É DECIDIDO AQUI (conserva e avisa o admin UMA vez, chave estável,
 * a linha gira): cobrança gravada sem order do MP (clássica, vaga em sentinela
 * ou vazia), order que o MP não conhece (404), order de outra cobrança ou de
 * outro pedido, order que NÃO está mais em `charged_back` (o gatilho é o MESMO
 * do webhook — `STATUS_DA_CONTESTACAO`). Reserva presa SEM aviso é exatamente
 * o defeito que esta peça existe para fechar.
 *
 * TÓPICO DA NOTIFICAÇÃO: o webhook trata `topic_chargebacks_wh` como irrelevante
 * (não traz o pedido) e vai ao ledger quando chega a notificação `order`/
 * `payment` cuja consulta autenticada diz `status = 'charged_back'`. Aqui não
 * há notificação nenhuma: a reconsulta vai direto à ORDER gravada no pedido e
 * aplica o MESMO gatilho — por isso nenhuma das duas portas depende do tópico.
 */
import type { AvisarAdminUmaVez } from "./aviso-ao-lojista.ts";
import {
  avisoContestacaoParaConferir,
  type ClienteDoLedger,
  consultarContestacao,
  registrarContestacao,
  STATUS_DA_CONTESTACAO,
} from "./contestacao.ts";
import type { PedidoParaEstorno } from "./estorno.ts";
import { consultarOrder, idEhClassico, vagaEmVerificacao } from "./mercadopago.ts";

/** N: quanto tempo uma reserva de contestação fica sem movimento antes de o
 * cron reconsultá-la. Justificativa no cabeçalho. */
export const PRAZO_DA_RECONSULTA_MS = 6 * 60 * 60 * 1000;

/** Teto de PEDIDOS por ciclo (2 GET ao MP cada, no mínimo): o cron roda a cada
 * 10 min e não pode virar uma varredura sem limite. */
export const LIMITE_DE_PEDIDOS_POR_CICLO = 10;

/** Teto de LINHAS lidas na lista (um pedido pode ter mais de um caso). */
const LIMITE_DE_LINHAS_NA_LISTA = 50;

export interface ClienteDaReconsulta extends ClienteDoLedger {
  // deno-lint-ignore no-explicit-any
  from(tabela: string): any;
}

export interface ResumoDaReconsulta {
  /** Pedidos considerados neste ciclo. */
  vistas: number;
  /** Decisão entregue ao banco (a RPC respondeu). */
  reconsultadas: number;
  /** A linha deixou de estar presa entre a lista e a vez dela. */
  resolvidasAntes: number;
  /** Nada decidido, admin avisado uma vez (cobrança sem order, 404, order de
   * outro pedido, order fora de `charged_back`). */
  conservadas: number;
  /** Falha transitória ou de banco: volta no próximo ciclo. */
  falhas: number;
}

type Desfecho = "reconsultada" | "resolvida_antes" | "conservada";

export async function reconsultarContestacoesPresas(args: {
  supabase: ClienteDaReconsulta;
  token: string;
  fetchImpl?: typeof fetch;
  avisar: AvisarAdminUmaVez;
  /** Relógio injetável (o teste fixa o instante). */
  agora?: () => number;
  prazoMs?: number;
  limitePedidos?: number;
  /** Prefixo dos logs. */
  rotulo?: string;
}): Promise<ResumoDaReconsulta> {
  const { supabase, token, fetchImpl, avisar } = args;
  const rotulo = args.rotulo ?? "reconciliar-pagamentos";
  const agora = args.agora ?? Date.now;
  const limiteDeIdade = new Date(agora() - (args.prazoMs ?? PRAZO_DA_RECONSULTA_MS)).toISOString();

  const resumo: ResumoDaReconsulta = { vistas: 0, reconsultadas: 0, resolvidasAntes: 0, conservadas: 0, falhas: 0 };

  // A lista do lote — as MAIS ANTIGAS primeiro, para ninguém morrer de fome.
  const { data: lista, error: erroLista } = await supabase
    .from("order_refunds")
    .select("id, order_id, updated_at")
    .eq("solicitado_por", "sistema")
    .eq("status", "em_processamento")
    .eq("mp_status", STATUS_DA_CONTESTACAO)
    .lt("updated_at", limiteDeIdade)
    .order("updated_at", { ascending: true })
    .limit(LIMITE_DE_LINHAS_NA_LISTA);
  if (erroLista) throw erroLista;

  const pedidos: string[] = [];
  for (const linha of (lista ?? []) as Array<{ order_id?: unknown }>) {
    const id = typeof linha.order_id === "string" ? linha.order_id : "";
    if (id && !pedidos.includes(id)) pedidos.push(id);
  }

  /** Renova o `updated_at` das linhas presas deste pedido — o rodízio. Só as
   * que o banco AINDA tem em `em_processamento`; nunca lança. */
  const girar = async (ids: string[]) => {
    for (const id of ids) {
      try {
        const { error } = await supabase
          .from("order_refunds")
          .update({ updated_at: new Date(agora()).toISOString() })
          .eq("id", id)
          .eq("status", "em_processamento");
        if (error) throw error;
      } catch (erro) {
        console.error(
          `${rotulo}: não consegui renovar updated_at da reserva de contestação (volta no próximo ciclo)`,
          { id, erro },
        );
      }
    }
  };

  const reconsultarUm = async (orderId: string): Promise<Desfecho> => {
    // FRESH GATE: as linhas presas DESTE pedido, agora, com o mesmo critério da
    // lista (inclusive a idade).
    const { data: presasAgora, error: erroPresas } = await supabase
      .from("order_refunds")
      .select("id")
      .eq("order_id", orderId)
      .eq("solicitado_por", "sistema")
      .eq("status", "em_processamento")
      .eq("mp_status", STATUS_DA_CONTESTACAO)
      .lt("updated_at", limiteDeIdade);
    if (erroPresas) throw erroPresas;
    const ids = ((presasAgora ?? []) as Array<{ id?: unknown }>).map((l) => String(l.id));
    if (ids.length === 0) return "resolvida_antes";

    const { data: pedidoRow, error: erroPedido } = await supabase
      .from("marketplace_orders")
      .select("id, gateway_payment_id, total, valor_estornado, payment_status, paid_at, status")
      .eq("id", orderId)
      .maybeSingle();
    if (erroPedido) throw erroPedido;
    if (!pedidoRow) throw new Error(`${rotulo}: pedido da contestação presa não encontrado`);
    const linhaDoPedido = pedidoRow as Record<string, unknown>;

    /** Nada decidido: avisa o admin UMA vez (chave estável por pedido+motivo) e
     * gira a linha — fica para daqui a N, sem sumir em silêncio. */
    const conservar = async (motivo: string): Promise<Desfecho> => {
      console.error(
        `${rotulo}: contestação presa que o app não consegue reconsultar sozinho — reserva CONSERVADA, nada decidido`,
        { orderId, motivo },
      );
      try {
        await avisar(`contestacao_indefinida:${orderId}:${motivo}`, avisoContestacaoParaConferir(orderId));
      } catch (erro) {
        console.error(`${rotulo}: aviso da contestação presa falhou`, { orderId, erro });
      }
      await girar(ids);
      return "conservada";
    };

    const idMp = typeof linhaDoPedido.gateway_payment_id === "string" ? linhaDoPedido.gateway_payment_id : "";
    if (!idMp || idEhClassico(idMp) || vagaEmVerificacao(idMp)) {
      return await conservar("sem_order_do_mp");
    }

    const consulta = await consultarOrder({ token, orderId: idMp, fetchImpl, corpoNoLog: false });
    if (!consulta.ok) {
      if (consulta.status === 404) return await conservar("order_nao_encontrada");
      throw new Error(`${rotulo}: consulta da order da contestação presa falhou (status ${consulta.status})`);
    }
    const order = consulta.order as Record<string, unknown>;

    // A order devolvida tem de SER a cobrança gravada DESTE pedido — nada se
    // decide sobre o dinheiro de outro (a invariante nº 1 do webhook).
    if (String(order.id ?? "") !== idMp || String(order.external_reference ?? "") !== orderId) {
      return await conservar("order_divergente");
    }

    // O MESMO gatilho do webhook (`STATUS_DA_CONTESTACAO`, status CRU da order).
    const statusCru = String(order.status ?? "");
    if (statusCru !== STATUS_DA_CONTESTACAO) {
      return await conservar(`order_${statusCru.toLowerCase().replace(/[^a-z_]/g, "_").slice(0, 30)}`);
    }

    const pedido: PedidoParaEstorno = {
      id: String(linhaDoPedido.id),
      gateway_payment_id: idMp,
      total: Number(linhaDoPedido.total),
      valor_estornado: Number(linhaDoPedido.valor_estornado ?? 0),
      payment_status: (linhaDoPedido.payment_status as string | null) ?? null,
      paid_at: (linhaDoPedido.paid_at as string | null) ?? null,
      status: String(linhaDoPedido.status),
    };

    // O caminho do webhook, inteiro: consulta cada caso, confere, e a RPC
    // decide o dinheiro. Falha transitória LANÇA (o mesmo contrato do webhook:
    // lá o MP reenvia; aqui o próximo ciclo repete).
    await registrarContestacao({
      supabase,
      orderId,
      corpo: order,
      ehPayments: false,
      pedido,
      consultarCaso: (caseId) => consultarContestacao({ token, caseId, fetchImpl }),
      avisar,
      rotulo,
    });

    await girar(ids);
    return "reconsultada";
  };

  for (const orderId of pedidos.slice(0, args.limitePedidos ?? LIMITE_DE_PEDIDOS_POR_CICLO)) {
    resumo.vistas++;
    try {
      const desfecho = await reconsultarUm(orderId);
      if (desfecho === "reconsultada") resumo.reconsultadas++;
      else if (desfecho === "resolvida_antes") resumo.resolvidasAntes++;
      else resumo.conservadas++;
    } catch (erro) {
      // Um pedido não custa a vez do seguinte; a linha NÃO é tocada, então
      // volta já no próximo ciclo.
      console.error(`${rotulo}: reconsulta da contestação presa falhou — o próximo ciclo repete`, { orderId, erro });
      resumo.falhas++;
    }
  }
  return resumo;
}
