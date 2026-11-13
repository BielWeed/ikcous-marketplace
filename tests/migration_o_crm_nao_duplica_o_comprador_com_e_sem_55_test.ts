// @ts-nocheck
// O CRM NAO DUPLICA O COMPRADOR COM E SEM O 55 -- prova offline do par 20261399990000 + rollback (a fonte de todo
// comprador do CRM, public.crm__vendas; caca de 13/11/2026). O COMPORTAMENTO (o mesmo WhatsApp com e sem o 55 vira UM
// comprador, numeros diferentes seguem diferentes, DDD 55 de 11 digitos nao perde o 55, sem numero nao junta ninguem, o
// resto das linhas identico, rollback, pre-voo, atomicidade sem BEGIN, consultas 142a/142b) e' provado em
// tests/banco/o-crm-nao-duplica-o-comprador-com-e-sem-55-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261178000000 com SO a troca declarada; o corpo do rollback tem de ser o da
// 20261178000000 BYTE A BYTE; os atributos (SQL, STABLE, INVOKER, search_path) e a ACL (PUBLIC, anon e authenticated
// fechados) nao podem mudar; o pre-voo vem antes da troca e a conferencia depois; sem BEGIN/COMMIT de nivel superior.
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
const NOME = "20261399990000_o_crm_nao_duplica_o_comprador_com_e_sem_55.sql";
const VIGENTE = "20261178000000_o_crm_e_o_inicio_leem_a_loja.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationVigente = ler(VIGENTE);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_VIGENTE = "8a802f6324c86cdc0be214b4d5ac69bb";
const H_NOVO = "bd683b55c36dff83eefa0282077d9a63";
const ASSINATURA = "public.crm__vendas(timestamptz)";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.crm__vendas(` do arquivo. */
function corpoDe(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.crm__vendas(";
  assert.equal(sql.split(marca).length - 1, 1, "uma definicao de crm__vendas");
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const CORPO_VIGENTE = corpoDe(migrationVigente);
const CORPO_NOVO = corpoDe(migration);

// A troca (declarada no cabecalho, item 4): tres trechos do corpo vigente.
const CTE_ANTIGA =
  "  ), wa_da_conta AS (\n" +
  "    SELECT DISTINCT ON (b.wa) b.wa, b.user_id\n" +
  "      FROM base b\n" +
  "     WHERE b.wa IS NOT NULL AND b.user_id IS NOT NULL\n" +
  "     ORDER BY b.wa, b.pago_em DESC\n" +
  "  )";
const CTE_NOVA =
  "  ), base_chave AS (\n" +
  '    -- O MESMO WhatsApp gravado uma vez com o 55 (balcao, "+55...") e outra sem (conta, "(34)...") e UM comprador: a chave e a fusao comparam o\n' +
  "    -- numero SEM o 55 quando ele tem DDI (12 ou 13 digitos comecando por 55), a mesma expressao de crm__pedidos_nao_pagos e crm__nunca_comprou\n" +
  "    -- (20261183000000, N4). O DDD 55 com 11 digitos nao perde o 55. `wa` (o que se exibe) continua o numero original do pedido.\n" +
  "    SELECT b.*,\n" +
  "           CASE WHEN length(b.wa) IN (12, 13) AND left(b.wa, 2) = '55'\n" +
  "                THEN substring(b.wa FROM 3) ELSE b.wa END AS wa_chave\n" +
  "      FROM base b\n" +
  "  ), wa_da_conta AS (\n" +
  "    SELECT DISTINCT ON (b.wa_chave) b.wa_chave, b.user_id\n" +
  "      FROM base_chave b\n" +
  "     WHERE b.wa_chave IS NOT NULL AND b.user_id IS NOT NULL\n" +
  "     ORDER BY b.wa_chave, b.pago_em DESC\n" +
  "  )";
const CHAVE_ANTIGA = "CASE WHEN b.wa IS NOT NULL THEN 'wa:' || b.wa END";
const CHAVE_NOVA =
  "CASE WHEN b.wa_chave IS NOT NULL THEN 'wa:' || b.wa_chave END";
const JUNCAO_ANTIGA =
  "    FROM base b\n    LEFT JOIN wa_da_conta w ON w.wa = b.wa AND b.user_id IS NULL";
const JUNCAO_NOVA =
  "    FROM base_chave b\n    LEFT JOIN wa_da_conta w ON w.wa_chave = b.wa_chave AND b.user_id IS NULL";
const TROCAS = [
  [CTE_ANTIGA, CTE_NOVA],
  [CHAVE_ANTIGA, CHAVE_NOVA],
  [JUNCAO_ANTIGA, JUNCAO_NOVA],
];

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

Deno.test("o corpo vigente e' o da 20261178000000 (md5 conhecido) e o corpo novo e' ele com SO as tres trocas declaradas, md5 dos dois conhecido; desfazer as trocas devolve o vigente byte a byte", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  let esperado = CORPO_VIGENTE;
  for (const [de, para] of TROCAS) {
    assert.equal(
      esperado.split(de).length - 1,
      1,
      `o trecho antigo existe UMA vez: ${de}`,
    );
    esperado = esperado.replace(de, () => para);
  }
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + as tres trocas");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  let volta = CORPO_NOVO;
  for (const [de, para] of [...TROCAS].reverse())
    volta = volta.replace(para, () => de);
  assert.equal(volta, CORPO_VIGENTE, "desfazer as trocas devolve o vigente");
  // o que NAO pode ter mudado: a venda que conta, as colunas devolvidas e a ordem delas
  for (const trecho of [
    "WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')",
    "AND o.status NOT IN ('cancelled', 'returned')",
    "AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL",
    "AND COALESCE(o.pagamento_recebido_em, o.paid_at) <= p_ate",
    "NULLIF(regexp_replace(COALESCE(o.customer_data ->> 'whatsapp', ''), '\\D', '', 'g'), '') AS wa",
    "COALESCE(b.user_id::text, w.user_id::text, CASE WHEN b.wa_chave IS NOT NULL THEN 'wa:' || b.wa_chave END),",
    "COALESCE(b.user_id, w.user_id),",
    "NULLIF(btrim(b.customer_name), ''), b.wa, b.email",
  ].map((t) => t.replace(/\s+/g, " ")))
    assert.ok(limpo(CORPO_NOVO).includes(limpo(trecho)), trecho);
  // a coluna exibida (whatsapp) continua o numero ORIGINAL (b.wa), nunca o da chave
  assert.ok(
    CORPO_NOVO.includes("NULLIF(btrim(b.customer_name), ''), b.wa, b.email"),
  );
});

Deno.test("a regra nova e' a MESMA expressao da 20261183000000 (N4): so 12 ou 13 digitos que comecam por 55; DDD 55 de 11 digitos nao entra", () => {
  const regra183 = ler("20261183000000_o_crm_ve_todo_mundo.sql");
  // a expressao existe, com este formato, na migration que ja a usa em crm__pedidos_nao_pagos e crm__nunca_comprou
  const molde = (x) =>
    `CASE WHEN length(${x}) IN (12, 13) AND left(${x}, 2) = '55'\n                THEN substring(${x} FROM 3) ELSE ${x} END`;
  // (removerRuido tira o conteudo das aspas de dolar; aqui o que importa E' o corpo das funcoes, entao so os comentarios saem)
  const semComentarios = (s) =>
    s
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n")
      .replace(/\s+/g, " ");
  assert.ok(
    semComentarios(regra183).includes(semComentarios(molde("v.whatsapp"))),
    "a 20261183000000 perdeu a expressao de referencia",
  );
  assert.ok(limpo(CORPO_NOVO).includes(limpo(molde("b.wa"))));
  // so um corte, nada de cortar duas vezes
  assert.equal(CORPO_NOVO.split("substring(b.wa FROM 3)").length - 1, 1);
  // 11 digitos (DDD 55 + celular) nao entra no corte
  assert.doesNotMatch(CORPO_NOVO, /IN \([^)]*\b11\b[^)]*\) AND left\(b\.wa/);
  // a chave e a fusao usam o numero SEM o 55; ninguem mais usa `b.wa` para comparar
  assert.doesNotMatch(
    CORPO_NOVO,
    /ON w\.wa = b\.wa|DISTINCT ON \(b\.wa\)|'wa:' \|\| b\.wa END/,
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261399990000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata e presente no corpo novo", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  const i = src.indexOf(`"${NOME}":`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  //", i));
  assert.ok(entrada.includes('funcao: "crm__vendas"'));
  const pares = [
    ...entrada.matchAll(/texto:\s*"((?:[^"\\]|\\.)*)",\s*vezes:\s*(\d+)/g),
  ].map((m) => [JSON.parse(`"${m[1]}"`), Number(m[2])]);
  assert.equal(pares.length, 6, "seis marcadores");
  for (const [texto, vezes] of pares) {
    assert.equal(vezes, 1, texto);
    assert.equal(CORPO_NOVO.split(texto).length - 1, 1, texto);
  }
  // os cinco marcadores da troca NAO existem no corpo da 20261178000000: sem a troca, a entrada reprova
  for (const [texto] of pares.filter(([t]) => !t.includes("o.status")))
    assert.equal(CORPO_VIGENTE.split(texto).length - 1, 0, texto);
});

Deno.test("o rollback recria o corpo VIGENTE (o da 20261178000000) byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback), CORPO_VIGENTE);
  assert.equal(md5(corpoDe(rollback)), H_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [H_VIGENTE, H_NOVO]) assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(!corpoDe(rollback).includes("wa_chave"));
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura, retorno e atributos (SQL, STABLE, INVOKER, search_path=public); nada de GRANT, REVOKE, DROP, ALTER, DML nem objeto novo fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.crm__vendas(p_ate timestamptz)\n" +
    "RETURNS TABLE (\n" +
    "  order_id uuid, total numeric, canal text, forma text, pago_em timestamptz, dia date,\n" +
    "  chave text, user_id uuid, nome text, whatsapp text, email text\n" +
    ")\n" +
    "LANGUAGE sql STABLE SET search_path = public\n" +
    "AS $$";
  for (const sql of [migration, rollback]) {
    assert.equal(
      sql.split("\nCREATE OR REPLACE FUNCTION").length - 1,
      1,
      "uma funcao por arquivo",
    );
    assert.ok(
      sql.includes(cabecalho),
      "assinatura, retorno e atributos de sempre",
    );
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
    assert.doesNotMatch(
      fora,
      /\b(VOLATILE|IMMUTABLE|SECURITY (INVOKER|DEFINER))\b/i,
    );
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
  assert.ok(migrationVigente.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos (o da 20261178000000 e o desta), atributos e retorno de sempre, ACL fechada para PUBLIC/anon/authenticated; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261399990000$");
  const fimPre = migration.indexOf("END $preflight_20261399990000$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261399990000$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    `to_regprocedure('${ASSINATURA}')`,
    "md5(replace(prosrc, E'\\r', ''))",
    `NOT IN ('${H_VIGENTE}', '${H_NOVO}')`,
    "l.lanname = 'sql'",
    "NOT p.prosecdef",
    "p.provolatile = 's'",
    "p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_arguments(p.oid) = 'p_ate timestamp with time zone'",
    "pg_get_function_result(p.oid) = 'TABLE(order_id uuid, total numeric, canal text, forma text, pago_em timestamp with time zone, dia date, chave text, user_id uuid, nome text, whatsapp text, email text)'",
    "<> 1",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "set_config('ikcous.crm3999_atributos'",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  const conf = migration.slice(iConf);
  for (const trecho of [
    `v_hash IS DISTINCT FROM '${H_NOVO}'`,
    "NOT p.prosecdef",
    "p.provolatile = 's'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.crm3999_atributos')::jsonb",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (aceita o corpo desta migration ou o da 20261178000000, atributos, ACL) e conferencia (o corpo volta ao da 20261178000000); nunca da EXECUTE a ninguem", () => {
  const iPre = rollback.indexOf("DO $preflight_rb_20261399990000$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rb_20261399990000$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`NOT IN ('${H_VIGENTE}', '${H_NOVO}')`));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.ok(pre.includes("g.grantee = 0"), "PUBLIC continua fechado");
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${H_VIGENTE}'`));
  assert.doesNotMatch(
    limpo(rollback.replace(corpoDe(rollback), "")),
    /GRANT|REVOKE/i,
  );
});

