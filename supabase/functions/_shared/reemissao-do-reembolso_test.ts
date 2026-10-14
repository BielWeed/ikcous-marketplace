import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { reemitirReembolsoDaDevolucao } from "./reemissao-do-reembolso.ts";

/**
 * A reemissão do reembolso da devolução, do lado do servidor (14/10/2026): o
 * Mercado Pago é consultado ANTES de o banco decidir criar × adotar × parar
 * (`reemitir_reembolso_da_devolucao`, migration 20261225000000). Aqui o banco e o
 * MP são dublês; o que se prova é a ORDEM e o que passa de um ao outro:
 *   * consulta indeterminada (M1 GET 500, M2 rede) NÃO chega ao banco;
 *   * o ator é o admin autenticado; a linha esperada vai junto;
 *   * o refund achado é o do valor da linha e que nenhuma outra linha reivindicou.
 */

const DEVOLUCAO = "d0000000-0000-4000-8000-000000000001";
const ESPERADA = "e0000000-0000-4000-8000-000000000002";
const PEDIDO_ID = "a0000000-0000-4000-8000-000000000003";
const ADMIN = "b0000000-0000-4000-8000-000000000004";
const ORDER = "ORD01ABCDEFOLUIMWQKDXYZ01";

type Fake = {
  devolucao?: unknown;
  linha?: unknown;
  pedido?: unknown;
  reivindicados?: string[];
  rpc?: { data?: unknown; error?: unknown };
  erroLeitura?: string;
};

