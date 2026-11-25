// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `dono-da-loja.ts` — a trava que decide quem
 * pode trocar as chaves do Mercado Pago e o Gmail da loja (o dinheiro e o link
 * de troca de senha vão para onde essas chaves apontam). 26 mutantes plantados;
 * 4 sobreviviam às suítes de `dono-da-loja_test.ts` e `dono-da-loja_log_test.ts`:
 *
 *   * linha do dono NULA, `user_id` que não é texto e `user_id` só de espaços
 *     são "dono ilegível" (nome certo no log e resposta "indisponível"), e
 *     nunca um erro de tipo qualquer escapando como se fosse outro problema;
 *   * a comparação do id ignora caixa nos DOIS lados: o uuid do dono vem do
 *     banco em minúsculas, mas quem chama pode mandar em maiúsculas e vice-versa.
 */
import { assertEquals, assertRejects } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { conferirDono, lerDonoDaLoja } from "./dono-da-loja.ts";

const bancoCom = (data: unknown) => ({
  from: () => ({ select: () => Promise.resolve({ data, error: null }) }),
});

const DONO = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";

Deno.test("lerDonoDaLoja: linha nula, user_id sem ser texto ou só espaços é dono_ilegivel (nunca outro erro)", async () => {
  for (const data of [[null], [undefined], [{}], [{ user_id: null }], [{ user_id: 123 }], [{ user_id: "   " }], [{ user_id: "" }], [{ user_id: ["x"] }]]) {
    await assertRejects(
      () => lerDonoDaLoja(bancoCom(data)),
      Error,
      "dono_ilegivel",
      JSON.stringify(data),
    );
  }
});

Deno.test("lerDonoDaLoja: uma linha com id devolve o id; tabela vazia devolve null", async () => {
  assertEquals(await lerDonoDaLoja(bancoCom([{ user_id: DONO }])), DONO);
  assertEquals(await lerDonoDaLoja(bancoCom([])), null);
});

Deno.test("conferirDono: a caixa do uuid não importa, em nenhum dos dois lados", async () => {
  const dono = (id: string) => () => Promise.resolve(id);
  assertEquals(await conferirDono(DONO, dono(DONO.toUpperCase()), "t"), "pode");
  assertEquals(await conferirDono(DONO.toUpperCase(), dono(DONO), "t"), "pode");
  assertEquals(await conferirDono(DONO.toUpperCase(), dono(DONO.toUpperCase()), "t"), "pode");
  assertEquals(await conferirDono(DONO, dono(DONO), "t"), "pode");
});

Deno.test("conferirDono: outro uuid (mesmo parecido) é so_o_dono", async () => {
  const outro = DONO.slice(0, -1) + "e";
  assertEquals(await conferirDono(outro, () => Promise.resolve(DONO), "t"), "so_o_dono");
  assertEquals(await conferirDono(outro.toUpperCase(), () => Promise.resolve(DONO.toUpperCase()), "t"), "so_o_dono");
});
