// @ts-nocheck
/**
 * CASO JÁ VINCULADO E PENDENTE (FASE 2, R3 do Lote A, 04/10/2026, complemento).
 *
 * A linha `sistema` em `em_processamento` carrega `mp_chargeback_id` (CBK) e
 * `mp_chargeback_case_id`, gravados pela RPC a partir de notificação
 * autenticada. A elegibilidade da reconsulta vem DESSE registro nosso — não do
 * estado atual da ORDER no MP.
 *
 * FONTES (primárias, lidas em 04/10/2026):
 *  - https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/optional-notifications
 *    o tópico `topic_chargebacks_wh` chega na CRIAÇÃO e na MUDANÇA de uma contestação.
 *  - https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/chargebacks/management
 *    na resolução, reconsultar `GET /v1/chargebacks/{case_id}`; `coverage_applied: true` =
 *    favorável ao vendedor, `false` = contrária. Não há gate pelo status da ORDER.
 *  - https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status
 *    lista `charged_back` com in_process / settled / reimbursed; NÃO garante que a order
 *    continue em `charged_back` depois da resolução, nem que volte a `processed`.
 *
 * O QUE ESTES TESTES NÃO ALEGAM: que a order muda (ou não) de estado quando a
 * disputa é resolvida — a documentação é silente ("NÃO DOCUMENTADO"). Eles provam
 * o contrato CONDICIONAL: SE a order sair de `charged_back` (ou deixar de listar
 * `chargebacks[]`), o caso vinculado ainda é reconsultado e resolvido.
 *
 * O que SÓ CONSERVA e avisa (NÃO é resolução automática): caso contra a loja sem
 * corroboração do pagamento; caso de outro pagamento ou de outro id; linha sem
 * vínculo. O admin confere no painel do MP; a reserva segue travando o saldo.
 *
 * O banco aqui é VIVO: a RPC dublê muda a linha (liberada/concluída) e grava a
 * lápide da decisão final, então "uma vez só" e "já resolvido" se OBSERVAM no
 * estado, não só na contagem de chamadas.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { reconsultarContestacoesPresas, recuperarContestacaoPeloCaso } from "./reconsulta-de-contestacao.ts";
import { handler as handlerDoWebhook } from "../webhook-mercadopago/index.ts";
import { handler as handlerDoCron } from "../reconciliar-pagamentos/index.ts";

const AGORA = Date.parse("2026-10-04T12:00:00.000Z");
const HORA = 60 * 60 * 1000;
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const OUTRO_PEDIDO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORDER_MP = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
const SEGREDO_WEBHOOK = "segredo-webhook-caso-conhecido";
const SEGREDO_CRON = "segredo-cron-caso-conhecido";

Deno.env.set("MP_WEBHOOK_SECRET", SEGREDO_WEBHOOK);
Deno.env.set("RECONCILIACAO_SECRET", SEGREDO_CRON);
Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");

const ha = (horas: number) => new Date(AGORA - horas * HORA).toISOString();

function linhaVinculada(id = "L1", extra: Record<string, unknown> = {}) {
  return {
    id,
    order_id: PEDIDO,
    updated_at: ha(7),
    status: "em_processamento",
    solicitado_por: "sistema",
    mp_status: "charged_back",
    mp_chargeback_id: "CBK1",
    mp_chargeback_case_id: "CASE1",
    ...extra,
  };
}

/** A order do MP DEPOIS de a disputa sair de `charged_back` (hipótese, não fato documentado). */
function orderProcessada(over: Record<string, unknown> = {}) {
  // Forma da doc (get-order): transactions.payments[].id = PAY01... (Orders API).
  const { status = "processed", detalhe = "accredited", pagamentos = [PAGAMENTO_NA_ORDER], chargebacks = [] } = over;
  return {
    id: ORDER_MP,
    status,
    status_detail: detalhe,
    external_reference: PEDIDO,
    total_amount: "149.90",
    transactions: {
      payments: pagamentos.map((id) => ({ id, amount: "149.90", status, status_detail: detalhe })),
      chargebacks,
    },
  };
}

// Forma da doc (chargebacks/management): `payments` do CASO traz o id numérico da
// API v1 (exemplo oficial: [86439942806]); o da ORDER é PAY01... — NUNCA iguais.
// Fontes: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/chargebacks/management
//         https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/get-order/get
const PAGAMENTO_NA_ORDER = "PAY01J67CQQH5904WDBVZEM4JMEP3";
const PAGAMENTO_NO_CASO = 86439942806;
const caso = (id: string, coverage: boolean | null, pagamentos: unknown[] = [PAGAMENTO_NO_CASO], amount = 149.9) => ({
  id,
  amount,
  currency: "BRL",
  coverage_applied: coverage,
  payments: pagamentos,
});

/** O vendedor e a loja DONOS do caso no MP de mentira (contrato: X-Caller-Id + Authorization). */
const VENDEDOR = "1234567";
const TOKEN_DA_LOJA = "token-de-teste";

