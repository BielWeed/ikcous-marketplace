// @ts-nocheck
/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp, security/detect-unsafe-regex --
 * Chaves e expressoes vem das constantes deste teste (as 17 tabelas, os nomes das consultas) e do texto dos arquivos do repositorio. */
// O LIVRO DE REGISTRO GUARDA A VERSAO ANTIGA — prova offline (texto) da migration 20261510000000, dos dois rollbacks, das consultas
// 188a/188b/188m e do registro delas nos portoes (plano PLANO-LIVRO-DE-REGISTRO, 26/11/2026).
//
// O QUE ESTE TESTE FIXA: antes de uma linha de 17 tabelas de dinheiro ser ALTERADA ou APAGADA, o banco guarda a versao antiga em
// public.livro_de_registro por 90 dias, com gatilhos POR COMANDO (FOR EACH STATEMENT, tabelas de transicao), uma funcao que engole o
// proprio erro (nunca no caminho de quem compra) e nenhuma porta para papel de aplicacao. Aqui so o que se le no TEXTO: os arquivos, a
// lista das 17, os 34 gatilhos, a ausencia de INSERT/GRANT/RAISE EXCEPTION/SQLERRM, o LOCK NOWAIT, a agenda e os rollbacks.
// O comportamento (papeis, diff, titular, limpeza, disjuntor, trava, custo, mutantes) fica com tests/banco/o-livro-de-registro-viva.cjs.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { createHash } = require("node:crypto");
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const {
  contarStatements,
  ROL_FECHADO_POR_CONSULTA,
} = require("../scripts/publicacao/conferir-banco.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const NOME = "20261510000000_o_livro_de_registro_guarda_a_versao_antiga.sql";
const LER = (n) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${n}`).replace(/\r/g, "");
const A188 = "188a-conferir-o-livro-de-registro-aplicado";
const B188 = "188b-antes-o-livro-de-registro-ausente";
const M188 = "188m-medir-o-volume-para-o-livro-de-registro";
const CONSULTA = (n) =>
  Deno.readTextFileSync(
    `${RAIZ}/scripts/publicacao/consultas/${n}.sql`,
  ).replace(/\r/g, "");
const md5 = (s) => createHash("md5").update(s).digest("hex");
const norm = (s) => s.replace(/\s+/g, " ").trim();

// As 17 tabelas e de onde vem o titular (LGPD) de cada uma. Esta lista e' o CONTRATO: a migration, os rollbacks, as consultas e a
// prova viva tem de concordar com ela, tabela por tabela.
const ORIGEM = {
  marketplace_orders: "user_id",
  marketplace_order_items: "order_id",
  order_refunds: "order_id",
  marketplace_order_payment_history: "order_id",
  devolucoes: "user_id",
  devolucao_itens: "devolucao_id",
  produtos: "",
  product_variants: "",
  categorias: "",
  coupons: "",
  fornecedores: "",
  fin_lancamentos: "",
  fin_contas: "",
  fin_categorias: "",
  store_config: "",
  config_pagamento_cartao: "",
  politica_devolucao: "",
};
const TABELAS = Object.keys(ORIGEM);
// O que NUNCA entra no livro (segredo, dado de navegacao, tabela que ja e' historico).
const FORA = [
  "cart_items",
  "visitas_por_dia",
  "analytics_events",
  "store_shipping_credentials",
  "user_addresses",
  "profiles",
  "marketplace_order_history",
  "produto_historico_preco",
  "cargo_log",
  "vor_receipts",
  "assinatura_da_loja",
  "frota_lojas",
  "frota_segredo",
  "banners",
];

const migration = LER(NOME);
const rollback = LER(`rollback-manual-${NOME}`);
const destrutivo = LER(`rollback-manual-destrutivo-${NOME}`);
const codigo = (s) => removerRuido(s);

/** Os CREATE OR REPLACE TRIGGER tr_livro_* do texto, com tabela, evento, transicoes, nivel e argumento. */
function gatilhos(sql) {
  const re =
    /CREATE OR REPLACE TRIGGER (tr_livro_\w+)\s+AFTER (\w+(?: OR \w+)*) ON public\.(\w+)\s+REFERENCING OLD TABLE AS antigos( NEW TABLE AS novos)?\s+FOR EACH (STATEMENT|ROW)\s+EXECUTE FUNCTION public\.livro_de_registro_anotar\(('(\w*)')?\);/g;
  return [...sql.matchAll(re)].map((m) => ({
    nome: m[1],
    evento: m[2],
    tabela: m[3],
    novos: Boolean(m[4]),
    nivel: m[5],
    origem: m[7] ?? "",
  }));
}
/** O corpo (entre $function$) de uma funcao da migration. */
function corpo(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}()`);
  assert(i >= 0, `${nome} nao encontrada`);
  const abre = sql.indexOf("AS $function$", i) + "AS $function$".length;
  return sql.slice(abre, sql.indexOf("$function$;", abre));
}
/** O cabecalho (do CREATE ate o AS) de uma funcao da migration. */
function cabecalho(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}()`);
  return sql.slice(i, sql.indexOf("AS $function$", i));
}

Deno.test("os tres arquivos existem com o numero reservado; avaliarFase0 nao recusa o par", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback comum", rollback],
    ["rollback destrutivo", destrutivo],
  ])
    assert(sql.length > 500, `${nome} vazio`);
});

Deno.test("nenhum dos tres arquivos abre ou fecha transacao (o aplicador abre); todos com lock_timeout de 5s", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback comum", rollback],
    ["rollback destrutivo", destrutivo],
  ]) {
    assertEquals(
      detectarTransacaoExplicita(codigo(sql)).achados,
      [],
      `${nome} contem controle de transacao`,
    );
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
  }
});

Deno.test("cada CREATE TABLE nasce com REVOKE ALL dos quatro papeis; nenhum GRANT em objeto do livro; sequencia do id tambem fechada", () => {
  const c = codigo(migration);
  const criadas = [
    ...c.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g),
  ].map((m) => m[1]);
  assertEquals(criadas.sort(), [
    "livro_de_registro",
    "livro_de_registro_chave",
    "livro_de_registro_falhas",
  ]);
  for (const t of criadas)
    assertStringIncludes(
      c,
      `REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated, service_role;`,
    );
  assertStringIncludes(
    c,
    "REVOKE ALL ON SEQUENCE public.livro_de_registro_id_seq FROM PUBLIC, anon, authenticated, service_role;",
  );
  for (const f of ["livro_de_registro_anotar", "livro_de_registro_limpar"])
    assertStringIncludes(
      c,
      `REVOKE ALL ON FUNCTION public.${f}() FROM PUBLIC, anon, authenticated, service_role;`,
    );
  assert(!/\bGRANT\b/.test(c), "nenhum GRANT na migration");
  for (const t of criadas)
    assert(
      !new RegExp(
        `ENABLE ROW LEVEL SECURITY[\\s\\S]*CREATE POLICY[^;]*public\\.${t}\\b`,
      ).test(c) && !/CREATE POLICY/.test(c),
      "nenhuma politica (RLS ligada sem politica)",
    );
  for (const t of criadas)
    assertStringIncludes(
      c,
      `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`,
    );
  // Sem FK, sem CHECK de valor e sem indice unico alem da PK no livro.
  const livro = migration.slice(
    migration.indexOf("CREATE TABLE IF NOT EXISTS public.livro_de_registro ("),
    migration.indexOf(
      ");",
      migration.indexOf(
        "CREATE TABLE IF NOT EXISTS public.livro_de_registro (",
      ),
    ),
  );
  assert(!/REFERENCES|CHECK|UNIQUE/i.test(livro), "livro com FK/CHECK/UNIQUE");
  assert(!/CREATE UNIQUE INDEX/i.test(c), "indice unico");
  assert(!/supabase_realtime/.test(c), "o livro nao entra no realtime");
});

Deno.test("as 17 tabelas: dois gatilhos POR COMANDO cada (34), AFTER UPDATE com antigos+novos e AFTER DELETE so com antigos; o titular de cada uma", () => {
  const g = gatilhos(migration);
  assertEquals(g.length, 34, "34 gatilhos");
  for (const t of TABELAS) {
    const daTabela = g.filter((x) => x.tabela === t);
    assertEquals(
      daTabela.map((x) => [x.nome, x.evento, x.novos, x.nivel, x.origem]),
      [
        ["tr_livro_alteracao", "UPDATE", true, "STATEMENT", ORIGEM[t]],
        ["tr_livro_exclusao", "DELETE", false, "STATEMENT", ORIGEM[t]],
      ],
      `gatilhos de ${t}`,
    );
  }
  assertEquals(
    [...new Set(g.map((x) => x.tabela))].sort(),
    [...TABELAS].sort(),
    "lista das 17 == constante",
  );
  // Escritos tabela por tabela (sem laco dinamico): cada CREATE TRIGGER do texto e' um dos 34.
  assertEquals(
    (codigo(migration).match(/CREATE OR REPLACE TRIGGER/g) ?? []).length,
    34,
  );
  assert(
    !/\bEXECUTE\s+format\b|\bEXECUTE\s+'/i.test(migration),
    "sem SQL dinamico",
  );
  for (const t of FORA)
    assert(
      !new RegExp(`ON public\\.${t}\\b`).test(migration),
      `${t} nao entra no livro`,
    );
});

Deno.test("nenhum gatilho do livro anota INSERT nem e' por linha", () => {
  for (const sql of [migration]) {
    const c = codigo(sql);
    assert(
      !/tr_livro_\w+\s+AFTER[^;]*\bINSERT\b/i.test(c),
      "tr_livro_ com INSERT",
    );
    assert(
      !/tr_livro_\w+\s+(BEFORE|INSTEAD)/i.test(c),
      "tr_livro_ BEFORE/INSTEAD",
    );
    assert(!/tr_livro_[^;]*FOR EACH ROW/i.test(c), "tr_livro_ por linha");
  }
});

Deno.test("anotar(): SECURITY DEFINER, search_path fixo, lock_timeout 200ms, EXCEPTION WHEN OTHERS, nenhum RAISE EXCEPTION, nenhum SQLERRM", () => {
  const cab = norm(cabecalho(migration, "public.livro_de_registro_anotar"));
  assertStringIncludes(
    cab,
    "RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER",
  );
  assertStringIncludes(cab, "SET search_path = pg_catalog, pg_temp");
  assertStringIncludes(cab, "SET lock_timeout = '200ms'");
  const b = corpo(migration, "public.livro_de_registro_anotar");
  assert(/EXCEPTION\s+WHEN OTHERS THEN/.test(b), "EXCEPTION WHEN OTHERS");
  assert(!/RAISE\s+EXCEPTION/i.test(b), "RAISE EXCEPTION no gatilho");
  assert(!/SQLERRM/i.test(migration), "SQLERRM em algum lugar da migration");
  assert(!/SQLERRM/i.test(rollback), "SQLERRM no rollback");
  // Sempre RETURN NULL (AFTER): nunca devolve a linha nem a troca.
  assertEquals(
    [...b.matchAll(/RETURN\s+(\w+)/g)].map((m) => m[1]),
    ["NULL", "NULL"],
  );
  // O que se grava: so UPDATE e DELETE; nada de NEW/OLD de linha.
  assertStringIncludes(b, "IF TG_OP = 'UPDATE' THEN");
  assertStringIncludes(b, "ELSIF TG_OP = 'DELETE' THEN");
  assert(!/\b(NEW|OLD)\./.test(b), "NEW./OLD. (gatilho e' por comando)");
  // O filtro do carimbo e a chave.
  assertStringIncludes(b, "ARRAY['updated_at', 'ultima_atualizacao']");
  assertStringIncludes(b, "public.livro_de_registro_chave");
  // Toda tabela qualificada (search_path vazio de public).
  for (const m of b.matchAll(/\b(FROM|INTO|JOIN)\s+([a-z_]+)(\s|\.)/g))
    if (!["antigos", "novos", "jsonb_each"].includes(m[2]) && m[3] !== ".")
      throw new Error(`nome nao qualificado no corpo: ${m[0]}`);
});

Deno.test("limpar(): SECURITY DEFINER, search_path fixo, statement_timeout 60s, 90 dias em lotes de 5000, teto, disjuntor; agenda diaria", () => {
  const cab = norm(cabecalho(migration, "public.livro_de_registro_limpar"));
  assertStringIncludes(cab, "SECURITY DEFINER");
  assertStringIncludes(cab, "SET search_path = pg_catalog, pg_temp");
  assertStringIncludes(cab, "SET statement_timeout = '60s'");
  const b = corpo(migration, "public.livro_de_registro_limpar");
  assertStringIncludes(b, "v.quando < clock_timestamp() - interval '90 days'");
  assertStringIncludes(b, "LIMIT 5000");
  assertStringIncludes(b, "pg_database_size(current_database())");
  assertStringIncludes(b, "SET ligado = false");
  assertStringIncludes(b, "f.dia < current_date - 90");
  assertEquals(
    migration.split("interval '90 days'").length - 1,
    1,
    "o prazo do livro aparece UMA vez (o mutante limpa-com-9-dias depende disso)",
  );
  assertStringIncludes(codigo(migration), "SELECT cron.schedule('', '', '');");
  assertStringIncludes(
    migration,
    "SELECT cron.schedule('limpar-livro-de-registro', '17 6 * * *', 'SELECT public.livro_de_registro_limpar()');",
  );
});

Deno.test("ordem: SET LOCAL -> pre-voo -> LOCK das 17 NOWAIT -> objetos -> pos-voo -> NOTIFY; chave semeada sem religar", () => {
  const iPre = migration.indexOf("DO $preflight_20261510000000$");
  const iLock = migration.indexOf("LOCK TABLE ");
  const iTab = migration.indexOf("CREATE TABLE IF NOT EXISTS");
  const iPos = migration.indexOf("DO $posvoo_20261510000000$");
  const iNotify = migration.indexOf("NOTIFY pgrst, 'reload schema';");
  assert(
    iPre > 0 && iLock > iPre && iTab > iLock && iPos > iTab && iNotify > iPos,
    "pre-voo -> LOCK -> objetos -> pos-voo -> NOTIFY",
  );
  const antes = codigo(migration.slice(0, iPre))
    .replace(/SET LOCAL [^;]+;/g, "")
    .trim();
  assertEquals(antes, "", "nada alem de SET LOCAL antes do pre-voo");
  const lock = norm(migration.slice(iLock, migration.indexOf(";", iLock) + 1));
  assertEquals(
    lock,
    `LOCK TABLE ${TABELAS.map((t) => `public.${t}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE NOWAIT;`,
  );
  assertStringIncludes(
    migration,
    "INSERT INTO public.livro_de_registro_chave (id) VALUES (1) ON CONFLICT (id) DO NOTHING;",
  );
  // A unica escrita de dado da migration e' a semente da chave (nenhuma linha das 17 e' lida para fora ou alterada).
  const c = codigo(migration);
  assertEquals((c.match(/\bINSERT INTO\b/g) ?? []).length, 1 + 0);
  assert(!/\b(UPDATE|DELETE FROM|TRUNCATE)\s+public\.(?!livro)/i.test(c));
  const pre = migration.slice(iPre, iLock);
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  for (const t of TABELAS) assertStringIncludes(pre, `'${t}'`);
  for (const trecho of [
    "to_regprocedure('cron.schedule(text,text,text)')",
    "to_regprocedure('auth.uid()')",
    "server_version_num",
  ])
    assertStringIncludes(pre, trecho);
  const pos = migration.slice(iPos, iNotify);
  assertStringIncludes(pos, "B2_POSVOO_DIVERGENTE");
  for (const trecho of [
    "relrowsecurity",
    "pg_policy",
    "aclexplode",
    "tgenabled",
    "proconfig",
    "cron.job",
    "pg_publication_tables",
  ])
    assertStringIncludes(pos, trecho);
});

