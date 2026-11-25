import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { reemitirReembolsoDaDevolucao } from "./reemissao-do-reembolso.ts";

/**
 * Caça por mutação (24/11/2026): a guarda `if (erroPedido || !pedido)` da
 * reemissão sobrevivia quando virava `&&`. Os testes de lá só provam o caso em
 * que o banco devolve ERRO (e `data` nulo junto); ninguém provava o caso em que
 * a leitura do pedido volta SEM erro e SEM linha (pedido apagado entre a
 * leitura da devolução e a do pedido). Sem a guarda, `pedido.id` lançaria
 * TypeError e a tela do lojista receberia um erro cru em vez da resposta
 * honesta de "não consegui ler agora" — e, pior, nada garante que o MP e o
 * banco não tivessem sido tocados antes de quebrar.
 *
 * O banco e o MP são dublês; o que se prova é a resposta 500 honesta e que
 * NADA vai ao MP nem à RPC.
 */

const DEVOLUCAO = "d0000000-0000-4000-8000-000000000011";
const ESPERADA = "e0000000-0000-4000-8000-000000000012";
const PEDIDO_ID = "a0000000-0000-4000-8000-000000000013";
const ADMIN = "b0000000-0000-4000-8000-000000000014";

function supabaseComPedidoAusente(erroDoPedido: unknown) {
  const rpcs: string[] = [];
  const cliente = {
    rpc(nome: string) {
      rpcs.push(nome);
      return Promise.resolve({ data: null, error: null });
    },
    from(tabela: string) {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        neq: () => q,
        not: () => q,
        maybeSingle: () => q,
        then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
          const resposta = tabela === "devolucoes"
            ? { data: { id: DEVOLUCAO, order_id: PEDIDO_ID }, error: null }
            : tabela === "order_refunds"
            ? { data: { id: ESPERADA, order_id: PEDIDO_ID, amount: 50 }, error: null }
            : { data: null, error: erroDoPedido };
          return Promise.resolve(resposta).then(res, rej);
        },
      };
      return q;
    },
  };
  return { cliente, rpcs };
}

function mpQueNaoDeveSerChamado() {
  const chamadas: string[] = [];
  const f = ((entrada: string | URL | Request) => {
    chamadas.push(String(entrada));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  return { f, chamadas };
}

const FALHA_DE_LEITURA = {
  http: 500,
  corpo: { erro: "Não consegui ler a devolução agora. Tente novamente em instantes." },
};

Deno.test("pedido SEM linha e SEM erro (apagado no meio): 500 honesto, sem lançar e sem tocar o MP nem o banco", async () => {
  const base = supabaseComPedidoAusente(null);
  const mp = mpQueNaoDeveSerChamado();
  const resposta = await reemitirReembolsoDaDevolucao({
    supabase: base.cliente,
    devolucaoId: DEVOLUCAO,
    refundEsperado: ESPERADA,
    ator: ADMIN,
    token: "TESTE_TOKEN",
    buscar: mp.f,
  });
  assertEquals(resposta, FALHA_DE_LEITURA);
  assertEquals(base.rpcs, []);
  assertEquals(mp.chamadas, []);
});

Deno.test("pedido com ERRO de leitura e sem linha: o mesmo 500 honesto (o caso que já existia, agora ao lado do outro)", async () => {
  const base = supabaseComPedidoAusente({ message: "banco fora" });
  const mp = mpQueNaoDeveSerChamado();
  const resposta = await reemitirReembolsoDaDevolucao({
    supabase: base.cliente,
    devolucaoId: DEVOLUCAO,
    refundEsperado: ESPERADA,
    ator: ADMIN,
    token: "TESTE_TOKEN",
    buscar: mp.f,
  });
  assertEquals(resposta, FALHA_DE_LEITURA);
  assertEquals(base.rpcs, []);
  assertEquals(mp.chamadas, []);
});
