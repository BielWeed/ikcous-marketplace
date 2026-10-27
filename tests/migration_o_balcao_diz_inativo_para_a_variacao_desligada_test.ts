// @ts-nocheck
// O BALCAO DIZ "INATIVO" PARA A VARIACAO DESLIGADA — prova offline do par 20261393100000 + rollback (balcao; cacada
// de 26/10/2026). O COMPORTAMENTO (variacao desligada com o codigo cai no terceiro caso "cadastrado mas inativo",
// quem ja era achado continua sendo e na mesma precedencia, variacao de produto apagado segue nao encontrada, as
// chaves da resposta, o gate, rollback, pre-voo, consultas 104a/104b e a leitura do reducer do balcao) e' provado em
// tests/banco/o-balcao-diz-inativo-para-a-variacao-desligada-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261381000000 com SO a busca da variacao desligada (tudo antes e depois do
// bloco trocado, inclusive o gate de admin e o RETURN, tem de ser byte a byte o vigente); o corpo do rollback tem de
// ser o da 20261381000000 BYTE A BYTE; os atributos (SECURITY DEFINER, STABLE, search_path) e a ACL nao podem mudar;
// o pre-voo vem antes da troca e a conferencia depois; sem BEGIN/COMMIT de nivel superior.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261393100000_o_balcao_diz_inativo_para_a_variacao_desligada.sql";
const VIGENTE =
  "20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationVigente = ler(VIGENTE);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");
const norm = (s) => s.replace(/\s+/g, " ").trim();
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

const H_VIGENTE = "e1b93114cd9deee7eda6801ef37ff1f9";
const H_NOVO = "3e2276ae97a7f2aef487e55d259ba7a3";
const ASSINATURA = "public.buscar_por_codigo_barras(text)";
const MARCA =
  "CREATE OR REPLACE FUNCTION public.buscar_por_codigo_barras(p_codigo text)";

/** O texto da funcao (do CREATE ao `$function$;`) e o corpo (entre as aspas de dolar). */
function funcaoDe(sql) {
  assert.equal(
    sql.split(MARCA).length - 1,
    1,
    "uma definicao de buscar_por_codigo_barras",
  );
  const ini = sql.indexOf(MARCA);
  const fim = sql.indexOf("$function$;", ini) + "$function$;".length;
  return sql.slice(ini, fim);
}
const corpoDe = (sql) =>
  /AS \$function\$([\s\S]*?)\$function\$;/.exec(funcaoDe(sql))[1];
const CORPO_VIGENTE = corpoDe(migrationVigente);
const CORPO_NOVO = corpoDe(migration);

// O bloco trocado (unico no corpo vigente): o ELSE final que zerava as variaveis.
const BLOCO_VIGENTE = `        IF FOUND THEN
            v_origem := 'produto';
        ELSE
            -- \`SELECT ... INTO\` sem linha ZERA todas as variaveis de destino,
            -- inclusive \`v_variacoes\`. Repor a lista vazia aqui e' o que
            -- mantem o contrato: a chave existe sempre e nunca e' NULL.
            v_produto := NULL;
            v_preco := NULL;
            v_estoque := NULL;
            v_variacoes := '[]'::jsonb;
        END IF;
    END IF;`;
const iBloco = CORPO_VIGENTE.indexOf(BLOCO_VIGENTE);
const ANTES = CORPO_VIGENTE.slice(0, iBloco);
const DEPOIS = CORPO_VIGENTE.slice(iBloco + BLOCO_VIGENTE.length);
const BLOCO_NOVO = CORPO_NOVO.slice(
  ANTES.length,
  CORPO_NOVO.length - DEPOIS.length,
);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("o corpo vigente e' o da 20261381000000 (md5 conhecido) e o corpo novo e' ele com SO o bloco final trocado: tudo antes e tudo depois e' byte a byte o vigente", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  assert.equal(
    CORPO_VIGENTE.split(BLOCO_VIGENTE).length - 1,
    1,
    "o bloco trocado existe UMA vez no vigente",
  );
  assert.ok(CORPO_NOVO.startsWith(ANTES), "o que vem antes do bloco mudou");
  assert.ok(CORPO_NOVO.endsWith(DEPOIS), "o que vem depois do bloco mudou");
  assert.equal(CORPO_NOVO, ANTES + BLOCO_NOVO + DEPOIS);
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  assert.ok(BLOCO_NOVO.length > BLOCO_VIGENTE.length);
  // o ultimo trecho do bloco novo ainda zera as variaveis quando nao acha nada (o contrato das chaves)
  for (const zera of [
    "v_produto := NULL;",
    "v_preco := NULL;",
    "v_estoque := NULL;",
    "v_variacoes := '[]'::jsonb;",
  ])
    assert.ok(BLOCO_NOVO.includes(zera), zera);
});

