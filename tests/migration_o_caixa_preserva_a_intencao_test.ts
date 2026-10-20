// @ts-nocheck
// Registro da 20261252 nas ferramentas de publicação. O comportamento financeiro
// e as corridas são provados em tests/banco/caixa-intencao-viva.cjs, não aqui.
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarChecagem, VERIFICACOES } = require("../scripts/db-apply.cjs");
const NOME = "20261252000000_o_caixa_preserva_a_intencao.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(`supabase/migrations/${NOME}`);
const FUNCOES = ["fin_caixa_fechar_sessao", "fin_caixa_movimentar_com_chave"];

Deno.test("20261252 db-apply: as duas funções têm verificação própria", () => {
  assert(VERIFICACOES[NOME], "a migration não pode ficar sem conferência");
  assertEquals(
    VERIFICACOES[NOME].map((c: any) => c.funcao),
    FUNCOES,
  );
});

for (const funcao of FUNCOES) {
  Deno.test(`20261252 db-apply: ${funcao} verifica o corpo real e recusa perder cada marcador`, () => {
    const checagem = VERIFICACOES[NOME]?.find((c: any) => c.funcao === funcao);
    assert(checagem, `sem verificação para ${funcao}`);
    const corpo = migration.match(
      new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${funcao}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
      ),
    )?.[1];
    assert(corpo, "corpo real não encontrado");
    assertEquals(avaliarChecagem(corpo, checagem).situacao, "verificada");
    for (const marcador of checagem.esperado) {
      const texto = typeof marcador === "string" ? marcador : marcador.texto;
      assertStringIncludes(corpo, texto);
      assertEquals(
        avaliarChecagem(corpo.replace(texto, ""), checagem).situacao,
        "falhou",
        `retirar o marcador precisa reprovar: ${texto}`,
      );
    }
  });
}

Deno.test("20261252 publicação: 55a e 55b exigem o rol exato e estão nos dois gatilhos", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA,
    estruturaDoRolFechado,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const workflow = ler(".github/workflows/rpc-ci.yml");
  for (const [consulta, quantidade] of [
    ["55a-conferir-intencao-do-caixa-aplicado", 8],
    ["55b-antes-intencao-do-caixa-base-vigente", 6],
  ] as const) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    const itens = [...sql.matchAll(/\bSELECT '([^']+)'/g)].map((m) => m[1]);
    assertEquals(itens.length, quantidade);
    const rol = ROL_FECHADO_POR_CONSULTA[consulta];
    assert(rol, `rol ausente: ${consulta}`);
    assertEquals([...rol].sort(), [...itens].sort());
    assertEquals(new Set(rol).size, quantidade);
    assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assertEquals(estruturaDoRolFechado(linhas, rol), null);
    for (const invalida of [
      linhas.slice(1),
      [...linhas.slice(1), linhas[1]],
      [...linhas, { ...linhas[0], item: "desconhecido" }],
      linhas.map((linha: any) => ({ ...linha, colunaExtra: true })),
    ]) {
      assert(estruturaDoRolFechado(invalida, rol) !== null);
    }
    const caminho = `"scripts/publicacao/consultas/${consulta}.sql"`;
    assertEquals(workflow.split(caminho).length - 1, 2);
    for (const evento of ["pull_request", "push"]) {
      const bloco = workflow.match(
        new RegExp(`  ${evento}:[\\s\\S]*?(?=\\n  [a-z_]+:|\\n[a-z_]+:)`),
      )?.[0];
      assert(bloco, `gatilho ausente: ${evento}`);
      assertStringIncludes(bloco, caminho);
    }
  }
});
