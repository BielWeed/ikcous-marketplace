// @ts-nocheck
// A BUSCA DE PEDIDOS ACHA O TELEFONE COLADO COM O +55 — prova offline do par 20261399900000 + rollback (tela Pedidos do painel;
// lote 40 do modo autonomo). O COMPORTAMENTO ("+55 34 98888-7777" acha o pedido guardado como "(34) 98888-7777", o numero sem o 55
// continua achando, DDD 55 com 11 digitos nao perde o 55, o resto do JSON identico, rollback, pre-voo, consultas 125a/125b) e'
// provado em tests/banco/a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-viva.cjs, que so roda no Postgres efemero do CI. Aqui
// fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261387000000 com SO o corte declarado; o corpo do rollback tem de ser o da 20261387000000
// BYTE A BYTE; os atributos (SECURITY DEFINER, VOLATILE, search_path 'public, extensions') e a ACL nao podem mudar; o pre-voo vem
// antes da troca e a conferencia depois; sem BEGIN/COMMIT de nivel superior (com eles o ROLLBACK do script de prova vira no-op).
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
  "20261399900000_a_busca_de_pedidos_acha_o_telefone_colado_com_o_55.sql";
const VIGENTE =
  "20261387000000_a_busca_de_pedido_pelo_numero_nao_vira_busca_de_telefone.sql";
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

const H_VIGENTE = "f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6";
const H_NOVO = "bf08545275eaa451a65e15feceb0ed8d";
const H_99 = "5861dbbe0e9c007a4196f5308c17d763";
const ASSINATURA =
  "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(` do arquivo. */
function corpoDe(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(";
  assert.equal(
    sql.split(marca).length - 1,
    1,
    "uma definicao de get_admin_orders_paged",
  );
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const CORPO_VIGENTE = corpoDe(migrationVigente);
const CORPO_NOVO = corpoDe(migration);

const LINHA_DIGITOS =
  "    v_search_digitos := regexp_replace(v_clean_search, '[^0-9]', '', 'g');\n";
// A troca (uma so): depois da linha que calcula v_search_digitos, o corte do 55.
const CORTE_DO_55 =
  "    -- Com 12 ou 13 digitos que comecam por 55 (o +55 do Brasil colado do WhatsApp), o 55 sai antes de\n" +
  '    -- comparar: o checkout e o balcao guardam o telefone sem o 55 ("(34) 98888-7777"), a mesma regra da busca\n' +
  "    -- de clientes (20261230000000) e da do CRM (20261392100000). Um telefone guardado COM o 55 continua casando\n" +
  "    -- (a comparacao e 'contem'). O DDD 55 (Santa Maria/RS) com 11 digitos nao perde o 55: nao entra neste corte.\n" +
  "    IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN\n" +
  "        v_search_digitos := substr(v_search_digitos, 3);\n" +
  "    END IF;\n";
const TROCA = [LINHA_DIGITOS, `${LINHA_DIGITOS}${CORTE_DO_55}`];

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

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao) e tudo esta em LF", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
  for (const arquivo of [NOME, `rollback-manual-${NOME}`]) {
    const bruto = Deno.readTextFileSync(
      new URL(`supabase/migrations/${arquivo}`, DIR),
    );
    assert.ok(!bruto.includes("\r"), `${arquivo} em disco tem CR`);
  }
});

Deno.test("o corpo vigente e' o da 20261387000000 (md5 conhecido) e o corpo novo e' ele com SO o corte declarado, md5 dos dois conhecido; desfazer a troca devolve o vigente byte a byte", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  const [de, para] = TROCA;
  assert.equal(
    CORPO_VIGENTE.split(de).length - 1,
    1,
    "o trecho antigo existe UMA vez",
  );
  const esperado = CORPO_VIGENTE.replace(de, () => para);
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + o corte");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  assert.equal(
    CORPO_NOVO.replace(para, () => de),
    CORPO_VIGENTE,
    "desfazer a troca devolve o vigente",
  );
  // o que NAO pode ter mudado: as portas, a regra de "parece telefone", o limiar de 4 digitos, os dois blocos, a ordem e a pagina
  for (const trecho of [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
    "v_parece_telefone := v_clean_search ~ '^[+]?[0-9() .-]+$';",
    "v_parece_telefone AND length(v_search_digitos) >= 4",
    "AND regexp_replace(",
    ") LIKE '%' || v_search_digitos || '%'",
    "AND upper(right(o.id::TEXT, 6)) = upper(v_clean_search)",
    "o.created_at DESC",
    "LIMIT p_page_size",
    "OFFSET v_offset",
    "'total_count', v_total_count",
    "public.f_unaccent(o.customer_name) ILIKE public.f_unaccent('%' || v_clean_search || '%')",
  ])
    assert.equal(
      CORPO_NOVO.split(trecho).length,
      CORPO_VIGENTE.split(trecho).length,
      `o trecho ${trecho} mudou de numero de ocorrencias`,
    );
  assert.equal(CORPO_NOVO.split("IF NOT public.is_admin() THEN").length - 1, 1);
  assert.equal(
    CORPO_NOVO.split("IF NOT public.is_admin_atual() THEN").length - 1,
    1,
  );
  // o limiar de 4 digitos vale nos DOIS blocos (contagem e pagina)
  assert.equal(
    CORPO_NOVO.split("v_parece_telefone AND length(v_search_digitos) >= 4")
      .length - 1,
    2,
  );
});

