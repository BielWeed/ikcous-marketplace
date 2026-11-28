// @ts-nocheck
/* eslint-disable security/detect-object-injection -- o indice e' o nome fixo desta migration, nunca entrada de rede. */
/* eslint-disable security/detect-unsafe-regex -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), entao nao ha ReDoS possivel; mesma razao dos outros testes migration_*. */
// A LOJA QUE SAIU PAUSA O PEDIDO NOVO — leitura do TEXTO da 20261661000000 e do rollback dela.
// O COMPORTAMENTO (a matriz do motivo, o controle com o corpo da 1600, os pedidos reais pela v23/v24 com a loja cancelada e a pausa ligada ou
// desligada, o balcao, a leitura do painel, os mutantes, reaplicar sem tocar dados, rollback, pre/pos-voo e as consultas 217a/217b/196a) e'
// provado no Postgres efemero por tests/banco/a-loja-que-saiu-pausa-o-pedido-novo-viva.cjs; aqui ficam as ancoras que se leem do arquivo, sem
// banco:
//   - a migration e' ADITIVA, SEM transacao propria e SEM escrita em dado: so redefine public.motivo_da_loja_nao_aceitar_pedido();
//   - o corpo novo e' o da 20261600000000 com UM ramo a mais (o resto byte a byte, comentario fora), DEPOIS das chaves 1 e 2 (pausa ligada e
//     chave da gestao) e ANTES do "so suspensa";
//   - os md5 do pre-voo, do pos-voo e do rollback sao os dos corpos que os arquivos carregam;
//   - o rollback devolve o bloco da 1600 BYTE A BYTE e passa a Fase 0 do db-prove-rollback;
//   - os marcadores do db-apply da 1600 seguem casando 1x no corpo desta (nenhum vira A MAIS nem some).
import { createHash } from "node:crypto";
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
const RAIZ = `${DIR}..`;
const NOME = "20261661000000_a_loja_que_saiu_pausa_o_pedido_novo.sql";
const NOME_1600 = "20261600000000_a_loja_pausa_o_pedido_novo.sql";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const migration = lerMig(NOME);
const rollback = lerMig(`rollback-manual-${NOME}`);
const m1600 = lerMig(NOME_1600);
const semComentario = (s: string) => s.replace(/--.*$/gm, "");
const codigo = semComentario(migration);

const CABECALHO =
  "CREATE OR REPLACE FUNCTION public.motivo_da_loja_nao_aceitar_pedido()";
/** O prosrc (o texto entre os $function$) do motivo no arquivo. */
const corpoDe = (sql: string) => {
  const i = sql.indexOf(CABECALHO);
  assert(i >= 0, "o motivo nao esta no arquivo");
  const a = sql.indexOf("AS $function$", i) + "AS $function$".length;
  return sql.slice(a, sql.indexOf("$function$", a));
};
/** O bloco inteiro: do CREATE OR REPLACE ate o fim da linha do COMMENT ON FUNCTION do motivo. */
const blocoDoMotivo = (sql: string) => {
  const i = sql.indexOf(CABECALHO);
  const c = sql.indexOf(
    "COMMENT ON FUNCTION public.motivo_da_loja_nao_aceitar_pedido() IS",
    i,
  );
  return sql.slice(i, sql.indexOf("\n", c) + 1);
};
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const H1600 = md5(corpoDe(m1600));
const H1661 = md5(corpoDe(migration));
/** O corpo da fechadura da 1600 (a_loja_aceita_pedido_novo), que recusa 'vendas_pausadas'. */
const fechaduraDe = (sql: string) => {
  const i = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.a_loja_aceita_pedido_novo()",
  );
  const a = sql.indexOf("AS $function$", i) + "AS $function$".length;
  return sql.slice(a, sql.indexOf("$function$", a));
};
const H_FECHADURA = md5(fechaduraDe(m1600));
const DEF_DO_GATILHO =
  "CREATE TRIGGER tr_a_loja_aceita_pedido_novo BEFORE INSERT ON public.marketplace_orders FOR EACH ROW WHEN ((new.canal IS DISTINCT FROM ''presencial''::text)) EXECUTE FUNCTION public.a_loja_aceita_pedido_novo()";
const blocoDo = (sql: string, marca: string) => {
  const i = sql.indexOf(`DO $${marca}$`);
  assert(i >= 0, `bloco ${marca} ausente`);
  return sql.slice(i, sql.indexOf(`END $${marca}$;`, i));
};

