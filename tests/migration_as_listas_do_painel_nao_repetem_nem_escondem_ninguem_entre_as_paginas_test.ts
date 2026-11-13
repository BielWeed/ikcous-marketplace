// @ts-nocheck
// AS LISTAS DO PAINEL NAO REPETEM NEM ESCONDEM NINGUEM ENTRE AS PAGINAS — prova offline do par 20261399980000 + rollback (Produtos, Pedidos e
// Cancelados do painel). O COMPORTAMENTO (100 registros de mesma data lidos em paginas de 10, 12 e 20 por conexoes e planos diferentes devolvem cada
// um UMA vez; os corpos anteriores repetem e escondem; mutantes; o conjunto achado e o total nao mudam; guarda de admin; rollback, estado misto,
// pre-voo, conexao sem BEGIN e consultas 140a/140b) e' provado em tests/banco/as-listas-do-painel-nao-repetem-ninguem-viva.cjs, que so roda no
// Postgres efemero do CI. Aqui fica o que se prova so lendo o texto.
//
// Riscos: cada corpo novo tem de ser o corpo vigente da migration anterior com SO o desempate declarado (nada mais); o corpo do rollback tem de ser o
// vigente BYTE A BYTE; os atributos e a ACL nao podem mudar (nenhum GRANT/REVOKE); o pre-voo vem antes da troca e a conferencia depois; sem
// BEGIN/COMMIT de nivel superior; as tres funcoes entram na cadeia das sucessoras e nos registros de publicacao.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const NOME =
  "20261399980000_as_listas_do_painel_nao_repetem_nem_escondem_ninguem_entre_as_paginas.sql";