function mp(opts: {
  order?: unknown;
  orderStatus?: number;
  casos?: Record<string, { status: number; corpo?: unknown }>;
  /** O que `GET /users/me` do token da loja devolve (padrão: o vendedor dono). */
  usersMe?: { status: number; corpo?: unknown } | "rede" | "timeout" | "redireciona" | "ok_depois";
  /** Quem é o vendedor DONO do caso para o MP (padrão VENDEDOR). */
  vendedorDoCaso?: string;
  /** O token que o MP aceita no GET do caso (padrão: o da loja). */
  tokenDono?: string;
}) {
  const consultasUsersMe: Array<{ autorizacao: string | null; metodo?: string; url: string }> = [];
  const chamadas: string[] = [];
  const cabecalhos: Array<{ autorizacao: string | null; vendedor: string | null; metodo?: string }> = [];
  const fetchImpl = (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    chamadas.push(u);
    if (u.endsWith("/users/me")) {
      const h = new Headers(init?.headers);
      consultasUsersMe.push({ autorizacao: h.get("Authorization"), metodo: init?.method, url: u });
      if (opts.usersMe === "rede") return Promise.reject(new TypeError("rede caiu"));
      if (opts.usersMe === "timeout") return Promise.reject(new DOMException(`aborted ${TOKEN_DA_LOJA} ${VENDEDOR}`, "AbortError"));
      if (opts.usersMe === "redireciona") {
        // 302 para OUTRO host; um fetch que seguisse levaria o Authorization junto.
        if (init?.redirect === "manual") return Promise.resolve(new Response(null, { status: 302, headers: { Location: "https://fora.example/captura" } }));
        chamadas.push("https://fora.example/captura");
        return Promise.resolve(new Response(JSON.stringify({ id: Number(VENDEDOR) }), { status: 200 }));
      }
      if (h.get("Authorization") !== `Bearer ${TOKEN_DA_LOJA}`) return Promise.resolve(new Response("{}", { status: 401 }));
      const resposta = opts.usersMe ?? { status: 200, corpo: { id: Number(VENDEDOR), nickname: "LOJA" } };
      return Promise.resolve(new Response(JSON.stringify(resposta.corpo ?? {}), { status: resposta.status }));
    }
    if (u.includes("/v1/chargebacks/")) {
      const h = new Headers(init?.headers);
      cabecalhos.push({ autorizacao: h.get("Authorization"), vendedor: h.get("X-Caller-Id"), metodo: init?.method });
      // O MP exige Authorization da loja dona E X-Caller-Id do vendedor dono.
      if (
        init?.method !== "GET" ||
        h.get("Authorization") !== `Bearer ${opts.tokenDono ?? TOKEN_DA_LOJA}` ||
        h.get("X-Caller-Id") !== (opts.vendedorDoCaso ?? VENDEDOR)
      ) {
        return Promise.resolve(new Response("{}", { status: 403 }));
      }
    }
    const o = u.match(/\/v1\/orders\/([^/?]+)$/);
    const c = u.match(/\/v1\/chargebacks\/([^/?]+)$/);
    if (o) {
      return Promise.resolve(new Response(JSON.stringify(opts.order ?? {}), { status: opts.orderStatus ?? 200 }));
    }
    const alvo = c ? Reflect.get(opts.casos ?? {}, c[1]) : undefined;
    if (!alvo) return Promise.resolve(new Response("{}", { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(alvo.corpo ?? {}), { status: alvo.status }));
  };
  return { fetchImpl, chamadas, cabecalhos, consultasUsersMe, casosLidos: () => chamadas.filter((u) => u.includes("/v1/chargebacks/")).length };
}

/** Banco VIVO: linhas mutáveis, RPC do ledger que muda a linha e grava a lápide. */
function bancoVivo(
  linhas: Array<Record<string, unknown>>,
  opts: {
    pedido?: Record<string, unknown>;
    /** O `db-max-rows` do PostgREST: nenhuma resposta passa de N linhas, o resto ficaria em outra página. */
    maxRows?: number;
    /** A consulta de EXISTÊNCIA (a que usa `neq`) falha. */
    erroNaExistencia?: boolean;
  } = {},
) {
  const lapides: string[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const toques: unknown[] = [];
  const pedido = {
    id: PEDIDO,
    gateway_payment_id: ORDER_MP,
    total: 149.9,
    total_amount: null,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: "2026-10-01T00:00:00Z",
    status: "paid",
    ...(opts.pedido ?? {}),
  };
  const construtor = () => {
    const filtros: Array<[string, string, unknown]> = [];
    let teto = Infinity;
    const q = {
      eq(c: string, v: unknown) {
        filtros.push(["eq", c, v]);
        return q;
      },
      lt(c: string, v: unknown) {
        filtros.push(["lt", c, v]);
        return q;
      },
      neq(c: string, v: unknown) {
        filtros.push(["neq", c, v]);
        return q;
      },
      order() {
        return q;
      },
      limit(n: number) {
        teto = n;
        return q;
      },
      then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
        if (opts.erroNaExistencia && filtros.some(([op]) => op === "neq")) {
          return Promise.resolve({ data: null, error: { message: "statement timeout" } }).then(res, rej);
        }
        const r = linhas.filter((l) =>
          filtros.every(([op, c, v]) =>
            op === "eq" ? Reflect.get(l, c) === v : op === "neq" ? Reflect.get(l, c) !== v : String(Reflect.get(l, c)) < String(v)
          )
        );
        const limite = Math.min(teto, opts.maxRows ?? Infinity);
        return Promise.resolve({ data: r.slice(0, limite).map((l) => ({ ...l })), error: null }).then(res, rej);
      },
    };
    return q;
  };
  return {
    linhas,
    lapides,
    rpcs,
    toques,
    from(tabela: string) {
      if (tabela === "order_refunds") {
        return {
          select: () => construtor(),
          update(valores: Record<string, unknown>) {
            const filtros: Array<[string, unknown]> = [];
            const q = {
              eq(c: string, v: unknown) {
                filtros.push([c, v]);
                return q;
              },
              then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
                toques.push({ filtros: [...filtros], valores });
                for (const l of linhas) if (filtros.every(([c, v]) => Reflect.get(l, c) === v)) Object.assign(l, valores);
                return Promise.resolve({ data: null, error: null }).then(res, rej);
              },
            };
            return q;
          },
        };
      }
      if (tabela === "marketplace_orders") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: pedido, error: null }) }) }) };
      }
      if (tabela === "app_settings") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      throw new Error(`from inesperado: ${tabela}`);
    },
    rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      if (nome === "pagamentos_a_reconciliar") return Promise.resolve({ data: [], error: null });
      if (nome !== "registrar_contestacao_no_ledger") return Promise.resolve({ data: null, error: null });
      const chave = `${args.p_order_id}:${args.p_mp_chargeback_id}`;
      const linha = linhas.find((l) => l.order_id === args.p_order_id && l.mp_chargeback_id === args.p_mp_chargeback_id);
      const retorno = (resultado: string) => ({ data: { resultado, aviso: null, valor_estornado: 0 }, error: null });
      if (lapides.includes(chave)) return Promise.resolve(retorno("ja_decidido")); // lápide: sem reabrir
      if (args.p_decisao === "a_favor_da_loja") {
        if (linha && linha.status === "em_processamento") linha.status = "liberado";
        lapides.push(chave);
        return Promise.resolve(retorno("liberado"));
      }
      if (args.p_decisao === "contra_a_loja") {
        if (linha && linha.status === "em_processamento") linha.status = "concluido";
        lapides.push(chave);
        return Promise.resolve(retorno("concluido"));
      }
      return Promise.resolve(retorno("ja_reservado"));
    },
  };
}

const doLedger = (b: { rpcs: Array<{ nome: string; args: Record<string, unknown> }> }) =>
  b.rpcs.filter((r) => r.nome === "registrar_contestacao_no_ledger").map((r) => r.args);