const RAMO_NOVO = `  -- 3-bis. A LOJA QUE SAIU (20261661000000): a gestao gravou a saida (status cancelada). Com a pausa ligada nesta loja (1) e a chave da gestao
  --        definida (2), o pedido NOVO para na hora, sem data a esperar: o dono so registra a saida depois do fim do contrato e da tolerancia
  --        (a conta e' do app de gestao). Pedidos que ja existem, o balcao e o painel seguem como na suspensa. Pausa desligada = aceita.
  IF v_status = 'cancelada' THEN
    RETURN 'vendas_pausadas';
  END IF;
`;

Deno.test("20261661: sem transacao propria, texto LF, lock_timeout de 5 s e statement_timeout de 30 s", () => {
  for (const [rotulo, sql] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${rotulo}: ${t.achados.join("/")}`);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
  }
  for (const arq of [NOME, `rollback-manual-${NOME}`])
    assert(
      !Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).includes(
        "\r",
      ),
      `${arq}: LF`,
    );
});

Deno.test("20261661: ADITIVA e sem tocar dado - so redefine o motivo; nada de tabela, coluna, gatilho, DROP, escrita nem GRANT", () => {
  assertEquals(
    [
      ...codigo.matchAll(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([a-z_.]+)/gi),
    ].map((m) => m[2]),
    ["public.motivo_da_loja_nao_aceitar_pedido"],
  );
  // a definicao do gatilho aparece so como LITERAL de comparacao no pre/pos-voo: sai antes de procurar DDL
  const tudo = semComentario(migration.replaceAll(`'${DEF_DO_GATILHO}'`, "''"));
  for (const proibido of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i,
    /\bCREATE\s+TABLE\b/i,
    /\bGRANT\b/i,
  ])
    assert(!proibido.test(tudo), `proibido: ${proibido}`);
  assertStringIncludes(
    migration,
    "REVOKE ALL ON FUNCTION public.motivo_da_loja_nao_aceitar_pedido() FROM PUBLIC, anon, authenticated, service_role;",
  );
});

Deno.test("20261661: o corpo novo e' o da 20261600000000 com UM ramo a mais (o resto byte a byte), depois das chaves 1 e 2 e antes do 'so suspensa'", () => {
  const novo = corpoDe(migration);
  assertEquals(novo.split(RAMO_NOVO).length, 2, "o ramo novo aparece 1x");
  assertEquals(novo.replace(RAMO_NOVO, ""), corpoDe(m1600));
  // o cabecalho (RETURNS, LANGUAGE, STABLE, SECURITY DEFINER, search_path) e' o mesmo da 1600
  const cab = (sql: string) => {
    const i = sql.indexOf(CABECALHO);
    return sql.slice(i, sql.indexOf("AS $function$", i));
  };
  assertEquals(cab(migration), cab(m1600));
  // a ordem: manutencao vence; a pausa ligada (1) e a chave da gestao (2) vem ANTES da saida; o "so suspensa" vem DEPOIS dela
  const i = (t: string) => {
    const k = novo.indexOf(t);
    assert(k >= 0, `ausente: ${t}`);
    return k;
  };
  const iRamo = i("IF v_status = 'cancelada' THEN");
  assert(i("RETURN 'manutencao';") < iRamo);
  assert(i("IF v_vale IS NOT TRUE THEN") < iRamo);
  assert(
    i("IF NOT EXISTS (SELECT 1 FROM public.assinatura_da_loja_chave) THEN") <
      iRamo,
  );
  assert(i("FROM public.assinatura_da_loja a WHERE a.id = 1;") < iRamo);
  assert(iRamo < i("IF v_status IS DISTINCT FROM 'suspensa' THEN"));
  // o motivo da saida e' o MESMO da suspensa: a fechadura da 1600 so recusa 'manutencao' e 'vendas_pausadas'
  assertEquals(
    semComentario(novo).split("RETURN 'vendas_pausadas';").length - 1,
    2,
  );
  assertStringIncludes(
    fechaduraDe(m1600),
    "ELSIF v_motivo = 'vendas_pausadas' THEN",
  );
  // o motivo segue sem escrever nada e sem levantar erro
  assert(
    !/\b(INSERT|UPDATE|DELETE|RAISE)\b/i.test(semComentario(novo)),
    "o motivo so le",
  );
});

Deno.test("20261661: os md5 do pre-voo, do pos-voo e do rollback sao os dos corpos que os arquivos carregam", () => {
  const pre = blocoDo(migration, "preflight_20261661000000");
  const pos = blocoDo(migration, "conferencia_20261661000000");
  const rbPre = blocoDo(rollback, "preflight_rollback_20261661000000");
  const rbPos = blocoDo(rollback, "conferencia_rollback_20261661000000");
  assertStringIncludes(pre, `v_hash NOT IN ('${H1600}', '${H1661}')`);
  // a fechadura da 1600 (que recusa 'vendas_pausadas') e' premissa: sem ela a saida nao para pedido nenhum
  assertStringIncludes(pre, H_FECHADURA);
  assertStringIncludes(pos, `IS DISTINCT FROM '${H1661}'`);
  assert(!pos.includes(H1600), "o pos-voo aceita so o corpo desta");
  assertStringIncludes(rbPre, `v_hash NOT IN ('${H1661}', '${H1600}')`);
  assertStringIncludes(rbPos, `IS DISTINCT FROM '${H1600}'`);
  assert(!rbPos.includes(H1661), "a conferencia do rollback aceita so a 1600");
  // o pre-voo vem ANTES do CREATE; o pos-voo DEPOIS do REVOKE; ambos conferem o gatilho do pedido pela definicao exata
  const iCreate = migration.indexOf(CABECALHO);
  assert(migration.indexOf("DO $preflight_20261661000000$") < iCreate);
  assert(
    migration.indexOf("DO $conferencia_20261661000000$") >
      migration.indexOf(
        "REVOKE ALL ON FUNCTION public.motivo_da_loja_nao_aceitar_pedido()",
      ),
  );
  assertStringIncludes(pre, DEF_DO_GATILHO);
  assertStringIncludes(pos, DEF_DO_GATILHO);
  for (const trecho of [
    "t.tgenabled = 'O'",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "a.grantee = 0 AND a.privilege_type = 'EXECUTE'",
    "p.proconfig = ARRAY['search_path=public, pg_temp']::text[]",
    "p.provolatile = 's'",
  ])
    assertStringIncludes(pos, trecho);
});

Deno.test("20261661: o rollback devolve o bloco da 20261600000000 BYTE A BYTE, passa a Fase 0 e nao apaga nada", () => {
  assertEquals(
    rollback.split(blocoDoMotivo(m1600)).length,
    2,
    "o bloco do motivo da 1600 (CREATE, REVOKE e COMMENT) nao esta letra por letra no rollback",
  );
  assertEquals(md5(corpoDe(rollback)), H1600);
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  const cod = semComentario(rollback.replace(corpoDe(rollback), ""));
  for (const proibido of [
    /\bDROP\b/i,
    /\bDELETE\b/i,
    /\bTRUNCATE\b/i,
    /\bUPDATE\b/i,
    /\bINSERT\b/i,
    /current_setting\('app\./i,
  ])
    assert(!proibido.test(cod), `rollback: ${proibido}`);
  let destrutivo = true;
  try {
    Deno.statSync(
      `${RAIZ}/supabase/migrations/rollback-manual-destrutivo-${NOME}`,
    );
  } catch {
    destrutivo = false;
  }
  assertEquals(destrutivo, false);
});

Deno.test("20261661: o db-apply confere o motivo novo pelos marcadores, e os da 1600 seguem casando 1x no corpo desta", () => {
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[NOME];
  assert(entrada, "sem entrada no db-apply: a migration sairia PULADA");
  assertEquals(
    entrada.map((c) => c.funcao),
    ["motivo_da_loja_nao_aceitar_pedido"],
  );
  const corpo = corpoDe(migration);
  for (const { texto, vezes } of entrada[0].esperado)
    assertEquals(corpo.split(texto).length - 1, vezes, texto);
  // a entrada da 1600 e' conferida contra o corpo VIVO depois desta: nenhum marcador vira A MAIS nem some
  const da1600 = VERIFICACOES[NOME_1600].find(
    (c) => c.funcao === "motivo_da_loja_nao_aceitar_pedido",
  );
  assert(da1600, "a entrada da 1600 perdeu o motivo");
  for (const { texto, vezes } of da1600.esperado)
    assertEquals(corpo.split(texto).length - 1, vezes, `1600: ${texto}`);
});
