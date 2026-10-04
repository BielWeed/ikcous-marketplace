/**
 * RECONSULTA PERIÓDICA DA CONTESTAÇÃO (chargeback) PRESA — FASE 2, R3 do Lote A
 * (04/10/2026). Chamada pelo cron `reconciliar-pagamentos` e, para o tópico
 * `topic_chargebacks_wh`, pelo webhook (`recuperarContestacaoPeloCaso`).
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
 * reconsulta no MP e entrega o resultado ao banco pelo MESMO caminho do webhook
 * (`contestacao.ts`): consulta o CASO (`GET /v1/chargebacks/{case_id}`), confere
 * e chama a RPC `registrar_contestacao_no_ledger`, que decide o dinheiro sob a
 * trava do pedido. NENHUMA regra de dinheiro foi copiada para cá: este arquivo
 * só escolhe QUEM reconsultar e QUANDO. Só GET ao MP; nenhum POST.
 *
 * DOIS CAMINHOS, e o segundo só existe com VÍNCULO AUTENTICADO:
 *
 *  1. PELA ORDER (o do webhook): a order reconsultada diz `charged_back` e lista
 *     `transactions.chargebacks[]` -> `registrarContestacao`, que consulta cada
 *     caso e confere caso x pagamento x item.
 *  2. PELO CASO CONHECIDO: a linha já carrega `mp_chargeback_case_id` (gravado
 *     pela RPC a partir de notificação autenticada). Se a order NÃO está mais em
 *     `charged_back`, deixou de listar o CBK, sumiu (404) ou nem existe no
 *     pedido, consulta-se ESSE caso pelo id exato -> `registrarContestacaoConhecida`.
 *     A documentação oficial do MP NÃO diz que estado a order assume depois da
 *     disputa resolvida: a tabela de status só descreve `charged_back` com
 *     `in_process`/`settled`/`reimbursed`; a página de gestão manda reconsultar
 *     o caso por `GET /v1/chargebacks/{id}` e descreve `coverage_applied`
 *     true/false como decisão favorável/contrária ao vendedor. Estado da order
 *     depois da resolução e persistência de `chargebacks[]`: "NÃO DOCUMENTADO",
 *     então a reconsulta NÃO depende de a order continuar em `charged_back`.
 *     Nunca se adivinha o vínculo por valor, tempo ou pagamento: ou o `case_id`
 *     já gravado, ou nada.
 *
 * A IDENTIDADE DO VENDEDOR (`X-Caller-Id`): o `GET /v1/chargebacks/{id}` exige,
 * além do `Authorization`, o seller ID da loja dona do caso
 * (https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/chargebacks/management).
 * `consultarContestacao` só sai com ele. A fonte é `GET /users/me` com o token da
 * PRÓPRIA loja (`resolverVendedorIdDoMp`, `contestacao.ts`): o MP diz quem é o
 * dono do token; uma chamada por execução, só na memória. Sem identidade
 * (rede, 4xx/5xx, id inválido), TODA consulta de caso conserva (sem liberar,
 * sem perder) e avisa o admin uma vez — o que vale também para o webhook.
 *
 * QUEM É RECONSULTADO: linha `sistema` + `em_processamento` + `charged_back`
 * com `updated_at` mais antigo que N. A linha de estorno do APP
 * (`solicitado_por <> 'sistema'`) nunca entra — é do executor de estorno.
 *
 * O PRAZO N = 6 HORAS. O calendário de reenvio (15 min, 30 min, 6 h, depois
 * 48 h e 96 h) vem da página do CHECKOUT PRO
 * (https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/payment-notifications);
 * a página de notificações da Orders API só diz "a cada 15 min, depois o
 * intervalo se amplia", sem números. Adoto o calendário do Checkout Pro como
 * referência:
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
 * a entrega devolve o estado canônico depois de cada decisão, e nada aqui
 * decide com o que foi lido antes.
 *
 * O QUE SÓ CONSERVA — NÃO É RESOLUÇÃO. O app não decide nada e avisa o admin
 * UMA vez (chave estável); a linha gira e a reserva continua travando o saldo
 * até o admin conferir no painel do MP:
 *  - linha SEM vínculo (sem `case_id`) cuja order não está em `charged_back`;
 *  - `charged_back` sem `transactions.chargebacks[]` legível e linha sem vínculo
 *    (a RPC nunca recebe uma identidade que o app teria de inventar);
 *  - cobrança gravada sem order do MP / order 404 / order de outro pedido, sem
 *    vínculo;
 *  - caso ilegível, de outro id ou sem decisão legível;
 *  - o MESMO `case_id` em mais de um pedido (ambíguo: conta TODOS os registros
 *    `sistema` do case_id, de qualquer estado e idade — nem só o lote, nem só
 *    as linhas elegíveis), sem consultar o MP;
 *  - decisão CONTRA a loja no caminho do caso conhecido (dinheiro que sai é
 *    irreversível e aqui não há `chargebacks[]` da order para corroborar);
 *  - linha LEGADA (sem vínculo) ao lado de uma vinculada quando o caminho da
 *    order não rodou: conserva e avisa, nunca gira em silêncio.
 * Reserva presa SEM aviso é exatamente o defeito que esta peça existe para fechar.
 *
 * TÓPICO DA NOTIFICAÇÃO: `topic_chargebacks_wh` traz o id do CASO em `data.id`
 * (não o pedido, e o corpo é forjável sem a assinatura). O webhook usa o id só
 * para achar a linha do ledger que JÁ carrega esse `case_id` — o pedido sai
 * dali, nunca do corpo — e roda o MESMO miolo do cron, sem esperar as 6 h.
 */