async function mudo<T>(fn: () => Promise<T>) {
  const erros: string[] = [];
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = (...a: unknown[]) => erros.push(a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" "));
  console.warn = () => {};
  console.log = () => {};
  try {
    return { valor: await fn(), erros };
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
}

async function cron(b: ReturnType<typeof bancoVivo>, m: ReturnType<typeof mp>, agora = AGORA, usar: { vendedorId?: string | null } = {}) {
  const avisos: string[] = [];
  const { valor, erros } = await mudo(() =>
    reconsultarContestacoesPresas({
      supabase: b,
      token: TOKEN_DA_LOJA,
      ...("vendedorId" in usar ? { vendedorId: usar.vendedorId } : {}),
      fetchImpl: m.fetchImpl,
      avisar: (chave) => {
        avisos.push(chave);
        return Promise.resolve();
      },
      agora: () => agora,
    })
  );
  return { resumo: valor, avisos, erros };
}

async function assinar(dataId: string, ts: number, xRequestId: string): Promise<string> {
  const manifesto = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(SEGREDO_WEBHOOK), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinado = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifesto));
  return Array.from(new Uint8Array(assinado)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function topicoDeCaso(caseId: string, tipo = "topic_chargebacks_wh"): Promise<Request> {
  const ts = Math.floor(Date.now() / 1000);
  const v1 = await assinar(caseId, ts, "req-caso");
  return new Request("http://localhost/webhook-mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-caso" },
    body: JSON.stringify({ type: tipo, data: { id: caseId } }),
  });
}

async function webhook(b: ReturnType<typeof bancoVivo>, m: ReturnType<typeof mp>, caseId = "CASE1", usar: { vendedorId?: string | null } = {}) {
  const { valor, erros } = await mudo(async () => {
    const r = await handlerDoWebhook(await topicoDeCaso(caseId), { supabase: b, fetchImpl: m.fetchImpl, ...usar });
    return { status: r.status, corpo: await r.json() };
  });
  return { ...valor, erros };
}

const mpGanho = () =>
  mp({ order: orderProcessada(), casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });

// ── (a) caso pendente, order já `processed` e SEM chargebacks[]: o cron resolve ──

Deno.test("(a) caso vinculado pendente, order 'processed' sem chargebacks[]: o cron reconsulta pelo case_id e LIBERA com coverage_applied true — uma vez só", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mpGanho();
  const r = await cron(b, m);

  assertEquals(doLedger(b).length, 1);
  assertEquals(doLedger(b)[0], {
    p_order_id: PEDIDO,
    p_mp_chargeback_id: "CBK1",
    p_case_id: "CASE1",
    p_decisao: "a_favor_da_loja",
    p_valor_caso: 149.9,
    p_valor_estimado: 149.9,
    p_casos_na_order: 1,
  });
  assertEquals(b.linhas[0].status, "liberado", "a reserva foi liberada no banco, não só 'chamada'");
  assertEquals(b.lapides, [`${PEDIDO}:CBK1`], "a lápide da decisão final foi gravada");
  assertEquals(r.resumo, { vistas: 1, reconsultadas: 1, emAberto: 0, resolvidasAntes: 0, conservadas: 0, falhas: 0 });
  assertEquals(r.avisos, []);
  assert(m.chamadas.some((u) => u.endsWith("/v1/chargebacks/CASE1")), "o caso foi consultado pelo id EXATO gravado na linha");

  // (e) o segundo ciclo: a linha já não está presa -> nenhuma chamada, nenhuma RPC.
  const m2 = mpGanho();
  const r2 = await cron(b, m2, AGORA + 7 * HORA);
  assertEquals([m2.chamadas, doLedger(b).length, r2.resumo.vistas], [[], 1, 0]);
});

Deno.test("(a) SEM order no MP (404) ou com a cobrança gravada sem order: o caso vinculado ainda é reconsultado e liberado", async () => {
  for (const variante of ["404", "sentinela"]) {
    const b = bancoVivo([linhaVinculada()], variante === "sentinela" ? { pedido: { gateway_payment_id: "verificando:abc:c0" } } : {});
    const m = mp({ orderStatus: 404, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
    const r = await cron(b, m);
    assertEquals(b.linhas[0].status, "liberado", variante);
    assertEquals(r.resumo.reconsultadas, 1, variante);
  }
});

Deno.test("(a) order ainda em 'charged_back' mas SEM o CBK na lista: o caso vinculado resolve do mesmo jeito (a elegibilidade é do NOSSO registro)", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mp({
    order: orderProcessada({ status: "charged_back", detalhe: "reimbursed", chargebacks: [] }),
    casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } },
  });
  await cron(b, m);
  assertEquals(b.linhas[0].status, "liberado");
  assertEquals(doLedger(b).length, 1);
});

// ── (b) coverage_applied false: não libera; segue a regra de perda ────────────

Deno.test("(b) coverage_applied FALSE (fixtures da doc: caso.payments numérico v1, order PAY01...) -> CONSERVA e avisa, mesmo com o pagamento da order 'settled': nada de comparar espaços de id, dinheiro que sai é irreversível; 0 RPC", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mp({
    order: orderProcessada({ detalhe: "settled" }),
    casos: { CASE1: { status: 200, corpo: caso("CASE1", false, [PAGAMENTO_NO_CASO], 100) } },
  });
  const r = await cron(b, m);
  assertEquals(doLedger(b), []);
  assertEquals(b.linhas[0].status, "em_processamento");
  assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:CBK1`]);
  assertEquals([r.resumo.conservadas, r.resumo.reconsultadas], [1, 0]);
});

Deno.test("(b) coverage_applied FALSE SEM corroboração do pagamento: CONSERVA e avisa — não é resolução, dinheiro que sai é irreversível; nenhuma RPC", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mp({
    order: orderProcessada(), // 'accredited': não diz nem 'settled' nem 'reimbursed'
    casos: { CASE1: { status: 200, corpo: caso("CASE1", false) } },
  });
  const r = await cron(b, m);
  assertEquals(doLedger(b), []);
  assertEquals(b.linhas[0].status, "em_processamento");
  assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:CBK1`]);
  assertEquals([r.resumo.conservadas, r.resumo.reconsultadas], [1, 0]);
});

// ── caso ainda aberto ─────────────────────────────────────────────────────────

