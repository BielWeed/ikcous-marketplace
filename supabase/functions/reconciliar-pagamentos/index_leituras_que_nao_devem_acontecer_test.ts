// @ts-nocheck
/**
 * reconciliar-pagamentos — três decisões do laço de pagamentos que a suíte
 * principal só observava pelo resultado final (caça por mutação "só testes",
 * 25/11/2026). Em cada uma, uma condição trocada produzia o MESMO resultado
 * quando o banco respondia bem, e só aparecia quando ele falhava ou quando a
 * order vinha torta:
 *
 *  1. ORDER SEM ID atrás do sentinela do cartão: o id vira texto vazio e a
 *     adoção PARA. Sem essa guarda, o id viraria "undefined" e a consulta, a
 *     conferência e a gravação do `gateway_payment_id` seguiriam em cima dele.
 *  2. A segunda evidência do método (leitura de `metodo_online`) só vale para
 *     recusa/expiração. Num pagamento APROVADO a leitura não pode acontecer:
 *     se ela falhasse, um PIX pago deixaria de ser confirmado por um dado que
 *     a aprovação nem usa.
 *  3. A prova pela devolução parcial só roda quando o MP disse
 *     `partially_refunded`. Status DESCONHECIDO continua "ignorado, nada
 *     escrito", mesmo que a leitura do pedido que a prova faria esteja fora
 *     do ar.
 *
 * O banco é um dublê NEUTRO: qualquer consulta que o teste não roteirizou
 * devolve vazio, sem erro, e toda escrita é registrada. Dados inventados.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const SEGREDO = "segredo-ficticio-leituras-que-nao-devem-acontecer";
Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-ficticio-leituras");

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const ORDER_PIX = "ORDTST01LEITURAS00PIXAPROVADO";
const SENTINELA = `verificando:${PEDIDO}:c0`;

type Linha = Record<string, unknown>;
type Retorno = { data: unknown; error: unknown };

type Leitura = (tabela: string, colunas: string) => Retorno | undefined;

function banco(opts: {
  candidatos: Array<{ order_id: string; gateway_payment_id: string }>;
  /** Roteiriza leituras `select(...)`; `undefined` = vazio neutro. */
  leitura?: Leitura;
}) {
  const escritas: Array<{ tabela: string; valores: Linha }> = [];
  const leituras: Array<{ tabela: string; colunas: string }> = [];
  const rpcs: Array<{ nome: string; args: unknown }> = [];

  const cadeia = (tabela: string) => {
    let colunas = "";
    let valores: Linha | null = null;
    const q: any = {};
    const encadear = () => q;
    Object.assign(q, {
      eq: encadear,
      neq: encadear,
      in: encadear,
      is: encadear,
      lt: encadear,
      lte: encadear,
      gt: encadear,
      gte: encadear,
      not: encadear,
      order: encadear,
      limit: encadear,
      ilike: encadear,
      or: encadear,
    });
    q.select = (c?: string) => {
      colunas = c ?? "";
      if (valores === null) leituras.push({ tabela, colunas });
      return q;
    };
    q.update = (v: Linha) => {
      valores = v;
      escritas.push({ tabela, valores: v });
      return q;
    };
    const resolverLista = (): Retorno => {
      if (valores !== null) return { data: [{ id: "linha-atualizada" }], error: null };
      return opts.leitura?.(tabela, colunas) ?? { data: [], error: null };
    };
    const resolverUnica = (): Retorno => {
      if (valores !== null) return { data: { id: "linha-atualizada" }, error: null };
      return opts.leitura?.(tabela, colunas) ?? { data: null, error: null };
    };
    q.maybeSingle = () => Promise.resolve(resolverUnica());
    q.single = () => Promise.resolve(resolverUnica());
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolverLista()).then(res, rej);
    return q;
  };

  const supabase = {
    from: (tabela: string) => cadeia(tabela),
    rpc: (nome: string, args: unknown) => {
      rpcs.push({ nome, args });
      if (nome === "pagamentos_a_reconciliar") {
        return Promise.resolve({ data: opts.candidatos, error: null });
      }
      if (nome === "confirmar_pagamento") return Promise.resolve({ data: "pago", error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { supabase, escritas, leituras, rpcs };
}

function requisicao() {
  return new Request("http://localhost/reconciliar-pagamentos", {
    method: "POST",
    headers: { "x-reconciliacao-secret": SEGREDO },
  });
}

async function rodar(
  b: ReturnType<typeof banco>,
  fetchImpl: (url: string) => Promise<Response>,
) {
  const reais = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    const resposta = await handler(requisicao(), {
      supabase: b.supabase,
      fetchImpl,
      enviarPush: () => Promise.resolve(),
      enviarComprovante: () => Promise.resolve(),
      enviarAvisoAtrasado: () => Promise.resolve(),
      enviarPushContado: () => Promise.resolve(1),
    });
    return { resposta, corpo: await resposta.json() };
  } finally {
    console.log = reais.log;
    console.warn = reais.warn;
    console.error = reais.error;
  }
}

const json = (corpo: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(corpo), { status }));

// ── 1. Order sem id atrás do sentinela ────────────────────────────────────

Deno.test("sentinela + order de cartão capturada SEM id na busca: não adota, não consulta '/orders/undefined' e não grava vaga nenhuma", async () => {
  const b = banco({
    candidatos: [{ order_id: PEDIDO, gateway_payment_id: SENTINELA }],
    leitura: (tabela, colunas) =>
      tabela === "marketplace_orders" && colunas.includes("created_at")
        ? { data: { created_at: "2026-11-25T12:00:00.000Z", total: 149.9, total_amount: null }, error: null }
        : undefined,
  });
  const urls: string[] = [];
  const orderSemId = {
    external_reference: PEDIDO,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
    date_created: "2026-11-25T12:00:00.000Z",
    transactions: {
      payments: [{ status: "processed", payment_method: { id: "visa", type: "credit_card", installments: 3 } }],
    },
  };
  const { resposta, corpo } = await rodar(b, (url) => {
    urls.push(String(url));
    if (String(url).includes("/v1/orders?")) return json({ results: [orderSemId] });
    return json({ message: "nao deveria consultar por id" }, 404);
  });

  assertEquals(resposta.status, 200);
  assertEquals(urls.filter((u) => !u.includes("/v1/orders?")), [], "nenhuma consulta por id: não há id");
  assertEquals(urls.some((u) => u.includes("undefined")), false);
  assertEquals(b.escritas.filter((e) => e.tabela === "marketplace_orders"), [], "a vaga do pedido não é tocada");
  assertEquals(b.rpcs.filter((r) => r.nome === "confirmar_pagamento"), []);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.falhas, 0);
});