Deno.test("a regra nova e' a MESMA da busca de clientes (20261230000000) e da do CRM: so 12 ou 13 digitos que comecam por 55; vem DEPOIS de v_search_digitos e ANTES de qualquer comparacao", () => {
  const corte =
    "IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN";
  const regra230 = ler(
    "20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql",
  );
  assert.ok(regra230.includes(corte), "a regra da busca de clientes mudou");
  const iCalc = CORPO_NOVO.indexOf(LINHA_DIGITOS);
  const iCorte = CORPO_NOVO.indexOf(corte);
  const iParece = CORPO_NOVO.indexOf("v_parece_telefone := ");
  const iUso = CORPO_NOVO.indexOf("LIKE '%' || v_search_digitos || '%'");
  assert.ok(iCalc >= 0 && iCorte > iCalc && iParece > iCorte && iUso > iParece);
  // so um corte (nada de cortar duas vezes) e o resto e' substr a partir do 3o digito
  assert.equal(CORPO_NOVO.split(corte).length - 1, 1);
  assert.equal(
    CORPO_NOVO.split("v_search_digitos := substr(v_search_digitos, 3);")
      .length - 1,
    1,
  );
  // 11 digitos (DDD 55 + celular) nao entra no corte
  assert.doesNotMatch(
    CORPO_NOVO,
    /IN \([^)]*\b11\b[^)]*\) AND left\(v_search_digitos/,
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261399900000 (sem ela a migration sai PULADA), cada marcador com a contagem exata e presente no corpo novo e ausente no vigente onde so o novo traz", () => {
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagem = VERIFICACOES[NOME];
  assert.ok(checagem, "sem entrada em VERIFICACOES");
  assert.equal(checagem.funcao, "get_admin_orders_paged");
  assert.equal(avaliarChecagem(CORPO_NOVO, checagem).situacao, "verificada");
  // O corpo da 387 (sem o corte) falha a verificacao; cada marcador tira a verificacao do ar quando some.
  assert.equal(avaliarChecagem(CORPO_VIGENTE, checagem).situacao, "falhou");
  for (const m of checagem.esperado)
    assert.equal(
      avaliarChecagem(CORPO_NOVO.replace(m.texto, "XX"), checagem).situacao,
      "falhou",
      `o marcador "${m.texto.slice(0, 40)}" nao pega a regressao`,
    );
  // A verificacao da 387 segue de pe com o corpo novo: nada do que ela cobra foi tirado.
  // eslint-disable-next-line security/detect-object-injection -- Nome literal da migration anterior, nunca entrada externa.
  const da387 = VERIFICACOES[VIGENTE];
  assert.equal(
    avaliarChecagem(CORPO_NOVO, da387).situacao,
    "verificada",
    "o corpo novo perdeu algo que a verificacao da 20261387000000 cobra",
  );
});