Deno.test("caso vinculado ainda EM ANÁLISE no MP: nenhuma RPC, a reserva segue, a linha gira (volta daqui a 6 h) e conta como emAberto", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mp({ order: orderProcessada(), casos: { CASE1: { status: 200, corpo: caso("CASE1", null) } } });
  const r = await cron(b, m);
  assertEquals(doLedger(b), []);
  assertEquals(b.linhas[0].status, "em_processamento");
  assertEquals(b.linhas[0].updated_at, new Date(AGORA).toISOString());
  assertEquals([r.resumo.emAberto, r.resumo.conservadas, r.avisos], [1, 0, []]);
  const m2 = mp({});
  const r2 = await cron(b, m2, AGORA + 10 * 60 * 1000);
  assertEquals([m2.chamadas, r2.resumo.vistas], [[], 0]);
});

// ── (d) vínculo exato: caso de outro pagamento / outro id ─────────────────────

Deno.test("(d) o MESMO case_id em DOIS pedidos, pelo CRON: ambíguo — conserva e avisa os dois, ZERO GET de caso, ZERO RPC, nada liberado (a mesma regra do tópico)", async () => {
  const b = bancoVivo([linhaVinculada("L1"), linhaVinculada("L2", { order_id: OUTRO_PEDIDO, mp_chargeback_id: "CBK2" })]);
  const m = mp({ orderStatus: 404, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const r = await cron(b, m);
  assertEquals([m.casosLidos(), doLedger(b)], [0, []], "nenhuma consulta de caso, nenhuma RPC");
  assertEquals(b.linhas.map((l) => l.status), ["em_processamento", "em_processamento"]);
  assertEquals(r.avisos.sort(), [`contestacao_indefinida:${OUTRO_PEDIDO}:caso_em_mais_de_um_pedido`, `contestacao_indefinida:${PEDIDO}:caso_em_mais_de_um_pedido`].sort());
  assertEquals([r.resumo.vistas, r.resumo.conservadas, r.resumo.reconsultadas], [2, 2, 0]);
});

Deno.test("(d) o case_id é de UM pedido só (o outro pedido tem OUTRO case_id): o cron resolve normalmente — a contagem não bloqueia o caso legítimo", async () => {
  const b = bancoVivo([linhaVinculada("L1"), linhaVinculada("L2", { order_id: OUTRO_PEDIDO, mp_chargeback_id: "CBK2", mp_chargeback_case_id: "CASE2" })]);
  const m = mp({
    orderStatus: 404,
    casos: { CASE1: { status: 200, corpo: caso("CASE1", true) }, CASE2: { status: 200, corpo: caso("CASE2", null) } },
  });
  const r = await cron(b, m);
  assertEquals(b.linhas.map((l) => l.status), ["liberado", "em_processamento"]);
  assertEquals([r.resumo.reconsultadas, r.resumo.emAberto, r.avisos], [1, 1, []]);
});

Deno.test("(d) o MP devolve OUTRO caso (id diferente do vínculo): nada é liberado nem concluído, admin avisado", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mp({ order: orderProcessada(), casos: { CASE1: { status: 200, corpo: caso("CASE-OUTRO", true) } } });
  const r = await cron(b, m);
  assertEquals(doLedger(b), []);
  assertEquals(r.avisos.length, 1);
  assertEquals(b.linhas[0].status, "em_processamento");
});

Deno.test("NUNCA se adivinha o vínculo: linha SEM case_id cuja order saiu de 'charged_back' só CONSERVA e avisa (nenhum GET de caso, nenhuma RPC)", async () => {
  const b = bancoVivo([linhaVinculada("L1", { mp_chargeback_id: null, mp_chargeback_case_id: null })]);
  const m = mp({ order: orderProcessada(), casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const r = await cron(b, m);
  assertEquals([doLedger(b), m.casosLidos()], [[], 0]);
  assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:order_processed`]);
  assertEquals(b.linhas[0].status, "em_processamento");
});

// ── falha transitória: conserva e repete ──────────────────────────────────────

Deno.test("falha TRANSITÓRIA no GET do caso vinculado (503): nenhuma RPC, linha NÃO tocada, falha contada — e o próximo ciclo resolve", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const r = await cron(b, mp({ order: orderProcessada(), casos: { CASE1: { status: 503 } } }));
  assertEquals([doLedger(b), b.toques, r.resumo.falhas], [[], [], 1]);
  assertEquals(b.linhas[0].status, "em_processamento");
  const r2 = await cron(b, mpGanho(), AGORA + 10 * 60 * 1000);
  assertEquals([b.linhas[0].status, r2.resumo.reconsultadas], ["liberado", 1]);
});

// ── (c) o tópico do webhook e o cron: o MESMO caminho, UMA vez ─────────────────

Deno.test("(c) o tópico topic_chargebacks_wh do webhook libera o caso vinculado pelo MESMO caminho do cron — e o cron depois NÃO repete (uma vez por caso)", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mpGanho();
  const w = await webhook(b, m);
  assertEquals([w.status, w.corpo.ok, w.corpo.desfecho], [200, true, "entregue"]);
  assertEquals(b.linhas[0].status, "liberado");
  assertEquals(doLedger(b).length, 1);
  assertEquals(doLedger(b)[0].p_decisao, "a_favor_da_loja");

  const m2 = mpGanho();
  const r = await cron(b, m2, AGORA + 7 * HORA);
  assertEquals([m2.chamadas, doLedger(b).length, r.resumo.vistas], [[], 1, 0]);
});

Deno.test("(c) o cron primeiro, o tópico depois: o mesmo estado final e UMA decisão só", async () => {
  const b = bancoVivo([linhaVinculada()]);
  await cron(b, mpGanho());
  const m2 = mpGanho();
  const w = await webhook(b, m2);
  assertEquals([w.status, w.corpo.desfecho], [200, "resolvida_antes"]);
  assertEquals([m2.chamadas, doLedger(b).length, b.linhas[0].status], [[], 1, "liberado"]);
});

Deno.test("(c) o webhook e o cron entregam à RPC EXATAMENTE os mesmos argumentos para o mesmo caso vinculado", async () => {
  const doWebhook = bancoVivo([linhaVinculada()]);
  await webhook(doWebhook, mpGanho());
  const doCron = bancoVivo([linhaVinculada()]);
  await cron(doCron, mpGanho());
  assertEquals(doLedger(doWebhook), doLedger(doCron));
  assertEquals(doLedger(doCron).length, 1);
});

Deno.test("(c) tópico repetido (redelivery do MP) é idempotente: a segunda entrega não consulta o MP nem chama a RPC", async () => {
  const b = bancoVivo([linhaVinculada()]);
  await webhook(b, mpGanho());
  const m2 = mpGanho();
  const w2 = await webhook(b, m2);
  const w3 = await webhook(b, m2);
  assertEquals([w2.status, w3.status, m2.chamadas, doLedger(b).length], [200, 200, [], 1]);
});

Deno.test("tópico do caso SEM linha vinculada no ledger: 200 'sem_vinculo', nada consultado, nada decidido (o pedido nunca sai do corpo da notificação)", async () => {
  const b = bancoVivo([linhaVinculada("L1", { mp_chargeback_case_id: "OUTRO" })]);
  const m = mpGanho();
  const w = await webhook(b, m, "CASE1");
  assertEquals([w.status, w.corpo.desfecho, m.chamadas, doLedger(b)], [200, "sem_vinculo", [], []]);
});

Deno.test("o MESMO case_id ligado a DOIS pedidos: ambíguo — nada se adivinha, nada é decidido", async () => {
  const b = bancoVivo([linhaVinculada("L1"), linhaVinculada("L2", { order_id: OUTRO_PEDIDO })]);
  const m = mpGanho();
  const w = await webhook(b, m);
  assertEquals([w.status, w.corpo.desfecho, m.chamadas, doLedger(b)], [200, "ambiguo", [], []]);
});

Deno.test("tópico com falha TRANSITÓRIA do MP: o webhook devolve 500 (o MP reenvia) e nada é decidido", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const w = await webhook(b, mp({ order: orderProcessada(), casos: { CASE1: { status: 503 } } }));
  assertEquals([w.status, doLedger(b), b.linhas[0].status], [500, [], "em_processamento"]);
});

Deno.test("o tópico respeita o FRESH GATE do caso: linha tocada há pouco (webhook acabou de mexer) segue no tópico, mas a RPC é a única a decidir", async () => {
  // O tópico NÃO tem o corte de idade (o MP acabou de avisar): a linha jovem entra.
  const b = bancoVivo([linhaVinculada("L1", { updated_at: ha(0.01) })]);
  const w = await webhook(b, mpGanho());
  assertEquals([w.corpo.desfecho, b.linhas[0].status], ["entregue", "liberado"]);
});

Deno.test("recuperarContestacaoPeloCaso lança na falha transitória (contrato do webhook: 500) e não toca a linha", async () => {
  const b = bancoVivo([linhaVinculada()]);
  let lancou = false;
  await mudo(async () => {
    try {
      await recuperarContestacaoPeloCaso({
        supabase: b,
        token: TOKEN_DA_LOJA,
        fetchImpl: mp({ order: orderProcessada(), casos: { CASE1: { status: 503 } } }).fetchImpl,
        avisar: () => Promise.resolve(),
        caseId: "CASE1",
        agora: () => AGORA,
      });
    } catch (_e) {
      lancou = true;
    }
  });
  assertEquals([lancou, b.toques], [true, []]);
});

Deno.test("o cron (handler inteiro) também resolve o caso vinculado com a order 'processed' e responde o resumo", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mpGanho();
  const { valor } = await mudo(async () => {
    const r = await handlerDoCron(
      new Request("http://localhost/reconciliar-pagamentos", { method: "POST", headers: { "x-reconciliacao-secret": SEGREDO_CRON } }),
      { supabase: b, fetchImpl: m.fetchImpl, enviarComprovante: async () => {}, enviarAvisoAtrasado: async () => {}, enviarPush: async () => {} },
    );
    return { status: r.status, corpo: await r.json() };
  });
  assertEquals(valor.status, 200);
  assertEquals(valor.corpo.contestacoes.reconsultadas, 1);
  assertEquals(b.linhas[0].status, "liberado");
});

// ── a identidade do VENDEDOR (X-Caller-Id) — contrato do MP ───────────────────
// O MP exige `Authorization` E `X-Caller-Id` no GET do caso (tabela de
// https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/chargebacks/management).
// O seller ID vem de `GET /users/me` com o token da PRÓPRIA loja (o MP diz quem é
// o dono do token). TODOS os testes deste arquivo rodam o caminho PADRÃO dos
// handlers — sem injetar `vendedorId` — com o dublê preso a rota, método e
// headers de `/users/me` e de `/v1/chargebacks/{id}`.
// Sem identidade confiável, ou com identidade errada -> CONSERVA e avisa (sem
// liberar, sem perder). Nada de rede real.

Deno.test("seller ID (caminho PADRÃO do cron): users/me com o token da loja -> X-Caller-Id no GET do caso -> libera; o /users/me sai UMA vez, só GET", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mpGanho();
  await cron(b, m);
  assertEquals(m.consultasUsersMe, [{ autorizacao: `Bearer ${TOKEN_DA_LOJA}`, metodo: "GET", url: "https://api.mercadopago.com/users/me" }]);
  assertEquals(m.cabecalhos, [{ autorizacao: `Bearer ${TOKEN_DA_LOJA}`, vendedor: VENDEDOR, metodo: "GET" }]);
  assertEquals(b.linhas[0].status, "liberado");
});

Deno.test("seller ID (caminho PADRÃO do webhook): o tópico resolve pelo MESMO caminho — users/me, X-Caller-Id, libera", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mpGanho();
  const w = await webhook(b, m);
  assertEquals([w.status, w.corpo.desfecho], [200, "entregue"]);
  assertEquals(m.consultasUsersMe.length, 1);
  assertEquals(m.cabecalhos, [{ autorizacao: `Bearer ${TOKEN_DA_LOJA}`, vendedor: VENDEDOR, metodo: "GET" }]);
  assertEquals(b.linhas[0].status, "liberado");
});

Deno.test("seller ID: DOIS casos do mesmo pedido -> um /users/me só (memória da execução), dois GET de caso", async () => {
  const b = bancoVivo([linhaVinculada("L1"), linhaVinculada("L2", { mp_chargeback_id: "CBK2", mp_chargeback_case_id: "CASE2" })]);
  const m = mp({
    order: orderProcessada(),
    casos: { CASE1: { status: 200, corpo: caso("CASE1", true) }, CASE2: { status: 200, corpo: caso("CASE2", true) } },
  });
  await cron(b, m);
  assertEquals([m.consultasUsersMe.length, m.casosLidos()], [1, 2]);
  assertEquals(b.linhas.map((l) => l.status), ["liberado", "liberado"]);
});

Deno.test("seller ID: fonte PERMANENTEMENTE inválida no /users/me (401, 403, forma errada, zero, sem id) -> o cron CONSERVA: nenhum GET de caso, nenhuma RPC, a reserva fica, admin avisado", async () => {
  const fontes: Array<[string, { status: number; corpo?: unknown } | "rede"]> = [
    ["401", { status: 401 }],
    ["403", { status: 403 }],
    ["id texto", { status: 200, corpo: { id: "abc" } }],
    ["id zero", { status: 200, corpo: { id: 0 } }],
    ["sem id", { status: 200, corpo: { nickname: "x" } }],
  ];
  for (const [nome, usersMe] of fontes) {
    const b = bancoVivo([linhaVinculada()]);
    const m = mp({ order: orderProcessada(), usersMe, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
    const r = await cron(b, m);
    assertEquals(m.casosLidos(), 0, nome);
    assertEquals([doLedger(b), b.linhas[0].status], [[], "em_processamento"], nome);
    assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:CBK1`], nome);
    assertEquals([r.resumo.conservadas, r.resumo.reconsultadas], [1, 0], nome);
  }
});