Deno.test("rollback comum: LOCK NOWAIT, tira os 34 gatilhos e a funcao do gatilho, desagenda SO se o job existir, preserva as tabelas", () => {
  const c = codigo(rollback);
  const lock = norm(
    rollback.slice(
      rollback.indexOf("LOCK TABLE "),
      rollback.indexOf(";", rollback.indexOf("LOCK TABLE ")) + 1,
    ),
  );
  assertEquals(
    lock,
    `LOCK TABLE ${TABELAS.map((t) => `public.${t}`).join(", ")} IN ACCESS EXCLUSIVE MODE NOWAIT;`,
  );
  const drops = [
    ...rollback.matchAll(
      /DROP TRIGGER IF EXISTS (tr_livro_\w+) ON public\.(\w+);/g,
    ),
  ].map((m) => `${m[2]}.${m[1]}`);
  assertEquals(
    drops.sort(),
    TABELAS.flatMap((t) => [
      `${t}.tr_livro_alteracao`,
      `${t}.tr_livro_exclusao`,
    ]).sort(),
  );
  assertStringIncludes(
    c,
    "DROP FUNCTION IF EXISTS public.livro_de_registro_anotar();",
  );
  assert(
    rollback.indexOf("DROP FUNCTION") > rollback.lastIndexOf("DROP TRIGGER"),
    "funcao depois dos gatilhos",
  );
  assert(!/DROP TABLE/i.test(c), "o comum preserva as tabelas");
  assert(!/CASCADE/i.test(c), "sem CASCADE");
  const desagenda = rollback.slice(
    rollback.indexOf("DO $desagenda_20261510000000$"),
  );
  assert(
    /IF to_regclass\('cron\.job'\) IS NOT NULL THEN\s+IF EXISTS \(SELECT 1 FROM cron\.job WHERE jobname = 'limpar-livro-de-registro'\) THEN\s+PERFORM cron\.unschedule\('limpar-livro-de-registro'\);/.test(
      desagenda,
    ),
    "desagenda so se existir",
  );
});

