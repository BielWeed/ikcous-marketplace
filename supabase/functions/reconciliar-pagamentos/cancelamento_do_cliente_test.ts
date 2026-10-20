// @ts-nocheck
/**
 * O lojista sabe quando o CLIENTE cancela (14/10/2026) — a rotina de 10
 * minutos, de ponta a ponta pelo `handler`.
 *
 * O que isto prende e os testes do módulo (`_shared/aviso-de-cancelamento-do-
 * cliente_test.ts`) não alcançam: o passo está LIGADO na rotina, usa a reserva
 * de verdade (`avisarAdminUmaVez` com a RPC `reservar_aviso_ao_lojista` —
 * aqui um dublê com a MESMA semântica: a chave nova reserva, 'enviado' não
 * repete, push que não chegou a ninguém libera), e a falha do passo (leitura
 * do histórico, push que lança) NÃO derruba a CONFIRMAÇÃO DE PAGAMENTO.
 *
 * O que este arquivo NÃO prova: a fila de estornos. O dublê de `order_refunds`
 * daqui devolve sempre vazio. A prova de que o passo não prende nem atrasa os
 * estornos (push que nunca responde + linha na fila, o estorno sai) mora em
 * `index_test.ts`, nos dois testes "cancelamento do cliente:", que usam o
 * dublê completo da fila.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const SEGREDO = "segredo-reconciliacao-teste";
const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const ADMIN = "a1111111-1111-4111-8111-111111111111";
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const PEDIDO_PAGAR = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORDER_PAGAR = "ORDTST01KZZ4D94WC79335A68CZ5NZ7Y";

Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");

const requisicao = () =>
  new Request("http://localhost/reconciliar-pagamentos", {
    method: "POST",
    headers: { "x-reconciliacao-secret": SEGREDO },
  });

function cadeiaVazia() {
  const q = {
    eq: () => q,
    lt: () => q,
    order: () => q,
    limit: () => q,
    then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return q;
}
const ehLeituraDeContestacao = (c: string) => c.trim() === "id" || c.trim() === "id, order_id, updated_at";

// Leitura por nome de coluna sem indexação dinâmica (security/detect-object-injection).
const campo = (linha: Record<string, unknown>, coluna: string) => Reflect.get(linha, coluna);

/** Tabelas em memória com os filtros que o passo usa (eq, not, gte, in, order, limit). */
function tabelaFalsa(linhas: Record<string, unknown>[], falhar = false) {
  let rs = [...linhas];
  let cols: string[] | null = null;
  const q = {
    select: (c: string) => ((cols = c.split(",").map((x) => x.trim())), q),
    eq: (c: string, v: unknown) => ((rs = rs.filter((l) => campo(l, c) === v)), q),
    not: (c: string, _op: string, _v: unknown) => ((rs = rs.filter((l) => campo(l, c) != null)), q),
    gte: (c: string, v: string) => ((rs = rs.filter((l) => String(campo(l, c)) >= v)), q),
    in: (c: string, vs: unknown[]) => ((rs = rs.filter((l) => vs.includes(campo(l, c)))), q),
    order: (c: string, o: { ascending: boolean }) => (
      rs.sort((a, b) => (String(campo(a, c)) < String(campo(b, c)) ? -1 : 1) * (o?.ascending === false ? -1 : 1)), q
    ),
    limit: (n: number) => ((rs = rs.slice(0, n)), q),
    then: (res, rej) =>
      Promise.resolve(
        falhar
          ? { data: null, error: { message: "tabela fora do ar" } }
          : { data: cols ? rs.map((l) => Object.fromEntries(cols.map((c) => [c, campo(l, c)]))) : rs, error: null },
      ).then(res, rej),
  };
  return q;
}

type Mundo = {
  historico: Record<string, unknown>[];
  pedidos: Record<string, unknown>[];
  perfis: Record<string, unknown>[];
  /** Reservas de aviso: chave -> enviado? (vive entre rodadas, como a tabela). */
  reservas: Map<string, boolean>;
  falharHistorico?: boolean;
  candidatos?: Array<{ order_id: string; gateway_payment_id: string }>;
  chamadas: Array<{ nome: string; args: Record<string, unknown> }>;
};

