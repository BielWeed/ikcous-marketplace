// @ts-nocheck
// O TOTAL COMPRADO DO CLIENTE E O MESMO NO CRM, NA LISTA E NA FICHA -- prova offline do par 20261403000000 + rollback
// (get_admin_customers_paged e get_admin_user_detail; decisao do socio, 17/11/2026). O COMPORTAMENTO (a pessoa com conta e
// uma venda de balcao paga de mesmo WhatsApp tem o MESMO total no CRM, na lista e na ficha, com e sem o 55; balcao cancelado
// ou sem pagar fora; WhatsApp em duas contas conta UMA vez; ordenacao estavel; rollback, pre-voo, atomicidade sem BEGIN) e'
// provado em tests/banco/o-total-do-cliente-e-o-mesmo-nas-tres-telas-viva.cjs. Aqui fica o que se prova so lendo o texto.
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
  "20261403000000_o_total_comprado_do_cliente_e_o_mesmo_no_crm_na_lista_e_na_ficha.sql";
const V_LISTA =
  "20261399993000_o_crm_e_a_lista_de_clientes_nao_contam_a_mesma_pessoa_duas_vezes.sql";
const V_FICHA = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const lerRaiz = (n) =>
  Deno.readTextFileSync(new URL(n, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationLista = ler(V_LISTA);
const migrationFicha = ler(V_FICHA);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const HL_VIGENTE = "35212d373895b2a9ede613198fc4c794";
const HL_NOVO = "309bbd903420f146423c7cf0512b91b3";
const HF_VIGENTE = "4dec3f232e1905ad62688b8bcd098b2a";
const HF_NOVO = "e7977d4d60b6114bb8247097b8ae3d4b";
const A_LISTA =
  "public.get_admin_customers_paged(text,text,text,integer,integer)";
const A_FICHA = "public.get_admin_user_detail(uuid)";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.<nome>(` do arquivo. */
function corpoDe(sql, nome) {
  const marca = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  assert.equal(sql.split(marca).length - 1, 1, `uma definicao de ${nome}`);
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const LISTA_VIGENTE = corpoDe(migrationLista, "get_admin_customers_paged");
const LISTA_NOVA = corpoDe(migration, "get_admin_customers_paged");
const FICHA_VIGENTE = corpoDe(migrationFicha, "get_admin_user_detail");
const FICHA_NOVA = corpoDe(migration, "get_admin_user_detail");

// As trocas declaradas (cabecalho, item 4), cada uma UMA vez, como PAR (antes, depois).
const TROCAS_LISTA = [
  [
    "    WITH customer_stats AS (\n",
    '    -- Compras de balcao (SEM conta) que o CRM atribui a cada conta (20261403000000): a regra de "quem e a mesma pessoa" mora em\n' +
      "    -- crm__vendas (o MESMO WhatsApp, com ou sem o 55, de um pedido pago da conta) e e LIDA daqui, nunca repetida. So o pedido sem\n" +
      "    -- conta (bo.user_id IS NULL) entra: o pedido da propria conta ja e somado pelo JOIN com marketplace_orders mais abaixo, entao\n" +
      "    -- nada conta duas vezes. Uma linha por conta, juntada UMA vez (nao ha subconsulta por cliente); MATERIALIZED garante uma unica\n" +
      "    -- avaliacao de crm__vendas por chamada. Com o WhatsApp em duas contas o balcao vai para UMA so (a que comprou por ultimo, regra do CRM).\n" +
      "    WITH balcao_da_conta AS MATERIALIZED (\n" +
      "        SELECT v.user_id, COUNT(*) AS pedidos, COALESCE(SUM(v.total), 0) AS total\n" +
      "        FROM public.crm__vendas(now()) v\n" +
      "        JOIN public.marketplace_orders bo ON bo.id = v.order_id AND bo.user_id IS NULL\n" +
      "        WHERE v.user_id IS NOT NULL\n" +
      "        GROUP BY v.user_id\n" +
      "    ),\n" +
      "    customer_stats AS (\n",
  ],
  [
    "            COUNT(o.id) as orders_count,\n",
    "            COUNT(o.id) + COALESCE(bal.pedidos, 0) as orders_count,\n",
  ],
  [
    "            ), 0) as total_spent,\n",
    "            ), 0) + COALESCE(bal.total, 0) as total_spent,\n",
  ],
  [
    "        LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')\n",
    "        LEFT JOIN balcao_da_conta bal ON bal.user_id = p.id\n        LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')\n",
  ],
  [
    "        GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state\n",
    "        GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state, bal.pedidos, bal.total\n",
  ],
];
const TROCAS_FICHA = [
  [
    "    v_addresses JSONB;\nBEGIN\n",
    "    v_addresses JSONB;\n    v_balcao JSONB;\nBEGIN\n",
  ],
  [
    "    -- Return Consolidated Object\n",
    "    -- 5. Compras de balcao que o CRM atribui a esta pessoa (20261403000000): pedidos pagos SEM conta feitos com o MESMO WhatsApp de um\n" +
      "    -- pedido pago desta conta (com ou sem o 55). A regra de identidade e a de crm__vendas, lida daqui e nunca copiada. Campo SEPARADO:\n" +
      "    -- a lista de pedidos acima nao muda (so os pedidos da conta aparecem nela). Sem balcao: pedidos 0 e total 0 (nunca nulo).\n" +
      "    SELECT jsonb_build_object('pedidos', COUNT(*), 'total', COALESCE(SUM(v.total), 0)) INTO v_balcao\n" +
      "    FROM public.crm__vendas(now()) v\n" +
      "    JOIN public.marketplace_orders bo ON bo.id = v.order_id AND bo.user_id IS NULL\n" +
      "    WHERE v.user_id = p_user_id;\n" +
      "\n" +
      "    -- Return Consolidated Object\n",
  ],
  [
    "        'addresses', v_addresses\n    );\n",
    "        'addresses', v_addresses,\n        'balcao_mesmo_whatsapp', v_balcao\n    );\n",
  ],
];

const aplicar = (corpo, trocas) => {
  let s = corpo;
  for (const [de, para] of trocas) {
    assert.equal(s.split(de).length - 1, 1, `ancora uma vez: ${de.trim()}`);
    s = s.replace(de, () => para);
  }
  return s;
};
const desfazer = (corpo, trocas) => {
  let s = corpo;
  for (const [de, para] of [...trocas].reverse()) {
    assert.equal(
      s.split(para).length - 1,
      1,
      `trecho novo uma vez: ${para.trim()}`,
    );
    s = s.replace(para, () => de);
  }
  return s;
};

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

Deno.test("get_admin_customers_paged: o vigente e' o da 20261399993000 (md5 conhecido); o novo e' ele com SO as cinco trocas declaradas; desfazer devolve o vigente byte a byte", () => {
  assert.equal(md5(LISTA_VIGENTE), HL_VIGENTE);
  assert.equal(md5(LISTA_NOVA), HL_NOVO);
  assert.notEqual(HL_NOVO, HL_VIGENTE);
  assert.equal(
    aplicar(LISTA_VIGENTE, TROCAS_LISTA),
    LISTA_NOVA,
    "novo = vigente + trocas",
  );
  assert.equal(
    desfazer(LISTA_NOVA, TROCAS_LISTA),
    LISTA_VIGENTE,
    "novo menos as trocas = vigente",
  );
  // o que NAO pode ter mudado: o formato do JSON, as travas, a busca, as estatisticas globais, o ORDER BY e a paginacao
  for (const trecho of [
    "'data', v_data,",
    "'total_count', v_total_count,",
    "'stats', v_stats",
    "IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN",
    "unaccent(addr.city) ILIKE unaccent('%' || v_clean_search || '%') OR",
    "LIMIT p_page_size",
    "OFFSET v_offset",
    "LEFT JOIN auth.users u ON u.id = p.id",
    "ORDER BY a.created_at DESC NULLS LAST, a.id",
    "WHERE v_clean_search = '' OR (",
    "WHERE status NOT IN ('cancelled', 'returned')",
    "END DESC,",
    "            id\n    ),",
  ])
    assert.equal(
      LISTA_NOVA.split(trecho).length,
      LISTA_VIGENTE.split(trecho).length,
      `o trecho ${trecho} mudou de numero de ocorrencias`,
    );
  assert.equal(LISTA_NOVA.split("IF NOT public.is_admin() THEN").length - 1, 1);
  assert.equal(
    LISTA_NOVA.split("IF NOT public.is_admin_atual() THEN").length - 1,
    1,
  );
  // a regra: so o balcao SEM conta (nada conta duas vezes), uma linha por conta, uma avaliacao de crm__vendas, junta pela conta, e a juncao e LEFT
  assert.ok(
    LISTA_NOVA.includes(
      "JOIN public.marketplace_orders bo ON bo.id = v.order_id AND bo.user_id IS NULL",
    ),
  );
  assert.ok(LISTA_NOVA.includes("WITH balcao_da_conta AS MATERIALIZED ("));
  assert.ok(
    LISTA_NOVA.includes("LEFT JOIN balcao_da_conta bal ON bal.user_id = p.id"),
  );
  assert.equal(
    LISTA_NOVA.split("public.crm__vendas(").length - 1,
    1,
    "uma unica leitura de crm__vendas",
  );
  assert.ok(
    !/\bFROM\s+balcao_da_conta\b[^;]*\bWHERE\b[^;]*p\.id/i.test(LISTA_NOVA),
    "sem subconsulta por cliente",
  );
  // o desempate e a ordem do ORDER BY intactos (o id e a ULTIMA chave)
  assert.ok(
    LISTA_NOVA.includes("            id\n    ),\n    paginated_data AS ("),
  );
});

Deno.test("get_admin_user_detail: o vigente e' o da 20261199000000 (md5 conhecido); o novo e' ele com SO as tres trocas declaradas; desfazer devolve o vigente byte a byte", () => {
  assert.equal(md5(FICHA_VIGENTE), HF_VIGENTE);
  assert.equal(md5(FICHA_NOVA), HF_NOVO);
  assert.notEqual(HF_NOVO, HF_VIGENTE);
  assert.equal(
    aplicar(FICHA_VIGENTE, TROCAS_FICHA),
    FICHA_NOVA,
    "novo = vigente + trocas",
  );
  assert.equal(
    desfazer(FICHA_NOVA, TROCAS_FICHA),
    FICHA_VIGENTE,
    "novo menos as trocas = vigente",
  );
  // o que NAO pode ter mudado: as travas, o perfil, a lista de pedidos da conta, o carrinho e os enderecos
  for (const trecho of [
    "'profile', v_profile,",
    "'orders', v_orders,",
    "'cart_items', v_cart_items,",
    "WHERE mo.user_id = p_user_id",
    "WHERE c.user_id = p_user_id;",
    "WHERE a.user_id = p_user_id;",
    "ORDER BY mo.created_at DESC",
  ])
    assert.equal(
      FICHA_NOVA.split(trecho).length,
      FICHA_VIGENTE.split(trecho).length,
      `o trecho ${trecho} mudou de numero de ocorrencias`,
    );
  assert.equal(FICHA_NOVA.split("IF NOT public.is_admin() THEN").length - 1, 1);
  assert.equal(
    FICHA_NOVA.split("IF NOT public.is_admin_atual() THEN").length - 1,
    1,
  );
  // a regra: so o balcao SEM conta, desta pessoa, lido de crm__vendas (nunca copiado), e o campo e SEPARADO da lista de pedidos
  assert.ok(
    FICHA_NOVA.includes(
      "JOIN public.marketplace_orders bo ON bo.id = v.order_id AND bo.user_id IS NULL",
    ),
  );
  assert.ok(FICHA_NOVA.includes("WHERE v.user_id = p_user_id;"));
  assert.equal(FICHA_NOVA.split("public.crm__vendas(").length - 1, 1);
  assert.ok(FICHA_NOVA.includes("'balcao_mesmo_whatsapp', v_balcao"));
  // A regra de identidade NAO e copiada: a quantidade de tratamentos de WhatsApp (regexp_replace) em cada corpo e a mesma do
  // vigente (a lista ja tinha os da BUSCA por numero; a troca nao acrescenta nenhum).
  const conta = (s) => (s.match(/regexp_replace\(/gi) || []).length;
  assert.equal(
    conta(FICHA_NOVA),
    conta(FICHA_VIGENTE),
    "a ficha nao copia a regra de identidade",
  );
  assert.equal(
    conta(LISTA_NOVA),
    conta(LISTA_VIGENTE),
    "a lista nao copia a regra de identidade",
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261403000000 (sem ela a migration sai PULADA, codigo 2) e cada contagem bate com o corpo novo", () => {
  const src = lerRaiz("scripts/db-apply.cjs");
  const i = src.indexOf(`"${NOME}":`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  //", i));
  for (const [funcao, corpo, minimo] of [
    ["get_admin_customers_paged", LISTA_NOVA, 10],
    ["get_admin_user_detail", FICHA_NOVA, 8],
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
  assert.equal(LISTA_VIGENTE.split("balcao_da_conta").length - 1, 0);
  assert.equal(FICHA_VIGENTE.split("balcao_mesmo_whatsapp").length - 1, 0);
});

Deno.test("o rollback recria os DOIS corpos VIGENTES byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback, "get_admin_customers_paged"), LISTA_VIGENTE);
  assert.equal(md5(corpoDe(rollback, "get_admin_customers_paged")), HL_VIGENTE);
  assert.equal(corpoDe(rollback, "get_admin_user_detail"), FICHA_VIGENTE);
  assert.equal(md5(corpoDe(rollback, "get_admin_user_detail")), HF_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [HL_VIGENTE, HL_NOVO, HF_VIGENTE, HF_NOVO])
      assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(
    !corpoDe(rollback, "get_admin_customers_paged").includes("balcao_da_conta"),
  );
  assert.ok(
    !corpoDe(rollback, "get_admin_user_detail").includes(
      "balcao_mesmo_whatsapp",
    ),
  );
});

Deno.test("dois CREATE OR REPLACE FUNCTION em cada arquivo, com as MESMAS assinaturas e os MESMOS atributos; nada de GRANT, REVOKE, DROP, ALTER, DML nem objeto novo fora dos corpos", () => {
  const cabLista =
    "CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(p_search text DEFAULT ''::text, p_sort_field text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)\n" +
    " RETURNS jsonb\n" +
    " LANGUAGE plpgsql\n" +
    " SECURITY DEFINER\n" +
    " SET search_path TO 'public', 'extensions'\n" +
    "AS $$";
  const cabFicha =
    "CREATE OR REPLACE FUNCTION public.get_admin_user_detail(p_user_id uuid)\n" +
    " RETURNS jsonb\n" +
    " LANGUAGE plpgsql\n" +
    " SECURITY DEFINER\n" +
    " SET search_path TO 'public'\n" +
    "AS $$";
  for (const sql of [migration, rollback]) {
    assert.equal(
      sql.split("\nCREATE OR REPLACE FUNCTION").length - 1,
      2,
      "duas funcoes por arquivo",
    );
    assert.ok(sql.includes(cabLista), "cabecalho de get_admin_customers_paged");
    assert.ok(sql.includes(cabFicha), "cabecalho de get_admin_user_detail");
    const fora = limpo(
      sql
        .replace(corpoDe(sql, "get_admin_customers_paged"), "")
        .replace(corpoDe(sql, "get_admin_user_detail"), ""),
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
  // as funcoes de origem tem os mesmos cabecalhos
  assert.ok(migrationLista.includes(cabLista));
  assert.ok(migrationFicha.includes(cabFicha));
});

Deno.test("o pre-voo vem antes das trocas, aceita SO os dois corpos de cada funcao, a ACL de hoje, atributos e o contrato de crm__vendas; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261403000000$");
  const fimPre = migration.indexOf("END $preflight_20261403000000$;");
  const iLista = migration.indexOf(
    "\nCREATE OR REPLACE FUNCTION public.get_admin_customers_paged",
  );
  const iFicha = migration.indexOf(
    "\nCREATE OR REPLACE FUNCTION public.get_admin_user_detail",
  );
  const iConf = migration.indexOf("DO $conferencia_20261403000000$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iLista);
  assert.ok(iLista < iFicha && iFicha < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    `to_regprocedure('${A_LISTA}')`,
    `to_regprocedure('${A_FICHA}')`,
    "md5(replace(prosrc, E'\\r', ''))",
    `('${A_LISTA}', '${HL_VIGENTE}', '${HL_NOVO}')`,
    `('${A_FICHA}', '${HF_VIGENTE}', '${HF_NOVO}')`,
    "v_hash NOT IN (r.hash_a, r.hash_b)",
    "p.prosecdef",
    "p.provolatile = 'v'",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "p.proconfig = ARRAY['search_path=public, extensions']::text[]",
    "pg_get_function_arguments(p.oid) = 'p_user_id uuid'",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "<> 1",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid_lista, 'EXECUTE')",
    "has_function_privilege('anon', v_oid_ficha, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_oid_ficha, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_oid_ficha, 'EXECUTE')",
    "to_regprocedure('public.crm__vendas(timestamptz)') IS NULL",
    "pg_get_function_result(to_regprocedure('public.crm__vendas(timestamptz)')) <> 'TABLE(order_id uuid, total numeric, canal text, forma text, pago_em timestamp with time zone, dia date, chave text, user_id uuid, nome text, whatsapp text, email text)'",
    "('marketplace_orders', 'user_id')",
    "ikcous.total3000_lista",
    "ikcous.total3000_ficha",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  // o pre-voo NAO aceita o corpo antigo da lista (a cadeia e' 99 -> 230 -> 392 -> 3993 -> esta)
  assert.ok(!pre.includes("1c71829d75e3d8f17bf7fb01019c05ec"));
  const conf = migration.slice(iConf);
  for (const trecho of [
    `v_hash IS DISTINCT FROM '${HL_NOVO}'`,
    `v_hash IS DISTINCT FROM '${HF_NOVO}'`,
    "p.prosecdef",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "NOT has_function_privilege('service_role', v_oid_lista, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_oid_ficha, 'EXECUTE')",
    "current_setting('ikcous.total3000_lista')",
    "current_setting('ikcous.total3000_ficha')",
  ])
    assert.ok(conf.includes(trecho), trecho);
  assert.ok(conf.split("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:").length > 6);
});

Deno.test("o rollback tem pre-voo (aceita, em cada funcao, o corpo desta migration ou o anterior; atributos, ACL) e conferencia (os dois corpos voltam); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rb_20261403000000$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rb_20261403000000$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`('${A_LISTA}', '${HL_VIGENTE}', '${HL_NOVO}')`));
  assert.ok(pre.includes(`('${A_FICHA}', '${HF_VIGENTE}', '${HF_NOVO}')`));
  assert.ok(pre.includes("v_hash NOT IN (r.hash_a, r.hash_b)"));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.ok(pre.includes("g.grantee = 0"), "PUBLIC continua fechado");
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${HL_VIGENTE}'`));
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${HF_VIGENTE}'`));
  assert.ok(conf.includes("ikcous.total3000_rb_lista"));
  assert.ok(conf.includes("ikcous.total3000_rb_ficha"));
  assert.doesNotMatch(
    limpo(
      rollback
        .replace(corpoDe(rollback, "get_admin_customers_paged"), "")
        .replace(corpoDe(rollback, "get_admin_user_detail"), ""),
    ),
    /GRANT|REVOKE/i,
  );
});