Deno.test("rollback destrutivo: exige app.confirmo_apagar_livro = 'APAGAR' e o comum antes; apaga as 3 tabelas e o limpar sem CASCADE", () => {
  const c = codigo(destrutivo);
  assertStringIncludes(
    destrutivo,
    "IF COALESCE(current_setting('app.confirmo_apagar_livro', true), '') <> 'APAGAR' THEN",
  );
  assertStringIncludes(destrutivo, "LIVRO_SO_COM_O_DONO");
  assertStringIncludes(destrutivo, "LIVRO_ROLLBACK_COMUM_PRIMEIRO");
  for (const t of [
    "livro_de_registro",
    "livro_de_registro_falhas",
    "livro_de_registro_chave",
  ])
    assertStringIncludes(c, `DROP TABLE IF EXISTS public.${t};`);
  assertStringIncludes(
    c,
    "DROP FUNCTION IF EXISTS public.livro_de_registro_limpar();",
  );
  assert(!/CASCADE/i.test(c), "sem CASCADE");
  assert(
    destrutivo.indexOf("LIVRO_SO_COM_O_DONO") <
      destrutivo.indexOf("DROP TABLE"),
  );
});

Deno.test("188a/188b: rol fechado igual aos rotulos do SQL, UM statement, so catalogo; 188a com o md5 dos corpos desta migration e sem exigir ligado", () => {
  const rolA = ROL_FECHADO_POR_CONSULTA[A188];
  const rolB = ROL_FECHADO_POR_CONSULTA[B188];
  assert(rolA?.length > 0 && rolB?.length > 0, "188a/188b no rol fechado");
  for (const [nome, rol] of [
    [A188, rolA],
    [B188, rolB],
  ]) {
    const sql = CONSULTA(nome);
    assertEquals(new Set(rol).size, rol.length, `${nome}: rotulo repetido`);
    assertEquals(contarStatements(sql), 1, `${nome}: UM statement`);
    const rotulos = [...sql.matchAll(/SELECT '([^']+)', 'sim'/g)].map(
      (m) => m[1],
    );
    assertEquals(rotulos.sort(), [...rol].sort(), `${nome}: rotulos != rol`);
    const cod = sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/.test(
        cod,
      ),
      `${nome}: so leitura`,
    );
    assert(
      !new RegExp(
        `\\bFROM\\s+(public\\.)?(${TABELAS.join("|")}|livro_de_registro\\w*)\\b`,
        "i",
      ).test(cod),
      `${nome}: nao le linha`,
    );
    assert(!/\bcommand\b/.test(cod), `${nome}: nao le o comando dos jobs`);
    for (const t of TABELAS) assertStringIncludes(sql, `'${t}'`);
  }
  const a = CONSULTA(A188);
  for (const f of [
    "public.livro_de_registro_anotar",
    "public.livro_de_registro_limpar",
  ])
    assertStringIncludes(a, `'${md5(corpo(migration, f))}'`);
  // Fora de comentario e de texto entre aspas (a forma das colunas da chave cita "ligado:boolean"), nada le a coluna ligado.
  assert(
    !/\bligado\b/.test(a.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''")),
    "188a nao exige ligado = true",
  );
});

