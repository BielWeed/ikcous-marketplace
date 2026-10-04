// @ts-nocheck
/**
 * RECONSULTA PERIÓDICA DA CONTESTAÇÃO PRESA (FASE 2, R3 do Lote A, 04/10/2026).
 *
 * Uma reserva de contestação (linha `sistema` em `em_processamento`) só se
 * resolve quando o MP notifica a decisão. Sem notificação nova, ela trava o
 * saldo do pedido para sempre. `reconsultarContestacoesPresas` (chamada pelo
 * cron) reconsulta o MP e entrega o resultado ao banco pelo MESMO caminho do
 * webhook (`registrarContestacao`, `contestacao.ts`).
 *
 * Nada aqui toca rede nem banco: o cliente Supabase e o MP são dublês. A regra
 * de dinheiro mora na RPC `registrar_contestacao_no_ledger` (provada em
 * `tests/banco/contestacao-viva.cjs`); aqui se prova QUEM chama, QUANDO, com o
 * quê, e o que acontece quando o MP responde mal.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  LIMITE_DE_PEDIDOS_POR_CICLO,
  PRAZO_DA_RECONSULTA_MS,
  reconsultarContestacoesPresas,
} from "./reconsulta-de-contestacao.ts";

const VENDEDOR = "1234567";
const AGORA = Date.parse("2026-10-04T12:00:00.000Z");
const HORA = 60 * 60 * 1000;
const PEDIDO_A = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const PEDIDO_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORDER_A = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
const ORDER_B = "ORDTST01KZZ4D94WC79335A68CZ5NZ7Y";

const ha = (horas: number) => new Date(AGORA - horas * HORA).toISOString();

type Linha = { id: string; order_id: string; updated_at: string; status?: string };

function linhaPresa(id: string, orderId: string, horas: number): Linha {
  return {
    id,
    order_id: orderId,
    updated_at: ha(horas),
    status: "em_processamento",
    solicitado_por: "sistema",
    mp_status: "charged_back",
  };
}

/**
 * Banco dublê: `order_refunds` é uma lista VIVA (o teste a muta entre as
 * leituras para provar o "fresh gate"); os filtros `eq`/`lt` são SIMULADOS de
 * verdade (um filtro que a produção deixar de pedir muda o resultado).
 */
