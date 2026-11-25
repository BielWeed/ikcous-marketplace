// @ts-nocheck
/**
 * Caça por mutação (25/11/2026, segunda rodada) em `reconsulta-de-contestacao.ts`
 * (o cron e o tópico do webhook que reconsultam uma contestação que travou o saldo
 * de um pedido). Depois das suítes `reconsulta-*_test.ts` ainda sobreviviam:
 *
 *   * o TAMANHO da lista do cron (50 linhas) e os filtros de cada consulta: o cron
 *     filtra por idade (`updated_at < limite`) e NUNCA por caso; o tópico do webhook
 *     filtra pelo caso e NUNCA por idade (um `lt(..., undefined)` vazaria);
 *   * erro do banco ao reler as linhas presas: o pedido conta como FALHA, nunca como
 *     "resolvida antes" (reserva presa que some sem decisão);
 *   * id de contestação e de caso de UM caractere é vínculo válido (não "sem vínculo");
 *   * linha sem vínculo e sem order do MP: o aviso nasce com o motivo `sem_order_do_mp`
 *     e o desfecho é `conservada`;
 *   * o desfecho `ambiguo` quando o mesmo caso aparece em outro pedido ENTRE a guarda do
 *     tópico e a do miolo (a corrida);
 *   * falha da consulta da order no TÓPICO do webhook não carimba linha nenhuma (só o
 *     cron gira a fila).
 *
 * Equivalentes explicados (sem teste): o `throw` dentro do `catch` do rodízio e
 * `valor_estornado ?? 0` do pedido (só é escrito, nunca lido, neste módulo); o retorno
 * de `conservar` (ninguém o lê); a erro de leitura do PEDIDO (sem o `throw`, a linha
 * ausente lança do mesmo jeito logo depois); e a cauda `emAberto > 0 ? ... :
 * "conservada"` do fim do pedido, inalcançável: toda linha vinculada vira entregue,
 * conservada ou em aberto, e sem vínculo cai antes no ramo que avisa.
 *
 * O banco é um dublê que REGISTRA cada pergunta (tabela, colunas, filtros);
 * fixtures inventadas; nenhuma rede, nenhum banco real.
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  reconsultarContestacoesPresas,
  recuperarContestacaoPeloCaso,
} from "./reconsulta-de-contestacao.ts";

const VENDEDOR = "1234567";
const AGORA = Date.parse("2026-10-04T12:00:00.000Z");
const LIMITE_DO_CRON = "2026-10-04T06:00:00.000Z"; // agora menos as 6 h do prazo
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const ORDER_MP = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";

function linhaDoPedido(extra: Record<string, unknown> = {}) {
  return {
    id: PEDIDO,
    gateway_payment_id: "",
    total: 100,
    valor_estornado: null,
    payment_status: "paid",
    paid_at: null,
    status: "paid",
    ...extra,
  };
}

type Config = {
  lista?: unknown[];
  erroLista?: unknown;
  presas?: unknown[];
  erroPresas?: unknown;
  primeiros?: unknown[];
  erroPrimeiro?: unknown;
  /** Resposta da pergunta "existe OUTRO pedido com este caso?", pela ordem da chamada. */
  outros?: (n: number) => unknown[];
  pedido?: Record<string, unknown> | null;
};

