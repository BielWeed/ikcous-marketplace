// @ts-nocheck
// O CRM E A LISTA DE CLIENTES NAO CONTAM A MESMA PESSOA DUAS VEZES -- prova offline do par 20261399993000 + rollback
// (crm__nunca_comprou e get_admin_customers_paged; caca de 13/11/2026). O COMPORTAMENTO (a pessoa com conta e venda avulsa
// de mesmo WhatsApp aparece UMA vez, com ou sem o 55 de cada lado; quem nunca comprou continua; numero diferente e DDD 55 nao
// juntam ninguem; dois enderecos principais viram UM, com pedidos e total certos; rollback, pre-voo, atomicidade sem BEGIN,
// consultas 145a/145b) e' provado em tests/banco/o-crm-e-a-lista-de-clientes-nao-contam-a-mesma-pessoa-duas-vezes-viva.cjs.
// Aqui fica o que se prova so lendo o texto.
//
// Riscos: cada corpo novo tem de ser o vigente com SO as trocas declaradas; o corpo do rollback tem de ser o vigente BYTE A
// BYTE; os atributos e a ACL nao podem mudar (nenhum GRANT/REVOKE); o pre-voo vem antes das trocas e a conferencia depois;
// sem BEGIN/COMMIT de nivel superior; nenhum dado e lido para escrita ou escrito.
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
  "20261399993000_o_crm_e_a_lista_de_clientes_nao_contam_a_mesma_pessoa_duas_vezes.sql";