function banco(opts: {
  linhas: Array<Record<string, unknown>>;
  pedidos?: Record<string, Record<string, unknown> | null>;
  rpc?: (nome: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
  erroToque?: boolean;
  /** Chamado logo DEPOIS de a lista do lote ser lida (a 1ª leitura de
   * `order_refunds`) — simula o webhook mexendo no banco entre a lista e a vez. */
  aposALista?: () => void;
}) {
  const registro = {
    selecoes: [] as Array<{ colunas: string; filtros: Array<[string, string, unknown]> }>,
    toques: [] as Array<{ id: unknown; valores: Record<string, unknown>; filtros: Array<[string, unknown]> }>,
    rpcs: [] as Array<{ nome: string; args: Record<string, unknown> }>,
    leiturasDePedido: [] as string[],
  };
  const construtor = (colunas: string) => {
    const filtros: Array<[string, string, unknown]> = [];
    let teto = Infinity;
    let ordem: { coluna: string; asc: boolean } | null = null;
    const resolver = () => {
      registro.selecoes.push({ colunas, filtros: [...filtros] });
      const primeira = registro.selecoes.length === 1;
      let r = opts.linhas.filter((l) =>
        filtros.every(([op, coluna, valor]) =>
          op === "eq" ? Reflect.get(l, coluna) === valor : String(Reflect.get(l, coluna)) < String(valor)
        )
      );
      if (ordem) {
        const { coluna, asc } = ordem;
        r = [...r].sort((a, b) => (String(Reflect.get(a, coluna)) < String(Reflect.get(b, coluna)) ? (asc ? -1 : 1) : asc ? 1 : -1));
      }
      const saida = { data: r.slice(0, teto).map((l) => ({ ...l })), error: null };
      if (primeira) opts.aposALista?.();
      return saida;
    };
    const q = {
      eq(coluna: string, valor: unknown) {
        filtros.push(["eq", coluna, valor]);
        return q;
      },
      lt(coluna: string, valor: unknown) {
        filtros.push(["lt", coluna, valor]);
        return q;
      },
      order(coluna: string, o?: { ascending?: boolean }) {
        ordem = { coluna, asc: o?.ascending ?? true };
        return q;
      },
      limit(n: number) {
        teto = n;
        return q;
      },
      then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
        return Promise.resolve(resolver()).then(res, rej);
      },
    };
    return q;
  };
  return {
    registro,
    from(tabela: string) {
      if (tabela === "order_refunds") {
        return {
          select: (colunas: string) => construtor(colunas),
          update(valores: Record<string, unknown>) {
            const filtros: Array<[string, unknown]> = [];
            const q = {
              eq(coluna: string, valor: unknown) {
                filtros.push([coluna, valor]);
                return q;
              },
              then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
                registro.toques.push({ id: filtros.find(([c]) => c === "id")?.[1], valores, filtros: [...filtros] });
                if (opts.erroToque) return Promise.resolve({ data: null, error: { message: "falhou" } }).then(res, rej);
                for (const l of opts.linhas) {
                  if (filtros.every(([c, v]) => Reflect.get(l, c) === v)) Object.assign(l, valores);
                }
                return Promise.resolve({ data: null, error: null }).then(res, rej);
              },
            };
            return q;
          },
        };
      }
      if (tabela === "marketplace_orders") {
        return {
          select: (_c: string) => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: () => {
                registro.leiturasDePedido.push(id);
                const p = opts.pedidos ? Reflect.get(opts.pedidos, id) : undefined;
                return Promise.resolve({ data: p === undefined ? null : p, error: null });
              },
            }),
          }),
        };
      }
      throw new Error(`from inesperado no dublê: ${tabela}`);
    },
    rpc(nome: string, args: Record<string, unknown>) {
      registro.rpcs.push({ nome, args });
      const r = opts.rpc?.(nome, args) ?? { data: { resultado: "ja_reservado", aviso: null, valor_estornado: 0 }, error: null };
      return Promise.resolve(r);
    },
  };
}

const pedidoDe = (orderMp: string, extra: Record<string, unknown> = {}) => ({
  id: PEDIDO_A,
  gateway_payment_id: orderMp,
  total: 149.9,
  valor_estornado: 0,
  payment_status: "pago",
  paid_at: "2026-10-01T00:00:00Z",
  status: "paid",
  ...extra,
});

/** A order do MP contestada, com UM caso (CBK) e o status do pagamento contestado. */
function orderContestada(over: Record<string, unknown> = {}) {
  const {
    id = ORDER_A,
    ref = PEDIDO_A,
    status = "charged_back",
    detalhePagamento = "in_process",
    chargebacks = [{ id: "CBK1", case_id: "CASE1", transaction_id: "PAY1", status: "" }],
  } = over as Record<string, unknown>;
  return {
    id,
    status,
    status_detail: detalhePagamento,
    external_reference: ref,
    total_amount: "149.90",
    transactions: {
      payments: [{ id: "PAY1", amount: "149.90", status: "charged_back", status_detail: detalhePagamento }],
      chargebacks,
    },
  };
}

const casoDoMp = (id: string, coverage: boolean | null, amount = 149.9) => ({
  id,
  amount,
  currency: "BRL",
  coverage_applied: coverage,
});