Deno.test("188m: medicao so de catalogo e estatistica, UM statement, sem pg_stats e sem o comando dos jobs", () => {
  const sql = CONSULTA(M188);
  assertEquals(contarStatements(sql), 1);
  const cod = sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
  assert(!/\bpg_stats\b/.test(cod), "pg_stats le amostra de valores (dado)");
  assert(!/\bcommand\b/.test(cod), "nao le o comando dos jobs");
  assert(
    !new RegExp(`\\bFROM\\s+(public\\.)?(${TABELAS.join("|")})\\b`, "i").test(
      cod,
    ),
    "nao le linha das 17",
  );
  for (const trecho of [
    "pg_stat_user_tables",
    "n_tup_upd",
    "n_tup_hot_upd",
    "n_tup_del",
    "n_live_tup",
    "stats_reset",
    "pg_relation_size",
    "reltuples",
    "pg_database_size",
    "pg_total_relation_size",
    "pg_extension",
    "cron.job",
    "server_version_num",
    "pg_trigger",
  ])
    assertStringIncludes(sql, trecho);
  for (const t of TABELAS) assertStringIncludes(sql, `'${t}'`);
});

Deno.test("registro: lote de UMA migration em provasDeObjetos (188a depois, 188b antes) logo depois da fila, menu do conferir-banco-da-loja (188a/188b/188m), dois caminhos do rpc-ci, portao de rol fechado e as provas vivas no rpc-ci", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const lotes = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261510000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].versoes, ["20261510000000"]);
  assertEquals(lotes[0].consulta, A188);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B188);
  assert(
    !("backfillLedger" in lotes[0]) &&
      !("nuncaAplicar" in lotes[0]) &&
      !("soNosRefs" in lotes[0]),
  );
  const iLivro = canais.provasDeObjetos.findIndex((l) => l.consulta === A188);
  const iFornecedores = canais.provasDeObjetos.findIndex(
    (l) => l.consulta === "181a-conferir-os-fornecedores-aplicado",
  );
  assert(iLivro > iFornecedores && iFornecedores >= 0, "depois da 20261450");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    new URL("../scripts/frota/publicar-release.mjs", import.meta.url).href
  );
  const menu = (
    await Deno.readTextFile(
      `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`,
    )
  ).replace(/\r/g, "");
  const rpc = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  for (const nome of [A188, B188]) {
    assert(CONSULTAS_DE_ROL_FECHADO.has(nome), `${nome} fora do rol fechado`);
    assertStringIncludes(menu, `          - ${nome}\n`);
  }
  assertStringIncludes(menu, `          - ${M188}\n`);
  assert(!CONSULTAS_DE_ROL_FECHADO.has(M188), "188m e' medicao (rol aberto)");
  for (const nome of [A188, B188, M188])
    assertEquals(
      rpc.split(`"scripts/publicacao/consultas/${nome}.sql"`).length - 1,
      2,
      `${nome}: nos dois caminhos do rpc-ci`,
    );
  for (const prova of [
    "o-livro-de-registro-viva.cjs",
    "o-livro-de-registro-portao-viva.cjs",
    "o-livro-de-registro-desfazer-ensaio-viva.cjs",
  ])
    assertStringIncludes(
      rpc,
      `run: node tests/banco/rodar-isolado.cjs tests/banco/${prova}`,
    );
});