function supabaseFalso(m: Mundo) {
  const vazio = { maybeSingle: () => Promise.resolve({ data: null, error: null }) };
  const responder = (nome: string, args: Record<string, unknown>) => {
    if (nome === "pagamentos_a_reconciliar") return { data: m.candidatos ?? [], error: null };
    if (nome === "confirmar_pagamento") return { data: "pago", error: null };
    if (nome === "liberar_cobranca_do_pedido") return { data: false, error: null };
    if (nome === "marcar_visitas_da_reconciliacao") return { data: 1, error: null };
    if (nome === "reservar_aviso_ao_lojista") {
      const chave = String(args.p_chave);
      if (!m.reservas.has(chave)) {
        m.reservas.set(chave, false);
        return { data: "reservado", error: null };
      }
      return { data: m.reservas.get(chave) ? "enviado" : "em_envio", error: null };
    }
    if (nome === "confirmar_aviso_ao_lojista") {
      m.reservas.set(String(args.p_chave), true);
      return { data: null, error: null };
    }
    if (nome === "liberar_aviso_ao_lojista") {
      if (m.reservas.get(String(args.p_chave)) === false) m.reservas.delete(String(args.p_chave));
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
  return {
    rpc: (nome: string, args: Record<string, unknown>) => {
      m.chamadas.push({ nome, args });
      return Promise.resolve(responder(nome, args));
    },
    from(tabela: string) {
      if (tabela === "marketplace_order_history") return tabelaFalsa(m.historico, m.falharHistorico);
      if (tabela === "marketplace_orders") {
        const q = tabelaFalsa(m.pedidos);
        const inOriginal = q.in;
        // O laço de pagamentos relê o pedido por `eq(...).maybeSingle()`.
        q.eq = (c: string, v: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: { total: 149.9, total_amount: null }, error: null }),
          then: (res, rej) => Promise.resolve({ data: m.pedidos.filter((l) => campo(l, c) === v), error: null }).then(res, rej),
        });
        q.in = inOriginal;
        return q;
      }
      if (tabela === "profiles") return tabelaFalsa(m.perfis);
      if (tabela === "app_settings") return { select: () => ({ eq: () => vazio }) };
      if (tabela === "order_refunds") {
        const fim = { limit: () => Promise.resolve({ data: [], error: null }) };
        return {
          select: (c: string) =>
            ehLeituraDeContestacao(c)
              ? cadeiaVazia()
              : { in: () => ({ neq: () => ({ lt: () => ({ order: () => ({ order: () => fim }) }) }) }) },
        };
      }
      throw new Error(`from inesperado no dublê: ${tabela}`);
    },
  };
}

const agoraISO = (minAtras: number) => new Date(Date.now() - minAtras * 60000).toISOString();
const hist = (id: string, extra = {}) => ({
  id,
  order_id: PEDIDO,
  old_status: "processing",
  new_status: "cancelled",
  created_by: CLIENTE,
  created_at: agoraISO(2),
  ...extra,
});
const pedido = (extra = {}) => ({
  id: PEDIDO,
  user_id: CLIENTE,
  customer_name: "Maria Silva",
  total: 149.9,
  total_amount: null,
  payment_status: "pago",
  status: "cancelled",
  cancelled_after_shipping: false,
  ...extra,
});

function novoMundo(extra: Partial<Mundo> = {}): Mundo {
  return {
    historico: [],
    pedidos: [pedido()],
    perfis: [{ id: CLIENTE, role: "customer" }, { id: ADMIN, role: "admin" }],
    reservas: new Map(),
    chamadas: [],
    ...extra,
  };
}

/** Uma rodada da rotina. `entregues`: quantas inscrições o push "alcançou". */
async function rodar(m: Mundo, opts: { entregues?: number; quebrarPush?: boolean } = {}) {
  const pushes: Array<{ title: string; body: string; url: string }> = [];
  const erros: string[] = [];
  const e0 = console.error, w0 = console.warn, l0 = console.log;
  console.error = (...a: unknown[]) => erros.push(a.map(String).join(" "));
  console.warn = () => {};
  console.log = () => {};
  try {
    const r = await handler(requisicao(), {
      supabase: supabaseFalso(m),
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: ORDER_PAGAR,
              status: "processed",
              status_detail: "accredited",
              total_amount: "149.90",
              transactions: {
                payments: [{ id: "P1", amount: "149.90", status: "processed", status_detail: "accredited", payment_method: { id: "visa", type: "credit_card" } }],
              },
            }),
            { status: 200 },
          ),
        ),
      enviarComprovante: async () => {},
      enviarAvisoAtrasado: async () => {},
      enviarPush: async () => {},
      // O push contado do aviso ao admin uma vez: devolve quantas inscrições alcançou.
      enviarPushContado: async ({ aviso }) => {
        if (opts.quebrarPush) throw new Error("push fora do ar");
        pushes.push(aviso);
        return opts.entregues ?? 1;
      },
    });
    return { status: r.status, corpo: await r.json(), pushes, erros };
  } finally {
    console.error = e0;
    console.warn = w0;
    console.log = l0;
  }
}

