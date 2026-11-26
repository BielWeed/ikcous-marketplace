// @ts-nocheck
// A LOJA GUARDA OS FORNECEDORES — prova offline do par 20261450000000 + rollback comum + rollback destrutivo
// (Central de Fornecedores, etapa E1, aprovada pelo dono em 25/11/2026).
//
// O DEFEITO QUE ESTE TESTE FIXA: contato de fornecedor e' dado comercial PRIVADO da loja. Se a tabela nascer sem RLS, com politica
// aberta, com privilegio para o anon/PUBLIC/service_role, ou com uma funcao SECURITY DEFINER no meio, o telefone de quem vende para a
// lojista fica legivel por qualquer cliente. Cada assercao abaixo esta amarrada a uma dessas portas. A decisao real (papeis, RLS,
// CHECKs, corrida) fica com tests/banco/os-fornecedores-so-o-admin-da-loja-viva.cjs, no Postgres efemero do CI.
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
const NOME = "20261450000000_a_loja_guarda_os_fornecedores.sql";
const LER = (n) => Deno.readTextFileSync(`${DIR}../supabase/migrations/${n}`);
const migration = LER(NOME);
const rollback = LER(`rollback-manual-${NOME}`);
const destrutivo = LER(`rollback-manual-destrutivo-${NOME}`);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const codigo = (s) => norm(removerRuido(s));
// `codigo` tira comentarios, literais e corpos entre dollar-quotes (so estrutura); `bruto` tira so os comentarios (literais e corpos ficam).
const bruto = (s) => norm(s.replace(/--.*$/gm, ""));
const migrationN = bruto(migration);
const rollbackN = bruto(rollback);
const destrutivoN = bruto(destrutivo);