Deno.test("LGPD: o bloco anonimizar do roteiro apaga o livro da cliente DEPOIS dos UPDATEs de public, protegido por to_regclass e contado no relatorio", async () => {
  const md = (
    await Deno.readTextFile(
      `${RAIZ}/docs/runbooks/atender-pedido-de-privacidade.md`,
    )
  ).replace(/\r/g, "");
  const bloco = md.slice(
    md.indexOf("-- BLOCO: anonimizar"),
    md.indexOf("$anonimizar$;"),
  );
  const iPurga = bloco.indexOf(
    "DELETE FROM public.livro_de_registro WHERE titular = v_id;",
  );
  assert(iPurga > 0, "a purga do livro no bloco anonimizar");
  for (const update of [
    "UPDATE public.marketplace_orders",
    "UPDATE public.devolucoes",
    "UPDATE public.profiles",
    "UPDATE public.analytics_events",
  ])
    assert(bloco.indexOf(update) < iPurga, `purga depois de ${update}`);
  assert(
    bloco.lastIndexOf(
      "IF to_regclass('public.livro_de_registro') IS NOT NULL THEN",
      iPurga,
    ) > 0,
    "protegido por to_regclass",
  );
  assertStringIncludes(bloco.slice(iPurga), "v_rel := v_rel || format(");
});

