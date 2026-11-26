// @ts-nocheck
/* eslint-disable security/detect-object-injection -- os indices vem de listas fechadas deste arquivo, nunca de entrada de rede. */
/* eslint-disable security/detect-unsafe-regex, security/detect-non-literal-regexp -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), então não há ReDoS possível; mesma razão dos outros testes migration_*. */
// A LOJA PAUSA O PEDIDO NOVO — leitura do TEXTO da 20261600000000.
// O COMPORTAMENTO (a recusa do pedido online, a regra das datas, a marca do dia da suspensa, o motivo, a leitura do painel, reaplicar, rollback, pre/pos-voo
// e os mutantes) e' provado no Postgres efemero por tests/banco/a-loja-pausa-o-pedido-novo-viva.cjs; aqui ficam as ancoras que se leem do arquivo, sem banco:
//   - a migration e' ADITIVA e SEM transacao propria; nunca redefine quem cria pedido, a venda de balcao nem a porta do cartao da assinatura;
//   - a tabela pausa_de_vendas nasce fechada (RLS sem politica, REVOKE de todos os papeis de aplicacao, inclusive service_role) e vazia.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const NOME = "20261600000000_a_loja_pausa_o_pedido_novo.sql";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const migration = lerMig(NOME);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const semComentario = (s: string) => s.replace(/--.*$/gm, "");
const codigo = semComentario(migration);

Deno.test("20261600: sem transacao propria, texto LF, lock_timeout de 5 s e statement_timeout de 30 s", () => {
  const t = detectarTransacaoExplicita(removerRuido(migration));
  assertEquals(t.achados, [], `controle de transacao: ${t.achados.join("/")}`);
  assert(!migration.includes("\r"));
  assertStringIncludes(migration, "SET LOCAL lock_timeout = '5s';");
  assertStringIncludes(migration, "SET LOCAL statement_timeout = '30s';");
});