Deno.test("avaliarFase0 nao recusa o par migration + rollback comum", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum dos tres arquivos abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback comum", rollback],
    ["rollback destrutivo", destrutivo],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${nome} contem controle de transacao`);
  }
});

Deno.test("a migration fecha o acesso: RLS ligada, REVOKE ALL de todos os papeis e GRANT so dos quatro verbos ao authenticated", () => {
  assertStringIncludes(
    migrationN,
    "ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;",
  );
  assertStringIncludes(
    migrationN,
    "REVOKE ALL ON TABLE public.fornecedores FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    migrationN,
    "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fornecedores TO authenticated;",
  );
  // Nenhum outro GRANT na tabela (nem a anon, nem a service_role, nem a PUBLIC, nem por coluna).
  const grants = [
    ...migrationN.matchAll(
      /GRANT [^;]+ ON TABLE public\.fornecedores TO [^;]+;/g,
    ),
  ];
  assertEquals(grants.length, 1, "so um GRANT na tabela");
  assert(
    !/FORCE ROW LEVEL SECURITY/.test(migrationN),
    "sem FORCE: o dono segue operando",
  );
  assert(!/ADD TABLE/i.test(migrationN), "fora do realtime");
});

Deno.test("quatro politicas, uma por acao, so para authenticated, todas pela porta rls_admin_atual() (nunca o JWT, nunca true)", () => {
  const politicas = [
    ...migrationN.matchAll(
      /CREATE POLICY (\w+) ON public\.fornecedores FOR (\w+) TO (\w+) ([^;]+);/g,
    ),
  ];
  assertEquals(
    politicas.map((p) => [p[1], p[2], p[3]]),
    [
      ["fornecedores_admin_select_policy", "SELECT", "authenticated"],
      ["fornecedores_admin_insert_policy", "INSERT", "authenticated"],
      ["fornecedores_admin_update_policy", "UPDATE", "authenticated"],
      ["fornecedores_admin_delete_policy", "DELETE", "authenticated"],
    ],
  );
  for (const p of politicas) {
    assertStringIncludes(p[4], "(SELECT public.rls_admin_atual())", p[1]);
    assert(
      !/is_admin\(\)|\btrue\b|auth\.jwt|app_metadata/i.test(p[4]),
      `${p[1]}: porta errada`,
    );
  }
  // Cada politica precisa da DROP POLICY IF EXISTS antes (reaplicar nao falha nem duplica).
  for (const p of politicas)
    assertStringIncludes(
      migrationN,
      `DROP POLICY IF EXISTS ${p[1]} ON public.fornecedores;`,
    );
});

Deno.test("nenhuma funcao nova e SECURITY DEFINER, o gatilho tem search_path fixo e a migration nao toca no que ja existe (produtos.fornecedor_id, rls_admin_atual)", () => {
  assert(
    !/SECURITY DEFINER/i.test(
      migrationN.replace(/NAO e' SECURITY DEFINER/gi, ""),
    ),
    "SECURITY DEFINER novo",
  );
  assertStringIncludes(migrationN, "SET search_path TO 'public'");
  assert(
    !/(ALTER|UPDATE|INSERT INTO|DELETE FROM|DROP) (TABLE )?(public\.)?(produtos|products|profiles) /i.test(
      migrationN,
    ),
    "toca em tabela existente",
  );
  assert(
    !/(CREATE OR REPLACE|DROP) FUNCTION public\.(rls_admin_atual|is_admin_atual|is_admin)\b/i.test(
      migrationN,
    ),
    "redefine a porta do admin",
  );
  assert(
    !/FOREIGN KEY|REFERENCES\s+(public\.)?\w+\s*\(/i.test(migrationN),
    "sem chave estrangeira",
  );
});

Deno.test("os sete CHECKs do banco espelham o front e o id e o do cliente com default de servidor", () => {
  for (const c of [
    "fornecedores_nome_check",
    "fornecedores_whatsapp_check",
    "fornecedores_instagram_check",
    "fornecedores_site_check",
    "fornecedores_cidade_check",
    "fornecedores_uf_check",
    "fornecedores_observacoes_check",
  ])
    assertStringIncludes(migrationN, `CONSTRAINT ${c} CHECK`, c);
  assertStringIncludes(migrationN, "'^[0-9]{10,13}$'");
  assertStringIncludes(migrationN, "'^https://[^[:space:]]+$'");
  assertStringIncludes(
    migrationN,
    "CONSTRAINT fornecedores_pkey PRIMARY KEY (id)",
  );
  assertStringIncludes(
    migrationN,
    "id uuid NOT NULL DEFAULT gen_random_uuid()",
  );
});

Deno.test("o pre-voo recusa estado divergente ANTES de qualquer escrita e o pos-voo confere o resultado", () => {
  const iPre = migration.indexOf("DO $preflight_20261450000000$");
  const iPos = migration.indexOf("DO $posflight_20261450000000$");
  assert(iPre > 0 && iPos > iPre, "pre-voo e pos-voo presentes, nessa ordem");
  const antesDoPreVoo = codigo(migration.slice(0, iPre));
  assert(
    !/\b(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE)\b/.test(
      antesDoPreVoo.replace(/SET LOCAL [^;]+;/g, ""),
    ),
    "nada e escrito antes do pre-voo",
  );
  assertStringIncludes(migration, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(migration, "SET LOCAL lock_timeout");
  assertStringIncludes(migration, "SET LOCAL statement_timeout");
});

Deno.test("rollback comum SELA a tabela (tira gatilho, funcao, politicas e privilegios) e PRESERVA as linhas: nunca apaga dado", () => {
  assert(
    !/DROP TABLE|TRUNCATE|DELETE FROM/i.test(rollbackN),
    "o rollback comum apaga dado",
  );
  for (const p of ["select", "insert", "update", "delete"])
    assertStringIncludes(rollbackN, `fornecedores_admin_${p}_policy`);
  assertStringIncludes(
    rollbackN,
    "REVOKE ALL ON TABLE public.fornecedores FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(rollbackN, "DROP FUNCTION");
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
});

Deno.test("rollback destrutivo exige a confirmacao escrita E o rollback comum antes, e so entao apaga a tabela (sem CASCADE)", () => {
  assertStringIncludes(destrutivoN, "app.confirmo_apagar_fornecedores");
  assertStringIncludes(destrutivo, "FORNECEDORES_SO_COM_O_DONO");
  assertStringIncludes(destrutivo, "FORNECEDORES_ROLLBACK_COMUM_PRIMEIRO");
  assertStringIncludes(
    destrutivoN,
    "DROP TABLE IF EXISTS public.fornecedores;",
  );
  assert(!/CASCADE/i.test(destrutivoN), "DROP sem CASCADE");
  const iDrop = destrutivo.indexOf("DROP TABLE IF EXISTS");
  assert(
    destrutivo.indexOf("FORNECEDORES_SO_COM_O_DONO") < iDrop,
    "confirmacao antes do DROP",
  );
  assert(
    destrutivo.indexOf("FORNECEDORES_ROLLBACK_COMUM_PRIMEIRO") < iDrop,
    "rollback comum antes do DROP",
  );
});