Deno.test("o roteiro de desfazer tem os quatro blocos, cada um com ENSAIO (v_confirmar false)", async () => {
  const md = (
    await Deno.readTextFile(
      `${RAIZ}/docs/runbooks/desfazer-pelo-livro-de-registro.md`,
    )
  ).replace(/\r/g, "");
  const blocos = Object.fromEntries(
    [...md.matchAll(/```sql\n-- BLOCO: ([\w-]+)\n([\s\S]*?)```/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
  assertEquals(Object.keys(blocos).sort(), [
    "achar",
    "desfazer-transacao",
    "restaurar-apagada",
    "valor-no-instante",
  ]);
  for (const nome of ["restaurar-apagada", "desfazer-transacao"]) {
    assertEquals(
      blocos[nome].split("v_confirmar boolean := false;").length - 1,
      1,
      `${nome}: ENSAIO por padrao`,
    );
    assertStringIncludes(blocos[nome], "ENSAIO");
  }
  assertStringIncludes(blocos["restaurar-apagada"], "jsonb_populate_record");
  assertStringIncludes(blocos["desfazer-transacao"], "PARADO");
  for (const nome of ["achar", "valor-no-instante"]) {
    const cod = blocos[nome].replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(!/\b(INSERT|UPDATE|DELETE)\b/.test(cod), `${nome}: so leitura`);
  }
});