/** MP dublê: GET /v1/orders/{id} e GET /v1/chargebacks/{case}. */
function mp(opts: {
  orders?: Record<string, { status: number; corpo?: unknown }>;
  casos?: Record<string, { status: number; corpo?: unknown }>;
}) {
  const chamadas: string[] = [];
  const authorization: string[] = [];
  const fetchImpl = (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    chamadas.push(u);
    authorization.push(String((init?.headers as Record<string, string>)?.Authorization));
    // Contrato do MP: o GET do caso exige Authorization da loja E X-Caller-Id.
    if (u.includes("/v1/chargebacks/") && (init?.headers as Record<string, string>)?.["X-Caller-Id"] !== VENDEDOR) {
      return Promise.resolve(new Response("{}", { status: 403 }));
    }
    const o = u.match(/\/v1\/orders\/([^/?]+)$/);
    const c = u.match(/\/v1\/chargebacks\/([^/?]+)$/);
    const alvo = o ? Reflect.get(opts.orders ?? {}, o[1]) : c ? Reflect.get(opts.casos ?? {}, c[1]) : undefined;
    if (!alvo) return Promise.resolve(new Response("{}", { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(alvo.corpo ?? {}), { status: alvo.status }));
  };
  return { fetchImpl, chamadas, authorization };
}

async function rodar(
  b: ReturnType<typeof banco>,
  m: ReturnType<typeof mp>,
  extra: Record<string, unknown> = {},
) {
  const avisos: Array<{ chave: string; aviso: { title: string; body: string; url: string } }> = [];
  const erros: string[] = [];
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = (...a: unknown[]) => erros.push(a.map(String).join(" "));
  console.warn = () => {};
  console.log = () => {};
  try {
    const resumo = await reconsultarContestacoesPresas({
      supabase: b,
      token: "token-do-lojista",
      vendedorId: VENDEDOR,
      fetchImpl: m.fetchImpl,
      avisar: (chave, aviso) => {
        avisos.push({ chave, aviso });
        return Promise.resolve();
      },
      agora: () => AGORA,
      ...extra,
    });
    return { resumo, avisos, erros };
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
}

const rpcsDoLedger = (b: ReturnType<typeof banco>) => b.registro.rpcs.filter((r) => r.nome === "registrar_contestacao_no_ledger");

// ── o prazo ───────────────────────────────────────────────────────────────

Deno.test("N = 6 horas (o intervalo em que o MP já desistiu de reenviar a notificação perdida)", () => {
  assertEquals(PRAZO_DA_RECONSULTA_MS, 6 * HORA);
});

// ── o caminho feliz: a notificação que nunca veio ─────────────────────────

Deno.test("reserva presa há 7 h, o caso foi ganho pela loja: o cron reconsulta e entrega ao banco a decisão, pelo MESMO RPC do webhook", async () => {
  const b = banco({
    linhas: [linhaPresa("L1", PEDIDO_A, 7)],
    pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) },
  });
  const m = mp({
    orders: { [ORDER_A]: { status: 200, corpo: orderContestada({ detalhePagamento: "reimbursed" }) } },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", true) } },
  });
  const r = await rodar(b, m);

  assertEquals(rpcsDoLedger(b).length, 1);
  assertEquals(rpcsDoLedger(b)[0].args, {
    p_order_id: PEDIDO_A,
    p_mp_chargeback_id: "CBK1",
    p_case_id: "CASE1",
    p_decisao: "a_favor_da_loja",
    p_valor_caso: 149.9,
    p_valor_estimado: 149.9,
    p_casos_na_order: 1,
  });
  assertEquals(r.resumo, { vistas: 1, reconsultadas: 1, emAberto: 0, resolvidasAntes: 0, conservadas: 0, falhas: 0 });
  assertEquals(r.avisos, []);
  assertEquals(m.authorization.every((a) => a === "Bearer token-do-lojista"), true);
  assertEquals(m.chamadas.map((u) => u.split("/").slice(-2).join("/")), ["orders/" + ORDER_A, "chargebacks/CASE1"]);
});

Deno.test("reserva presa, decisão CONTRA a loja: a decisão 'contra_a_loja' chega ao banco com o valor do caso", async () => {
  const b = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 7)], pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) } });
  const m = mp({
    orders: { [ORDER_A]: { status: 200, corpo: orderContestada({ detalhePagamento: "settled" }) } },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", false, 100) } },
  });
  await rodar(b, m);
  const args = rpcsDoLedger(b)[0].args;
  assertEquals([args.p_decisao, args.p_valor_caso], ["contra_a_loja", 100]);
});