Deno.test("20261600: ADITIVA - nunca redefine quem cria pedido, a venda de balcao, a porta do cartao nem o leitor; nada de DROP TABLE, DROP COLUMN, DELETE, UPDATE nem TRUNCATE", () => {
  for (const proibido of [
    "FUNCTION public.create_marketplace_order",
    "FUNCTION public.registrar_venda_presencial",
    "FUNCTION public.assinatura_da_loja_gravar",
    "FUNCTION public.assinatura_da_loja_ler",
    "FUNCTION public.assinatura_da_loja_definir_chave",
  ])
    assert(!migration.includes(proibido), `a migration toca ${proibido}`);
  for (const proibido of [
    /\bDROP\s+TABLE\b/i,
    /\bDROP\s+COLUMN\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bALTER\s+TABLE\s+public\.(marketplace_orders|assinatura_da_loja|store_config)\b/i,
    /\bINSERT\s+INTO\s+public\.pausa_de_vendas\s*\(id,\s*vale_pela_assinatura/i,
  ])
    assert(!proibido.test(codigo), `a migration tem ${proibido}`);
});

Deno.test("20261600: a tabela pausa_de_vendas nasce fechada - linha unica, RLS ligada sem politica e REVOKE de PUBLIC, anon, authenticated e service_role", () => {
  assertStringIncludes(
    norm(codigo),
    norm(`CREATE TABLE IF NOT EXISTS public.pausa_de_vendas (
  id smallint NOT NULL,
  vale_pela_assinatura boolean NOT NULL DEFAULT false,
  ligada_em timestamptz,
  suspensa_desde date,
  CONSTRAINT pausa_de_vendas_pkey PRIMARY KEY (id),
  CONSTRAINT pausa_de_vendas_linha_unica CHECK (id = 1)
);`),
  );
  assertStringIncludes(
    codigo,
    "ALTER TABLE public.pausa_de_vendas ENABLE ROW LEVEL SECURITY;",
  );
  assertStringIncludes(
    codigo,
    "REVOKE ALL ON TABLE public.pausa_de_vendas FROM PUBLIC, anon, authenticated, service_role;",
  );
  assert(!/\bCREATE\s+POLICY\b/i.test(codigo), "politica nova");
  assert(
    !/\bGRANT\b[^;]*\bON\s+TABLE\s+public\.pausa_de_vendas\b/i.test(codigo),
    "GRANT na tabela",
  );
});

Deno.test("20261600: o pre-voo vem ANTES de criar qualquer coisa e exige canal, idempotency_key, manutencao, is_admin_atual, o cartao com pausa_em e a tabela da chave", () => {
  const pre = migration.indexOf("DO $preflight_20261600000000$");
  assert(pre >= 0, "sem pre-voo");
  assert(
    pre <
      migration.indexOf("CREATE TABLE IF NOT EXISTS public.pausa_de_vendas"),
  );
  const bloco = migration.slice(
    pre,
    migration.indexOf("END $preflight_20261600000000$;"),
  );
  for (const exigido of [
    "a.attname = 'canal'",
    "a.attname = 'idempotency_key'",
    "a.attname = 'manutencao'",
    "to_regprocedure('public.is_admin_atual()')",
    "pausa_em:date:false",
    "to_regclass('public.assinatura_da_loja_chave')",
    "'B1_BASELINE_DIVERGENT: public.pausa_de_vendas ja existe com outra forma",
  ])
    assertStringIncludes(bloco, exigido);
});

/** O texto do CREATE OR REPLACE FUNCTION public.<nome>(...) ate o $function$; final. */
function funcaoDe(sql: string, nome: string): string {
  const marca = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  assertEquals(sql.split(marca).length - 1, 1, `uma definicao de ${nome}`);
  const i = sql.indexOf(marca);
  const a = sql.indexOf("AS $function$", i);
  return sql.slice(i, sql.indexOf("$function$;", a) + "$function$;".length);
}

Deno.test("20261600: data_da_pausa_de_vendas recebe p_pausa_em, e' SQL IMMUTABLE sem relogio, com search_path fixo e EXECUTE de ninguem", () => {
  const f = funcaoDe(migration, "data_da_pausa_de_vendas");
  assertStringIncludes(
    f,
    "data_da_pausa_de_vendas(p_teste_ate date, p_proxima date, p_suspensa_desde date, p_pausa_em date)\n RETURNS date\n LANGUAGE sql\n IMMUTABLE\n SET search_path = public, pg_temp\n",
  );
  assert(!/SECURITY DEFINER/.test(f));
  assert(
    !/\b(now|current_date|clock_timestamp|localtimestamp|current_timestamp)\b/i.test(
      semComentario(f.slice(f.indexOf("AS $function$"))),
    ),
    "relogio na regra pura",
  );
  // a regra: tolerancia 3 (sinal de teste) ou 10, +1; o piso pausa_em; sexta a domingo para a segunda; sinal de teste sem pausa_em = NULL
  for (const trecho of [
    "WHEN p_proxima IS NULL OR p_suspensa_desde IS NULL THEN NULL",
    "WHEN p_teste_ate IS NOT NULL AND p_teste_ate = p_proxima AND p_pausa_em IS NULL THEN NULL",
    "THEN 3 ELSE 10 END + 1,",
    "p_suspensa_desde, p_pausa_em) AS inicio",
    "IN (5, 6, 7) THEN 8 - extract(isodow FROM d.inicio)::integer ELSE 0 END",
  ])
    assertStringIncludes(f, trecho);
  assertStringIncludes(
    codigo,
    "REVOKE ALL ON FUNCTION public.data_da_pausa_de_vendas(date, date, date, date) FROM PUBLIC, anon, authenticated, service_role;",
  );
  assert(
    !/GRANT[^;]*data_da_pausa_de_vendas/.test(codigo),
    "GRANT na regra pura",
  );
});