import type { AvisarAdminUmaVez } from "./aviso-ao-lojista.ts";
import {
  avisoContestacaoParaConferir,
  type ClienteDoLedger,
  consultarContestacao,
  criarResolvedorDeVendedor,
  lerContestacoesDaOrder,
  registrarContestacao,
  registrarContestacaoConhecida,
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
  /** Decisão ENTREGUE ao banco (a RPC respondeu). */
  reconsultadas: number;
  /** Caso conhecido ainda EM ANÁLISE no MP: nada a entregar, a reserva segue. */
  emAberto: number;
  /** A linha deixou de estar presa entre a lista e a vez dela. */
  resolvidasAntes: number;
  /** NADA decidido (só conserva e avisa o admin uma vez): ver o cabeçalho. */
  conservadas: number;
  /** Falha transitória ou de banco: volta no próximo ciclo. */
  falhas: number;
}

export type DesfechoDaReconsulta = "entregue" | "em_aberto" | "resolvida_antes" | "conservada";

type LinhaPresa = { id: string; idContestacao: string | null; caseId: string | null };

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

/**
 * Os pedidos DISTINTOS cujas linhas do sistema carregam este `case_id`. É a
 * regra única do vínculo: o tópico do webhook e o cron passam por aqui; mais de
 * um pedido = o caso é ambíguo e NADA se adivinha (nem consulta, nem decisão).
 */
async function pedidosComOCaso(supabase: ClienteDaReconsulta, caseId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("order_refunds")
    .select("order_id")
    .eq("solicitado_por", "sistema")
    .eq("mp_chargeback_case_id", caseId);
  if (error) throw error;
  return [
    ...new Set(((data ?? []) as Array<{ order_id?: unknown }>).map((l) => String(l.order_id ?? "")).filter(Boolean)),
  ];
}

/** O aviso de caso ambíguo (mais de um pedido com o mesmo case_id): um por pedido. */
async function avisarCasoAmbiguo(
  avisar: AvisarAdminUmaVez,
  pedidos: string[],
  rotulo: string,
): Promise<void> {
  for (const pedido of pedidos) {
    try {
      await avisar(`contestacao_indefinida:${pedido}:caso_em_mais_de_um_pedido`, avisoContestacaoParaConferir(pedido));
    } catch (erro) {
      console.error(`${rotulo}: aviso do caso em mais de um pedido falhou`, { pedido, erro });
    }
  }
}