// ── "aberta há mais de N tempo" ───────────────────────────────────────────

Deno.test("reserva de 5 h 59 min: NÃO é reconsultada (nenhuma chamada ao MP, nenhuma RPC); de 6 h 01 min: é", async () => {
  const jovem = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 5.98)], pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) } });
  const m1 = mp({ orders: { [ORDER_A]: { status: 200, corpo: orderContestada() } } });
  const r1 = await rodar(jovem, m1);
  assertEquals(m1.chamadas, []);
  assertEquals(jovem.registro.rpcs, []);
  assertEquals(r1.resumo.vistas, 0);

  const velha = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 6.02)], pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) } });
  const m2 = mp({
    orders: { [ORDER_A]: { status: 200, corpo: orderContestada() } },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", null) } },
  });
  await rodar(velha, m2);
  assertEquals(rpcsDoLedger(velha).length, 1);
});

Deno.test("só entram linhas do SISTEMA, em_processamento e de contestação (mp_status 'charged_back'): o estorno do app e a linha concluída ficam de fora", async () => {
  const b = banco({
    linhas: [
      linhaPresa("L-ok", PEDIDO_A, 7),
      { ...linhaPresa("L-app", PEDIDO_A, 9), solicitado_por: "lojista" },
      { ...linhaPresa("L-fim", PEDIDO_A, 9), status: "concluido" },
      { ...linhaPresa("L-refund", PEDIDO_A, 9), mp_status: "refunded" },
    ],
    pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) },
  });
  const m = mp({
    orders: { [ORDER_A]: { status: 200, corpo: orderContestada() } },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", null) } },
  });
  const r = await rodar(b, m);
  assertEquals(r.resumo.vistas, 1);
  const lote = b.registro.selecoes[0].filtros;
  assert(lote.some(([op, c, v]) => op === "eq" && c === "solicitado_por" && v === "sistema"));
  assert(lote.some(([op, c, v]) => op === "eq" && c === "status" && v === "em_processamento"));
  assert(lote.some(([op, c, v]) => op === "eq" && c === "mp_status" && v === "charged_back"));
});

// ── o rodízio: o que ainda está em análise não é reconsultado a cada ciclo ─

Deno.test("caso ainda EM ANÁLISE: a decisão chega ao banco e a linha é 'tocada' (updated_at = agora) — só volta daqui a 6 h, e a fila gira", async () => {
  const b = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 7)], pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) } });
  const m = mp({
    orders: { [ORDER_A]: { status: 200, corpo: orderContestada() } },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", null) } },
  });
  const antes = Date.now();
  await rodar(b, m);
  assertEquals(rpcsDoLedger(b)[0].args.p_decisao, "em_analise");
  assertEquals(b.registro.toques.length, 1);
  assertEquals(b.registro.toques[0].id, "L1");
  // O relógio é o do CRON (`agora()`), não o da máquina do teste.
  assertEquals(b.registro.toques[0].valores.updated_at, new Date(AGORA).toISOString());
  assert(antes > 0);
  // O toque é CONDICIONAL: linha que o banco já concluiu/liberou no meio não é tocada.
  assert(b.registro.toques[0].filtros.some(([c, v]) => c === "status" && v === "em_processamento"));

  // Segundo ciclo, 10 min depois: a linha tocada é jovem — ninguém vai ao MP.
  const m2 = mp({});
  const r2 = await rodar(b, m2, { agora: () => AGORA + 10 * 60 * 1000 });
  assertEquals(r2.resumo.vistas, 0);
  assertEquals(m2.chamadas, []);
});

// ── "sem decidir com retrato velho" ───────────────────────────────────────

