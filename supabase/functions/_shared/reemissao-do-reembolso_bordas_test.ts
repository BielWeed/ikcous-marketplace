// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `reemissao-do-reembolso.ts` — a ponte que
 * pergunta ao Mercado Pago "esse dinheiro já saiu?" ANTES de o banco recriar
 * uma linha de reembolso (recriar sem saber paga a cliente duas vezes). 41
 * mutantes plantados; 16 sobreviviam às suítes de `reemissao-do-reembolso_test.ts`
 * e `_pedido_ausente_test.ts` (6 são equivalentes: `?? ""`/`?? 0`/`?? null` de
 * valores que `String`/`Number` já tratam igual, o filtro de `typeof` sobre uma
 * coluna de texto e o `typeof data !== "object"`, que a checagem de `resultado` logo depois repete).
 * Os outros 10 mudavam o resultado. O dublê delas devolve a MESMA linha para
 * qualquer filtro, então apagar um `.eq(...)` não derrubava nada — e sem o
 * `.eq("id", ...)` o `maybeSingle` pegaria uma devolução, uma linha de
 * reembolso ou um pedido QUALQUER. Aqui o banco é em memória e APLICA os
 * filtros (`eq`, `neq`, `not ... is null`), com a linha certa sempre atrás de
 * uma linha errada:
 *
 *   * a devolução, a linha esperada e o pedido são os dos ids pedidos (a URL do
 *     MP leva o id de cobrança do PEDIDO certo);
 *   * os ids "já reivindicados" são os de OUTRAS linhas do MESMO pedido: nem os
 *     da própria linha, nem os de outro pedido;
 *   * erro de leitura da devolução ou da linha é 500 (e não "não encontrada");
 *   * linha de outro pedido responde `reembolso_mudou / outra_linha`, HTTP 200;
 *   * lista de ids que vem `null` do banco não derruba a reemissão.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { reemitirReembolsoDaDevolucao } from "./reemissao-do-reembolso.ts";

const DEVOLUCAO = "d0000000-0000-4000-8000-000000000001";
const ESPERADA = "e0000000-0000-4000-8000-000000000002";
const PEDIDO_ID = "a0000000-0000-4000-8000-000000000003";
const OUTRO_PEDIDO = "a9999999-0000-4000-8000-000000000009";
const ADMIN = "b0000000-0000-4000-8000-000000000004";
const ORDER = "ORD01ABCDEFOLUIMWQKDXYZ01";
const ORDER_DO_OUTRO = "ORD99ZZZZZZOUTROPEDIDO999";

type Linha = Record<string, unknown>;
const campo = (l: Linha, c: string) => Reflect.get(l, c);

