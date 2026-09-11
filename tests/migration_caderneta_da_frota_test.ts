// @ts-nocheck
// A CADERNETA DA FROTA — prova offline do par 20261141000000 + rollback
// (brief equipe/entregas/20260911-brief-escala-etapa2-site-por-host.md,
// tarefa T5).
//
// O DEFEITO QUE ESTE TESTE FIXA: sem a caderneta central (`frota_lojas`,
// `frota_segredo`, `resolver_loja`), "um build para toda a frota" não tem de
// onde ler a lista de lojas — e se a caderneta nascer com QUALQUER
// privilégio de leitura para `anon`/`authenticated`, ela vira uma varredura
// de dicionário que devolve o `project_ref` e o endpoint REST de TODOS os
// clientes para qualquer visitante (item 6 do parecer do sócio). Cada
// asserção abaixo está amarrada a essa ameaça: sabotar qualquer uma reabre
// esse furo.
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
const NOME = "20261141000000_caderneta_da_frota.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior", () => {
  // A prova em transação (db-prove-caderneta.cjs) e a aplicação real
  // (db-apply.cjs) dependem de UMA transação externa sem interrupção — um
  // BEGIN/COMMIT escondido aqui grava direto no banco e invalida o ROLLBACK
  // da prova (regra da casa, sem exceção). O BEGIN/END de
  // `resolver_loja` (corpo PL/pgSQL dentro do dollar-quote) não conta: é
  // isso que `removerRuido` prova ao remover o corpo antes de procurar.
  const transMigration = detectarTransacaoExplicita(removerRuido(migration));
  const transRollback = detectarTransacaoExplicita(removerRuido(rollback));
  assertEquals(
    transMigration.achados,
    [],
    `migration contém controle de transação: ${transMigration.achados.join("/")}`,
  );
  assertEquals(
    transRollback.achados,
    [],
    `rollback contém controle de transação: ${transRollback.achados.join("/")}`,
  );
});

Deno.test("as duas tabelas nascem com CREATE TABLE IF NOT EXISTS (idempotente, nunca sobrescreve dado)", () => {
  assertStringIncludes(
    migrationN,
    norm("CREATE TABLE IF NOT EXISTS public.frota_lojas ("),
  );
  assertStringIncludes(
    migrationN,
    norm("CREATE TABLE IF NOT EXISTS public.frota_segredo ("),
  );
});

Deno.test("frota_lojas: colunas obrigatorias do contrato (id, nome, dominio_publico UNIQUE, project_ref, supabase_url, publishable_key, ativa)", () => {
  assertStringIncludes(migrationN, norm("id text PRIMARY KEY"));
  assertStringIncludes(migrationN, norm("nome text NOT NULL"));
  assertStringIncludes(
    migrationN,
    norm("dominio_publico text NOT NULL UNIQUE"),
  );
  assertStringIncludes(migrationN, norm("project_ref text NOT NULL"));
  assertStringIncludes(migrationN, norm("supabase_url text NOT NULL"));
  assertStringIncludes(migrationN, norm("publishable_key text NOT NULL"));
  assertStringIncludes(migrationN, norm("ativa boolean NOT NULL DEFAULT true"));
});

Deno.test("frota_lojas.dominio_publico usa o MESMO CHECK de host que a T4 (regex de host minusculo sem esquema/porta/caminho)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "CHECK (dominio_publico ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')",
    ),
  );
});

Deno.test("frota_segredo: id fixo em 1 (linha unica) e hash NOT NULL", () => {
  assertStringIncludes(migrationN, norm("id int PRIMARY KEY CHECK (id = 1)"));
  assertStringIncludes(migrationN, norm("hash text NOT NULL"));
});

for (const tabela of ["frota_lojas", "frota_segredo"]) {
  Deno.test(`${tabela}: RLS ligado e REVOKE ALL de PUBLIC/anon/authenticated logo em seguida`, () => {
    // Achado confirmado no banco vivo (pg_default_acl, 11/09/2026): o schema
    // public tem ALTER DEFAULT PRIVILEGES para o role postgres que concede
    // TODOS os privilégios de tabela a anon/authenticated/service_role em
    // qualquer objeto novo — sem este REVOKE explícito, a tabela nasceria
    // com INSERT/SELECT/UPDATE/DELETE de graça para anon/authenticated.
    assertStringIncludes(
      migrationN,
      norm(`ALTER TABLE public.${tabela} ENABLE ROW LEVEL SECURITY;`),
    );
    assertStringIncludes(
      migrationN,
      norm(`REVOKE ALL ON public.${tabela} FROM PUBLIC, anon, authenticated;`),
    );
  });
}