function banco(cfg: Config = {}) {
  const consultas: Array<{ tabela: string; selecao: string | null; atualiza: unknown; metodos: Array<[string, unknown[]]> }> = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  let perguntasDeOutro = 0;

  function responder(reg) {
    if (reg.tabela === "marketplace_orders") {
      return { data: cfg.pedido === undefined ? linhaDoPedido() : cfg.pedido, error: null };
    }
    if (reg.atualiza) return { data: null, error: null };
    if (reg.selecao === "id, order_id, updated_at") return { data: cfg.lista ?? [], error: cfg.erroLista ?? null };
    if (reg.selecao === "id, mp_chargeback_id, mp_chargeback_case_id") {
      return { data: cfg.presas ?? [], error: cfg.erroPresas ?? null };
    }
    if (reg.selecao === "order_id") {
      if (reg.metodos.some(([m]) => m === "neq")) {
        const n = perguntasDeOutro++;
        return { data: cfg.outros ? cfg.outros(n) : [], error: null };
      }
      return { data: cfg.primeiros ?? [], error: cfg.erroPrimeiro ?? null };
    }
    return { data: null, error: new Error(`pergunta inesperada: ${reg.selecao}`) };
  }

  const supabase = {
    from(tabela: string) {
      const reg = { tabela, selecao: null, atualiza: null, metodos: [] as Array<[string, unknown[]]> };
      consultas.push(reg);
      const q: Record<string, unknown> = {};
      for (const m of ["eq", "neq", "lt", "order", "limit"]) {
        q[m] = (...a: unknown[]) => {
          reg.metodos.push([m, a]);
          return q;
        };
      }
      q.select = (s: string) => {
        reg.selecao = s;
        return q;
      };
      q.update = (v: unknown) => {
        reg.atualiza = v;
        return q;
      };
      q.maybeSingle = () => Promise.resolve(responder(reg));
      q.then = (ok, err) => Promise.resolve(responder(reg)).then(ok, err);
      return q;
    },
    rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      return Promise.resolve({ data: { resultado: "registrada" }, error: null });
    },
  };
  const atualizacoes = () => consultas.filter((c) => c.atualiza);
  const consultaDe = (selecao: string) => consultas.filter((c) => c.selecao === selecao);
  return { supabase, consultas, rpcs, atualizacoes, consultaDe };
}

function avisador() {
  const avisos: Array<{ chave: string; aviso: unknown }> = [];
  return {
    avisos,
    avisar: (chave: string, aviso: unknown) => {
      avisos.push({ chave, aviso });
      return Promise.resolve();
    },
  };
}

/** Um MP de mentira: casos a favor da loja; a consulta da order pode falhar. */
function mpDeMentira(opcoes: { statusDaOrder?: number } = {}) {
  const urls: string[] = [];
  const impl = ((url: string) => {
    urls.push(String(url));
    if (String(url).includes("/v1/orders/")) {
      return Promise.resolve(new Response("{}", { status: opcoes.statusDaOrder ?? 404 }));
    }
    const caso = String(url).split("/v1/chargebacks/")[1];
    return Promise.resolve(
      new Response(JSON.stringify({ id: caso, coverage_applied: true, currency: "BRL", amount: "40.00" }), { status: 200 }),
    );
  }) as unknown as typeof fetch;
  return { impl, urls };
}

const metodo = (reg, nome: string) => reg.metodos.filter(([m]) => m === nome).map(([, a]) => a);

// ─── a lista do cron e os filtros de cada consulta ───────────────────────────

Deno.test("cron: a lista pede no máximo 50 linhas, mais antigas primeiro, só as presas de contestação mais velhas que 6 h", async () => {
  const b = banco({ lista: [] });
  const a = avisador();
  const resumo = await reconsultarContestacoesPresas({
    supabase: b.supabase,
    token: "tok",
    vendedorId: VENDEDOR,
    avisar: a.avisar,
    agora: () => AGORA,
  });
  assertEquals(resumo, { vistas: 0, reconsultadas: 0, emAberto: 0, resolvidasAntes: 0, conservadas: 0, falhas: 0 });
  const [lista] = b.consultaDe("id, order_id, updated_at");
  assertEquals(metodo(lista, "limit"), [[50]]);
  assertEquals(metodo(lista, "lt"), [["updated_at", LIMITE_DO_CRON]]);
  assertEquals(metodo(lista, "order"), [["updated_at", { ascending: true }]]);
  assertEquals(metodo(lista, "eq"), [["solicitado_por", "sistema"], ["status", "em_processamento"], ["mp_status", "charged_back"]]);
});

Deno.test("cron: relê as linhas do pedido por IDADE (lt) e nunca por caso; o tópico do webhook relê por CASO e nunca por idade", async () => {
  const cron = banco({ lista: [{ order_id: PEDIDO }], presas: [] });
  const resumo = await reconsultarContestacoesPresas({
    supabase: cron.supabase,
    token: "tok",
    vendedorId: VENDEDOR,
    avisar: avisador().avisar,
    agora: () => AGORA,
  });
  assertEquals(resumo.resolvidasAntes, 1);
  const [presasDoCron] = cron.consultaDe("id, mp_chargeback_id, mp_chargeback_case_id");
  assertEquals(metodo(presasDoCron, "lt"), [["updated_at", LIMITE_DO_CRON]]);
  assertEquals(metodo(presasDoCron, "eq").some(([coluna]) => coluna === "mp_chargeback_case_id"), false);

  const topico = banco({ primeiros: [{ order_id: PEDIDO }], presas: [] });
  const desfecho = await recuperarContestacaoPeloCaso({
    supabase: topico.supabase,
    token: "tok",
    vendedorId: VENDEDOR,
    avisar: avisador().avisar,
    caseId: "CASE9",
    agora: () => AGORA,
  });
  assertEquals(desfecho, "resolvida_antes");
  const [presasDoTopico] = topico.consultaDe("id, mp_chargeback_id, mp_chargeback_case_id");
  assertEquals(metodo(presasDoTopico, "lt"), []);
  assertEquals(metodo(presasDoTopico, "eq").filter(([coluna]) => coluna === "mp_chargeback_case_id"), [["mp_chargeback_case_id", "CASE9"]]);
});

