// @ts-nocheck
// A DEVOLUÇÃO NASCE NO PEDIDO — prova offline do par 20261175000000 + rollback
// (plano docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md,
// tarefa 1). A prova VIVA (RPCs de verdade no Postgres efêmero) mora em
// tests/banco/devolucoes-viva.cjs; aqui fica o que se prova só lendo o texto.
//
// Cada asserção está amarrada a um risco: tabela sem RLS expõe devolução de
// um cliente a outro; prazo abaixo da lei no CHECK deixa a loja negar o art.
// 49; escrita liberada para authenticated pula a máquina de estados; bucket
// público vaza foto de cliente; SECURITY DEFINER sem search_path fixo abre
// sequestro de função.
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
const NOME = "20261175000000_a_devolucao_nasce_no_pedido.sql";
const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const m = norm(migration);
const r = norm(rollback);

const TABELAS = [
  "politica_devolucao",
  "devolucoes",
  "devolucao_itens",
  "devolucao_eventos",
];
const RPCS = [
  "devolucao_elegibilidade",
  "solicitar_devolucao",
  "cancelar_devolucao",
  "informar_envio_devolucao",
  "devolucoes_do_pedido",
  "devolucao_detalhe",
  "admin_devolucoes_listar",
  "admin_devolucao_decidir",
  "admin_devolucao_registrar",
  "admin_devolucao_concluir",
  "admin_devolucao_reemitir_reembolso",
  "admin_devolucao_reprovar",
  "salvar_politica_de_devolucao",
];

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("toda tabela nova liga RLS e tira escrita de anon/authenticated", () => {
  for (const t of TABELAS) {
    assertStringIncludes(m, `CREATE TABLE IF NOT EXISTS public.${t} (`);
    assertStringIncludes(
      m,
      `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`,
    );
  }
  assertStringIncludes(
    m,
    "REVOKE ALL ON public.devolucoes, public.devolucao_itens, public.devolucao_eventos FROM PUBLIC, anon, authenticated;",
  );
  assertStringIncludes(
    m,
    "GRANT SELECT ON public.devolucoes, public.devolucao_itens, public.devolucao_eventos TO authenticated;",
  );
  // Nenhuma policy de escrita: só SELECT nas tabelas de devolução.
  assert(
    !/CREATE POLICY devolucoe?s?_\w+ ON public\.devolucoes FOR (INSERT|UPDATE|DELETE|ALL)/.test(
      m,
    ),
  );
});

Deno.test("prazos mínimos da lei moram no CHECK (arrependimento >= 7, vício >= 30)", () => {
  assertStringIncludes(m, "CHECK (prazo_arrependimento_dias BETWEEN 7 AND 90)");
  assertStringIncludes(m, "CHECK (prazo_vicio_dias BETWEEN 30 AND 365)");
});

Deno.test("fotos em bucket PRIVADO, gravadas só na pasta do próprio cliente", () => {
  assertStringIncludes(
    m,
    "VALUES ('devolucoes', 'devolucoes', false, 5242880,",
  );
  assertStringIncludes(
    m,
    "WITH CHECK (bucket_id = 'devolucoes' AND split_part(name, '/', 1) = (SELECT auth.uid())::text);",
  );
});

Deno.test("toda RPC é SECURITY DEFINER com search_path fixo e sai de anon", () => {
  for (const f of RPCS) {
    const ini = m.indexOf(`CREATE OR REPLACE FUNCTION public.${f}(`);
    assert(ini >= 0, `${f} não encontrada`);
    const cabecalho = m.slice(ini, m.indexOf("AS $$", ini));
    assertStringIncludes(cabecalho, "SECURITY DEFINER");
    assertStringIncludes(cabecalho, "SET search_path = public");
    assertStringIncludes(m, `'public.${f}(`);
  }
  assertStringIncludes(
    m,
    "EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_sig);",
  );
});

Deno.test("RPCs do lojista fazem o gate de admin dentro da função", () => {
  for (const f of RPCS.filter(
    (n) => n.startsWith("admin_") || n.startsWith("salvar_"),
  )) {
    const ini = m.indexOf(`CREATE OR REPLACE FUNCTION public.${f}(`);
    const corpo = m.slice(ini, m.indexOf("$$;", ini));
    assertStringIncludes(corpo, "IF NOT public.is_admin() THEN");
  }
});

Deno.test("o rollback desfaz tabelas, RPCs, gatilho e policies do bucket", () => {
  for (const t of TABELAS)
    assertStringIncludes(r, `DROP TABLE IF EXISTS public.${t};`);
  for (const f of RPCS)
    assertStringIncludes(r, `DROP FUNCTION IF EXISTS public.${f}(`);
  assertStringIncludes(
    r,
    "DROP TRIGGER IF EXISTS tr_devolucao_avisa_o_cliente ON public.devolucoes;",
  );
  assertStringIncludes(
    r,
    "DROP POLICY IF EXISTS devolucoes_cliente_insert_policy ON storage.objects;",
  );
});