Deno.test("NENHUMA das duas tabelas tem policy — a trava e o REVOKE, nunca RLS seletivo (busca por indice de string, nunca new RegExp com variavel)", () => {
  // Mesmo motivo documentado em tests/db_apply_mapa_contra_sql_test.ts:
  // new RegExp com string interpolada dispara security/detect-non-literal-regexp.
  // Como a migration inteira não deve ter NENHUM CREATE POLICY (a trava das
  // duas tabelas é só o REVOKE ALL), basta procurar a palavra-chave uma vez.
  assert(
    !/CREATE\s+POLICY/i.test(removerRuido(migration)),
    "migration contém CREATE POLICY — a trava de frota_lojas/frota_segredo deveria ser só o REVOKE, sem policy seletiva",
  );
});

Deno.test("nenhuma linha de seed (INSERT) na migration — a Savy e a principal nascem com a tabela vazia", () => {
  // O brief é explícito: os dados da frota entram pela hub, FORA desta
  // migration. Um INSERT aqui semearia a mesma loja em toda base que
  // receber o arquivo, inclusive num cliente novo que não deveria herdar
  // segredo nem cadastro de ninguém.
  assert(
    !/INSERT\s+INTO\s+public\.frota_(lojas|segredo)/i.test(
      removerRuido(migration),
    ),
    "migration contém INSERT em frota_lojas/frota_segredo — deveria nascer vazia",
  );
});

const blocoResolverLoja = (() => {
  const inicio = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.resolver_loja(",
  );
  const marcadorFim =
    "GRANT EXECUTE ON FUNCTION public.resolver_loja(text, text) TO anon;";
  const fim = migration.indexOf(marcadorFim);
  if (inicio === -1 || fim === -1) return null;
  return migration.slice(inicio, fim + marcadorFim.length);
})();

Deno.test("resolver_loja existe (assinatura + corpo + REVOKE + GRANT juntos)", () => {
  assert(
    blocoResolverLoja !== null,
    "resolver_loja não encontrada (assinatura, corpo, REVOKE e GRANT juntos)",
  );
});

Deno.test("resolver_loja: LANGUAGE plpgsql + SECURITY DEFINER + VOLATILE + SET search_path = '' (senão anon nunca alcança, ou um schema hostil sequestra a busca)", () => {
  assert(blocoResolverLoja !== null);
  const blocoN = norm(blocoResolverLoja);
  assertStringIncludes(blocoN, norm("LANGUAGE plpgsql"));
  assertStringIncludes(blocoN, norm("SECURITY DEFINER"));
  assertStringIncludes(blocoN, norm("VOLATILE"));
  assertStringIncludes(blocoN, norm("SET search_path = ''"));
});

Deno.test("resolver_loja: NUNCA STABLE nem IMMUTABLE — são as duas volatilidades que o PostgREST aceita por GET/HEAD com parâmetro na querystring (achado da revisão 11/09/2026, rodada 2: STABLE deixaria o segredo da frota viajar em log de URL)", () => {
  assert(blocoResolverLoja !== null);
  const blocoN = norm(blocoResolverLoja);
  assert(
    !/\bSTABLE\b/.test(blocoN),
    "resolver_loja não pode ser STABLE — PostgREST aceitaria GET com p_chave na querystring",
  );
  assert(
    !/\bIMMUTABLE\b/.test(blocoN),
    "resolver_loja não pode ser IMMUTABLE — mesmo problema de STABLE",
  );
});

Deno.test("resolver_loja: sem a chave certa, RETURN sem QUERY (zero linhas, SEM ERRO — nenhum oraculo entre 'chave errada' e 'host inexistente')", () => {
  assert(blocoResolverLoja !== null);
  const blocoN = norm(blocoResolverLoja);
  assertStringIncludes(
    blocoN,
    norm(
      "IF NOT EXISTS ( SELECT 1 FROM public.frota_segredo fs WHERE fs.id = 1 AND fs.hash = extensions.crypt(p_chave, fs.hash) )",
    ),
  );
  assertStringIncludes(blocoN, norm("RETURN;"));
});