Deno.test("o gate de admin continua sendo a PRIMEIRA instrucao, antes de qualquer leitura de tabela (inclusive a nova); a normalizacao, o teto e o RETURN nao mudam", () => {
  const codigo = norm(semComentarios(CORPO_NOVO));
  const iGate = codigo.indexOf(
    "IF public.is_admin_atual() IS DISTINCT FROM true THEN",
  );
  const iLeitura = codigo.indexOf("FROM public.product_variants");
  assert.ok(iGate >= 0 && iLeitura > iGate, "o gate vem antes da 1a leitura");
  assert.equal(
    CORPO_NOVO.split("IF public.is_admin_atual() IS DISTINCT FROM true THEN")
      .length - 1,
    1,
  );
  for (const trecho of [
    "v_codigo := NULLIF(btrim(p_codigo, E' \\t\\r\\n'), '');",
    "IF length(v_codigo) > 64 THEN",
    "'encontrado', v_origem IS NOT NULL,",
    "'variacoes', v_variacoes",
  ])
    assert.equal(
      CORPO_NOVO.split(trecho).length,
      CORPO_VIGENTE.split(trecho).length,
      trecho,
    );
});

Deno.test("a busca nova: so depois de nao achar variacao ATIVA nem produto, so variacao desligada (active IS DISTINCT FROM true, cobre NULL), produto nao apagado, devolve o terceiro caso (encontrado, origem 'variante', produto.ativo falso, lista de variacoes vazia)", () => {
  const novo = norm(semComentarios(BLOCO_NOVO));
  for (const trecho of [
    "FROM public.product_variants v JOIN public.produtos p ON p.id = v.product_id WHERE v.codigo_barras = v_codigo AND v.active IS DISTINCT FROM true AND p.deleted_at IS NULL;",
    "'ativo', false,",
    "INTO v_produto, v_variante, v_preco, v_estoque",
    "COALESCE(v.price_override, p.preco_venda)",
    "v_origem := 'variante'; v_variacoes := '[]'::jsonb; ELSE",
  ])
    assert.ok(novo.includes(trecho), trecho);
  // fica DENTRO do ELSE do produto (depois dele): quem ja era achado continua sendo e na mesma precedencia
  const iProduto = norm(semComentarios(CORPO_NOVO)).indexOf(
    "v_origem := 'produto';",
  );
  const iNova = norm(semComentarios(CORPO_NOVO)).indexOf(
    "AND v.active IS DISTINCT FROM true",
  );
  assert.ok(iProduto >= 0 && iNova > iProduto);
  // as duas buscas antigas ficaram: variacao ATIVA primeiro, produto depois
  assert.equal(CORPO_NOVO.split("AND v.active = true").length - 1, 1);
  assert.equal(
    CORPO_NOVO.split("WHERE p.codigo_barras = v_codigo").length - 1,
    1,
  );
  // nada de ILIKE/LIKE na busca por codigo (igualdade: o indice unico vale e um EAN pode ser prefixo de outro)
  assert.doesNotMatch(semComentarios(BLOCO_NOVO), /\bI?LIKE\b/i);
  // as mesmas chaves do objeto do produto e da variacao que o caso 'variante' ativo devolve
  for (const chave of [
    "'id', p.id,",
    "'nome', p.nome,",
    "'preco_venda', p.preco_venda,",
    "'estoque', p.estoque,",
    "'codigo_barras', p.codigo_barras,",
    "'tem_variantes', true",
    "'variant_id', v.id,",
    "'valor', v.value,",
    "'preco', COALESCE(v.price_override, p.preco_venda),",
    "'estoque', v.stock_increment,",
    "'codigo_barras', v.codigo_barras",
  ])
    assert.ok(BLOCO_NOVO.includes(chave), chave);
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261393100000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata no corpo novo", () => {
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[NOME];
  assert.ok(entrada, "sem entrada em VERIFICACOES");
  assert.equal(entrada.funcao, "buscar_por_codigo_barras");
  assert.ok(entrada.esperado.length >= 5);
  for (const m of entrada.esperado) {
    const { texto, vezes } = typeof m === "string" ? { texto: m, vezes: 1 } : m;
    assert.equal(
      CORPO_NOVO.split(texto).length - 1,
      vezes ?? 1,
      `contagem de ${texto}`,
    );
  }
  // o marcador da busca nova NAO existe no corpo da 381: sem a troca, a entrada reprova
  assert.ok(!CORPO_VIGENTE.includes("AND v.active IS DISTINCT FROM true"));
});