function supabaseFalso(f: Fake) {
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const leituras: string[] = [];
  const cliente = {
    rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      return Promise.resolve({ data: f.rpc?.data ?? null, error: f.rpc?.error ?? null });
    },
    from(tabela: string) {
      const filtros: string[] = [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string) => (filtros.push(`eq:${c}`), q),
        neq: (c: string) => (filtros.push(`neq:${c}`), q),
        not: (c: string) => (filtros.push(`not:${c}`), q),
        maybeSingle: () => q,
        then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
          leituras.push(tabela);
          if (f.erroLeitura === tabela) return Promise.resolve({ data: null, error: { message: "banco fora" } }).then(res, rej);
          const data = tabela === "devolucoes"
            ? f.devolucao
            : tabela === "marketplace_orders"
            ? f.pedido
            : filtros.some((x) => x.startsWith("not:"))
            ? (f.reivindicados ?? []).map((mp_refund_id) => ({ mp_refund_id }))
            : f.linha;
          return Promise.resolve({ data: data ?? null, error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
  return { cliente, rpcs, leituras };
}

const devolucaoOk = { id: DEVOLUCAO, order_id: PEDIDO_ID };
const linhaOk = { id: ESPERADA, order_id: PEDIDO_ID, amount: 50 };
const pedidoOk = {
  id: PEDIDO_ID,
  gateway_payment_id: ORDER,
  total: 100,
  valor_estornado: 0,
  payment_status: "pago",
  paid_at: "2026-10-01T00:00:00Z",
  status: "delivered",
};

function mp(status: number, corpo: unknown) {
  const chamadas: string[] = [];
  const f = ((entrada: string | URL | Request, init?: RequestInit) => {
    chamadas.push(`${(init?.method ?? "GET").toUpperCase()} ${String(entrada)}`);
    return Promise.resolve(new Response(JSON.stringify(corpo), { status }));
  }) as typeof fetch;
  return { f, chamadas };
}

const orderSemReembolso = {
  id: ORDER,
  status: "processed",
  transactions: { payments: [{ id: "PAY1", status: "processed" }] },
};

function reemitir(fake: Fake, buscar: typeof fetch) {
  const base = supabaseFalso(fake);
  return {
    ...base,
    resposta: reemitirReembolsoDaDevolucao({
      supabase: base.cliente,
      devolucaoId: DEVOLUCAO,
      refundEsperado: ESPERADA,
      ator: ADMIN,
      token: "TESTE_TOKEN",
      buscar,
    }),
  };
}

const completo = { devolucao: devolucaoOk, linha: linhaOk, pedido: pedidoOk };

Deno.test("M1 - GET 500 no MP: indeterminado e o banco NÃO é chamado (nenhuma chave nova sem saber)", async () => {
  const r = reemitir(completo, mp(500, {}).f);
  assertEquals(await r.resposta, { http: 200, corpo: { resultado: "indeterminado", detalhe: "consulta_inconclusiva" } });
  assertEquals(r.rpcs.length, 0);
});

Deno.test("M2 - falha de rede na consulta: indeterminado e o banco NÃO é chamado", async () => {
  const r = reemitir(completo, (() => Promise.reject(new Error("rede"))) as typeof fetch);
  assertEquals((await r.resposta).corpo.resultado, "indeterminado");
  assertEquals(r.rpcs.length, 0);
});

Deno.test("M3 - devolução do painel em parcelas (refunds sem dono de outros valores): indeterminado, o banco NÃO é chamado", async () => {
  const corpo = {
    ...orderSemReembolso,
    transactions: { payments: [{ id: "PAY1" }], refunds: [{ id: "P1", amount: "20.00", status: "processed" }, { id: "P2", amount: "30.00", status: "processed" }] },
  };
  const r = reemitir(completo, mp(200, corpo).f);
  assertEquals((await r.resposta).corpo.resultado, "indeterminado");
  assertEquals(r.rpcs.length, 0);
});

Deno.test("nao_achou vai ao banco com o ator (admin autenticado) e a linha esperada; a resposta do banco volta como está", async () => {
  const dadosDoBanco = { resultado: "reemitido", detalhe: "tentativa_nova", refund_id: "novo", refund_anterior: ESPERADA };
  const r = reemitir({ ...completo, rpc: { data: dadosDoBanco } }, mp(200, orderSemReembolso).f);
  assertEquals(await r.resposta, { http: 200, corpo: dadosDoBanco });
  assertEquals(r.rpcs, [{
    nome: "reemitir_reembolso_da_devolucao",
    args: { p_devolucao_id: DEVOLUCAO, p_ator: ADMIN, p_refund_esperado: ESPERADA, p_consulta: { resultado: "nao_achou" } },
  }]);
});

Deno.test("achou: o banco recebe o id, o status e o valor do refund do MP", async () => {
  const corpo = {
    ...orderSemReembolso,
    transactions: { payments: [{ id: "PAY1" }], refunds: [{ id: "REF9", amount: "50.00", status: "processed" }] },
  };
  const r = reemitir({ ...completo, rpc: { data: { resultado: "ja_existia", detalhe: "adotado" } } }, mp(200, corpo).f);
  assertEquals((await r.resposta).corpo.resultado, "ja_existia");
  assertEquals(r.rpcs[0].args.p_consulta, { resultado: "achou", mp_refund_id: "REF9", mp_status: "processed", valor: 50 });
});

Deno.test("M4 - o refund achado já pertence a OUTRA linha do pedido: não é adotado por esta (vai nao_achou ao banco, que decide)", async () => {
  const corpo = {
    ...orderSemReembolso,
    transactions: { payments: [{ id: "PAY1" }], refunds: [{ id: "REF9", amount: "50.00", status: "processed" }] },
  };
  const r = reemitir({ ...completo, reivindicados: ["REF9"], rpc: { data: { resultado: "use_por_fora", detalhe: "sem_prova_de_que_nao_saiu" } } }, mp(200, corpo).f);
  await r.resposta;
  assertEquals(r.rpcs[0].args.p_consulta, { resultado: "nao_achou" });
});

Deno.test("só GET no MP: a reemissão nunca faz POST (a tentativa nova é executada depois, pela ação normal)", async () => {
  const dubleMp = mp(200, orderSemReembolso);
  const r = reemitir({ ...completo, rpc: { data: { resultado: "reemitido", detalhe: "tentativa_nova" } } }, dubleMp.f);
  await r.resposta;
  assertEquals(dubleMp.chamadas.map((c) => c.split(" ")[0]), ["GET"]);
});

Deno.test("a linha esperada é de OUTRO pedido: reembolso_mudou, sem consultar o MP nem chamar o banco", async () => {
  const dubleMp = mp(200, orderSemReembolso);
  const r = reemitir({ ...completo, linha: { ...linhaOk, order_id: "outro-pedido" } }, dubleMp.f);
  assertEquals((await r.resposta).corpo.resultado, "reembolso_mudou");
  assertEquals(dubleMp.chamadas.length, 0);
  assertEquals(r.rpcs.length, 0);
});

Deno.test("devolução ou linha inexistente: 404; erro de leitura: 500 — nada vai ao MP nem ao banco", async () => {
  const dubleMp = mp(200, orderSemReembolso);
  assertEquals((await reemitir({ ...completo, devolucao: null }, dubleMp.f).resposta).http, 404);
  assertEquals((await reemitir({ ...completo, linha: null }, dubleMp.f).resposta).http, 404);
  const quebrado = reemitir({ ...completo, erroLeitura: "marketplace_orders" }, dubleMp.f);
  assertEquals((await quebrado.resposta).http, 500);
  assertEquals(quebrado.rpcs.length, 0);
  assertEquals(dubleMp.chamadas.length, 0);
});

Deno.test("erros do banco viram resposta honesta: 42501 -> 403, P0002 -> 404, 22023 -> 409 com a mensagem, outro -> 500 sem vazar", async () => {
  const casos: Array<[string, number]> = [["42501", 403], ["P0002", 404], ["22023", 409], ["XX000", 500]];
  for (const [code, http] of casos) {
    const r = reemitir({ ...completo, rpc: { error: { code, message: "Só uma devolução concluída com reembolso pode reemitir." } } }, mp(200, orderSemReembolso).f);
    const { http: obtido, corpo } = await r.resposta;
    assertEquals(obtido, http, code);
    if (code === "XX000") assertEquals(JSON.stringify(corpo).includes("Só uma devolução"), false);
  }
});

Deno.test("resposta do banco sem 'resultado' legível: 500 (não inventa sucesso)", async () => {
  const r = reemitir({ ...completo, rpc: { data: { coisa: 1 } } }, mp(200, orderSemReembolso).f);
  assertEquals((await r.resposta).http, 500);
});