Deno.test("tópico: as duas perguntas 'quem tem este caso' pedem só a coluna order_id; a primeira com limit 1, a segunda excluindo o pedido", async () => {
  const b = banco({ primeiros: [{ order_id: PEDIDO }], presas: [] });
  await recuperarContestacaoPeloCaso({
    supabase: b.supabase,
    token: "tok",
    vendedorId: VENDEDOR,
    avisar: avisador().avisar,
    caseId: "CASE9",
    agora: () => AGORA,
  });
  const perguntas = b.consultaDe("order_id");
  assertEquals(perguntas.length, 2);
  assertEquals(metodo(perguntas[0], "limit"), [[1]]);
  assertEquals(metodo(perguntas[0], "neq"), []);
  assertEquals(metodo(perguntas[1], "neq"), [["order_id", PEDIDO]]);
  assertEquals(metodo(perguntas[1], "eq"), [["solicitado_por", "sistema"], ["mp_chargeback_case_id", "CASE9"]]);
});

Deno.test("erro do banco: ao achar o pedido do caso LANÇA (o webhook devolve 500); ao reler as linhas presas conta FALHA, nunca 'resolvida antes'", async () => {
  await assertRejects(
    () =>
      recuperarContestacaoPeloCaso({
        supabase: banco({ erroPrimeiro: new Error("banco fora") }).supabase,
        token: "tok",
        vendedorId: VENDEDOR,
        avisar: avisador().avisar,
        caseId: "CASE9",
        agora: () => AGORA,
      }),
    Error,
    "banco fora",
  );
  const resumo = await reconsultarContestacoesPresas({
    supabase: banco({ lista: [{ order_id: PEDIDO }], presas: null, erroPresas: new Error("banco fora") }).supabase,
    token: "tok",
    vendedorId: VENDEDOR,
    avisar: avisador().avisar,
    agora: () => AGORA,
  });
  assertEquals(resumo.falhas, 1);
  assertEquals(resumo.resolvidasAntes, 0);
});

// ─── o vínculo de um caractere ───────────────────────────────────────────────

Deno.test("ids de contestação e de caso de UM caractere são vínculo válido: o caso é consultado e entregue ao banco", async () => {
  const b = banco({ lista: [{ order_id: PEDIDO }], presas: [{ id: "R1", mp_chargeback_id: "C", mp_chargeback_case_id: "9" }] });
  const a = avisador();
  const mp = mpDeMentira();
  const resumo = await reconsultarContestacoesPresas({
    supabase: b.supabase,
    token: "tok",
    vendedorId: VENDEDOR,
    fetchImpl: mp.impl,
    avisar: a.avisar,
    agora: () => AGORA,
  });
  assertEquals(resumo.reconsultadas, 1);
  assertEquals(resumo.conservadas, 0);
  assertEquals(b.rpcs.length, 1);
  assertEquals(b.rpcs[0].args.p_mp_chargeback_id, "C");
  assertEquals(b.rpcs[0].args.p_case_id, "9");
  assertEquals(a.avisos.length, 0);
});

// ─── linha sem vínculo e sem order ───────────────────────────────────────────

Deno.test("linha sem vínculo e cobrança sem order do MP: avisa com o motivo sem_order_do_mp, gira a linha e o desfecho é conservada", async () => {
  const b = banco({
    primeiros: [{ order_id: PEDIDO }],
    presas: [{ id: "R1", mp_chargeback_id: null, mp_chargeback_case_id: "CASE9" }],
  });
  const a = avisador();
  const mp = mpDeMentira();
  const desfecho = await recuperarContestacaoPeloCaso({
    supabase: b.supabase,
    token: "tok",
    vendedorId: VENDEDOR,
    fetchImpl: mp.impl,
    avisar: a.avisar,
    caseId: "CASE9",
    agora: () => AGORA,
  });
  assertEquals(desfecho, "conservada");
  assertEquals(a.avisos.map((x) => x.chave), [`contestacao_indefinida:${PEDIDO}:sem_order_do_mp`]);
  assertEquals(b.rpcs.length, 0);
  assertEquals(mp.urls.length, 0);
  assertEquals(b.atualizacoes().length, 1);
});