Deno.test("a rotina avisa o lojista quando o CLIENTE cancelou pedido pago (UM push)", async () => {
  const m = novoMundo({ historico: [hist("h1")] });
  const r = await rodar(m);
  assertEquals(r.status, 200);
  assertEquals(r.pushes, [{
    title: "Cliente cancelou o pedido",
    body: "#4F5A6B · R$ 149,90 · Maria Silva — pago, o reembolso é automático",
    url: "/admin-orders",
  }]);
  assertEquals(r.corpo.cancelamentos, { candidatos: 1, avisados: 1, ignorados: 0, falhas: 0 });
});

Deno.test("cliente cancelou pedido JA ENVIADO -> a rotina avisa com o texto do transporte", async () => {
  const m = novoMundo({
    historico: [hist("h1", { old_status: "shipping" })],
    pedidos: [pedido({ cancelled_after_shipping: true })],
  });
  const r = await rodar(m);
  assertEquals(r.pushes.length, 1);
  assert(r.pushes[0].body.includes("o produto já saiu: avise o transporte"), r.pushes[0].body);
});

Deno.test("ADMIN cancelando -> nenhum push", async () => {
  const m = novoMundo({ historico: [hist("h1", { created_by: ADMIN })] });
  const r = await rodar(m);
  assertEquals(r.pushes.length, 0);
});

Deno.test("expiracao do PIX / recusa (sem autor, pedido nao pago) -> nenhum push", async () => {
  const m = novoMundo({
    historico: [hist("h1", { created_by: null }), hist("h2", { id: "h2" })],
    pedidos: [pedido({ payment_status: "expirado" })],
  });
  const r = await rodar(m);
  assertEquals(r.pushes.length, 0);
});

Deno.test("REENTRADA: a rotina roda duas vezes e o lojista recebe UM aviso so", async () => {
  const m = novoMundo({ historico: [hist("h1")] });
  const a = await rodar(m);
  const b = await rodar(m);
  assertEquals(a.pushes.length, 1);
  assertEquals(b.pushes.length, 0);
  assertEquals([...m.reservas.entries()], [["cancelado_pelo_cliente:h1", true]]);
});

Deno.test("SEGUNDO cancelamento (reativou e cancelou de novo) = evento novo = novo aviso", async () => {
  const m = novoMundo({ historico: [hist("h1", { created_at: agoraISO(120) })] });
  await rodar(m);
  m.historico.push(hist("h2", { created_at: agoraISO(1) }));
  const r = await rodar(m);
  assertEquals(r.pushes.length, 1);
  assertEquals([...m.reservas.keys()].sort(), ["cancelado_pelo_cliente:h1", "cancelado_pelo_cliente:h2"]);
});

Deno.test("nenhum admin com push (0 entregas): a reserva e SOLTA e a proxima rodada tenta de novo", async () => {
  const m = novoMundo({ historico: [hist("h1")] });
  await rodar(m, { entregues: 0 });
  assertEquals(m.reservas.size, 0);
  const b = await rodar(m, { entregues: 1 });
  assertEquals(b.pushes.length, 1);
});

Deno.test("a LEITURA do historico falha: o passo registra o erro e a rotina segue (pagamento confirmado, resposta 200)", async () => {
  const m = novoMundo({
    historico: [hist("h1")],
    falharHistorico: true,
    candidatos: [{ order_id: PEDIDO_PAGAR, gateway_payment_id: ORDER_PAGAR }],
  });
  const r = await rodar(m);
  assertEquals(r.status, 200);
  assertEquals([r.corpo.verificados, r.corpo.confirmados, r.corpo.falhas], [1, 1, 0]);
  assert(m.chamadas.some((c) => c.nome === "confirmar_pagamento"));
  assert(r.erros.some((e) => e.includes("aviso de cancelamento do cliente")), r.erros.join("\n"));
  assertEquals(r.corpo.cancelamentos, { candidatos: 0, avisados: 0, ignorados: 0, falhas: 0 });
});

Deno.test("o PUSH lanca: o passo nao derruba nada (resposta 200, pagamento confirmado) e a reserva expira sozinha", async () => {
  const m = novoMundo({
    historico: [hist("h1")],
    candidatos: [{ order_id: PEDIDO_PAGAR, gateway_payment_id: ORDER_PAGAR }],
  });
  const r = await rodar(m, { quebrarPush: true });
  assertEquals(r.status, 200);
  assertEquals([r.corpo.confirmados, r.corpo.falhas], [1, 0]);
  // Push que lanca = 0 entregas: a reserva e solta e a proxima rodada tenta.
  assertEquals(m.reservas.size, 0);
});