Deno.test("resolver_loja: devolve a loja por dominio_publico case-insensitive (lower(...) = lower(...)) e SO se ativa", () => {
  assert(blocoResolverLoja !== null);
  const blocoN = norm(blocoResolverLoja);
  assertStringIncludes(
    blocoN,
    norm("WHERE lower(fl.dominio_publico) = lower(p_host)"),
  );
  assertStringIncludes(blocoN, norm("AND fl.ativa;"));
});

Deno.test("resolver_loja: REVOKE ALL de PUBLIC/authenticated/service_role, GRANT EXECUTE so a anon (nunca service_role no porteiro)", () => {
  assert(blocoResolverLoja !== null);
  const blocoN = norm(blocoResolverLoja);
  assertStringIncludes(
    blocoN,
    norm(
      "REVOKE ALL ON FUNCTION public.resolver_loja(text, text) FROM PUBLIC, authenticated, service_role;",
    ),
  );
  assertStringIncludes(
    blocoN,
    norm("GRANT EXECUTE ON FUNCTION public.resolver_loja(text, text) TO anon;"),
  );
  assert(
    !blocoN.includes("TO anon, authenticated") &&
      !blocoN.includes("TO anon, service_role"),
    "GRANT de resolver_loja não pode incluir authenticated nem service_role",
  );
});

Deno.test("cabecalho: secao CONVENCAO DE CHAMADA existe e documenta POST + apikey (quem chama resolver_loja precisa saber isto, ou o segredo viaja em querystring/cabecalho)", () => {
  // T5c (rodada C): esta secao e o unico lugar que registra a convencao que
  // o porteiro (T3b, src/hospedagem/porteiro.ts) tem de seguir. Apagar a
  // secao nao muda o SQL, mas deixa este teste vermelho -- e' o sinal de
  // que a documentacao sumiu.
  assertStringIncludes(migration, "CONVENÇÃO DE CHAMADA");
  assertStringIncludes(migrationN, norm("SEMPRE `POST`"));
  assertStringIncludes(migrationN, norm("cabeçalhos `apikey`"));
});

Deno.test("cabecalho: custo do gen_salt('bf', N) documentado bate com o CUSTO_BF usado em scripts/db-prove-caderneta.cjs", () => {
  // O numero no cabecalho e' a convencao que a hub DEVE seguir ao semear o
  // segredo de producao (a migration nao semeia nada -- ver "DADOS
  // EXISTENTES"); scripts/db-prove-caderneta.cjs mede a latencia com o MESMO
  // custo e e' de la que o numero foi copiado. Os dois tem de concordar, ou
  // o numero documentado nao corresponde ao que foi medido.
  const custoBf = Deno.readTextFileSync(
    `${DIR}../scripts/db-prove-caderneta.cjs`,
  ).match(/const CUSTO_BF = (\d+);/);
  assert(custoBf !== null, "CUSTO_BF nao encontrado em db-prove-caderneta.cjs");
  const custo = custoBf[1];
  assertStringIncludes(migrationN, norm(`Custo escolhido: **${custo}**`));
  assertStringIncludes(
    migrationN,
    norm(`extensions.crypt(segredo, extensions.gen_salt('bf', ${custo}))`),
  );
});

Deno.test("o rollback derruba a funcao e as duas tabelas pela assinatura/nome, nada mais, na ordem funcao->tabelas", () => {
  // IF EXISTS: repetir o rollback não pode virar erro.
  assertStringIncludes(
    rollbackN,
    norm("DROP FUNCTION IF EXISTS public.resolver_loja(text, text);"),
  );
  assertStringIncludes(
    rollbackN,
    norm("DROP TABLE IF EXISTS public.frota_segredo;"),
  );
  assertStringIncludes(
    rollbackN,
    norm("DROP TABLE IF EXISTS public.frota_lojas;"),
  );
  const idxFuncao = rollbackN.indexOf("DROP FUNCTION IF EXISTS");
  const idxSegredo = rollbackN.indexOf(
    "DROP TABLE IF EXISTS public.frota_segredo",
  );
  const idxLojas = rollbackN.indexOf("DROP TABLE IF EXISTS public.frota_lojas");
  assert(
    idxFuncao < idxSegredo && idxSegredo < idxLojas,
    "ordem esperada: função primeiro, depois frota_segredo, depois frota_lojas",
  );
});