Deno.test("FRESH GATE: a linha foi concluída pelo webhook ENTRE a lista e a vez dela -> nenhuma chamada ao MP, nenhuma RPC", async () => {
  const linhas = [linhaPresa("L1", PEDIDO_A, 7)];
  // O webhook conclui a linha no instante em que o cron já listou e ainda não
  // chegou à vez dela.
  const b = banco({
    linhas,
    pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) },
    aposALista: () => {
      linhas[0].status = "concluido";
    },
  });
  const m = mp({ orders: { [ORDER_A]: { status: 200, corpo: orderContestada() } } });
  const r = await rodar(b, m);
  assertEquals(m.chamadas, [], "decidir com a lista velha reconsultaria o MP à toa");
  assertEquals(b.registro.rpcs, []);
  assertEquals(r.resumo.resolvidasAntes, 1);
});

Deno.test("FRESH GATE (idade): o webhook TOCOU a linha (updated_at = agora) entre a lista e a vez dela -> a linha está viva, não presa: nenhuma chamada ao MP, nenhuma RPC", async () => {
  const linhas = [linhaPresa("L1", PEDIDO_A, 7)];
  const b = banco({
    linhas,
    pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) },
    aposALista: () => {
      linhas[0].updated_at = ha(0.01);
    },
  });
  const m = mp({ orders: { [ORDER_A]: { status: 200, corpo: orderContestada() } } });
  const r = await rodar(b, m);
  assertEquals([m.chamadas, b.registro.rpcs, r.resumo.resolvidasAntes], [[], [], 1]);
});

Deno.test("o estado é RELIDO depois de cada mutação: o pedido e as linhas são lidos de novo para cada pedido (nunca um retrato único do lote)", async () => {
  const b = banco({
    linhas: [linhaPresa("L1", PEDIDO_A, 9), linhaPresa("L2", PEDIDO_B, 8)],
    pedidos: {
      [PEDIDO_A]: pedidoDe(ORDER_A),
      [PEDIDO_B]: pedidoDe(ORDER_B, { id: PEDIDO_B }),
    },
  });
  const m = mp({
    orders: {
      [ORDER_A]: { status: 200, corpo: orderContestada() },
      [ORDER_B]: { status: 200, corpo: orderContestada({ id: ORDER_B, ref: PEDIDO_B }) },
    },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", null) } },
  });
  await rodar(b, m);
  assertEquals(b.registro.leiturasDePedido, [PEDIDO_A, PEDIDO_B]);
  // 1 lista do lote + 1 releitura por pedido
  assertEquals(b.registro.selecoes.length, 3);
  assertEquals(rpcsDoLedger(b).map((r) => r.args.p_order_id), [PEDIDO_A, PEDIDO_B]);
});

// ── o MP responde mal ─────────────────────────────────────────────────────

Deno.test("falha TRANSITÓRIA no GET do caso (503): nenhuma RPC, a linha NÃO é tocada (volta no próximo ciclo) e o outro pedido segue", async () => {
  const b = banco({
    linhas: [linhaPresa("L1", PEDIDO_A, 9), linhaPresa("L2", PEDIDO_B, 8)],
    pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A), [PEDIDO_B]: pedidoDe(ORDER_B, { id: PEDIDO_B }) },
  });
  const m = mp({
    orders: {
      [ORDER_A]: { status: 200, corpo: orderContestada() },
      [ORDER_B]: { status: 200, corpo: orderContestada({ id: ORDER_B, ref: PEDIDO_B, chargebacks: [{ id: "CBK2", case_id: "CASE2", transaction_id: "PAY1", status: "" }] }) },
    },
    casos: { CASE1: { status: 503 }, CASE2: { status: 200, corpo: casoDoMp("CASE2", null) } },
  });
  const r = await rodar(b, m);
  assertEquals(r.resumo, { vistas: 2, reconsultadas: 1, emAberto: 0, resolvidasAntes: 0, conservadas: 0, falhas: 1 });
  assertEquals(rpcsDoLedger(b).map((x) => x.args.p_order_id), [PEDIDO_B]);
  assertEquals(b.registro.toques.map((t) => t.id), ["L2"], "só a linha resolvida gira; a que falhou volta no próximo ciclo");
});

Deno.test("GET da order falha (503): falha contada, nada decidido, linha NÃO tocada", async () => {
  const b = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 7)], pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) } });
  const m = mp({ orders: { [ORDER_A]: { status: 503 } } });
  const r = await rodar(b, m);
  assertEquals([r.resumo.falhas, b.registro.rpcs.length, b.registro.toques.length], [1, 0, 0]);
});