Deno.test("a ordem de desfazer, o alcance e o limite conhecido estao declarados no cabecalho", () => {
  for (const trecho of [
    "ROLLBACK MANUAL",
    "ANTES do rollback",
    "DDD 55",
    "crm__pedidos_nao_pagos",
    "crm__nunca_comprou",
    "DADOS EXISTENTES",
    "Sem BEGIN/COMMIT",
    "142a",
    "142b",
  ])
    assert.ok(migration.includes(trecho), trecho);
});

Deno.test("as consultas 142a e 142b leem o corpo certo (md5 de cada lado), so catalogo, rol fechado de 4 linhas, e estao no menu do conferir-banco e do release", () => {
  const a = Deno.readTextFileSync(
    new URL(
      "scripts/publicacao/consultas/142a-conferir-o-crm-nao-duplica-o-comprador-com-e-sem-55-aplicado.sql",
      DIR,
    ),
  );
  const b = Deno.readTextFileSync(
    new URL(
      "scripts/publicacao/consultas/142b-antes-o-crm-nao-duplica-o-comprador-com-e-sem-55-base-vigente.sql",
      DIR,
    ),
  );
  assert.ok(a.includes(`'${H_NOVO}'`) && !a.includes(H_VIGENTE));
  assert.ok(b.includes(`'${H_VIGENTE}'`) && !b.includes(H_NOVO));
  for (const sql of [a, b]) {
    assert.doesNotMatch(
      removerRuido(sql),
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REVOKE)\b/i,
    );
    assert.ok(sql.includes(`to_regprocedure('${ASSINATURA}')`));
    assert.ok(
      sql.includes(
        "NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')",
      ),
    );
  }
  // o resto das duas e' igual: so muda o md5 e o comentario
  assert.equal(
    a.split("\n").slice(2).join("\n").replace(H_NOVO, "X"),
    b.split("\n").slice(2).join("\n").replace(H_VIGENTE, "X"),
  );
  const conferir = Deno.readTextFileSync(
    new URL("scripts/publicacao/conferir-banco.cjs", DIR),
  );
  const release = Deno.readTextFileSync(
    new URL("scripts/frota/publicar-release.mjs", DIR),
  );
  const canais = JSON.parse(
    Deno.readTextFileSync(new URL("scripts/frota/canais-de-backend.json", DIR)),
  );
  for (const nome of [
    "142a-conferir-o-crm-nao-duplica-o-comprador-com-e-sem-55-aplicado",
    "142b-antes-o-crm-nao-duplica-o-comprador-com-e-sem-55-base-vigente",
  ]) {
    assert.ok(
      conferir.replace(/\s+/g, " ").includes(`"${nome}": ROL_DA_142`),
      nome,
    );
    assert.ok(release.includes(`"${nome}"`), nome);
  }
  const entrada = JSON.stringify(canais).includes(
    '"consulta":"142a-conferir-o-crm-nao-duplica-o-comprador-com-e-sem-55-aplicado","versoes":["20261399990000"],"ausenciaConfirmadaPor":"142b-antes-o-crm-nao-duplica-o-comprador-com-e-sem-55-base-vigente"',
  );
  assert.ok(entrada, "canais-de-backend.json sem a entrada da 142a");
});

Deno.test("depois da 20261178000000 so este par redefine crm__vendas", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > VIGENTE.slice(0, 14) &&
      /create (?:or replace )?function public\.crm__vendas\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(posteriores.sort(), [NOME, `rollback-manual-${NOME}`]);
});