const V_NUNCA = "20261183000000_o_crm_ve_todo_mundo.sql";
const V_CLIENTES =
  "20261392000000_a_lista_de_clientes_nao_repete_nem_esconde_ninguem_entre_as_paginas.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const lerRaiz = (n) =>
  Deno.readTextFileSync(new URL(n, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationNunca = ler(V_NUNCA);
const migrationClientes = ler(V_CLIENTES);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const HN_VIGENTE = "9a83cf34789b8b67c245648c8d82fc42";
const HN_NOVO = "3aa94ac8dc4ce19db958e6d93cbea7a8";
const HC_VIGENTE = "1c71829d75e3d8f17bf7fb01019c05ec";
const HC_NOVO = "35212d373895b2a9ede613198fc4c794";
const A_NUNCA = "public.crm__nunca_comprou(timestamptz)";
const A_CLIENTES =
  "public.get_admin_customers_paged(text,text,text,integer,integer)";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.<nome>(` do arquivo. */
function corpoDe(sql, nome) {
  const marca = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  assert.equal(sql.split(marca).length - 1, 1, `uma definicao de ${nome}`);
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const NUNCA_VIGENTE = corpoDe(migrationNunca, "crm__nunca_comprou");
const NUNCA_NOVO = corpoDe(migration, "crm__nunca_comprou");
const CLIENTES_VIGENTE = corpoDe(
  migrationClientes,
  "get_admin_customers_paged",
);
const CLIENTES_NOVO = corpoDe(migration, "get_admin_customers_paged");

// As trocas declaradas (cabecalho, item 4). crm__nunca_comprou: uma CTE e um NOT EXISTS; get_admin_customers_paged: uma juncao.
const CTE_NOVA =
  ", wa_nao_pagos AS (\n" +
  "    -- Venda avulsa anulada, devolvida ou sem pagar (20261399993000): quem tem\n" +
  '    -- CONTA e nenhum pedido ligado a ela, e a lojista registrou "Cliente\n' +
  '    -- avulso" com o MESMO WhatsApp, já aparece em "Pediu e não pagou"\n' +
  "    -- (crm__pedidos_nao_pagos, chave 'wa:', user_id nulo). Sem esta exclusão o\n" +
  "    -- perfil voltava aqui como um SEGUNDO registro da mesma pessoa. LÊ a\n" +
  '    -- função do grupo (não repete a regra dela): "está lá" e "sai daqui" não\n' +
  "    -- divergem. Mesma régua do 55 de wa_pagos.\n" +
  "    SELECT DISTINCT\n" +
  "           CASE WHEN length(d) IN (12, 13) AND left(d, 2) = '55'\n" +
  "                THEN substring(d FROM 3) ELSE d END AS wa_chave\n" +
  "      FROM (\n" +
  "        SELECT np.whatsapp AS d\n" +
  "          FROM public.crm__pedidos_nao_pagos(p_ate) np\n" +
  "         WHERE np.user_id IS NULL AND np.whatsapp IS NOT NULL\n" +
  "      ) x\n" +
  "  )";
const EXISTS_NOVO =
  "     AND NOT EXISTS (\n" +
  "       SELECT 1 FROM wa_nao_pagos wn\n" +
  "        WHERE wn.wa_chave = (\n" +
  "          CASE WHEN length(pw.wa) IN (12, 13) AND left(pw.wa, 2) = '55'\n" +
  "               THEN substring(pw.wa FROM 3) ELSE pw.wa END\n" +
  "        )\n" +
  "     )\n";
const JUNCAO_ANTIGA =
  "        LEFT JOIN public.user_addresses addr ON addr.user_id = p.id AND addr.is_default = true\n";
const JUNCAO_NOVA =
  "        -- UM endereco principal por cliente (o mais novo; no empate, o de menor id) ANTES de juntar os pedidos: dois\n" +
  "        -- enderecos is_default na mesma conta (dois aparelhos salvando o primeiro endereco ao mesmo tempo) dobravam a\n" +
  "        -- contagem e a soma dos pedidos, ou repetiam a cliente uma vez por cidade (20261399993000).\n" +
  "        LEFT JOIN LATERAL (\n" +
  "            SELECT a.city, a.state\n" +
  "            FROM public.user_addresses a\n" +
  "            WHERE a.user_id = p.id AND a.is_default = true\n" +
  "            ORDER BY a.created_at DESC NULLS LAST, a.id\n" +
  "            LIMIT 1\n" +
  "        ) addr ON true\n";

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

Deno.test("crm__nunca_comprou: o vigente e' o da 20261183000000 (md5 conhecido); o novo e' ele com SO a CTE e o NOT EXISTS declarados; desfazer devolve o vigente byte a byte", () => {
  assert.equal(md5(NUNCA_VIGENTE), HN_VIGENTE);
  assert.equal(md5(NUNCA_NOVO), HN_NOVO);
  assert.notEqual(HN_NOVO, HN_VIGENTE);
  assert.equal(
    NUNCA_NOVO.split(CTE_NOVA).length - 1,
    1,
    "a CTE nova existe UMA vez",
  );
  assert.equal(
    NUNCA_NOVO.split(EXISTS_NOVO).length - 1,
    1,
    "o NOT EXISTS novo existe UMA vez",
  );
  const desfeito = NUNCA_NOVO.replace(CTE_NOVA, () => "").replace(
    EXISTS_NOVO,
    () => "",
  );
  assert.equal(desfeito, NUNCA_VIGENTE, "novo menos as duas trocas = vigente");
  // o que NAO pode ter mudado: as exclusoes antigas, a regua de staff, o corte do 55 e o formato do retorno
  for (const trecho of [
    "SELECT 1 FROM wa_pagos wp",
    "WHERE o.user_id = p.id AND o.created_at <= p_ate",
    "AND p.created_at <= p_ate",
    "WHERE COALESCE(p.role, 'customer') = 'customer'",
    "COALESCE(u.raw_app_meta_data ->> 'role', 'customer') NOT IN ('admin', 'gerente', 'vendedor')",
    "FROM public.crm__vendas(p_ate) v",
    "WHERE v.chave LIKE 'wa:%'",
    "SELECT p.id::text, p.id, NULLIF(btrim(COALESCE(p.full_name, '')), ''),",
  ])
    assert.equal(
      NUNCA_NOVO.split(trecho).length,
      NUNCA_VIGENTE.split(trecho).length,
      `o trecho ${trecho} mudou de numero de ocorrencias`,
    );
  // a nova exclusao so olha o grupo SEM conta e so numero que existe
  assert.ok(
    NUNCA_NOVO.includes("WHERE np.user_id IS NULL AND np.whatsapp IS NOT NULL"),
  );
  // o mesmo corte do 55 (12 ou 13 digitos comecando por 55) nas duas exclusoes
  assert.equal(
    NUNCA_NOVO.split("IN (12, 13) AND left(").length - 1,
    NUNCA_VIGENTE.split("IN (12, 13) AND left(").length - 1 + 2,
  );
});

Deno.test("get_admin_customers_paged: o vigente e' o da 20261392000000 (md5 conhecido); o novo e' ele com SO a juncao de endereco declarada; desfazer devolve o vigente byte a byte", () => {
  assert.equal(md5(CLIENTES_VIGENTE), HC_VIGENTE);
  assert.equal(md5(CLIENTES_NOVO), HC_NOVO);
  assert.notEqual(HC_NOVO, HC_VIGENTE);
  assert.equal(CLIENTES_VIGENTE.split(JUNCAO_ANTIGA).length - 1, 1);
  assert.equal(CLIENTES_NOVO.split(JUNCAO_NOVA).length - 1, 1);
  assert.equal(
    CLIENTES_VIGENTE.replace(JUNCAO_ANTIGA, () => JUNCAO_NOVA),
    CLIENTES_NOVO,
    "novo = vigente + a juncao",
  );
  assert.equal(
    CLIENTES_NOVO.replace(JUNCAO_NOVA, () => JUNCAO_ANTIGA),
    CLIENTES_VIGENTE,
    "desfazer a troca devolve o vigente",
  );
  // o que NAO pode ter mudado: o formato do JSON, as travas, a busca, o GROUP BY, o ORDER BY e a paginacao
  for (const trecho of [
    "'data', v_data,",
    "'total_count', v_total_count,",
    "'stats', v_stats",
    "IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN",
    "unaccent(addr.city) ILIKE unaccent('%' || v_clean_search || '%') OR",
    "GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state",
    "LIMIT p_page_size",
    "OFFSET v_offset",
    "LEFT JOIN auth.users u ON u.id = p.id",
    "LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')",
    "END DESC,",
  ])
    assert.equal(
      CLIENTES_NOVO.split(trecho).length,
      CLIENTES_VIGENTE.split(trecho).length,
      `o trecho ${trecho} mudou de numero de ocorrencias`,
    );
  assert.equal(
    CLIENTES_NOVO.split("IF NOT public.is_admin() THEN").length - 1,
    1,
  );
  assert.equal(
    CLIENTES_NOVO.split("IF NOT public.is_admin_atual() THEN").length - 1,
    1,
  );
  // a regra: UM endereco (LIMIT 1), o mais novo com nulo por ultimo, desempate pelo id, so o principal, e a juncao e LEFT
  assert.ok(
    CLIENTES_NOVO.includes("ORDER BY a.created_at DESC NULLS LAST, a.id"),
  );
  assert.ok(
    CLIENTES_NOVO.includes("WHERE a.user_id = p.id AND a.is_default = true"),
  );
  assert.ok(!CLIENTES_NOVO.includes("LEFT JOIN public.user_addresses"));
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261399993000 (sem ela a migration sai PULADA, codigo 2) e cada contagem bate com o corpo novo", () => {
  const src = lerRaiz("scripts/db-apply.cjs");
  const i = src.indexOf(`"${NOME}":`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  //", i));
  for (const [funcao, corpo, minimo] of [
    ["crm__nunca_comprou", NUNCA_NOVO, 6],
    ["get_admin_customers_paged", CLIENTES_NOVO, 7],
  ]) {
    const j = entrada.indexOf(`funcao: "${funcao}"`);
    assert.ok(j >= 0, `entrada de ${funcao}`);
    const fim = entrada.indexOf("funcao:", j + 10);
    const parte = entrada.slice(j, fim < 0 ? undefined : fim);
    const pares = [
      ...parte.matchAll(/texto:\s*"((?:[^"\\]|\\.)*)",\s*vezes:\s*(\d+)/g),
    ].map((m) => [JSON.parse(`"${m[1]}"`), Number(m[2])]);
    assert.equal(pares.length, minimo, `${funcao}: marcadores`);
    for (const [texto, vezes] of pares)
      assert.equal(corpo.split(texto).length - 1, vezes, `${funcao}: ${texto}`);
  }
  // os marcadores novos NAO existem nos corpos vigentes: sem a troca, a entrada reprova
  assert.equal(NUNCA_VIGENTE.split("wa_nao_pagos AS (").length - 1, 0);
  assert.equal(CLIENTES_VIGENTE.split("LEFT JOIN LATERAL (").length - 1, 0);
});

Deno.test("o rollback recria os DOIS corpos VIGENTES byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback, "crm__nunca_comprou"), NUNCA_VIGENTE);
  assert.equal(md5(corpoDe(rollback, "crm__nunca_comprou")), HN_VIGENTE);
  assert.equal(
    corpoDe(rollback, "get_admin_customers_paged"),
    CLIENTES_VIGENTE,
  );
  assert.equal(md5(corpoDe(rollback, "get_admin_customers_paged")), HC_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [HN_VIGENTE, HN_NOVO, HC_VIGENTE, HC_NOVO])
      assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(!corpoDe(rollback, "crm__nunca_comprou").includes("wa_nao_pagos"));
  assert.ok(
    !corpoDe(rollback, "get_admin_customers_paged").includes("LATERAL"),
  );
});

Deno.test("dois CREATE OR REPLACE FUNCTION em cada arquivo, com as MESMAS assinaturas e os MESMOS atributos; nada de GRANT, REVOKE, DROP, ALTER, DML nem objeto novo fora dos corpos", () => {
  const cabNunca =
    "CREATE OR REPLACE FUNCTION public.crm__nunca_comprou(p_ate timestamptz)\n" +
    "RETURNS TABLE (\n" +
    "  chave text, user_id uuid, nome text, whatsapp text, email text, cadastrado_em timestamptz\n" +
    ")\n" +
    "LANGUAGE sql STABLE SET search_path = public\n" +
    "AS $$";
  const cabClientes =
    "CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(p_search text DEFAULT ''::text, p_sort_field text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)\n" +
    " RETURNS jsonb\n" +
    " LANGUAGE plpgsql\n" +
    " SECURITY DEFINER\n" +
    " SET search_path TO 'public', 'extensions'\n" +
    "AS $$";
  for (const sql of [migration, rollback]) {
    assert.equal(
      sql.split("\nCREATE OR REPLACE FUNCTION").length - 1,
      2,
      "duas funcoes por arquivo",
    );
    assert.ok(sql.includes(cabNunca), "cabecalho de crm__nunca_comprou");
    assert.ok(
      sql.includes(cabClientes),
      "cabecalho de get_admin_customers_paged",
    );
    const fora = limpo(
      sql
        .replace(corpoDe(sql, "crm__nunca_comprou"), "")
        .replace(corpoDe(sql, "get_admin_customers_paged"), ""),
    );
    assert.doesNotMatch(fora, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(fora, /\b(DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    assert.doesNotMatch(fora.replace(/ALTER FUNCTION/g, ""), /\bALTER\b/i);
    assert.doesNotMatch(
      fora,
      /\bCREATE\s+(TABLE|POLICY|INDEX|TRIGGER|VIEW|UNIQUE)\b/i,
    );
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
  // as duas funcoes de origem tem os mesmos cabecalhos
  assert.ok(migrationNunca.includes(cabNunca));
  assert.ok(migrationClientes.includes(cabClientes));
});

Deno.test("o pre-voo vem antes das trocas, aceita SO os dois corpos de cada funcao, a ACL de hoje, atributos e colunas; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261399993000$");
  const fimPre = migration.indexOf("END $preflight_20261399993000$;");
  const iNunca = migration.indexOf(
    "\nCREATE OR REPLACE FUNCTION public.crm__nunca_comprou",
  );
  const iClientes = migration.indexOf(
    "\nCREATE OR REPLACE FUNCTION public.get_admin_customers_paged",
  );
  const iConf = migration.indexOf("DO $conferencia_20261399993000$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iNunca);
  assert.ok(iNunca < iClientes && iClientes < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    `to_regprocedure('${A_NUNCA}')`,
    `to_regprocedure('${A_CLIENTES}')`,
    "md5(replace(prosrc, E'\\r', ''))",
    `('${A_NUNCA}', '${HN_VIGENTE}', '${HN_NOVO}')`,
    `('${A_CLIENTES}', '${HC_VIGENTE}', '${HC_NOVO}')`,
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "p.prosecdef",
    "NOT p.prosecdef",
    "p.provolatile = 's'",
    "p.provolatile = 'v'",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "p.proconfig = ARRAY['search_path=public, extensions']::text[]",
    "pg_get_function_result(p.oid) = 'TABLE(chave text, user_id uuid, nome text, whatsapp text, email text, cadastrado_em timestamp with time zone)'",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "<> 1",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid_nunca, 'EXECUTE')",
    "has_function_privilege('anon', v_oid_clientes, 'EXECUTE')",
    "to_regprocedure('public.crm__pedidos_nao_pagos(timestamptz)') IS NULL",
    "('user_addresses', 'created_at')",
    "('user_addresses', 'is_default')",
    "ikcous.crm3993_atributos_nunca",
    "ikcous.crm3993_atributos_clientes",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  // o pre-voo NAO aceita o corpo da 20261199000000 de get_admin_customers_paged (a cadeia e' 99 -> 230 -> 392 -> esta)
  assert.ok(!pre.includes("d6c092c3e0d8069891af795147d65e9e"));
  const conf = migration.slice(iConf);
  for (const trecho of [
    `v_hash IS DISTINCT FROM '${HN_NOVO}'`,
    `v_hash IS DISTINCT FROM '${HC_NOVO}'`,
    "p.prosecdef",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid_nunca, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_oid_clientes, 'EXECUTE')",
    "current_setting('ikcous.crm3993_atributos_nunca')",
    "current_setting('ikcous.crm3993_atributos_clientes')",
  ])
    assert.ok(conf.includes(trecho), trecho);
  assert.equal(
    conf.split("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:").length > 8,
    true,
  );
});

Deno.test("o rollback tem pre-voo (aceita, em cada funcao, o corpo desta migration ou o anterior; atributos, ACL) e conferencia (os dois corpos voltam); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rb_20261399993000$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rb_20261399993000$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`('${A_NUNCA}', '${HN_VIGENTE}', '${HN_NOVO}')`));
  assert.ok(pre.includes(`('${A_CLIENTES}', '${HC_VIGENTE}', '${HC_NOVO}')`));
  assert.ok(pre.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.ok(pre.includes("g.grantee = 0"), "PUBLIC continua fechado");
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${HN_VIGENTE}'`));
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${HC_VIGENTE}'`));
  assert.ok(conf.includes("ikcous.crm3993_rb_atributos_nunca"));
  assert.ok(conf.includes("ikcous.crm3993_rb_atributos_clientes"));
  assert.doesNotMatch(
    limpo(
      rollback
        .replace(corpoDe(rollback, "crm__nunca_comprou"), "")
        .replace(corpoDe(rollback, "get_admin_customers_paged"), ""),
    ),
    /GRANT|REVOKE/i,
  );
});

