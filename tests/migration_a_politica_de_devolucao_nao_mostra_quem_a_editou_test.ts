// @ts-nocheck
// A POLÍTICA DE DEVOLUÇÃO NÃO MOSTRA QUEM A EDITOU — prova offline do par
// 20261215000000 + rollback (achado L da revisão de risco de 26/09/2026).
//
// O DEFEITO QUE ESTE TESTE FIXA: `politica_devolucao` dava SELECT da tabela
// inteira a `anon`/`authenticated`, e a linha carrega `updated_by` (o uuid do
// admin que salvou por último). Cada asserção abaixo está amarrada a esse
// furo: sabotar a lista de colunas (pôr `updated_by` de volta) ou esquecer o
// REVOKE de tabela reabre a leitura sem login.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME =
  "20261215000000_a_politica_de_devolucao_nao_mostra_quem_a_editou.sql";
const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);

const norm = (s) => s.replace(/\s+/g, " ").trim();
// Só o SQL executável: o cabeçalho cita `updated_by` e a tabela em prosa.
const sqlMigration = norm(removerRuido(migration));
const sqlRollback = norm(removerRuido(rollback));

// Todas as colunas de politica_devolucao (20261175), menos `updated_by`.
const COLUNAS_PUBLICAS = [
  "id",
  "prazo_arrependimento_dias",
  "prazo_troca_dias",
  "prazo_vicio_dias",
  "aceita_troca",
  "aceita_vale",
  "exige_fotos_vicio",
  "metodos_locais",
  "metodos_nacionais",
  "reembolso_momento",
  "frete_troca_pago_por",
  "categorias_sem_troca",
  "texto_politica",
  "endereco_devolucao",
  "updated_at",
];

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa)", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("o REVOKE de tabela vem antes do GRANT por coluna", () => {
  const revoke = sqlMigration.indexOf(
    "REVOKE SELECT ON public.politica_devolucao FROM anon, authenticated;",
  );
  const grant = sqlMigration.indexOf("GRANT SELECT (");
  assert(revoke >= 0, "falta o REVOKE SELECT da tabela inteira");
  assert(grant > revoke, "o GRANT por coluna tem de vir depois do REVOKE");
});

Deno.test("o GRANT por coluna cobre exatamente as colunas publicas e nunca updated_by", () => {
  const m = sqlMigration.match(
    /GRANT SELECT \(([^)]*)\) ON public\.politica_devolucao TO anon, authenticated;/,
  );
  assert(m, "falta o GRANT SELECT (colunas) ON public.politica_devolucao");
  const colunas = m[1].split(",").map((c) => c.trim());
  assertEquals(colunas, COLUNAS_PUBLICAS);
  assert(!colunas.includes("updated_by"), "updated_by nao pode ser concedida");
});

Deno.test("a migration nao concede SELECT da tabela inteira nem mexe na policy", () => {
  assert(
    !/GRANT SELECT ON public\.politica_devolucao/.test(sqlMigration),
    "GRANT de tabela inteira reabriria o achado L",
  );
  assert(
    !/POLICY/i.test(sqlMigration),
    "a policy RLS nao muda nesta migration",
  );
});

Deno.test("o rollback devolve o SELECT da tabela inteira, depois de limpar os grants por coluna", () => {
  const revoke = sqlRollback.indexOf(
    "REVOKE SELECT ON public.politica_devolucao FROM anon, authenticated;",
  );
  assert(
    revoke >= 0,
    "o rollback precisa do REVOKE para tirar o grant por coluna",
  );
  assertStringIncludes(
    sqlRollback,
    "GRANT SELECT ON public.politica_devolucao TO anon, authenticated;",
  );
  assert(
    sqlRollback.indexOf("GRANT SELECT ON public.politica_devolucao") > revoke,
    "REVOKE antes do GRANT",
  );
});

Deno.test("a pos-condicao aborta se anon/authenticated ainda leem updated_by ou a tabela", () => {
  // removerRuido apaga o corpo do bloco DO ($pos$...$pos$); aqui vale o SQL
  // bruto, sem as linhas de comentario do cabecalho.
  const bruto = norm(
    migration
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n"),
  );
  assertStringIncludes(bruto, "DO $pos$ BEGIN");
  for (const papel of ["anon", "authenticated"]) {
    assertStringIncludes(
      bruto,
      `has_column_privilege('${papel}', 'public.politica_devolucao', 'updated_by', 'SELECT')`,
    );
    assertStringIncludes(
      bruto,
      `has_table_privilege('${papel}', 'public.politica_devolucao', 'SELECT')`,
    );
  }
  assertStringIncludes(bruto, "RAISE EXCEPTION");
});
