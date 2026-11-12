/**
 * Apagar o XOR de segredoConfere não pode liberar segredos de mesmo tamanho.
 * Handler real; banco e HTTP são dublês, sem acesso a serviços externos.
 */
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const SEGREDO = "segredo-reconciliacao-teste";
Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-ficticio-autenticacao");

type Dependencias = NonNullable<Parameters<typeof handler>[1]>;

async function chamar(segredo: string) {
  const banco: string[] = [];
  const chamadasExternas: string[] = [];
  const supabase = {
    from(tabela: string) {
      banco.push(`from:${tabela}`);
      assertEquals(tabela, "app_settings");
      return {
        select(colunas: string) {
          assertEquals(colunas, "value");
          return {
            eq(coluna: string, valor: string) {
              assertEquals([coluna, valor], ["key", "pagamentos_mercado_pago"]);
              return { maybeSingle: async () => ({ data: null, error: null }) };
            },
          };
        },
      };
    },
    rpc(nome: string) {
      banco.push(`rpc:${nome}`);
      assertEquals(nome, "pagamentos_a_reconciliar");
      // Para o controle logo após a autenticação, sem executar reconciliação.
      return Promise.resolve({
        data: null,
        error: new Error("Falha fictícia da fila após autenticação"),
      });
    },
  };
  const fetchOriginal = globalThis.fetch;
  const fetchFalso: typeof fetch = (entrada) => {
    chamadasExternas.push(String(entrada));
    return Promise.resolve(new Response("{}", { status: 502 }));
  };
  globalThis.fetch = fetchFalso;
  try {
    const resposta = await handler(
      new Request("http://localhost/reconciliar-pagamentos", {
        method: "POST",
        headers: { "x-reconciliacao-secret": segredo },
      }),
      {
        supabase: supabase as unknown as Dependencias["supabase"],
        fetchImpl: fetchFalso,
      },
    );
    return { resposta, banco, chamadasExternas };
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

for (const { posicao, recebido } of [
  { posicao: "início", recebido: "Xegredo-reconciliacao-teste" },
  { posicao: "meio", recebido: "segredo-reconXiliacao-teste" },
  { posicao: "fim", recebido: "segredo-reconciliacao-testX" },
]) {
  Deno.test(`segredo do mesmo tamanho com caractere diferente no ${posicao} -> 401 sem banco nem HTTP`, async () => {
    assertEquals(recebido.length, SEGREDO.length);
    assertNotEquals(recebido, SEGREDO);

    const { resposta, banco, chamadasExternas } = await chamar(recebido);

    assertEquals(resposta.status, 401);
    assertEquals(await resposta.json(), { error: "Não autorizado." });
    assertEquals(banco, []);
    assertEquals(chamadasExternas, []);
  });
}

Deno.test("segredo exato passa da autenticação e alcança a fila fictícia", async () => {
  const { resposta, banco, chamadasExternas } = await chamar(SEGREDO);

  // 500 é a falha de banco deliberada, NÃO uma recusa de autenticação.
  assertEquals(resposta.status, 500);
  assertEquals(await resposta.json(), { error: "Erro ao buscar candidatos." });
  assertEquals(banco, ["from:app_settings", "rpc:pagamentos_a_reconciliar"]);
  assertEquals(chamadasExternas, []);
});