Deno.test("a ordem de desfazer esta declarada no cabecalho; a 8e, a 32a, a 145a, o modulo das sucessoras e o portao conhecem a migration", () => {
  for (const trecho of [
    "ROLLBACK",
    "ANTES do rollback da 20261399993000",
    "20261399990000",
    "balcao_mesmo_whatsapp",
    "Nenhuma linha de pedido, conta, perfil, endereco ou historico e escrita ao aplicar",
  ])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = lerRaiz(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    c8e.includes(
      `('get_admin_customers_paged', '${HL_NOVO}', '20261403000000')`,
    ),
  );
  assert.ok(
    c8e.includes(`('get_admin_user_detail', '${HF_NOVO}', '20261403000000')`),
  );
  const c32a = lerRaiz(
    "scripts/publicacao/consultas/32a-conferir-busca-de-clientes-aplicado.sql",
  );
  assert.ok(c32a.includes(`WHEN f.m = '${HL_NOVO}' THEN`));
  const c145a = lerRaiz(
    "scripts/publicacao/consultas/145a-conferir-o-crm-e-a-lista-de-clientes-nao-contam-a-mesma-pessoa-duas-vezes-aplicado.sql",
  );
  assert.ok(c145a.includes(`WHEN h = '${HL_NOVO}' THEN '${HL_VIGENTE}'`));
  const sucessoras = lerRaiz("tests/banco/sucessoras-da-99.cjs");
  assert.ok(sucessoras.includes(NOME));
  const posterior = lerRaiz("tests/banco/a-busca-de-clientes-posterior.cjs");
  assert.ok(posterior.includes(NOME));
  assert.ok(posterior.includes(HL_NOVO));
});

Deno.test("depois da 20261399993000 so este par redefine get_admin_customers_paged; depois da 20261199000000 so este par redefine get_admin_user_detail", () => {
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
  assert.deepEqual(redefinem("get_admin_customers_paged", V_LISTA), [
    NOME,
    `rollback-manual-${NOME}`,
  ]);
  assert.deepEqual(redefinem("get_admin_user_detail", V_FICHA), [
    NOME,
    `rollback-manual-${NOME}`,
  ]);
});