// ── 2. Pagamento aprovado não lê o método ─────────────────────────────────

Deno.test("PIX aprovado: a leitura do método (metodo_online) NÃO acontece — e se ela falhasse, a confirmação seguiria igual", async () => {
  const b = banco({
    candidatos: [{ order_id: PEDIDO, gateway_payment_id: ORDER_PIX }],
    leitura: (tabela, colunas) => {
      if (tabela !== "marketplace_orders") return undefined;
      // A segunda evidência do método é só de recusa/expiração: aqui falharia.
      if (colunas.replaceAll(" ", "") === "metodo_online,gateway_payment_id") {
        return { data: null, error: { message: "banco fora do ar só para esta leitura" } };
      }
      return {
        data: {
          id: PEDIDO,
          total: 100,
          total_amount: null,
          gateway_payment_id: ORDER_PIX,
          payment_status: "aguardando",
          paid_at: null,
          status: "pending",
        },
        error: null,
      };
    },
  });
  const order = {
    id: ORDER_PIX,
    external_reference: PEDIDO,
    status: "processed",
    status_detail: "accredited",
    total_amount: "100.00",
    transactions: {
      payments: [{
        id: "PAY01PIX",
        amount: "100.00",
        status: "processed",
        payment_method: { id: "pix", type: "bank_transfer" },
      }],
    },
  };
  const { corpo } = await rodar(b, () => json(order));

  assertEquals(
    b.leituras.filter((l) => l.colunas.replaceAll(" ", "") === "metodo_online,gateway_payment_id"),
    [],
    "pagamento aprovado não tem por que ler o método gravado",
  );
  assertEquals(corpo.falhas, 0);
  assertEquals(corpo.confirmados, 1);
  assertEquals(b.rpcs.filter((r) => r.nome === "confirmar_pagamento").length, 1);
});

// ── 3. Status desconhecido não aciona a prova da devolução parcial ───────

Deno.test("status DESCONHECIDO do MP (sem 'partially_refunded'): ignorado e nada lido para a prova da parcial, mesmo com essa leitura fora do ar", async () => {
  const b = banco({
    candidatos: [{ order_id: PEDIDO, gateway_payment_id: ORDER_PIX }],
    leitura: (tabela, colunas) => {
      if (tabela !== "marketplace_orders") return undefined;
      if (colunas.includes("payment_status") && colunas.includes("paid_at")) {
        return { data: null, error: { message: "banco fora do ar só para esta leitura" } };
      }
      return undefined;
    },
  });
  const orderNova = {
    id: ORDER_PIX,
    external_reference: PEDIDO,
    status: "status_que_o_mp_inventou_hoje",
    status_detail: "detalhe_novo",
    total_amount: "100.00",
    transactions: { payments: [{ id: "PAY01", amount: "100.00", status: "novo" }] },
  };
  const { corpo } = await rodar(b, () => json(orderNova));

  assertEquals(
    b.leituras.filter((l) => l.colunas.includes("payment_status") && l.colunas.includes("paid_at")),
    [],
    "a prova da parcial só roda com partially_refunded",
  );
  assertEquals(corpo.ignorados, 1);
  assertEquals(corpo.falhas, 0);
  assertEquals(corpo.confirmados, 0);
  assertEquals(b.rpcs.filter((r) => r.nome === "confirmar_pagamento"), []);
  assertEquals(b.escritas.filter((e) => e.tabela === "marketplace_orders"), []);
});
