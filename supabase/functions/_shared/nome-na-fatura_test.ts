/**
 * Testes do nome que aparece na FATURA do cartao do comprador (03/10/2026).
 *
 * O campo e' OPCIONAL (`transactions.payments[].payment_method.
 * statement_descriptor`): nome torto nunca pode virar campo torto no POST, e a
 * leitura do nome da loja nunca pode segurar nem derrubar a cobranca. O que
 * se prova: normalizacao (sem acento, so' caractere seguro, cortado no
 * limite, nunca vazio) e leitura de melhor esforco (erro, excecao e demora
 * viram "sem nome" — e nada vai para log).
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { LIMITE_DO_NOME_NA_FATURA, lerNomeNaFatura, nomeNaFatura } from "./nome-na-fatura.ts";

Deno.test("nomeNaFatura: nome simples vira MAIUSCULO", () => {
  assertEquals(nomeNaFatura("Loja Teste"), "LOJA TESTE");
});

Deno.test("nomeNaFatura: tira acento e cedilha (sem caractere fora do ASCII)", () => {
  assertEquals(nomeNaFatura("Açaí Café Ção"), "ACAI CAFE CAO");
  assertEquals(nomeNaFatura("Ünïcôdé"), "UNICODE");
});

Deno.test("nomeNaFatura: simbolo e pontuacao viram espaco colapsado — so' letra, digito e espaco sobram", () => {
  assertEquals(nomeNaFatura("Savy & Cia. (Moda)"), "SAVY CIA MODA");
  assertEquals(nomeNaFatura("Loja\nTeste\t99"), "LOJA TESTE 99");
  assertEquals(nomeNaFatura("  muitos    espacos  "), "MUITOS ESPACO");
});

Deno.test("nomeNaFatura: corta no limite e nao deixa espaco sobrando no fim", () => {
  assertEquals(LIMITE_DO_NOME_NA_FATURA, 13);
  assertEquals(nomeNaFatura("Loja Muito Grande Mesmo"), "LOJA MUITO GR");
  // O corte cai exatamente num espaco: o resultado nao termina nele.
  assertEquals(nomeNaFatura("ABCDEFGHIJKL MNO"), "ABCDEFGHIJKL");
  assertEquals(nomeNaFatura("ABCDEFGHIJKLM"), "ABCDEFGHIJKLM");
});

Deno.test("nomeNaFatura: nada utilizavel -> undefined (o campo NAO e' enviado)", () => {
  for (const vazio of [undefined, null, "", "   ", "\n\t", "★★★", "!!!", "😀", 42, {}, [], true]) {
    assertEquals(nomeNaFatura(vazio), undefined, String(vazio));
  }
});

Deno.test("nomeNaFatura: a saida SEMPRE casa /^[A-Z0-9 ]{1,13}$/ e e' idempotente (re-normalizar nao muda)", () => {
  const entradas = [
    "Loja Teste",
    "Açaí & Cia — Moda Íntima Ltda",
    "x".repeat(500),
    "ÁB́Ć", // acentos combinados
    "Ｌｏｊａ", // largura total (fora do ASCII, sem decomposicao para ASCII)
    "Mercadinho 24h",
    "Zé's #1",
  ];
  for (const entrada of entradas) {
    const saida = nomeNaFatura(entrada);
    if (saida === undefined) continue;
    assertEquals(/^[A-Z0-9 ]{1,13}$/.test(saida), true, `${entrada} -> ${saida}`);
    assertEquals(saida === saida.trim(), true);
    assertEquals(nomeNaFatura(saida), saida);
  }
});

Deno.test("nomeNaFatura: largura total (Ｌｏｊａ) vira ASCII; entrada acima de 200 caracteres e' cortada ANTES de normalizar", () => {
  assertEquals(nomeNaFatura("Ｌｏｊａ Ｔｅｓｔｅ"), "LOJA TESTE");
  // Lixo antes do nome: o corte de entrada (200) descarta o que vem depois.
  assertEquals(nomeNaFatura(`${" ".repeat(300)}Loja`), undefined);
  assertEquals(nomeNaFatura(`${" ".repeat(150)}Loja`), "LOJA");
});

// ─── lerNomeNaFatura ────────────────────────────────────────────────────────

/** Duble do cliente Supabase so' com o que a leitura usa. */
function bancoCom(resposta: () => unknown, leituras?: Array<{ tabela: string; colunas: string }>) {
  return {
    from(tabela: string) {
      return {
        select(colunas: string) {
          leituras?.push({ tabela, colunas });
          return {
            limit: () => ({ maybeSingle: () => Promise.resolve().then(resposta) }),
          };
        },
      };
    },
  };
}

Deno.test("lerNomeNaFatura: le store_config.store_name e devolve normalizado", async () => {
  const leituras: Array<{ tabela: string; colunas: string }> = [];
  const nome = await lerNomeNaFatura(
    bancoCom(() => ({ data: { store_name: "Açaí do Zé" }, error: null }), leituras),
  );
  assertEquals(nome, "ACAI DO ZE");
  assertEquals(leituras, [{ tabela: "store_config", colunas: "store_name" }]);
});

Deno.test("lerNomeNaFatura: sem linha, nome vazio ou so' simbolo -> undefined", async () => {
  for (const data of [null, {}, { store_name: null }, { store_name: "" }, { store_name: "   " }, { store_name: "★" }]) {
    assertEquals(await lerNomeNaFatura(bancoCom(() => ({ data, error: null }))), undefined);
  }
});

Deno.test("lerNomeNaFatura: erro de banco, excecao, banco ausente ou malformado -> undefined, NUNCA lanca e NUNCA loga", async () => {
  const logs: unknown[][] = [];
  const originais = { warn: console.warn, error: console.error, log: console.log, info: console.info };
  console.warn = console.error = console.log = console.info = (...a: unknown[]) => void logs.push(a);
  try {
    assertEquals(
      await lerNomeNaFatura(
        bancoCom(() => ({ data: { store_name: "Loja Secreta" }, error: { message: "boom Loja Secreta" } })),
      ),
      undefined,
    );
    assertEquals(
      await lerNomeNaFatura(bancoCom(() => {
        throw new Error("explodiu Loja Secreta");
      })),
      undefined,
    );
    for (const banco of [undefined, null, {}, { from: 42 }, "x"]) {
      assertEquals(await lerNomeNaFatura(banco), undefined);
    }
  } finally {
    Object.assign(console, originais);
  }
  assertEquals(logs, []);
});

Deno.test("lerNomeNaFatura: leitura que passa do prazo -> undefined (a cobranca nao espera)", async () => {
  const lento = {
    from: () => ({
      select: () => ({
        limit: () => ({ maybeSingle: () => new Promise(() => {}) }), // nunca resolve
      }),
    }),
  };
  const inicio = Date.now();
  assertEquals(await lerNomeNaFatura(lento, 30), undefined);
  assertEquals(Date.now() - inicio < 1000, true);
});
