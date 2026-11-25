// @ts-nocheck
/**
 * Bordas de scripts/db-apply.cjs que os sete testes vizinhos não seguram —
 * caça por mutação de 25/11/2026 (73 defeitos de uma linha plantados, 29
 * sobreviviam). Cada teste abaixo existe para derrubar um desses 29 (o id do
 * mutante está no título entre colchetes). Tudo com cliente de mentira: nenhum
 * banco é tocado, nenhuma migration é aplicada.
 *
 * Mutantes equivalentes (nenhum teste os derruba, e não precisa):
 *  - [A43] `def === undefined` -> `def == null` em avaliarChecagem: `def` só
 *    chega como string ou undefined; null nunca sai de `definicaoAtual`.
 *  - [A44] `${vezes}x` -> `${resultado.esperado}x` na linha de divergência:
 *    `resultado.esperado` é o mesmo `vezes` normalizado.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  funcoesAlteradas,
  montarRollback,
  resumirVerificacao,
  conferirMarcador,
  avaliarChecagem,
  checagemBemFormada,
  montarTarefasDeVerificacao,
  buscarDef,
  recusarFaixaHistorica,
  versaoDaMigration,
  guardaDoLedger,
  ROTULO_DA_SITUACAO,
} = require("../scripts/db-apply.cjs");

// Conexão de uma loja conhecida, montada em pedaços: só o ref (que aparece no
// host público do banco) basta para o script reconhecer a loja.
const CONEXAO_CONHECIDA = `${["postgresql", "//"].join(":")}postgres@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;

// ---------------------------------------------------------------------------
// funcoesAlteradas
// ---------------------------------------------------------------------------
Deno.test("[A01] funcoesAlteradas reconhece CREATE OR REPLACE em minúsculas e em caixa mista", () => {
  assertEquals(
    funcoesAlteradas(
      "create or replace function public.minha_fn() returns int",
    ),
    ["minha_fn"],
  );
  assertEquals(
    funcoesAlteradas("Create Or Replace Function PUBLIC.Outra(x int)"),
    ["Outra"],
  );
});

Deno.test("[A02] funcoesAlteradas mantém a ordem de aparição e não repete nome", () => {
  const sql = `
    CREATE OR REPLACE FUNCTION public.segunda() RETURNS int AS $$ select 1 $$;
    CREATE OR REPLACE FUNCTION public.primeira() RETURNS int AS $$ select 2 $$;
    CREATE OR REPLACE FUNCTION public.segunda() RETURNS int AS $$ select 3 $$;
  `;
  assertEquals(funcoesAlteradas(sql), ["segunda", "primeira"]);
});

// ---------------------------------------------------------------------------
// montarRollback
// ---------------------------------------------------------------------------
Deno.test("[A06] montarRollback lista as funções criadas separadas por vírgula e espaço", () => {
  const r = montarRollback(
    ["m.sql"],
    [
      { funcao: "antiga", defs: ["DEF ANTIGA"] },
      { funcao: "nova_a", defs: [] },
      { funcao: "nova_b", defs: [] },
    ],
  );
  assertEquals(r.nomesCriadas, "nova_a, nova_b");
  assertStringIncludes(
    r.conteudo,
    "-- nova_a, nova_b. Restaurar as funções acima NÃO remove as novas.",
  );
});

Deno.test("[A09] montarRollback só avisa de função nova quando existe função criada", () => {
  const r = montarRollback(
    ["m.sql"],
    [{ funcao: "antiga", defs: ["DEF ANTIGA"] }],
  );
  assert(!r.conteudo.includes("também CRIA função nova"));
  assertEquals(r.nomesCriadas, "");
  const misto = montarRollback(
    ["m.sql"],
    [
      { funcao: "antiga", defs: ["DEF ANTIGA"] },
      { funcao: "nova", defs: [] },
    ],
  );
  assertStringIncludes(misto.conteudo, "também CRIA função nova");
});

Deno.test("[A11] montarRollback separa o cabeçalho do corpo com uma linha em branco", () => {
  const r = montarRollback(["m.sql"], [{ funcao: "f", defs: ["DEF"] }]);
  assertStringIncludes(
    r.conteudo,
    "Isso não\n-- desfaz a migration inteira.\n\n-- f\nDEF;\n",
  );
  assertEquals(r.instrucoes, 1);
});

// ---------------------------------------------------------------------------
// resumirVerificacao
// ---------------------------------------------------------------------------
Deno.test("[A18] resumirVerificacao: pulada sem motivo diz 'sem motivo registrado'", () => {
  const { estado, mensagem } = resumirVerificacao(
    [{ base: "a.sql", situacao: "pulada" }],
    "rollback-a.sql",
  );
  assertEquals(estado, "PULADA");
  assertStringIncludes(mensagem, "a.sql (sem motivo registrado)");
});

Deno.test("[A19] resumirVerificacao: o resumo de 'conferidas e passaram' só aparece se alguma passou", () => {
  const soPuladas = resumirVerificacao(
    [{ base: "a.sql", situacao: "pulada", motivo: "m" }],
    "rb.sql",
  );
  assert(!soPuladas.mensagem.includes("foram conferidas e passaram"));
  const mista = resumirVerificacao(
    [
      { base: "a.sql", situacao: "pulada", motivo: "m" },
      { base: "b.sql", situacao: "verificada" },
    ],
    "rb.sql",
  );
  assertStringIncludes(
    mista.mensagem,
    "1 de 2 verificação(ões) foram conferidas e passaram",
  );
});

// ---------------------------------------------------------------------------
// rótulos e marcadores
// ---------------------------------------------------------------------------
Deno.test("[A25][A26] todo rótulo de situação tem a mesma largura (a coluna do terminal)", () => {
  assertEquals(ROTULO_DA_SITUACAO.get("sumiu"), "SUMIU  ");
  assertEquals(ROTULO_DA_SITUACAO.get("a_mais"), "A MAIS ");
  assertEquals(ROTULO_DA_SITUACAO.get("ok"), "ok     ");
  assertEquals(ROTULO_DA_SITUACAO.get("ausente"), "AUSENTE");
  for (const [situacao, rotulo] of ROTULO_DA_SITUACAO)
    assertEquals(rotulo.length, 7, situacao);
});

Deno.test("[A27][A33][A34] conferirMarcador: vezes 0 ou fracionário é malformado, nunca ok", () => {
  for (const vezes of [0, 1.5, -1]) {
    const r = conferirMarcador("abc abc", { texto: "abc", vezes });
    assertEquals(r.situacao, "malformado", `vezes=${vezes}`);
    assertEquals(r.ok, false);
  }
  const zeroAchou = conferirMarcador("nada aqui", {
    texto: "NAO EXISTE",
    vezes: 0,
  });
  assertEquals(zeroAchou.ok, false);
  assertEquals(zeroAchou.situacao, "malformado");
});

Deno.test("[A39] conferirMarcador: definição indefinida conta zero, mesmo procurando o texto 'undefined'", () => {
  const r = conferirMarcador(undefined, "undefined");
  assertEquals(r.achou, 0);
  assertEquals(r.situacao, "ausente");
  assertEquals(r.ok, false);
});

Deno.test("[A28][A31][A45][A46] checagemBemFormada: forma exata do marcador e da checagem", () => {
  // marcador como objeto sem `vezes` vale (padrão 1)
  assert(checagemBemFormada({ funcao: "f", esperado: [{ texto: "x" }] }));
  // marcador que é lista não vale
  assert(!checagemBemFormada({ funcao: "f", esperado: [["x"]] }));
  // nem uma lista que por acaso carregue a propriedade `texto`
  assert(
    !checagemBemFormada({
      funcao: "f",
      esperado: [Object.assign([], { texto: "x" })],
    }),
  );
  // função com nome vazio não vale
  assert(!checagemBemFormada({ funcao: "", esperado: ["x"] }));
  // lista com propriedades de checagem não vale
  assert(
    !checagemBemFormada(Object.assign([], { funcao: "f", esperado: ["x"] })),
  );
  // e a forma boa continua valendo
  assert(
    checagemBemFormada({
      funcao: "f",
      esperado: ["x", { texto: "y", vezes: 2 }],
    }),
  );
});

Deno.test("[A42] avaliarChecagem: o rótulo do marcador é cortado em 64 caracteres, nem 63 nem 65", () => {
  const longo = "x".repeat(70);
  const r = avaliarChecagem("def sem o marcador", {
    funcao: "f",
    esperado: [longo],
  });
  assertEquals(r.linhas.length, 1);
  assert(r.linhas[0].endsWith(`f: ${"x".repeat(64)}`), r.linhas[0]);
});

// ---------------------------------------------------------------------------
// montarTarefasDeVerificacao e buscarDef
// ---------------------------------------------------------------------------
Deno.test("[A49] montarTarefasDeVerificacao: qualquer valor falso no mapa vira 'pulada', sem estourar", () => {
  for (const vazio of [null, "", 0, false]) {
    const t = montarTarefasDeVerificacao(["pasta/a.sql"], { "a.sql": vazio });
    assertEquals(t.length, 1, String(vazio));
    assertEquals(t[0].checagem, undefined);
    assertEquals(t[0].base, "a.sql");
    assertStringIncludes(t[0].linhasAntes[0], "sem verificação registrada");
  }
});

Deno.test("[A52] buscarDef: função que não existe, mesmo com sucessora, devolve undefined sem estourar", async () => {
  const c = {
    async query() {
      return { rows: [] };
    },
  };
  const r = await buscarDef(c, {
    funcao: "casca",
    esperado: ["x"],
    sucessora: { delegacao: "chama_a_nova()", funcao: "nova" },
  });
  assertEquals(r, undefined);
});

Deno.test("[A51] buscarDef: só vai à sucessora quando a casca realmente a chama", async () => {
  const consultadas = [];
  const c = {
    async query(_sql, params) {
      consultadas.push(params[0]);
      return {
        rows: [
          { def: params[0] === "casca" ? "corpo da casca" : "corpo da nova" },
        ],
      };
    },
  };
  const sucessora = { delegacao: "chama_a_nova()", funcao: "nova" };
  assertEquals(
    await buscarDef(c, { funcao: "casca", esperado: ["x"], sucessora }),
    "corpo da casca",
  );
  assertEquals(consultadas, ["casca"]);
});

Deno.test("[A53] buscarDef: sem checagem devolve undefined e nem consulta o banco", async () => {
  const c = {
    async query() {
      throw new Error("não devia consultar");
    },
  };
  assertEquals(await buscarDef(c, undefined), undefined);
});

// ---------------------------------------------------------------------------
// faixa histórica
// ---------------------------------------------------------------------------
Deno.test("[A59] faixa histórica: o número tem de estar no INÍCIO do nome", () => {
  recusarFaixaHistorica(CONEXAO_CONHECIDA, [
    "supabase/migrations/920261160000000_a.sql",
  ]);
  recusarFaixaHistorica(CONEXAO_CONHECIDA, ["x20261160000000_a.sql"]);
});

Deno.test("[A61] faixa histórica: vale com o caminho inteiro da migration, não só com o nome solto", () => {
  assertThrows(
    () =>
      recusarFaixaHistorica(CONEXAO_CONHECIDA, [
        "supabase/migrations/20261160000000_a.sql",
      ]),
    Error,
    "RECUSADO (loja conhecida, faixa histórica",
  );
  assertThrows(
    () =>
      recusarFaixaHistorica(CONEXAO_CONHECIDA, [
        "supabase/migrations/rollback-manual-20261166999999_a.sql",
      ]),
    Error,
    "20261166999999_a.sql",
  );
});

// ---------------------------------------------------------------------------
// versão e guarda do ledger
// ---------------------------------------------------------------------------
Deno.test("[A62] versaoDaMigration: sem dígitos antes do primeiro '_' é null", () => {
  assertEquals(versaoDaMigration("_sem_versao.sql"), null);
  assertEquals(versaoDaMigration("abc_20261270000000.sql"), null);
  assertEquals(versaoDaMigration("20261270000000.sql"), null);
});

const clienteLedger = (rows, falha) => ({
  async query() {
    if (falha) throw falha;
    return { rows };
  },
});
const V1 = "20261270000000_a.sql";
const V2 = "20261270000000_b.sql";

Deno.test("[A64] guardaDoLedger: só `true` de verdade libera a reaplicação (texto 'sim' não)", async () => {
  for (const frouxo of ["sim", 1, "true", {}]) {
    await assertRejects(
      () =>
        guardaDoLedger(clienteLedger([{ version: "20261270000000" }]), [V1], {
          permitirReaplicar: frouxo,
        }),
      Error,
      "RECUSADO (versão já aplicada",
    );
  }
});

Deno.test("[A66] guardaDoLedger: com permitirReaplicar, versão repetida na lista é aceita", async () => {
  const r = await guardaDoLedger(clienteLedger([]), [V1, V2], {
    permitirReaplicar: true,
  });
  assertEquals(r, []);
  await assertRejects(
    () => guardaDoLedger(clienteLedger([]), [V1, V2], {}),
    Error,
    "versão repetida na lista",
  );
});

Deno.test("[A70] guardaDoLedger: a mensagem do erro do banco é cortada em 300 caracteres", async () => {
  const falha = new Error("y".repeat(400));
  const erro = await assertRejects(
    () => guardaDoLedger(clienteLedger([], falha), [V1], {}),
    Error,
    "FALHOU a conferência do ledger",
  );
  assertStringIncludes(erro.message, "y".repeat(300));
  assert(!erro.message.includes("y".repeat(301)));
});