Deno.test("seller ID: fonte inválida no /users/me, o tópico do webhook também conserva (200, desfecho conservada, nada consultado nem decidido)", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mp({ order: orderProcessada(), usersMe: { status: 401 }, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const w = await webhook(b, m);
  assertEquals([w.status, w.corpo.desfecho, m.casosLidos(), doLedger(b)], [200, "conservada", 0, []]);
  assertEquals(b.linhas[0].status, "em_processamento");
});

Deno.test("seller ID DIVERGENTE do vendedor dono do caso (users/me diz um, o caso é de outro): o MP recusa (403) — nada liberado nem concluído, admin avisado", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mp({ order: orderProcessada(), vendedorDoCaso: "9999999", casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const r = await cron(b, m);
  assertEquals(m.casosLidos(), 1, "a consulta saiu, com o id da loja, e o MP recusou");
  assertEquals([doLedger(b), b.linhas[0].status], [[], "em_processamento"]);
  assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:CBK1`]);
});

Deno.test("Authorization de OUTRA loja (o caso é de quem tem outro token): o MP recusa (403) — nada liberado, admin avisado", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mp({ order: orderProcessada(), tokenDono: "token-de-outra-loja", casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const r = await cron(b, m);
  assertEquals([doLedger(b), b.linhas[0].status, r.avisos.length], [[], "em_processamento", 1]);
});

Deno.test("seller ID: com o override explícito (seam de teste) o /users/me NÃO é consultado; null explícito conserva", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mpGanho();
  await cron(b, m, AGORA, { vendedorId: VENDEDOR });
  assertEquals([m.consultasUsersMe.length, b.linhas[0].status], [0, "liberado"]);
  const b2 = bancoVivo([linhaVinculada()]);
  const m2 = mpGanho();
  await cron(b2, m2, AGORA, { vendedorId: null });
  assertEquals([m2.casosLidos(), b2.linhas[0].status], [0, "em_processamento"]);
});

Deno.test("seller ID: nem o token nem o seller ID aparecem nos logs do ciclo", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mp({ order: orderProcessada(), vendedorDoCaso: "9999999", casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const r = await cron(b, m);
  const tudo = r.erros.join(" ");
  assertEquals(tudo.includes(TOKEN_DA_LOJA), false);
  assertEquals(tudo.includes(VENDEDOR), false);
});

Deno.test("seller ID: /users/me responde 302 para OUTRO host -> fonte inválida: o Authorization NÃO sai para o host de fora, o caso fica CONSERVADO (cron e tópico do webhook)", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const m = mp({ order: orderProcessada(), usersMe: "redireciona", casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const r = await cron(b, m);
  assertEquals(m.chamadas.some((u) => u.includes("fora.example")), false, "o Authorization seguiu o redirecionamento");
  assertEquals([m.casosLidos(), doLedger(b), b.linhas[0].status], [0, [], "em_processamento"]);
  assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:CBK1`]);

  const b2 = bancoVivo([linhaVinculada()]);
  const m2 = mp({ order: orderProcessada(), usersMe: "redireciona", casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const w = await webhook(b2, m2);
  assertEquals([w.status, w.corpo.desfecho], [200, "conservada"]);
  assertEquals(m2.chamadas.some((u) => u.includes("fora.example")), false);
  assertEquals([m2.casosLidos(), doLedger(b2)], [0, []]);
});

// ── falha TEMPORÁRIA do /users/me: não é "fonte inválida" ──────────────────────
// 503, 429 e timeout/rede são o mesmo contrato da reconsulta para o GET do caso:
// NÃO tocam a linha (updated_at intacto), não avisam, e a linha volta no PRÓXIMO
// ciclo (10 min), não em 6 h. Só a fonte permanentemente inválida conserva e avisa.
for (
  const [nome, usersMe] of [
    ["503", { status: 503 }],
    ["429", { status: 429 }],
    ["timeout", "timeout"],
    ["rede", "rede"],
  ] as Array<[string, { status: number } | "timeout" | "rede"]>
) {
  Deno.test(`seller ID: /users/me com falha TEMPORÁRIA (${nome}) no caminho PADRÃO do cron -> dinheiro conservado, ZERO GET de caso, ZERO RPC, updated_at INTACTO, sem aviso; o próximo ciclo TENTA DE NOVO e resolve`, async () => {
    const b = bancoVivo([linhaVinculada()]);
    const antes = JSON.stringify(b.linhas);
    const m = mp({ order: orderProcessada(), usersMe, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
    const r1 = await cron(b, m);
    assertEquals(m.consultasUsersMe.length, 1, "o /users/me foi tentado");
    assertEquals(m.casosLidos(), 0, "ZERO GET do caso");
    assertEquals(doLedger(b), [], "ZERO RPC de decisão");
    assertEquals(JSON.stringify(b.linhas), antes, "linha INTACTA (status e updated_at)");
    assertEquals(b.toques, [], "nenhum update na linha");
    assertEquals(r1.avisos, [], "falha temporária não avisa o admin (como o GET do caso)");
    assertEquals([r1.resumo.falhas, r1.resumo.conservadas, r1.resumo.reconsultadas], [1, 0, 0]);

    // Próximo ciclo (10 min depois), MP de volta: a linha ainda é elegível e é tentada DE NOVO.
    const m2 = mpGanho();
    const r2 = await cron(b, m2, AGORA + 10 * 60 * 1000);
    assertEquals(r2.resumo.vistas, 1, "a linha continua elegível (updated_at antigo)");
    assertEquals(m2.consultasUsersMe.length, 1, "tentou de novo");
    assertEquals([b.linhas[0].status, r2.resumo.reconsultadas, doLedger(b).length], ["liberado", 1, 1]);
  });
}

Deno.test("seller ID: /users/me com falha TEMPORÁRIA (503) no tópico do webhook -> 500 (o MP reenvia), nenhum GET de caso, nenhuma RPC, linha intacta", async () => {
  const b = bancoVivo([linhaVinculada()]);
  const antes = JSON.stringify(b.linhas);
  const m = mp({ order: orderProcessada(), usersMe: { status: 503 }, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const w = await webhook(b, m);
  assertEquals([w.status, m.casosLidos(), doLedger(b), JSON.stringify(b.linhas)], [500, 0, [], antes]);
  // O reenvio do MP, com o /users/me de volta, resolve.
  const w2 = await webhook(b, mpGanho());
  assertEquals([w2.status, w2.corpo.desfecho, b.linhas[0].status], [200, "entregue", "liberado"]);
});

Deno.test("PRIVACIDADE na falha TEMPORÁRIA do /users/me (503, 429, timeout): nem o token nem o seller ID aparecem em NENHUM log (error/warn/log) nem na resposta do webhook — mesmo quando o corpo/erro do MP os carrega", async () => {
  const casos: Array<[string, { status: number; corpo?: unknown } | "timeout"]> = [
    ["503", { status: 503, corpo: { id: Number(VENDEDOR), detalhe: TOKEN_DA_LOJA } }],
    ["429", { status: 429, corpo: { id: Number(VENDEDOR), detalhe: TOKEN_DA_LOJA } }],
    ["timeout", "timeout"],
  ];
  for (const [nome, usersMe] of casos) {
    const linhas: string[] = [];
    const [e, w, l] = [console.error, console.warn, console.log];
    const capta = (...a: unknown[]) => linhas.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : typeof x === "object" ? JSON.stringify(x) : String(x))).join(" "));
    console.error = capta;
    console.warn = capta;
    console.log = capta;
    let resposta = "";
    try {
      const b = bancoVivo([linhaVinculada()]);
      const m = mp({ order: orderProcessada(), usersMe, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
      await cron(b, m);
      const bw = bancoVivo([linhaVinculada()]);
      const mw = mp({ order: orderProcessada(), usersMe, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
      const r = await handlerDoWebhook(await topicoDeCaso("CASE1"), { supabase: bw, fetchImpl: mw.fetchImpl });
      resposta = `${r.status} ${await r.text()}`;
      assertEquals(r.status, 500, nome);
    } finally {
      [console.error, console.warn, console.log] = [e, w, l];
    }
    const tudo = linhas.join(" ") + " " + resposta;
    assert(linhas.length > 0, `${nome}: o teste precisa ter capturado logs de verdade`);
    assertEquals(tudo.includes(TOKEN_DA_LOJA), false, `${nome}: token no log/resposta`);
    assertEquals(tudo.includes(VENDEDOR), false, `${nome}: seller ID no log/resposta`);
  }
});

// ── B2: ambiguidade olha TODOS os registros 'sistema' do case_id ──────────────
// Não só o lote de 50, nem só as linhas elegíveis: o outro pedido pode estar fora
// do lote (jovem demais), ou já resolvido. Cron e tópico: o MESMO miolo.

async function topicoAmbiguo(b: ReturnType<typeof bancoVivo>) {
  const m = mp({ orderStatus: 404, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const w = await webhook(b, m);
  return { w, m, chaves: b.rpcs.filter((x) => x.nome === "reservar_aviso_ao_lojista").map((x) => x.args.p_chave as string).sort() };
}

for (const [rotulo, outra] of [
  ["o outro pedido está FORA do lote (linha jovem, não elegível)", { updated_at: ha(0.1) }],
  ["o outro pedido já está RESOLVIDO (linha liberada)", { status: "liberado" }],
] as Array<[string, Record<string, unknown>]>) {
  Deno.test(`B2 cron: ${rotulo} -> o case_id em 2 pedidos é ambíguo: 0 GET de caso, 0 RPC, aviso, a linha elegível NÃO é liberada`, async () => {
    const b = bancoVivo([linhaVinculada("L1"), linhaVinculada("L2", { order_id: OUTRO_PEDIDO, mp_chargeback_id: "CBK2", ...outra })]);
    const m = mp({ orderStatus: 404, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
    const r = await cron(b, m);
    assertEquals([m.casosLidos(), doLedger(b)], [0, []]);
    assertEquals(b.linhas[0].status, "em_processamento");
    assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:caso_em_mais_de_um_pedido`]);
    assertEquals([r.resumo.vistas, r.resumo.conservadas, r.resumo.reconsultadas], [1, 1, 0]);
  });

  Deno.test(`B2 tópico: ${rotulo} -> ambíguo: 200, 0 GET ao MP, 0 RPC de decisão, aviso`, async () => {
    const b = bancoVivo([linhaVinculada("L1"), linhaVinculada("L2", { order_id: OUTRO_PEDIDO, mp_chargeback_id: "CBK2", ...outra })]);
    const { w, m, chaves } = await topicoAmbiguo(b);
    assertEquals([w.status, w.corpo.desfecho, m.chamadas, doLedger(b)], [200, "ambiguo", [], []]);
    assertEquals(chaves, [`contestacao_indefinida:${PEDIDO}:caso_em_mais_de_um_pedido`], "o aviso sai pelo pedido resolvido; o outro avisa no seu próprio ciclo");
    assertEquals(b.linhas[0].status, "em_processamento");
  });
}

Deno.test("B2: mais de 50 linhas do sistema no lote e o outro pedido do mesmo case_id fora dele -> a contagem não depende do lote (ambíguo)", async () => {
  const linhas = [linhaVinculada("L1", { updated_at: ha(20) })];
  for (let i = 0; i < 60; i++) {
    linhas.push(linhaVinculada(`X${i}`, { order_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, mp_chargeback_id: `CBX${i}`, mp_chargeback_case_id: `CASEX${i}`, updated_at: ha(8 + i / 100) }));
  }
  // o outro pedido do CASE1 está fora do lote de 50 (o mais novo dos elegíveis perde a vaga)
  linhas.push(linhaVinculada("L2", { order_id: OUTRO_PEDIDO, mp_chargeback_id: "CBK2", updated_at: ha(6.5) }));
  const b = bancoVivo(linhas);
  const m = mp({ orderStatus: 404, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const r = await cron(b, m);
  assertEquals(doLedger(b).filter((x) => x.p_case_id === "CASE1"), []);
  assert(!m.chamadas.some((u) => u.endsWith("/chargebacks/CASE1")), "CASE1 não foi consultado");
  assertEquals(r.avisos.includes(`contestacao_indefinida:${PEDIDO}:caso_em_mais_de_um_pedido`), true);
});

// ── O1: a linha legada sem vínculo ao lado de uma vinculada ────────────────────

Deno.test("O1: linha LEGADA (sem vínculo) + linha vinculada no MESMO pedido, order 'charged_back' com chargebacks[] ilegível -> a vinculada resolve pelo caso e a legada CONSERVA e AVISA (não gira em silêncio, não conta como emAberto)", async () => {
  const b = bancoVivo([
    linhaVinculada("L1"),
    linhaVinculada("L2", { mp_chargeback_id: null, mp_chargeback_case_id: null }),
  ]);
  // order em charged_back, mas sem chargebacks[] legível (lista vazia)
  const m = mp({
    order: orderProcessada({ status: "charged_back", detalhe: "in_process", chargebacks: [] }),
    casos: { CASE1: { status: 200, corpo: caso("CASE1", null) } },
  });
  const r = await cron(b, m);
  assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:order_sem_chargebacks_legivel`]);
  assertEquals([r.resumo.emAberto, r.resumo.conservadas], [0, 1], "não é 'em aberto' em silêncio");
  assertEquals(doLedger(b), [], "o caso vinculado ainda está em análise: nada a entregar");
  assertEquals(b.linhas.map((l) => l.status), ["em_processamento", "em_processamento"]);
});

Deno.test("O1: o mesmo, com o caso vinculado JÁ a favor da loja -> libera a vinculada E avisa pela legada (a decisão entregue vale; o desfecho é 'entregue')", async () => {
  const b = bancoVivo([
    linhaVinculada("L1"),
    linhaVinculada("L2", { mp_chargeback_id: null, mp_chargeback_case_id: null }),
  ]);
  const m = mp({
    order: orderProcessada({ status: "charged_back", detalhe: "reimbursed", chargebacks: [] }),
    casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } },
  });
  const r = await cron(b, m);
  assertEquals(b.linhas.map((l) => l.status), ["liberado", "em_processamento"]);
  assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:order_sem_chargebacks_legivel`]);
  assertEquals([r.resumo.reconsultadas, r.resumo.emAberto], [1, 0]);
});

// ── B2 na BORDA PAGINADA: o PostgREST limita as linhas por resposta (db-max-rows) ──
// https://docs.postgrest.org/en/stable/references/configuration.html#db-max-rows
// Um `select(order_id)` + dedupe em memória só vê a primeira página: o outro pedido
// do mesmo case_id pode não aparecer e a guarda "provaria" o contrário do que
// afirma. A guarda pergunta ao SERVIDOR se EXISTE OUTRO order_id com esse case_id
// (neq + limit 1), sem filtro de estado, idade nem elegibilidade.

Deno.test("B2 borda paginada, CRON: o dublê só entrega 1 linha por resposta (a página 1 só traz o pedido A) -> mesmo assim é ambíguo: 0 GET ao MP, 0 RPC, aviso, nada liberado", async () => {
  const b = bancoVivo([linhaVinculada("L1"), linhaVinculada("L2", { order_id: OUTRO_PEDIDO, mp_chargeback_id: "CBK2", updated_at: ha(0.1) })], { maxRows: 1 });
  const m = mp({ orderStatus: 404, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const r = await cron(b, m);
  assertEquals([m.casosLidos(), doLedger(b)], [0, []]);
  assertEquals(b.linhas[0].status, "em_processamento");
  assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:caso_em_mais_de_um_pedido`]);
});

Deno.test("B2 borda paginada, TÓPICO: idem — o primeiro pedido resolvido e a MESMA guarda: ambíguo, 200, 0 GET ao MP, 0 RPC, aviso", async () => {
  const b = bancoVivo([linhaVinculada("L1"), linhaVinculada("L2", { order_id: OUTRO_PEDIDO, mp_chargeback_id: "CBK2", status: "liberado" })], { maxRows: 1 });
  const { w, m, chaves } = await topicoAmbiguo(b);
  assertEquals([w.status, w.corpo.desfecho, m.chamadas, doLedger(b)], [200, "ambiguo", [], []]);
  assertEquals(chaves, [`contestacao_indefinida:${PEDIDO}:caso_em_mais_de_um_pedido`]);
  assertEquals(b.linhas[0].status, "em_processamento");
});

Deno.test("B2: com a borda paginada, o caso de UM pedido só continua resolvendo (a guarda não bloqueia o legítimo)", async () => {
  const b = bancoVivo([linhaVinculada("L1"), linhaVinculada("L2", { order_id: OUTRO_PEDIDO, mp_chargeback_id: "CBK2", mp_chargeback_case_id: "CASE2" })], { maxRows: 1 });
  const m = mp({ orderStatus: 404, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  await cron(b, m);
  assertEquals(b.linhas[0].status, "liberado");
});

Deno.test("B2: ERRO na consulta de existência -> CONSERVA como falha TEMPORÁRIA (nunca 'não ambíguo'): cron falhas+1, 0 GET ao MP, 0 RPC, linha intacta, sem aviso; o tópico responde 500", async () => {
  const b = bancoVivo([linhaVinculada("L1")], { erroNaExistencia: true });
  const antes = JSON.stringify(b.linhas);
  const m = mp({ orderStatus: 404, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } });
  const r = await cron(b, m);
  assertEquals([m.casosLidos(), doLedger(b), JSON.stringify(b.linhas), r.avisos], [0, [], antes, []]);
  assertEquals([r.resumo.falhas, r.resumo.conservadas, r.resumo.reconsultadas], [1, 0, 0]);
  const w = await webhook(bancoVivo([linhaVinculada("L1")], { erroNaExistencia: true }), mp({ orderStatus: 404, casos: { CASE1: { status: 200, corpo: caso("CASE1", true) } } }));
  assertEquals(w.status, 500);
});