Deno.test("order NÃO EXISTE no MP (404): nada decidido, o admin é avisado UMA vez (chave estável) e a linha gira", async () => {
  const b = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 7)], pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) } });
  const r = await rodar(b, mp({}));
  assertEquals(b.registro.rpcs, []);
  assertEquals(r.avisos.map((a) => a.chave), [`contestacao_indefinida:${PEDIDO_A}:order_nao_encontrada`]);
  assertEquals(b.registro.toques.length, 1);
  assertEquals([r.resumo.conservadas, r.resumo.falhas], [1, 0]);
});

Deno.test("a order do MP NÃO está mais em 'charged_back': nada decidido (o gatilho é o MESMO do webhook), aviso uma vez, a linha gira", async () => {
  const b = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 7)], pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) } });
  const m = mp({ orders: { [ORDER_A]: { status: 200, corpo: orderContestada({ status: "refunded" }) } } });
  const r = await rodar(b, m);
  assertEquals(b.registro.rpcs, []);
  assertEquals(m.chamadas.length, 1, "nenhum GET de caso: não há caso a ler");
  assertEquals(r.avisos.map((a) => a.chave), [`contestacao_indefinida:${PEDIDO_A}:order_refunded`]);
  assertEquals(b.registro.toques.length, 1);
});

Deno.test("a order devolvida é de OUTRO pedido (external_reference diverge): nenhuma RPC — nada se decide sobre o dinheiro de outro", async () => {
  const b = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 7)], pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) } });
  const m = mp({ orders: { [ORDER_A]: { status: 200, corpo: orderContestada({ ref: PEDIDO_B }) } } });
  const r = await rodar(b, m);
  assertEquals(b.registro.rpcs, []);
  assertEquals(r.avisos.length, 1);
});

Deno.test("pedido com a cobrança gravada CLÁSSICA (numérica) ou em SENTINELA: sem order do MP para reconsultar — nada decidido, aviso, nenhuma chamada ao MP", async () => {
  for (const vaga of ["123456789", "verificando:abc:c0", null, ""]) {
    const b = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 7)], pedidos: { [PEDIDO_A]: pedidoDe(vaga) } });
    const m = mp({});
    const r = await rodar(b, m);
    assertEquals(m.chamadas, [], String(vaga));
    assertEquals(b.registro.rpcs, [], String(vaga));
    assertEquals(r.avisos.length, 1, String(vaga));
  }
});

Deno.test("pedido SUMIU do banco: falha contada, nada decidido", async () => {
  const b = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 7)], pedidos: { [PEDIDO_A]: null } });
  const r = await rodar(b, mp({}));
  assertEquals([r.resumo.falhas, b.registro.rpcs.length], [1, 0]);
});

Deno.test("a RPC do ledger FALHA (erro de banco): falha contada, linha NÃO tocada, o próximo ciclo repete", async () => {
  const b = banco({
    linhas: [linhaPresa("L1", PEDIDO_A, 7)],
    pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) },
    rpc: () => ({ data: null, error: { message: "deadlock detected" } }),
  });
  const m = mp({
    orders: { [ORDER_A]: { status: 200, corpo: orderContestada() } },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", null) } },
  });
  const r = await rodar(b, m);
  assertEquals([r.resumo.falhas, b.registro.toques.length], [1, 0]);
});

Deno.test("o toque que FALHA só loga: o resumo e a decisão já entregue não mudam", async () => {
  const b = banco({ linhas: [linhaPresa("L1", PEDIDO_A, 7)], pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) }, erroToque: true });
  const m = mp({
    orders: { [ORDER_A]: { status: 200, corpo: orderContestada() } },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", null) } },
  });
  const r = await rodar(b, m);
  assertEquals([r.resumo.reconsultadas, r.resumo.falhas], [1, 0]);
  assert(r.erros.some((e) => e.includes("updated_at")), r.erros.join("\n"));
});

