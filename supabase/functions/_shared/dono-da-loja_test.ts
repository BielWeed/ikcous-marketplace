// @ts-nocheck
// Testes do `_shared/dono-da-loja.ts` (24/11/2026): quem é o dono da loja e se
// quem chamou pode MUDAR o destino das chaves de pagamento e do e-mail.
// Nenhuma rede: o "banco" é um dublê da consulta `from().select()`.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { conferirDono, lerDonoDaLoja } from "./dono-da-loja.ts";

function bancoCom(resposta: unknown, lidas: string[] = []) {
  return {
    from(tabela: string) {
      lidas.push(`from:${tabela}`);
      return {
        select(colunas: string) {
          lidas.push(`select:${colunas}`);
          if (resposta instanceof Error) throw resposta;
          return Promise.resolve(resposta);
        },
      };
    },
  };
}

Deno.test("lerDonoDaLoja — uma linha: devolve o user_id; lê SÓ a coluna user_id da tabela dono_da_loja", async () => {
  const lidas: string[] = [];
  const dono = await lerDonoDaLoja(bancoCom({ data: [{ user_id: "uid-dono" }], error: null }, lidas));
  assertEquals(dono, "uid-dono");
  assertEquals(lidas, ["from:dono_da_loja", "select:user_id"]);
});

Deno.test("lerDonoDaLoja — zero linhas é null (loja sem dono cadastrado), e SÓ isso é null", async () => {
  assertEquals(await lerDonoDaLoja(bancoCom({ data: [], error: null })), null);
  for (
    const resposta of [
      { data: null, error: null },
      { data: undefined, error: null },
      { data: {}, error: null },
      { data: "x", error: null },
      // Não é lista, mas `length` é 0: sem a conferência de `Array.isArray`
      // passaria por "zero linhas" e LIBERARIA a loja como se não tivesse dono.
      { data: "", error: null },
      { data: { length: 0 }, error: null },
      { data: [{}], error: null },
      { data: [{ user_id: "" }], error: null },
      { data: [{ user_id: 7 }], error: null },
      { data: [{ user_id: null }], error: null },
      { data: [{ user_id: "a" }, { user_id: "b" }], error: null },
      { data: [], error: { message: "permission denied", code: "42501" } },
      { data: null, error: { message: "relation does not exist", code: "42P01" } },
    ]
  ) {
    let lancou = false;
    try {
      await lerDonoDaLoja(bancoCom(resposta));
    } catch {
      lancou = true;
    }
    assertEquals(lancou, true, JSON.stringify(resposta));
  }
});

Deno.test("lerDonoDaLoja — consulta que lança também lança (nunca vira 'sem dono')", async () => {
  let lancou = false;
  try {
    await lerDonoDaLoja(bancoCom(new Error("rede caiu")));
  } catch {
    lancou = true;
  }
  assertEquals(lancou, true);
});

Deno.test("conferirDono — dono pode; outro admin é 'so_o_dono'; sem dono pode; caixa do uuid não importa", async () => {
  assertEquals(await conferirDono("a-1", async () => "a-1", "[t]"), "pode");
  assertEquals(await conferirDono("A-1", async () => "a-1", "[t]"), "pode");
  assertEquals(await conferirDono("a-1", async () => "b-2", "[t]"), "so_o_dono");
  assertEquals(await conferirDono("a-1", async () => null, "[t]"), "pode");
});

Deno.test("conferirDono — leitura que falha, ou leitor que devolve algo que não é id nem null, é 'indisponivel' (nunca libera) e o texto do erro não vai ao log", async () => {
  const saiu: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => saiu.push(args.map(String).join(" "));
  try {
    assertEquals(
      await conferirDono("a-1", async () => {
        throw new Error("linha vazada SEGREDO-DO-BANCO");
      }, "[t]"),
      "indisponivel",
    );
    assertEquals(await conferirDono("a-1", async () => undefined as any, "[t]"), "indisponivel");
    assertEquals(await conferirDono("a-1", async () => "" as any, "[t]"), "indisponivel");
    assertEquals(await conferirDono("a-1", async () => 5 as any, "[t]"), "indisponivel");
  } finally {
    console.error = original;
  }
  assertEquals(saiu.join("\n").includes("SEGREDO-DO-BANCO"), false);
});