Deno.test("o rollback recria o corpo VIGENTE (o da 20261387000000) byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback), CORPO_VIGENTE);
  assert.equal(md5(corpoDe(rollback)), H_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [H_VIGENTE, H_NOVO]) assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(!corpoDe(rollback).includes("substr(v_search_digitos, 3)"));
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos (SECURITY DEFINER, plpgsql, VOLATILE, search_path='public, extensions'); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(p_search text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_start_date text DEFAULT ''::text, p_end_date text DEFAULT ''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_payment_status text DEFAULT 'all'::text, p_canal text DEFAULT 'all'::text)\n" +
    " RETURNS jsonb\n" +
    " LANGUAGE plpgsql\n" +
    " SECURITY DEFINER\n" +
    " SET search_path TO 'public', 'extensions'\n" +
    "AS $$";
  for (const sql of [migration, rollback]) {
    assert.equal(
      sql.split("\nCREATE OR REPLACE FUNCTION").length - 1,
      1,
      "uma funcao por arquivo",
    );
    assert.ok(sql.includes(cabecalho), "assinatura e atributos de sempre");
    const fora = limpo(sql.replace(corpoDe(sql), ""));
    assert.doesNotMatch(fora, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(
      fora,
      /\b(DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
    assert.doesNotMatch(
      fora,
      /\bCREATE\s+(TABLE|POLICY|INDEX|TRIGGER|VIEW)\b/i,
    );
    assert.doesNotMatch(fora, /\b(STABLE|IMMUTABLE|SECURITY INVOKER)\b/i);
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
  assert.ok(migrationVigente.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos (o da 387 e o desta), a ACL de hoje e confere atributos e argumentos; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261399900000$");
  const fimPre = migration.indexOf("END $preflight_20261399900000$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261399900000$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    "to_regprocedure(r.assinatura)",
    "md5(replace(p.prosrc, E'\\r', ''))",
    `('${ASSINATURA.replace("public.", "public.")}', '${H_VIGENTE}', '${H_NOVO}')`,
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "p.prosecdef",
    "p.proconfig = ARRAY['search_path=public, extensions']::text[]",
    "p.provolatile = 'v'",
    "NOT p.proretset",
    "pg_get_function_identity_arguments(p.oid) = 'p_search text, p_status text, p_start_date text, p_end_date text, p_page integer, p_page_size integer, p_payment_status text, p_canal text'",
    "q.proname = 'get_admin_orders_paged') = 1",
    "aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))",
    "a.grantee = 0",
    "NOT has_function_privilege('anon', p.oid, 'EXECUTE')",
    "has_function_privilege('authenticated', p.oid, 'EXECUTE')",
    "has_function_privilege('service_role', p.oid, 'EXECUTE')",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
    "set_config('ikcous.pedidos3999_atributos'",
  ])
    assert.ok(pre.includes(trecho), trecho);
  // o pre-voo NAO aceita o corpo da 20261199000000 (a cadeia e' 99 -> 387 -> esta): aplique a 387 antes
  assert.ok(!pre.includes(H_99));
  const conf = migration.slice(iConf);
  for (const trecho of [
    `= '${H_NOVO}'`,
    "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.pedidos3999_atributos')::jsonb",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399900000",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (exige o corpo DESTA migration, atributos, ACL) e conferencia (o corpo volta ao da 387 com os mesmos atributos); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261399900000$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261399900000$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`'${H_VIGENTE}', '${H_NOVO}')`));
  assert.ok(pre.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.ok(pre.includes("a.grantee = 0"), "PUBLIC continua fechado");
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`= '${H_VIGENTE}'`));
  assert.ok(
    conf.includes("current_setting('ikcous.pedidos3999_atributos')::jsonb"),
  );
  assert.doesNotMatch(
    limpo(rollback.replace(corpoDe(rollback), "")),
    /GRANT|REVOKE/i,
  );
});

Deno.test("a ordem de desfazer esta declarada no cabecalho; a 92a, a 8e, a 9a, o modulo das sucessoras e a prova viva da 387 conhecem a sucessora", () => {
  for (const trecho of [
    "ROLLBACK MANUAL",
    "vem ANTES do rollback da 20261387000000",
    "DDD 55",
    "92a",
    "125a",
    "125b",
  ])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = lerRepo(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    c8e.includes(`('get_admin_orders_paged', '${H_NOVO}', '20261399900000')`),
  );
  const c92a = lerRepo(
    "scripts/publicacao/consultas/92a-conferir-a-busca-de-pedido-pelo-numero-aplicado.sql",
  );
  assert.ok(c92a.includes(`h IN ('${H_VIGENTE}', '${H_NOVO}')`));
  assert.ok(c92a.includes(`THEN '${H_VIGENTE}' ELSE h END`));
  // O corpo FINAL da 9a e' o da sucessora desta (20261399980000, o desempate por id); o da 99, o da 387 e o desta ainda no ar aparecem como ele.
  const c9a = lerRepo(
    "scripts/publicacao/consultas/9a-conferir-60-a-66-aplicado.sql",
  );
  assert.ok(
    c9a.includes(
      "('get_admin_orders_paged', 'b404a8397a6490c86fb192d85fd5b6c9')",
    ),
  );
  assert.ok(!c9a.includes(`('get_admin_orders_paged', '${H_NOVO}')`));
  assert.ok(!c9a.includes(`('get_admin_orders_paged', '${H_VIGENTE}')`));
  assert.ok(
    c9a.includes(
      `(c.h = '${H_99}' OR c.h = '${H_VIGENTE}')\n              THEN 'b404a8397a6490c86fb192d85fd5b6c9'`,
    ),
  );
  assert.ok(
    c9a.includes(
      `WHEN f.fn = 'get_admin_orders_paged' AND c.h = '${H_NOVO}'\n              THEN 'b404a8397a6490c86fb192d85fd5b6c9'`,
    ),
  );
  const sucessoras = lerRepo("tests/banco/sucessoras-da-99.cjs");
  assert.ok(sucessoras.includes(NOME));
  const posterior = lerRepo("tests/banco/a-busca-de-pedidos-posterior.cjs");
  assert.ok(posterior.includes(`"${H_NOVO}"`));
  assert.ok(posterior.includes(`"${H_VIGENTE}"`));
  assert.ok(posterior.includes(NOME));
  assert.ok(posterior.includes("`rollback-manual-${"));
  assert.ok(
    lerRepo("tests/banco/a-busca-de-pedido-pelo-numero-viva.cjs").includes(
      "a-busca-de-pedidos-posterior.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/portao-8e-aceita-sucessoras-viva.cjs").includes(
      "a-busca-de-pedidos-posterior.cjs",
    ),
  );
});

Deno.test("as consultas 125a/125b sao so de catalogo, quatro linhas fechadas, e estao registradas (rol, release, workflows, canais, prova viva, LEIA-ME)", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A =
    "125a-conferir-a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-aplicado";
  const B =
    "125b-antes-a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-base-vigente";
  for (const [nomeConsulta, hash, corte] of [
    [A, H_NOVO, "sim"],
    [B, H_VIGENTE, "nao"],
  ]) {
    const consulta = lerRepo(
      `scripts/publicacao/consultas/${nomeConsulta}.sql`,
    );
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${hash}'`));
    // So catalogo: nenhuma tabela de pedido e' lida e a RPC nao e' chamada.
    assert.doesNotMatch(
      consulta,
      /FROM public\.(?:marketplace_|produtos|profiles|coupons|store_config)|(?:SELECT|PERFORM|FROM)\s+public\.get_admin_orders_paged\(/,
    );
    assert.ok(
      consulta.includes(
        `'o corpo corta o 55 do telefone colado (uma vez)', '${corte}'`,
      ) ||
        consulta.includes(
          `'get_admin_orders_paged: o corpo corta o 55 do telefone colado (uma vez)', '${corte}'`,
        ),
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 4);
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(nomeConsulta));
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(estruturaDoRolFechado(linhas, rol), null);
    assert.notEqual(estruturaDoRolFechado(linhas.slice(1), rol), null);
    assert.notEqual(estruturaDoRolFechado([...linhas, linhas[0]], rol), null);
    assert.equal(
      lerRepo(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${nomeConsulta}.sql"`,
      ).length - 1,
      2,
    );
    assert.ok(
      lerRepo(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nomeConsulta}\n`,
      ),
    );
  }
  const entrada = JSON.parse(
    lerRepo("scripts/frota/canais-de-backend.json"),
  ).provasDeObjetos.find((p: { versoes: string[] }) =>
    p.versoes.includes("20261399900000"),
  );
  assert.equal(entrada.consulta, A);
  assert.equal(entrada.ausenciaConfirmadaPor, B);
  assert.deepEqual(entrada.versoes, ["20261399900000"]);
  assert.ok(/^[\x20-\x7e]*$/.test(String(entrada._comentario)));
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assert.equal(
      Object.entries(entrada).find(([chave]) => chave === campo)?.[1],
      undefined,
      campo,
    );
  assert.ok(
    lerRepo(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-viva.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-viva.cjs",
    ),
  );
});

Deno.test("depois da 20261387000000 so este par redefine get_admin_orders_paged", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > VIGENTE.slice(0, 14) &&
      /create (?:or replace )?function public\.get_admin_orders_paged\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  // A 20261399980000 (as listas do painel desempatam por id) e' a unica depois desta: tem o proprio teste.
  const SUCESSORA =
    "20261399980000_as_listas_do_painel_nao_repetem_nem_escondem_ninguem_entre_as_paginas.sql";
  assert.deepEqual(posteriores.sort(), [
    NOME,
    SUCESSORA,
    `rollback-manual-${NOME}`,
    `rollback-manual-${SUCESSORA}`,
  ]);
});