/** Banco em memória que APLICA os filtros; `maybeSingle` devolve a PRIMEIRA linha que sobra. */
function bancoEmMemoria(
  tabelas: Record<string, Linha[]>,
  opcoes: { erroEm?: string; idsNulos?: boolean; rpc?: { data?: unknown; error?: unknown } } = {},
) {
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const cliente = {
    rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      return Promise.resolve({ data: opcoes.rpc?.data ?? null, error: opcoes.rpc?.error ?? null });
    },
    from(tabela: string) {
      let linhas = [...(Reflect.get(tabelas, tabela) as Linha[])];
      let ehListaDeIds = false;
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((linhas = linhas.filter((l) => campo(l, c) === v)), q),
        neq: (c: string, v: unknown) => ((linhas = linhas.filter((l) => campo(l, c) !== v)), q),
        not: (c: string, op: string, v: unknown) => {
          ehListaDeIds = true;
          if (op === "is" && v === null) linhas = linhas.filter((l) => campo(l, c) !== null && campo(l, c) !== undefined);
          return q;
        },
        maybeSingle: () => ((linhas = linhas.slice(0, 1)), q),
        then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
          if (opcoes.erroEm === tabela) {
            return Promise.resolve({ data: null, error: { message: "banco fora" } }).then(res, rej);
          }
          if (ehListaDeIds && opcoes.idsNulos) return Promise.resolve({ data: null, error: null }).then(res, rej);
          const data = ehListaDeIds ? linhas : (linhas[0] ?? null);
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
  return { cliente, rpcs };
}

const pedidoCom = (id: string, gateway: string) => ({
  id,
  gateway_payment_id: gateway,
  total: 100,
  valor_estornado: 0,
  payment_status: "pago",
  paid_at: "2026-10-01T00:00:00Z",
  status: "delivered",
});

/** Cada tabela tem a linha ERRADA primeiro e a certa depois. */
function tabelas() {
  return {
    devolucoes: [
      { id: "d-outra", order_id: OUTRO_PEDIDO },
      { id: DEVOLUCAO, order_id: PEDIDO_ID },
    ],
    order_refunds: [
      { id: "e-de-outro-pedido", order_id: OUTRO_PEDIDO, amount: 999, mp_refund_id: "MP-FORA" },
      { id: ESPERADA, order_id: PEDIDO_ID, amount: 50, mp_refund_id: "REF-NOVO" },
      { id: "e-irma", order_id: PEDIDO_ID, amount: 20, mp_refund_id: "MP-IRMA" },
      { id: "e-irma-sem-mp", order_id: PEDIDO_ID, amount: 30, mp_refund_id: null },
    ],
    marketplace_orders: [
      pedidoCom(OUTRO_PEDIDO, ORDER_DO_OUTRO),
      pedidoCom(PEDIDO_ID, ORDER),
    ],
  };
}

function mp(refunds: unknown[]) {
  const chamadas: string[] = [];
  const f = ((entrada: string | URL | Request, init?: RequestInit) => {
    chamadas.push(`${(init?.method ?? "GET").toUpperCase()} ${String(entrada)}`);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: ORDER,
          status: "processed",
          transactions: { payments: [{ id: "PAY1", status: "processed" }], refunds },
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  return { f, chamadas };
}

function reemitir(banco: ReturnType<typeof bancoEmMemoria>, buscar: typeof fetch) {
  return reemitirReembolsoDaDevolucao({
    supabase: banco.cliente,
    devolucaoId: DEVOLUCAO,
    refundEsperado: ESPERADA,
    ator: ADMIN,
    token: "TESTE_TOKEN",
    buscar,
  });
}

const DADOS = { resultado: "ja_existia", detalhe: "adotado" };

Deno.test("filtros: devolução, linha e pedido certos; ids reivindicados são os das IRMÃS do mesmo pedido (nem a própria linha, nem outro pedido)", async () => {
  const banco = bancoEmMemoria(tabelas(), { rpc: { data: DADOS } });
  // O MP lista o reembolso da irmã (já dela) e um novo de 50,00: só o novo é desta linha.
  const dubleMp = mp([
    { id: "MP-IRMA", amount: "20.00", status: "processed" },
    { id: "REF-NOVO", amount: "50.00", status: "processed" },
  ]);
  const r = await reemitir(banco, dubleMp.f);
  assertEquals(r, { http: 200, corpo: DADOS });
  // a consulta foi ao pedido CERTO
  assertEquals(dubleMp.chamadas.length, 1);
  assertEquals(dubleMp.chamadas[0].endsWith(`/v1/orders/${ORDER}`), true, dubleMp.chamadas[0]);
  assertEquals(banco.rpcs[0].args, {
    p_devolucao_id: DEVOLUCAO,
    p_ator: ADMIN,
    p_refund_esperado: ESPERADA,
    // REF-NOVO é achado mesmo constando na própria linha (a própria linha não é "outra dona");
    // MP-IRMA é da irmã e não é adotado.
    p_consulta: { resultado: "achou", mp_refund_id: "REF-NOVO", mp_status: "processed", valor: 50 },
  });
});

Deno.test("filtros: reembolso do MP que só consta em OUTRO pedido não é 'dono' aqui — sobra sem dono e a consulta fica indeterminada", async () => {
  const banco = bancoEmMemoria(tabelas(), { rpc: { data: DADOS } });
  const dubleMp = mp([
    { id: "REF-NOVO", amount: "50.00", status: "processed" },
    // "MP-FORA" pertence à linha de OUTRO pedido: aqui ninguém o reivindicou.
    { id: "MP-FORA", amount: "77.00", status: "processed" },
  ]);
  const r = await reemitir(banco, dubleMp.f);
  assertEquals(r, { http: 200, corpo: { resultado: "indeterminado", detalhe: "consulta_inconclusiva" } });
  assertEquals(banco.rpcs.length, 0);
});

Deno.test("lista de ids reivindicados que volta nula do banco não derruba a reemissão", async () => {
  const banco = bancoEmMemoria(tabelas(), { idsNulos: true, rpc: { data: DADOS } });
  const r = await reemitir(banco, mp([{ id: "REF-NOVO", amount: "50.00", status: "processed" }]).f);
  assertEquals(r.http, 200);
  assertEquals(banco.rpcs.length, 1);
  assertEquals(banco.rpcs[0].args.p_consulta.resultado, "achou");
});

Deno.test("erro de leitura da devolução ou da linha é 500 (não 'não encontrada') e nada vai ao MP nem ao banco", async () => {
  const original = console.error;
  console.error = () => {};
  for (const tabela of ["devolucoes", "order_refunds"]) {
    const banco = bancoEmMemoria(tabelas(), { erroEm: tabela });
    const dubleMp = mp([]);
    const r = await reemitir(banco, dubleMp.f).finally(() => {
      console.error = original;
    });
    console.error = () => {};
    assertEquals(r.http, 500, tabela);
    assertEquals(r.corpo, { erro: "Não consegui ler a devolução agora. Tente novamente em instantes." }, tabela);
    assertEquals(banco.rpcs.length, 0, tabela);
    assertEquals(dubleMp.chamadas.length, 0, tabela);
  }
  console.error = original;
});

Deno.test("linha de OUTRO pedido: HTTP 200 com reembolso_mudou / outra_linha, exatamente", async () => {
  const t = tabelas();
  t.order_refunds[1] = { ...t.order_refunds[1], order_id: OUTRO_PEDIDO };
  const banco = bancoEmMemoria(t);
  const dubleMp = mp([]);
  const r = await reemitir(banco, dubleMp.f);
  assertEquals(r, { http: 200, corpo: { resultado: "reembolso_mudou", detalhe: "outra_linha" } });
  assertEquals(dubleMp.chamadas.length, 0);
  assertEquals(banco.rpcs.length, 0);
});