const ler = (rel) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const FUNCOES = [
  {
    chave: "produtos",
    nome: "get_admin_products_paged",
    assinatura:
      "public.get_admin_products_paged(text,text,text,text,integer,integer)",
    anterior:
      "20261399200000_a_busca_de_produtos_do_painel_acha_por_palavras.sql",
    hVigente: "346063e900b8b7b63dfbeffe5070eedc",
    hNovo: "0f153b653338f6570da399493093cfae",
    delim: "$function$",
    de: "        ORDER BY p.data_cadastro DESC\n        LIMIT p_page_size\n",
    para:
      "        ORDER BY p.data_cadastro DESC,\n" +
      "            -- Desempate pelo id (unico): produtos cadastrados no mesmo instante (importacao, duplicar, grade) saiam numa\n" +
      "            -- ordem que podia mudar de uma pagina para outra, e a paginacao por OFFSET repetia um e escondia outro\n" +
      "            -- (20261399980000). A ordem escolhida continua mandando.\n" +
      "            p.id\n" +
      "        LIMIT p_page_size\n",
    cauda:
      /ORDER BY p\.data_cadastro DESC, p\.id LIMIT p_page_size OFFSET v_offset \) t;/,
    intactos: [
      "'data', v_data,",
      "'total_count', v_total_count",
      "IF NOT public.is_admin_atual() THEN",
      "LIMIT p_page_size",
      "OFFSET v_offset",
      "v_padroes TEXT[];",
      "p.deleted_at IS NULL",
      "COUNT(p.id)",
    ],
    guardas: ["IF NOT public.is_admin_atual() THEN"],
    ordenacoes: 1,
  },
  {
    chave: "pedidos",
    nome: "get_admin_orders_paged",
    assinatura:
      "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)",
    anterior:
      "20261399900000_a_busca_de_pedidos_acha_o_telefone_colado_com_o_55.sql",
    hVigente: "bf08545275eaa451a65e15feceb0ed8d",
    hNovo: "b404a8397a6490c86fb192d85fd5b6c9",
    delim: "$$",
    de: "            END,\n            o.created_at DESC\n        LIMIT p_page_size\n",
    para:
      "            END,\n" +
      "            o.created_at DESC,\n" +
      "            -- Desempate pelo id (unico): pedidos do mesmo instante (importacao, balcao, lote) saiam numa ordem que podia\n" +
      "            -- mudar de uma pagina para outra, e a paginacao por OFFSET repetia um e escondia outro (20261399980000).\n" +
      "            -- O pedido do numero digitado continua primeiro e a data continua mandando.\n" +
      "            o.id\n" +
      "        LIMIT p_page_size\n",
    cauda:
      /ELSE 1 END, o\.created_at DESC, o\.id LIMIT p_page_size OFFSET v_offset \) t;/,
    intactos: [
      "'data', v_data,",
      "'total_count', v_total_count",
      "upper(right(o.id::TEXT, 6)) = upper(v_clean_search)",
      "LIMIT p_page_size",
      "OFFSET v_offset",
      "IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN",
      "v_parece_telefone AND length(v_search_digitos) >= 4",
    ],
    guardas: [
      "IF NOT public.is_admin() THEN",
      "IF NOT public.is_admin_atual() THEN",
    ],
    ordenacoes: 1,
  },
  {
    chave: "cancelados",
    nome: "get_admin_orders_cancelados_recentes",
    assinatura:
      "public.get_admin_orders_cancelados_recentes(integer,integer,integer)",
    anterior:
      "20261380000000_o_aviso_de_cancelados_antigos_conta_so_pendencia_real.sql",
    hVigente: "9567454f17698f3f0624cca0b06458cd",
    hNovo: "80ec13f92e224b21d5308a063e88fb6e",
    delim: "$$",
    de:
      "             ORDER BY COALESCE(h.cancelado_em, o.updated_at) DESC, o.created_at DESC\n" +
      "             LIMIT p_page_size\n",
    para:
      "             ORDER BY COALESCE(h.cancelado_em, o.updated_at) DESC, o.created_at DESC,\n" +
      "                      -- Desempate pelo id (unico): cancelamentos do mesmo instante (cancelar em lote) saiam numa ordem que\n" +
      "                      -- podia mudar de uma pagina para outra, e a paginacao por OFFSET repetia um e escondia outro\n" +
      "                      -- (20261399980000). A ordem de atencao do cancelamento continua mandando.\n" +
      "                      o.id\n" +
      "             LIMIT p_page_size\n",
    cauda:
      /ORDER BY COALESCE\(h\.cancelado_em, o\.updated_at\) DESC, o\.created_at DESC, o\.id LIMIT p_page_size OFFSET v_offset \) c \) t;/,
    intactos: [
      "'data', v_data,",
      "'total_count', v_total_count,",
      "'fora_da_janela', v_fora_da_janela",
      "AND pendente",
      "LIMIT p_page_size",
      "OFFSET v_offset",
    ],
    guardas: [
      "IF NOT public.is_admin() THEN",
      "IF NOT public.is_admin_atual() THEN",
    ],
    ordenacoes: 1,
  },
];

/** A definicao (cabecalho + corpo) do UM `CREATE OR REPLACE FUNCTION public.<nome>(` do arquivo, e o corpo entre as aspas de dolar. */
function definicaoDe(sql, nome) {
  const marca = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  assert.equal(sql.split(marca).length - 1, 1, `uma definicao de ${nome}`);
  const ini = sql.indexOf(marca);
  const m = /\nAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  const fecha = sql.indexOf(`${m[1]};`, abre);
  return {
    cabecalho: sql.slice(ini, abre),
    corpo: sql.slice(abre, fecha),
    delim: m[1],
  };
}
for (const f of FUNCOES) {
  const ant = definicaoDe(ler(`supabase/migrations/${f.anterior}`), f.nome);
  f.cabecalho = ant.cabecalho;
  f.corpoVigente = ant.corpo;
  f.corpoNovo = definicaoDe(migration, f.nome).corpo;
  f.corpoRollback = definicaoDe(rollback, f.nome).corpo;
}

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
  for (const sql of [migration, rollback]) {
    assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
    assert.ok(sql.includes("SET LOCAL statement_timeout = '30s';"));
    assert.ok(sql.includes("NOTIFY pgrst, 'reload schema';"));
  }
});