function criarReconsultor(args: {
  supabase: ClienteDaReconsulta;
  token: string;
  vendedorId?: string | null;
  fetchImpl?: typeof fetch;
  avisar: AvisarAdminUmaVez;
  agora: () => number;
  rotulo: string;
}) {
  const { supabase, token, fetchImpl, avisar, agora, rotulo } = args;
  // O seller ID vem do `GET /users/me` do PRÓPRIO token (uma vez por execução);
  // `vendedorId` explícito só existe para o teste fixar a identidade.
  const obterVendedor = args.vendedorId !== undefined
    ? () => Promise.resolve(args.vendedorId ?? null)
    : criarResolvedorDeVendedor({ token, fetchImpl });

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

  /**
   * Reconsulta UM pedido. `limiteDeIdade`: só linhas mais velhas que isso (o
   * cron); `caseId`: só a linha desse caso (o tópico `chargebacks` do webhook).
   * FRESH GATE: as linhas são relidas AGORA, com o mesmo critério.
   */
  const reconsultarUm = async (
    orderId: string,
    filtro: { limiteDeIdade?: string; caseId?: string },
  ): Promise<DesfechoDaReconsulta> => {
    let consultaDasLinhas = supabase
      .from("order_refunds")
      .select("id, mp_chargeback_id, mp_chargeback_case_id")
      .eq("order_id", orderId)
      .eq("solicitado_por", "sistema")
      .eq("status", "em_processamento")
      .eq("mp_status", STATUS_DA_CONTESTACAO);
    if (filtro.limiteDeIdade) consultaDasLinhas = consultaDasLinhas.lt("updated_at", filtro.limiteDeIdade);
    if (filtro.caseId) consultaDasLinhas = consultaDasLinhas.eq("mp_chargeback_case_id", filtro.caseId);
    const { data: presasAgora, error: erroPresas } = await consultaDasLinhas;
    if (erroPresas) throw erroPresas;
    const presas = ((presasAgora ?? []) as Array<Record<string, unknown>>).map((l): LinhaPresa => ({
      id: String(l.id),
      idContestacao: textoOuNulo(l.mp_chargeback_id),
      caseId: textoOuNulo(l.mp_chargeback_case_id),
    }));
    if (presas.length === 0) return "resolvida_antes";
    const ids = presas.map((l) => l.id);
    const vinculadas = presas.filter((l) => l.idContestacao !== null && l.caseId !== null);
    const semVinculo = presas.length - vinculadas.length;

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
    const conservar = async (motivo: string): Promise<DesfechoDaReconsulta> => {
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
    const pedido: PedidoParaEstorno = {
      id: String(linhaDoPedido.id),
      gateway_payment_id: idMp,
      total: Number(linhaDoPedido.total),
      valor_estornado: Number(linhaDoPedido.valor_estornado ?? 0),
      payment_status: (linhaDoPedido.payment_status as string | null) ?? null,
      paid_at: (linhaDoPedido.paid_at as string | null) ?? null,
      status: String(linhaDoPedido.status),
    };
    // O MESMO case_id em mais de um pedido: ambíguo. Antes de qualquer consulta
    // ao MP, conserva e avisa (a regra do tópico, no mesmo miolo do cron).
    for (const linha of vinculadas) {
      if ((await pedidosComOCaso(supabase, String(linha.caseId))).length > 1) {
        console.error(`${rotulo}: o mesmo case_id está ligado a mais de um pedido — nada consultado nem decidido`, { orderId });
        return await conservar("caso_em_mais_de_um_pedido");
      }
    }
    const consultarCaso = async (caseId: string) =>
      consultarContestacao({ token, caseId, vendedorId: await obterVendedor(), fetchImpl });

    // A ORDER do MP — quando a cobrança gravada tem uma. Sem ela (clássica,
    // sentinela, vazia), se o MP não a conhece (404) ou se é de outro pedido,
    // `order` fica null e `motivoSemOrder` diz por quê: o caminho pelo caso
    // conhecido ainda funciona; o da order não.
    let order: Record<string, unknown> | null = null;
    let motivoSemOrder: string | null = null;
    if (!idMp || idEhClassico(idMp) || vagaEmVerificacao(idMp)) {
      motivoSemOrder = "sem_order_do_mp";
    } else {
      const consulta = await consultarOrder({ token, orderId: idMp, fetchImpl, corpoNoLog: false });
      if (!consulta.ok) {
        if (consulta.status !== 404) {
          throw new Error(`${rotulo}: consulta da order da contestação presa falhou (status ${consulta.status})`);
        }
        motivoSemOrder = "order_nao_encontrada";
      } else {
        const candidata = consulta.order as Record<string, unknown>;
        // A order devolvida tem de SER a cobrança gravada DESTE pedido — nada
        // se decide sobre o dinheiro de outro (a invariante nº 1 do webhook).
        if (String(candidata.id ?? "") !== idMp || String(candidata.external_reference ?? "") !== orderId) {
          motivoSemOrder = "order_divergente";
        } else {
          order = candidata;
        }
      }
    }
    const statusCru = String(order?.status ?? "");
    const motivoDaOrder = motivoSemOrder ??
      (statusCru === STATUS_DA_CONTESTACAO
        ? "order_sem_chargebacks_legivel"
        : `order_${statusCru.toLowerCase().replace(/[^a-z_]/g, "_").slice(0, 30)}`);

    let entregues = 0;
    let emAberto = 0;
    let conservadas = 0;
    let cbkCobertos: string[] = [];
    let caminhoDaOrderRodou = false;

    // Caminho 1: pela ORDER, quando ela ainda diz `charged_back` (o MESMO
    // gatilho do webhook, status CRU). Se a lista de casos não é legível e a
    // linha TEM vínculo, quem resolve é o caso conhecido (caminho 2); sem
    // vínculo, `registrarContestacao` conserva e avisa — como no webhook.
    if (order && statusCru === STATUS_DA_CONTESTACAO) {
      const leitura = lerContestacoesDaOrder(order);
      if (leitura.ok || vinculadas.length === 0) {
        caminhoDaOrderRodou = true;
        const r = await registrarContestacao({
          supabase,
          orderId,
          corpo: order,
          ehPayments: false,
          pedido,
          consultarCaso,
          avisar,
          rotulo,
        });
        entregues += r.entregues;
        conservadas += r.conservadas;
        if (leitura.ok) cbkCobertos = leitura.itens.map((i) => i.idContestacao);
      }
    }

    // Caminho 2: o CASO CONHECIDO — toda linha vinculada que a order não cobriu
    // (order fora de `charged_back`, sem o CBK na lista, sem order). O id do
    // caso é o GRAVADO na linha: nunca um palpite.
    for (const linha of vinculadas) {
      if (cbkCobertos.includes(String(linha.idContestacao))) continue;
      const r = await registrarContestacaoConhecida({
        supabase,
        orderId,
        idContestacao: String(linha.idContestacao),
        caseId: String(linha.caseId),
        corpoDaOrder: order,
        casosNaOrder: vinculadas.length,
        pedido,
        consultarCaso,
        avisar,
        rotulo,
      });
      if (r === "entregue") entregues++;
      else if (r === "em_aberto") emAberto++;
      else conservadas++;
    }

    // Linha SEM vínculo que o caminho da order não cobriu (order fora de
    // `charged_back`, 404, ou `charged_back` sem lista legível enquanto OUTRA
    // linha do mesmo pedido tem vínculo): não há com o que consultar com
    // segurança. Conserva e AVISA — a linha legada nunca gira em silêncio nem
    // conta como "em aberto". Vale também ao lado de uma linha vinculada.
    if (semVinculo > 0 && !caminhoDaOrderRodou) {
      await conservar(motivoDaOrder); // avisa uma vez e gira todas as linhas do pedido
      return entregues > 0 ? "entregue" : "conservada";
    }

    await girar(ids);
    if (entregues > 0) return "entregue";
    if (conservadas > 0) return "conservada";
    return emAberto > 0 ? "em_aberto" : "conservada";
  };

  return { reconsultarUm };
}

export async function reconsultarContestacoesPresas(args: {
  supabase: ClienteDaReconsulta;
  token: string;
  /** Fixa o seller ID (teste). Ausente (`undefined`): resolve por `GET /users/me`. */
  vendedorId?: string | null;
  fetchImpl?: typeof fetch;
  avisar: AvisarAdminUmaVez;
  /** Relógio injetável (o teste fixa o instante). */
  agora?: () => number;
  prazoMs?: number;
  limitePedidos?: number;
  /** Prefixo dos logs. */
  rotulo?: string;
}): Promise<ResumoDaReconsulta> {
  const { supabase } = args;
  const rotulo = args.rotulo ?? "reconciliar-pagamentos";
  const agora = args.agora ?? Date.now;
  const limiteDeIdade = new Date(agora() - (args.prazoMs ?? PRAZO_DA_RECONSULTA_MS)).toISOString();
  const { reconsultarUm } = criarReconsultor({
    supabase,
    token: args.token,
    vendedorId: args.vendedorId,
    fetchImpl: args.fetchImpl,
    avisar: args.avisar,
    agora,
    rotulo,
  });

  const resumo: ResumoDaReconsulta = {
    vistas: 0,
    reconsultadas: 0,
    emAberto: 0,
    resolvidasAntes: 0,
    conservadas: 0,
    falhas: 0,
  };

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

  for (const orderId of pedidos.slice(0, args.limitePedidos ?? LIMITE_DE_PEDIDOS_POR_CICLO)) {
    resumo.vistas++;
    try {
      const desfecho = await reconsultarUm(orderId, { limiteDeIdade });
      if (desfecho === "entregue") resumo.reconsultadas++;
      else if (desfecho === "em_aberto") resumo.emAberto++;
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

/**
 * O TÓPICO `topic_chargebacks_wh` do webhook (doc do MP: `data.id` = o id do
 * CASO): recupera a contestação pelo MESMO miolo do cron, sem esperar as 6
 * horas. O pedido NÃO sai do corpo da notificação (forjável): sai da linha do
 * ledger que já carrega ESSE `case_id` — o vínculo autenticado.
 *  - 'sem_vinculo': nenhuma linha com esse caso (a reserva nasce da notificação
 *    `order`/`order.charged_back`; nada a recuperar, nada a adivinhar);
 *  - 'ambiguo': o mesmo caso ligado a mais de um pedido — nada se adivinha;
 *  - repetição/duplicata: a linha já resolvida não está mais presa e a entrega
 *    é idempotente ('resolvida_antes', sem RPC);
 *  - falha transitória LANÇA (o webhook devolve 500 e o MP reenvia).
 */
export async function recuperarContestacaoPeloCaso(args: {
  supabase: ClienteDaReconsulta;
  token: string;
  vendedorId?: string | null;
  fetchImpl?: typeof fetch;
  avisar: AvisarAdminUmaVez;
  caseId: string;
  agora?: () => number;
  rotulo?: string;
}): Promise<DesfechoDaReconsulta | "sem_vinculo" | "ambiguo"> {
  const rotulo = args.rotulo ?? "webhook-mercadopago";
  const pedidos = await pedidosComOCaso(args.supabase, args.caseId);
  if (pedidos.length === 0) return "sem_vinculo";
  if (pedidos.length > 1) {
    console.error(`${rotulo}: o mesmo case_id está ligado a mais de um pedido — nada recuperado`, {
      pedidos: pedidos.length,
    });
    await avisarCasoAmbiguo(args.avisar, pedidos, rotulo);
    return "ambiguo";
  }
  const { reconsultarUm } = criarReconsultor({
    supabase: args.supabase,
    token: args.token,
    vendedorId: args.vendedorId,
    fetchImpl: args.fetchImpl,
    avisar: args.avisar,
    agora: args.agora ?? Date.now,
    rotulo,
  });
  return await reconsultarUm(pedidos[0], { caseId: args.caseId });
}