Deno.test("o rollback recria o corpo VIGENTE (o da 20261381000000) byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(funcaoDe(rollback), funcaoDe(migrationVigente));
  assert.equal(corpoDe(rollback), CORPO_VIGENTE);
  assert.equal(md5(corpoDe(rollback)), H_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [H_VIGENTE, H_NOVO]) assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(
    !corpoDe(rollback).includes(
      "IS DISTINCT FROM true\n              AND p.deleted_at",
    ),
  );
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos (SECURITY DEFINER, plpgsql, STABLE, search_path=pg_catalog, pg_temp); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.buscar_por_codigo_barras(p_codigo text)\n" +
    " RETURNS jsonb\n" +
    " LANGUAGE plpgsql\n" +
    " STABLE SECURITY DEFINER\n" +
    " SET search_path TO 'pg_catalog', 'pg_temp'\n" +
    "AS $function$";
  for (const sql of [migration, rollback]) {
    assert.equal(
      sql.split("\nCREATE OR REPLACE FUNCTION").length - 1,
      1,
      "uma funcao por arquivo",
    );
    assert.ok(sql.includes(cabecalho), "assinatura e atributos de sempre");
    const fora = limpo(sql.replace(funcaoDe(sql), ""));
    assert.doesNotMatch(fora, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(
      fora,
      /\b(DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
    assert.doesNotMatch(
      fora,
      /\bCREATE\s+(TABLE|POLICY|INDEX|TRIGGER|VIEW)\b/i,
    );
    assert.doesNotMatch(fora, /\b(VOLATILE|IMMUTABLE|SECURITY INVOKER)\b/i);
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
  assert.ok(migrationVigente.includes(cabecalho));
  // a busca e' so de LEITURA: nenhum DML dentro do corpo novo
  assert.doesNotMatch(
    semComentarios(CORPO_NOVO),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
  );
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos (o da 381 e o desta), a ACL de hoje e confere atributos e argumentos; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261393100000$");
  const fimPre = migration.indexOf("END $preflight_20261393100000$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261393100000$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    `to_regprocedure('${ASSINATURA}')`,
    "md5(replace(prosrc, E'\\r', ''))",
    `'${H_VIGENTE}'`,
    `'${H_NOVO}'`,
    "v_hash NOT IN (",
    "p.prosecdef",
    "p.provolatile = 's'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]",
    "pg_get_function_arguments(p.oid) = 'p_codigo text'",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "<> 1",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico)",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  const conf = migration.slice(iConf);
  for (const trecho of [
    `v_hash IS DISTINCT FROM '${H_NOVO}'`,
    "p.prosecdef",
    "p.provolatile = 's'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "RAISE EXCEPTION 'conferencia 20261393100000:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (aceita o corpo desta migration ou o da 381, atributos, ACL) e conferencia (o corpo volta ao da 381); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261393100000$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261393100000$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`'${H_VIGENTE}'`) && pre.includes(`'${H_NOVO}'`));
  assert.ok(pre.includes("v_hash NOT IN ("));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${H_VIGENTE}'`));
  assert.ok(conf.includes("g.grantee = 0"), "PUBLIC continua fechado");
  assert.doesNotMatch(
    limpo(rollback.replace(funcaoDe(rollback), "")),
    /GRANT|REVOKE/i,
  );
});

Deno.test("o cabecalho declara a regra, o contrato da resposta, os dados existentes, a ordem de desfazer e que nenhum front muda", () => {
  for (const trecho of [
    "O DEFEITO MEDIDO",
    "terceiro caso",
    "encontrado = true",
    "DADOS EXISTENTES",
    "ROLLBACK MANUAL",
    "Este rollback vem ANTES do rollback da 20261381000000",
    "Nenhum front muda",
    "86a",
    "9a",
    "Sem BEGIN/COMMIT de",
  ])
    assert.ok(migration.includes(trecho), trecho);
  assert.ok(migration.includes("5. DADOS EXISTENTES"));
});

Deno.test("depois da 20261381000000 so este par redefine buscar_por_codigo_barras", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > VIGENTE.slice(0, 14) &&
      /create (?:or replace )?function (?:public\.)?buscar_por_codigo_barras\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(posteriores.sort(), [NOME, `rollback-manual-${NOME}`]);
});

Deno.test("a 86a e a 9a aceitam o corpo desta migration como sucessor do da 381 (e so ele); o 'dono' do corpo na 9a e' esta migration", () => {
  const c86a = lerRepo(
    "scripts/publicacao/consultas/86a-conferir-ex-admin-no-resto-do-painel-aplicado.sql",
  );
  assert.ok(
    c86a.includes(
      `OR (a.assinatura='public.buscar_por_codigo_barras(text)'\n             AND md5(replace(p.prosrc,chr(13),''))='${H_NOVO}')`,
    ),
  );
  assert.ok(c86a.includes(`'${H_VIGENTE}'`));
  const c86b = lerRepo(
    "scripts/publicacao/consultas/86b-antes-ex-admin-no-resto-do-painel-base-vigente.sql",
  );
  assert.ok(!c86b.includes(H_NOVO), "a 86b (o ANTES) nunca aceita a sucessora");
  const c9a = lerRepo(
    "scripts/publicacao/consultas/9a-conferir-60-a-66-aplicado.sql",
  );
  assert.ok(c9a.includes(`('buscar_por_codigo_barras', '${H_NOVO}')`));
  assert.ok(
    c9a.includes(
      `f.fn = 'buscar_por_codigo_barras'
                   AND (c.h = '8762faab7f7efaf4bfd183499408d8df' OR c.h = '${H_VIGENTE}')`,
    ),
  );
});

Deno.test("as consultas 104a/104b existem, tem o rol fechado de 4 linhas, o md5 certo e estao registradas nos canais, no rpc-ci e no conferir-banco-da-loja", () => {
  const C104A =
    "104a-conferir-o-balcao-diz-inativo-para-a-variacao-desligada-aplicado";
  const C104B =
    "104b-antes-o-balcao-diz-inativo-para-a-variacao-desligada-base-vigente";
  const sqlA = lerRepo(`scripts/publicacao/consultas/${C104A}.sql`);
  const sqlB = lerRepo(`scripts/publicacao/consultas/${C104B}.sql`);
  assert.ok(sqlA.includes(`'${H_NOVO}'`) && !sqlA.includes(H_VIGENTE));
  assert.ok(sqlB.includes(`'${H_VIGENTE}'`) && !sqlB.includes(H_NOVO));
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  assert.equal(ROL_FECHADO_POR_CONSULTA[C104A].length, 4);
  assert.deepEqual(
    ROL_FECHADO_POR_CONSULTA[C104A],
    ROL_FECHADO_POR_CONSULTA[C104B],
  );
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const prova = canais.provasDeObjetos.find((p) => p.consulta === C104A);
  assert.ok(prova, "104a nao esta nos canais");
  assert.deepEqual(prova.versoes, ["20261393100000"]);
  assert.equal(prova.ausenciaConfirmadaPor, C104B);
  const rpc = lerRepo(".github/workflows/rpc-ci.yml");
  assert.equal(rpc.split(`consultas/${C104A}.sql`).length - 1, 2);
  assert.equal(rpc.split(`consultas/${C104B}.sql`).length - 1, 2);
  assert.ok(
    rpc.includes(
      "tests/banco/rodar-isolado.cjs tests/banco/o-balcao-diz-inativo-para-a-variacao-desligada-viva.cjs",
    ),
  );
  const conferir = lerRepo(".github/workflows/conferir-banco-da-loja.yml");
  assert.ok(conferir.includes(`- ${C104A}`) && conferir.includes(`- ${C104B}`));
});