for (const f of FUNCOES)
  Deno.test(`${f.nome}: o vigente e' o da migration anterior (md5 conhecido) e o novo e' ele com SO o desempate declarado; desfazer a troca devolve o vigente byte a byte`, () => {
    assert.equal(md5(f.corpoVigente), f.hVigente);
    assert.equal(
      f.corpoVigente.split(f.de).length - 1,
      1,
      "o trecho antigo existe UMA vez",
    );
    assert.equal(
      f.corpoNovo,
      f.corpoVigente.replace(f.de, () => f.para),
    );
    assert.equal(md5(f.corpoNovo), f.hNovo);
    assert.notEqual(f.hNovo, f.hVigente);
    assert.equal(
      f.corpoNovo.replace(f.para, () => f.de),
      f.corpoVigente,
    );
    // o que NAO pode ter mudado: o formato do JSON, as travas, os filtros e a paginacao mantem o mesmo numero de ocorrencias
    for (const trecho of f.intactos)
      assert.equal(
        f.corpoNovo.split(trecho).length,
        f.corpoVigente.split(trecho).length,
        `o trecho ${trecho} mudou de numero de ocorrencias`,
      );
    for (const guarda of f.guardas)
      assert.equal(f.corpoNovo.split(guarda).length - 1, 1, guarda);
    // nenhum outro ORDER BY do corpo mudou
    assert.equal(
      f.corpoNovo.split("ORDER BY").length,
      f.corpoVigente.split("ORDER BY").length,
    );
    // a regra nova: o desempate e' o ULTIMO termo do ORDER BY da pagina (a ordem escolhida continua mandando) e e' o id, unico
    assert.match(limpo(f.corpoNovo), f.cauda);
    assert.doesNotMatch(limpo(f.corpoVigente), /o\.id LIMIT|p\.id LIMIT/);
    // o desempate nunca fica DESC (ordem fixa e igual a da prova viva) e nunca e' um campo que se repete
    assert.doesNotMatch(f.corpoNovo, /\b[po]\.id DESC\b/);
  });

Deno.test("o rollback recria os tres corpos VIGENTES byte a byte, com os mesmos md5 que o pre-voo e a conferencia declaram", () => {
  for (const f of FUNCOES) {
    assert.equal(f.corpoRollback, f.corpoVigente, f.nome);
    assert.equal(md5(f.corpoRollback), f.hVigente);
    assert.ok(!f.corpoRollback.includes("Desempate pelo id"));
    for (const sql of [migration, rollback])
      assert.ok(
        sql.includes(
          `('${f.chave}', '${f.assinatura}', '${f.hVigente}', '${f.hNovo}')`,
        ),
        `${f.nome}: o pre-voo nao cita (chave, assinatura, vigente, desta)`,
      );
  }
});