Deno.test("a ordem de desfazer esta declarada no cabecalho; a 8e, a 32a, o modulo das sucessoras e o ledger conhecem a migration", () => {
  for (const trecho of [
    "ROLLBACK",
    "ANTES do rollback da 20261392000000",
    "20261183000000",
    "8e",
    "32a",
    "145a",
    "145b",
    "NENHUM endereco e apagado",
  ])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = lerRaiz(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    c8e.includes(
      `('get_admin_customers_paged', '${HC_NOVO}', '20261399993000')`,
    ),
  );
  const c32a = lerRaiz(
    "scripts/publicacao/consultas/32a-conferir-busca-de-clientes-aplicado.sql",
  );
  assert.ok(c32a.includes(`'${HC_NOVO}'`));
  const sucessoras = lerRaiz("tests/banco/sucessoras-da-99.cjs");
  assert.ok(sucessoras.includes(NOME));
  const posterior = lerRaiz("tests/banco/a-busca-de-clientes-posterior.cjs");
  assert.ok(posterior.includes(NOME));
  assert.ok(posterior.includes(HC_NOVO));
});

Deno.test("depois da 20261183000000 so este par redefine crm__nunca_comprou; depois da 20261392000000 so este par redefine get_admin_customers_paged", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const redefinem = (nome, depoisDe) => {
    // `nome` vem das duas chamadas logo abaixo (literais fechados).
    // eslint-disable-next-line security/detect-non-literal-regexp
    const re = new RegExp(
      `create (?:or replace )?function public\\.${nome}\\b`,
    );
    return todas
      .filter(
        (n) =>
          n.replace(/^rollback-manual-/, "").slice(0, 14) >
            depoisDe.slice(0, 14) && re.test(limpo(ler(n)).toLowerCase()),
      )
      .sort();
  };
  assert.deepEqual(redefinem("crm__nunca_comprou", V_NUNCA), [
    NOME,
    `rollback-manual-${NOME}`,
  ]);
  assert.deepEqual(redefinem("get_admin_customers_paged", V_CLIENTES), [
    NOME,
    `rollback-manual-${NOME}`,
  ]);
});