// ── forma ─────────────────────────────────────────────────────────────────

Deno.test("dois CBK na MESMA order (duas linhas presas): UM GET da order, DOIS GET de caso, uma RPC por caso, as duas linhas giram", async () => {
  const b = banco({
    linhas: [linhaPresa("L1", PEDIDO_A, 9), linhaPresa("L2", PEDIDO_A, 8)],
    pedidos: { [PEDIDO_A]: pedidoDe(ORDER_A) },
  });
  const m = mp({
    orders: {
      [ORDER_A]: {
        status: 200,
        corpo: orderContestada({
          chargebacks: [
            { id: "CBK1", case_id: "CASE1", transaction_id: "PAY1", status: "" },
            { id: "CBK2", case_id: "CASE2", transaction_id: "PAY1", status: "" },
          ],
        }),
      },
    },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", null) }, CASE2: { status: 200, corpo: casoDoMp("CASE2", null) } },
  });
  const r = await rodar(b, m);
  assertEquals(m.chamadas.filter((u) => u.includes("/v1/orders/")).length, 1);
  assertEquals(m.chamadas.filter((u) => u.includes("/v1/chargebacks/")).length, 2);
  assertEquals(rpcsDoLedger(b).map((x) => x.args.p_mp_chargeback_id), ["CBK1", "CBK2"]);
  assertEquals(rpcsDoLedger(b).map((x) => x.args.p_casos_na_order), [2, 2]);
  assertEquals(b.registro.toques.map((t) => t.id).sort(), ["L1", "L2"]);
  assertEquals(r.resumo.vistas, 1, "conta PEDIDOS, não linhas");
});

Deno.test(`no máximo ${LIMITE_DE_PEDIDOS_POR_CICLO} pedidos por ciclo: o cron não vira uma varredura sem teto, e os mais antigos vão primeiro`, async () => {
  const linhas = [];
  const pedidos = {};
  const orders = {};
  for (let i = 0; i < LIMITE_DE_PEDIDOS_POR_CICLO + 5; i++) {
    const idPedido = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const idOrder = `ORDTST${String(i).padStart(6, "0")}`;
    linhas.push(linhaPresa(`L${i}`, idPedido, 100 - i)); // i=0 é a mais antiga
    Reflect.set(pedidos, idPedido, pedidoDe(idOrder, { id: idPedido }));
    Reflect.set(orders, idOrder, { status: 200, corpo: orderContestada({ id: idOrder, ref: idPedido }) });
  }
  const b = banco({ linhas, pedidos });
  const m = mp({ orders, casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", null) } } });
  const r = await rodar(b, m);
  assertEquals(r.resumo.vistas, LIMITE_DE_PEDIDOS_POR_CICLO);
  assertEquals(rpcsDoLedger(b).map((x) => x.args.p_order_id)[0], "00000000-0000-4000-8000-000000000000");
});

Deno.test("nenhuma linha presa: nenhuma chamada a lugar nenhum além da lista", async () => {
  const b = banco({ linhas: [] });
  const m = mp({});
  const r = await rodar(b, m);
  assertEquals(r.resumo, { vistas: 0, reconsultadas: 0, emAberto: 0, resolvidasAntes: 0, conservadas: 0, falhas: 0 });
  assertEquals([m.chamadas, b.registro.rpcs, b.registro.leiturasDePedido], [[], [], []]);
});

Deno.test("a lista de linhas presas falha: lança (o cron registra e segue; o resultado dos PAGAMENTOS já foi dado)", async () => {
  const b = banco({ linhas: [] });
  const quebrado = {
    ...b,
    from: () => ({
      select: () => ({
        eq() {
          return this;
        },
        lt() {
          return this;
        },
        order() {
          return this;
        },
        limit: () => Promise.resolve({ data: null, error: { message: "timeout" } }),
      }),
    }),
  };
  let lancou = false;
  try {
    await rodar(quebrado, mp({}));
  } catch (_e) {
    lancou = true;
  }
  assertEquals(lancou, true);
});