Deno.test("so um CREATE OR REPLACE FUNCTION por funcao em cada arquivo, com a MESMA assinatura e os MESMOS atributos; nada de GRANT, REVOKE, DROP, ALTER, DML nem objeto novo fora do corpo", () => {
  for (const sql of [migration, rollback]) {
    assert.equal(
      sql.split("\nCREATE OR REPLACE FUNCTION").length - 1,
      3,
      "tres funcoes por arquivo",
    );
    let fora = sql;
    for (const f of FUNCOES) {
      const d = definicaoDe(sql, f.nome);
      assert.equal(
        d.cabecalho,
        f.cabecalho,
        `${f.nome}: assinatura e atributos de sempre`,
      );
      assert.ok(d.cabecalho.includes(" SECURITY DEFINER\n"));
      assert.ok(
        d.cabecalho.includes(" SET search_path TO 'public', 'extensions'\n"),
      );
      assert.ok(d.cabecalho.includes(" RETURNS jsonb\n LANGUAGE plpgsql\n"));
      assert.doesNotMatch(
        d.cabecalho,
        /\b(STABLE|IMMUTABLE|SECURITY INVOKER)\b/,
      );
      fora = fora.replace(d.corpo, "");
    }
    fora = limpo(fora);
    assert.doesNotMatch(fora, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(fora, /\b(DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    assert.doesNotMatch(fora, /\bALTER\b/i);
    assert.doesNotMatch(
      fora,
      /\bCREATE\s+(TABLE|POLICY|INDEX|TRIGGER|VIEW)\b/i,
    );
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
});

Deno.test("o pre-voo vem antes das trocas, aceita SO o corpo vigente e o desta migration por funcao, confere atributos, dono, ACL, sobrecarga e a chave primaria; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261399980000$");
  const fimPre = migration.indexOf("END $preflight_20261399980000$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261399980000$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    "md5(replace(p.prosrc, E'\\r', ''))",
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "to_regprocedure(r.assinatura)",
    "p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]",
    "p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset",
    "l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype",
    "pg_get_function_identity_arguments(p.oid) = r.argumentos",
    "p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))",
    "q.proname = r.nome) = 1",
    "has_function_privilege('authenticated', p.oid, 'EXECUTE')",
    "has_function_privilege('service_role', p.oid, 'EXECUTE')",
    "NOT has_function_privilege('anon', p.oid, 'EXECUTE')",
    "aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))",
    "a.grantee = 0 AND a.privilege_type = 'EXECUTE'",
    "to_jsonb(p) - 'prosrc'",
    "set_config('ikcous.listas3998_' || r.chave, v_atributos::text, true)",
    "k.contype = 'p'",
    "<> 2",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  // os argumentos de cada funcao (o nome dos parametros e' contrato de quem chama por nome)
  for (const argumentos of [
    "p_search text, p_category text, p_status text, p_stock text, p_page integer, p_page_size integer",
    "p_search text, p_status text, p_start_date text, p_end_date text, p_page integer, p_page_size integer, p_payment_status text, p_canal text",
    "p_dias integer, p_page integer, p_page_size integer",
  ])
    assert.ok(pre.includes(`'${argumentos}'`), argumentos);
  const conf = migration.slice(iConf);
  for (const f of FUNCOES)
    assert.ok(
      conf.includes(`('${f.chave}', '${f.assinatura}', '${f.hNovo}')`),
      f.nome,
    );
  for (const trecho of [
    "md5(replace(p.prosrc, E'\\r', '')) = r.hash",
    "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.listas3998_' || r.chave)::jsonb",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399980000 falhou",
  ])
    assert.ok(conf.includes(trecho), trecho);
  // o pre-voo NAO aceita nenhum corpo mais antigo que o vigente
  for (const velho of [
    "39db382689def5fac3b263a66f84ede1",
    "f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6",
    "99a9e4cb232aef020bf297ddcd1901f0",
  ])
    assert.ok(!pre.includes(velho), velho);
});

Deno.test("o rollback tem pre-voo (exige o corpo DESTA migration nas tres, atributos, dono, ACL) e conferencia (os corpos voltam ao vigente); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261399980000$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261399980000$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.ok(
    pre.includes("aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))"),
  );
  const conf = rollback.slice(iConf);
  for (const f of FUNCOES)
    assert.ok(
      conf.includes(`('${f.chave}', '${f.assinatura}', '${f.hVigente}')`),
      f.nome,
    );
  assert.ok(
    conf.includes(
      "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.listas3998_' || r.chave)::jsonb",
    ),
  );
  assert.doesNotMatch(limpo(rollback), /\b(GRANT|REVOKE)\b/i);
});

Deno.test("a ordem de desfazer esta declarada no cabecalho; a 8e, a 9a, a 17a, a 85a, a 86a, a 90a, a 92a, a 119a, a 125a e o modulo das sucessoras conhecem a sucessora", () => {
  for (const trecho of [
    "ROLLBACK MANUAL",
    "vem ANTES do rollback de cada uma das três",
    "NÃO RESOLVE",
    "8e, 9a, 85a, 86a, 90a, 92a, 119a e 125a",
    "tests/banco/as-listas-do-painel-nao-repetem-ninguem-viva.cjs",
  ])
    assert.ok(migration.includes(trecho), trecho);
  for (const f of FUNCOES) assert.ok(migration.includes(`${f.nome}`), f.nome);
  const c8e = ler(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  for (const f of FUNCOES.filter((x) => x.chave !== "produtos"))
    assert.ok(
      c8e.includes(`('${f.nome}', '${f.hNovo}', '20261399980000')`),
      `8e ${f.nome}`,
    );
  const c9a = ler(
    "scripts/publicacao/consultas/9a-conferir-60-a-66-aplicado.sql",
  );
  for (const f of FUNCOES.filter((x) => x.chave !== "produtos"))
    assert.ok(c9a.includes(`('${f.nome}', '${f.hNovo}')`), `9a ${f.nome}`);
  // cada vizinha cita o md5 novo (a 17a cita o sha256 do corpo de produtos, conferido pelo ci_conferir_banco_test.ts)
  for (const [arq, hash] of [
    ["85a-conferir-aviso-de-cancelados-antigos-aplicado", FUNCOES[2].hNovo],
    ["86a-conferir-ex-admin-no-resto-do-painel-aplicado", FUNCOES[0].hNovo],
    ["90a-conferir-busca-do-painel-por-codigo-aplicado", FUNCOES[0].hNovo],
    ["92a-conferir-a-busca-de-pedido-pelo-numero-aplicado", FUNCOES[1].hNovo],
    [
      "119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado",
      FUNCOES[0].hNovo,
    ],
    [
      "125a-conferir-a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-aplicado",
      FUNCOES[1].hNovo,
    ],
  ])
    assert.ok(
      ler(`scripts/publicacao/consultas/${arq}.sql`).includes(`'${hash}'`),
      arq,
    );
  // a cadeia: as 3 entradas (uma por funcao) da migration na lista das sucessoras, com os hashes do pre-voo
  const { SUCESSORAS_DA_99 } = require("./banco/sucessoras-da-99.cjs");
  const dela = SUCESSORAS_DA_99.filter((s) => s.nome === NOME);
  assert.deepEqual(
    dela.map((s) => [s.assinatura, s.hashVigente, s.hashDesta]),
    FUNCOES.map((f) => [f.assinatura, f.hVigente, f.hNovo]),
  );
  // o modulo posterior (a prova das tres anteriores desfaz esta primeiro) e quem o chama
  const posterior = ler("tests/banco/as-listas-do-painel-posterior.cjs");
  for (const f of FUNCOES) {
    assert.ok(posterior.includes(f.assinatura), f.assinatura);
    assert.ok(
      posterior.includes(f.hVigente) && posterior.includes(f.hNovo),
      f.nome,
    );
  }
  assert.ok(posterior.includes("rollback-manual-${NOME}"));
  for (const arq of [
    "tests/banco/a-busca-de-pedidos-posterior.cjs",
    "tests/banco/a-busca-do-painel-acha-por-palavras-posterior.cjs",
    "tests/banco/o-aviso-de-cancelados-antigos-viva.cjs",
    "tests/banco/portao-8e-aceita-sucessoras-viva.cjs",
  ])
    assert.ok(ler(arq).includes("desfazerListasDoPainelNaTransacao"), arq);
  assert.ok(
    ler("tests/banco/portao-8e-aceita-sucessoras-viva.cjs").includes(NOME),
  );
});

Deno.test("depois da migration anterior de cada funcao so este par redefine essa funcao", () => {
  const todas = [
    ...Deno.readDirSync(new URL("../supabase/migrations/", import.meta.url)),
  ]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  for (const f of FUNCOES) {
    const posteriores = [];
    for (const n of todas)
      if (
        n.replace(/^rollback-manual-/, "").slice(0, 14) >
          f.anterior.slice(0, 14) &&
        [
          ...limpo(ler(`supabase/migrations/${n}`))
            .toLowerCase()
            .matchAll(/create (?:or replace )?function public\.(\w+)/g),
        ].some((m) => m[1] === f.nome)
      )
        posteriores.push(n);
    assert.deepEqual(
      posteriores.sort(),
      [NOME, `rollback-manual-${NOME}`],
      f.nome,
    );
  }
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261399980000 (sem ela a migration sai PULADA, codigo 2) e cada contagem bate com o corpo novo e nao com o vigente", () => {
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = new Map(Object.entries(VERIFICACOES)).get(NOME);
  assert.ok(Array.isArray(entrada), "sem entrada em VERIFICACOES");
  assert.deepEqual(
    entrada.map((e) => e.funcao),
    FUNCOES.map((f) => f.nome),
  );
  for (const f of FUNCOES) {
    const e = entrada.find((x) => x.funcao === f.nome);
    for (const { texto, vezes } of e.esperado) {
      assert.equal(
        `${f.cabecalho}${f.corpoNovo}`.split(texto).length - 1,
        vezes,
        `${f.nome}: ${texto}`,
      );
    }
    // o marcador do desempate NAO existe no corpo vigente: sem a troca, a entrada reprova
    const marcadorDoDesempate = e.esperado.find(
      (x) =>
        x.texto.includes("20261399980000") ||
        x.texto.includes("numero digitado continua"),
    );
    assert.ok(marcadorDoDesempate, `${f.nome}: sem marcador do desempate`);
    assert.equal(
      `${f.cabecalho}${f.corpoVigente}`.split(marcadorDoDesempate.texto)
        .length - 1,
      0,
    );
  }
});

Deno.test("consultas 140a/140b so de catalogo, dez linhas fechadas, hashes certos e registros de publicacao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A = "140a-conferir-as-listas-do-painel-nao-repetem-ninguem-aplicado";
  const B = "140b-antes-as-listas-do-painel-nao-repetem-ninguem-base-vigente";
  type Fn = (typeof FUNCOES)[number];
  const novo = (x: Fn) => x.hNovo;
  const vigente = (x: Fn) => x.hVigente;
  for (const [nomeConsulta, doCampo, doOutro] of [
    [A, novo, vigente],
    [B, vigente, novo],
  ] as const) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    for (const f of FUNCOES) {
      assert.ok(
        consulta.includes(`'${doCampo(f)}'`),
        `${nomeConsulta}: ${f.nome}`,
      );
      assert.ok(
        !consulta.includes(doOutro(f)),
        `${nomeConsulta} cita o corpo do outro lado`,
      );
      assert.ok(consulta.includes(`('${f.nome}', '${f.assinatura}', `));
    }
    // Catalogo apenas: nenhuma le produto, pedido nem cliente e nenhuma chama as funcoes.
    assert.doesNotMatch(
      limpo(consulta),
      /FROM public\.(?:produtos|marketplace_orders|marketplace_order_items|profiles|product_variants)/,
    );
    assert.doesNotMatch(
      limpo(consulta),
      /\bget_admin_(?:products|orders)\w*\(\s*[\d'$]/,
    );
    assert.doesNotMatch(
      limpo(consulta).replace(/'(?:[^']|'')*'/g, "''"),
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i,
    );
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.equal(rol.length, 10);
    assert.equal(new Set(rol).size, 10);
    const linhas = rol.map((item) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(estruturaDoRolFechado(linhas, rol), null);
    assert.notEqual(estruturaDoRolFechado(linhas.slice(1), rol), null);
    assert.notEqual(estruturaDoRolFechado([...linhas, linhas[0]], rol), null);
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(nomeConsulta));
    assert.equal(
      ler(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${nomeConsulta}.sql"`,
      ).length - 1,
      2,
    );
    assert.ok(
      ler(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nomeConsulta}\n`,
      ),
    );
  }
  const entrada = JSON.parse(
    ler("scripts/frota/canais-de-backend.json"),
  ).provasDeObjetos.find((p) => p.versoes.includes("20261399980000"));
  assert.equal(entrada.consulta, A);
  assert.equal(entrada.ausenciaConfirmadaPor, B);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/as-listas-do-painel-nao-repetem-ninguem-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "as-listas-do-painel-nao-repetem-ninguem-viva.cjs",
    ),
  );
});