Deno.test("uma linha vinculada ENTREGUE ao lado de uma sem vínculo: o pedido conta como entregue e a sem vínculo ainda avisa", async () => {
  const b = banco({
    lista: [{ order_id: PEDIDO }],
    presas: [
      { id: "R1", mp_chargeback_id: null, mp_chargeback_case_id: null },
      { id: "R2", mp_chargeback_id: "CBK2", mp_chargeback_case_id: "CASE2" },
    ],
  });
  const a = avisador();
  const resumo = await reconsultarContestacoesPresas({
    supabase: b.supabase,
    token: "tok",
    vendedorId: VENDEDOR,
    fetchImpl: mpDeMentira().impl,
    avisar: a.avisar,
    agora: () => AGORA,
  });
  assertEquals(resumo.reconsultadas, 1);
  assertEquals(resumo.conservadas, 0);
  assertEquals(b.rpcs.length, 1);
  assertEquals(a.avisos.map((x) => x.chave), [`contestacao_indefinida:${PEDIDO}:sem_order_do_mp`]);
});

// ─── a corrida entre as duas guardas ─────────────────────────────────────────

Deno.test("caso que passa a existir em OUTRO pedido entre a guarda do tópico e a do miolo: desfecho ambiguo, aviso, nenhuma consulta ao MP", async () => {
  const b = banco({
    primeiros: [{ order_id: PEDIDO }],
    presas: [{ id: "R1", mp_chargeback_id: "CBK1", mp_chargeback_case_id: "CASE9" }],
    outros: (n) => (n === 0 ? [] : [{ order_id: "OUTRO-PEDIDO" }]),
  });
  const a = avisador();
  const mp = mpDeMentira();
  const desfecho = await recuperarContestacaoPeloCaso({
    supabase: b.supabase,
    token: "tok",
    vendedorId: VENDEDOR,
    fetchImpl: mp.impl,
    avisar: a.avisar,
    caseId: "CASE9",
    agora: () => AGORA,
  });
  assertEquals(desfecho, "ambiguo");
  assertEquals(a.avisos.map((x) => x.chave), [`contestacao_indefinida:${PEDIDO}:caso_em_mais_de_um_pedido`]);
  assertEquals(mp.urls.length, 0);
  assertEquals(b.rpcs.length, 0);
});

// ─── a consulta da order falha ───────────────────────────────────────────────

Deno.test("falha 500 do MP na order: o cron carimba a linha com o corte e conta falha; o tópico do webhook lança SEM carimbar nada", async () => {
  const presas = [{ id: "R1", mp_chargeback_id: "CBK1", mp_chargeback_case_id: "CASE9" }];
  const pedido = linhaDoPedido({ gateway_payment_id: ORDER_MP });

  const cron = banco({ lista: [{ order_id: PEDIDO }], presas, pedido });
  const resumo = await reconsultarContestacoesPresas({
    supabase: cron.supabase,
    token: "tok",
    vendedorId: VENDEDOR,
    fetchImpl: mpDeMentira({ statusDaOrder: 500 }).impl,
    avisar: avisador().avisar,
    agora: () => AGORA,
  });
  assertEquals(resumo.falhas, 1);
  assertEquals(cron.atualizacoes().map((c) => c.atualiza), [{ updated_at: LIMITE_DO_CRON }]);

  const topico = banco({ primeiros: [{ order_id: PEDIDO }], presas, pedido });
  await assertRejects(
    () =>
      recuperarContestacaoPeloCaso({
        supabase: topico.supabase,
        token: "tok",
        vendedorId: VENDEDOR,
        fetchImpl: mpDeMentira({ statusDaOrder: 500 }).impl,
        avisar: avisador().avisar,
        caseId: "CASE9",
        agora: () => AGORA,
      }),
    Error,
    "status 500",
  );
  assertEquals(topico.atualizacoes().length, 0);
  assert(topico.rpcs.length === 0);
});
