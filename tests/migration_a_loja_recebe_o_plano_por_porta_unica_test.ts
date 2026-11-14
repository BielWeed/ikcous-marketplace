// @ts-nocheck
/* eslint-disable security/detect-object-injection -- os indices vem de listas fechadas deste arquivo, nunca de entrada de rede. */
/* eslint-disable security/detect-unsafe-regex -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), então não há ReDoS possível; mesma razão dos outros testes migration_*. */
// A LOJA RECEBE O PLANO POR UMA PORTA UNICA — leitura do TEXTO do par 20261399998000 + rollback-manual (decisao do socio, 13/11/2026).
// O COMPORTAMENTO (autenticacao pelo hash, lista branca, mais velho, simular, tipos, ACL por papel, corrida de duas conexoes, reaplicar, rollback,
// pre/pos-voo) e' provado no Postgres efemero por tests/banco/a-loja-recebe-o-plano-por-porta-unica-viva.cjs; aqui ficam as ancoras que se leem
// do arquivo, sem banco:
//   - a migration e' ADITIVA e SEM transacao propria (regra da casa); cria 1 tabela e 2 funcoes; nada existente e' redefinido nem apagado;
//   - a tabela da chave nasce selada (RLS sem politica, nenhum privilegio) e guarda so o HASH;
//   - a porta autentica ANTES de olhar p_dados, com UMA excecao, e a lista branca e' exatamente o cartao menos id, recursos e observacao;
//   - o corpo da porta NUNCA escreve recursos nem observacao e nao monta SQL dinamico;
//   - o rollback cita EXATAMENTE os objetos que a migration cria e recusa corpo desconhecido.
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
const NOME = "20261399998000_a_loja_recebe_o_plano_por_porta_unica.sql";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const migration = lerMig(NOME);
const rollback = lerMig(`rollback-manual-${NOME}`);
const tabelaDoCartao = lerMig("20261177000000_o_financeiro_da_loja_nasce.sql");

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const contar = (texto: string, trecho: string) =>
  texto.split(trecho).length - 1;
const semComentario = (s: string) => s.replace(/--.*$/gm, "");

/** O corpo (prosrc) da funcao: o texto entre os dois $function$ do CREATE OR REPLACE dela. */
function corpoDe(sql: string, funcao: string): string {
  const marca = `CREATE OR REPLACE FUNCTION public.${funcao}(`;
  assertEquals(contar(sql, marca), 1, `uma definicao de ${funcao}`);
  const ini = sql.indexOf(marca);
  const abre = sql.indexOf("AS $function$", ini) + "AS $function$".length;
  return sql.slice(abre, sql.indexOf("$function$;", abre));
}
/** O bloco `DO $tag$ ... END $tag$;` da migration. */
function blocoDo(sql: string, tag: string): string {
  const i = sql.indexOf(`DO $${tag}$`);
  assert(i >= 0, `bloco ${tag} ausente`);
  const fim = sql.indexOf(`END $${tag}$;`, i);
  assert(fim > i, `fim do bloco ${tag} ausente`);
  return sql.slice(i, fim + `END $${tag}$;`.length);
}
/** A migration sem comentario, sem corpo de funcao e sem bloco DO: so os comandos de nivel superior. */
function soComandos(sql: string): string {
  return sql
    .replace(/\$function\$[\s\S]*?\$function\$/g, "$function$$function$")
    .replace(/DO \$(\w+)\$[\s\S]*?END \$\1\$;/g, "")
    .replace(/--.*$/gm, "")
    .replace(/'[^']*'/g, "''");
}

const CORPO_GRAVAR = corpoDe(migration, "assinatura_da_loja_gravar");
const CORPO_DEFINIR = corpoDe(migration, "assinatura_da_loja_definir_chave");
const H_GRAVAR = md5(CORPO_GRAVAR);
const H_DEFINIR = md5(CORPO_DEFINIR);

Deno.test("20261399998: o par nao abre nem fecha transacao e passa a Fase 0 do db-prove-rollback", () => {
  for (const [rotulo, sql] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(
      t.achados,
      [],
      `${rotulo} tem controle de transacao: ${t.achados.join("/")}`,
    );
  }
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  // CRLF do Windows: os hashes sao de replace(prosrc, E'\r', ''), e o texto do arquivo e' LF
  assert(!migration.includes("\r"));
});

Deno.test("20261399998: ADITIVA - so cria 1 tabela e 2 funcoes novas; nada existente e' redefinido, apagado ou regravado", () => {
  const cod = soComandos(migration);
  const criados = [
    ...cod.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?(\w+(?:\s+\w+)?)\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(\w+)/gi,
    ),
  ].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  assertEquals(criados, [
    "TABLE assinatura_da_loja_chave",
    "FUNCTION assinatura_da_loja_definir_chave",
    "FUNCTION assinatura_da_loja_gravar",
  ]);
  for (const proibido of [
    /\bDROP\b/i,
    /\bDELETE\b/i,
    /\bTRUNCATE\b/i,
    /\bUPDATE\b/i,
    /\bINSERT\b/i,
    /CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i,
    /CREATE\s+POLICY/i,
    /CREATE\s+(UNIQUE\s+)?INDEX/i,
    /ALTER\s+DEFAULT/i,
    /CREATE\s+EXTENSION/i,
    /ALTER\s+TABLE\s+public\.assinatura_da_loja(?![a-z_])/i,
  ]) {
    assert(
      !proibido.test(cod),
      `comando de nivel superior proibido: ${proibido}`,
    );
  }
  const alters = cod.match(/ALTER\s+[^;]*;/gi) ?? [];
  assertEquals(alters.map(norm), [
    "ALTER TABLE public.assinatura_da_loja_chave ENABLE ROW LEVEL SECURITY;",
  ]);
  // a tabela do cartao e a RPC de leitura nao sao tocadas
  assert(
    !/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.assinatura_da_loja_ler/i.test(
      migration,
    ),
  );
  assertEquals(
    [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(
      (m) => m[1],
    ),
    ["assinatura_da_loja_definir_chave", "assinatura_da_loja_gravar"],
  );
});

Deno.test("20261399998: a tabela da chave guarda so o HASH, nasce selada (RLS sem politica e nenhum privilegio) e a linha e' unica", () => {
  const n = norm(migration);
  assertStringIncludes(
    n,
    "CREATE TABLE IF NOT EXISTS public.assinatura_da_loja_chave (",
  );
  assertStringIncludes(n, "id smallint NOT NULL DEFAULT 1,");
  assertStringIncludes(n, "chave_hash text NOT NULL,");
  assertStringIncludes(n, "criada_em timestamptz NOT NULL DEFAULT now(),");
  assertStringIncludes(
    n,
    "CONSTRAINT assinatura_da_loja_chave_pkey PRIMARY KEY (id)",
  );
  assertStringIncludes(n, "CHECK (id = 1)");
  assertStringIncludes(n, "CHECK (chave_hash ~ '^[0-9a-f]{64}$')");
  assertStringIncludes(
    n,
    "ALTER TABLE public.assinatura_da_loja_chave ENABLE ROW LEVEL SECURITY;",
  );
  assertStringIncludes(
    n,
    "REVOKE ALL ON TABLE public.assinatura_da_loja_chave FROM PUBLIC, anon, authenticated, service_role;",
  );
  const cod = soComandos(migration);
  assert(
    cod.indexOf("CREATE TABLE IF NOT EXISTS public.assinatura_da_loja_chave") <
      cod.indexOf("REVOKE ALL ON TABLE public.assinatura_da_loja_chave"),
  );
  assert(
    !/GRANT\s+[A-Z, ]+\s+ON\s+(TABLE\s+)?public\.assinatura_da_loja_chave/i.test(
      cod.replace(/REVOKE[^;]*;/g, ""),
    ),
    "nenhum GRANT na tabela da chave",
  );
  assert(!/CREATE\s+POLICY/i.test(cod), "sem politica: a RLS fecha tudo");
  assert(
    !/FORCE\s+ROW\s+LEVEL/i.test(cod),
    "sem FORCE: o dono (a funcao SECURITY DEFINER) precisa passar",
  );
});

Deno.test("20261399998: ACL - definir_chave SO do service_role; a porta SO de anon e authenticated; REVOKE antes do GRANT; nada para PUBLIC", () => {
  const n = norm(migration);
  const revD =
    "REVOKE ALL ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) FROM PUBLIC, anon, authenticated, service_role;";
  const granD =
    "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) TO service_role;";
  const revG =
    "REVOKE ALL ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;";
  const granG =
    "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) TO anon, authenticated;";
  for (const t of [revD, granD, revG, granG]) assertEquals(contar(n, t), 1, t);
  assert(
    n.indexOf(revD) < n.indexOf(granD) && n.indexOf(revG) < n.indexOf(granG),
    "REVOKE antes do GRANT (ACL deterministica)",
  );
  const cod = soComandos(migration);
  assert(!/GRANT[^;]*\bPUBLIC\b/.test(cod), "nada e' concedido a PUBLIC");
  assertEquals(
    (cod.match(/GRANT[^;]*;/g) ?? []).length,
    2,
    "so dois GRANT na migration inteira",
  );
  const grantsDefinir = (
    cod.match(/GRANT[^;]*definir_chave[^;]*;/g) ?? []
  ).join(" ");
  assert(
    /\bservice_role\b/.test(grantsDefinir) &&
      !/\banon\b|\bauthenticated\b/.test(grantsDefinir),
    "definir_chave: so service_role",
  );
  const grantsGravar = (
    cod.match(/GRANT[^;]*assinatura_da_loja_gravar[^;]*;/g) ?? []
  ).join(" ");
  assert(
    /\banon\b/.test(grantsGravar) &&
      /\bauthenticated\b/.test(grantsGravar) &&
      !/service_role/.test(grantsGravar),
    "a porta: anon e authenticated, nunca service_role",
  );
});

Deno.test("20261399998: as duas funcoes sao SECURITY DEFINER com search_path fixo e VOLATILE", () => {
  const n = norm(migration);
  assertStringIncludes(
    n,
    "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_definir_chave(p_hash text, p_substituir boolean DEFAULT false) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $function$",
  );
  assertStringIncludes(
    n,
    "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $function$",
  );
  // nenhuma outra funcao de nivel superior: so as duas, ambas SECURITY DEFINER (fora de comentario e de texto de COMMENT)
  assertEquals(
    contar(soComandos(migration).replace(/\s+/g, " "), "SECURITY DEFINER"),
    2,
  );
});

Deno.test("20261399998: a porta AUTENTICA ANTES de olhar p_dados, com UMA excecao so, e compara o HASH (nunca o texto da chave)", () => {
  const c = norm(CORPO_GRAVAR);
  assertStringIncludes(
    c,
    "v_enviado := encode(sha256(convert_to(COALESCE(p_chave, ''), 'UTF8')), 'hex');",
  );
  assertStringIncludes(
    c,
    "IF v_guardado IS NULL OR p_chave IS NULL OR p_chave = '' OR v_enviado <> v_guardado THEN RAISE EXCEPTION 'nao_autorizado' USING ERRCODE = '42501'; END IF;",
  );
  assertEquals(
    contar(CORPO_GRAVAR, "'nao_autorizado'"),
    1,
    "uma unica excecao de autorizacao",
  );
  assert(
    !/p_chave\s*=\s*v_guardado|v_guardado\s*=\s*p_chave|p_chave\s*<>\s*v_guardado/.test(
      CORPO_GRAVAR,
    ),
    "a chave nunca e' comparada em texto cru",
  );
  const iHash = CORPO_GRAVAR.indexOf("sha256(");
  const iNegado = CORPO_GRAVAR.indexOf("'nao_autorizado'");
  // nenhum acesso a p_dados antes da excecao de autorizacao
  const antes = semComentario(CORPO_GRAVAR.slice(0, iNegado));
  assert(iHash >= 0 && iHash < iNegado);
  assert(!/p_dados/.test(antes), "p_dados so e' lido DEPOIS de autenticar");
  assert(!/p_simular/.test(antes), "p_simular so e' lido DEPOIS de autenticar");
  // a chave nunca vai para uma mensagem, para o DETAIL nem para um log
  assert(
    !/RAISE\s+(NOTICE|WARNING|LOG|INFO|DEBUG)\b/i.test(CORPO_GRAVAR),
    "nenhum RAISE de log: a chave nao pode vazar",
  );
  for (const m of CORPO_GRAVAR.matchAll(/RAISE EXCEPTION[^;]*;/g)) {
    assert(
      !/p_chave|v_enviado|v_guardado/.test(m[0]),
      `a excecao cita a chave ou o hash: ${m[0]}`,
    );
    assert(
      !/p_dados\s*->>?\s*'/.test(m[0]),
      `a excecao devolve valor do dado: ${m[0]}`,
    );
  }
});

Deno.test("20261399998: a lista branca e' EXATAMENTE as colunas do cartao menos id, recursos e observacao (e a tabela do cartao ainda as tem)", () => {
  const criar =
    /CREATE TABLE IF NOT EXISTS public\.assinatura_da_loja \(([\s\S]*?)\n\);/.exec(
      tabelaDoCartao,
    );
  assert(criar, "CREATE TABLE do cartao nao achado");
  const colunas = [...criar[1].matchAll(/^\s{2}([a-z_]+)\s/gm)].map(
    (m) => m[1],
  );
  const esperadas = colunas
    .filter((c) => !["id", "recursos", "observacao"].includes(c))
    .sort();
  const m = /v_chaves CONSTANT text\[\] := ARRAY\[([^\]]*)\];/.exec(
    CORPO_GRAVAR,
  );
  assert(m, "v_chaves nao achada");
  const lista = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  assertEquals(lista, esperadas);
  assertEquals(lista.length, 10);
  // todas obrigatorias e todas conferidas uma a uma: cada campo aparece no INSERT e no UPDATE
  for (const campo of lista) {
    assertStringIncludes(CORPO_GRAVAR, `${campo} = EXCLUDED.${campo}`);
  }
  assertEquals(
    (CORPO_GRAVAR.match(/^\s+\w+ = EXCLUDED\.\w+,?$/gm) ?? []).length,
    10,
    "o UPDATE reescreve exatamente os 10 campos",
  );
});

Deno.test("20261399998: o corpo da porta NUNCA escreve recursos nem observacao, nao apaga, nao monta SQL dinamico e so escreve na linha 1", () => {
  const corpo = semComentario(CORPO_GRAVAR);
  assert(
    !/\brecursos\b/.test(corpo),
    "recursos nao aparece no corpo (fora de comentario)",
  );
  assert(
    !/\bobservacao\b/.test(corpo),
    "observacao nao aparece no corpo (fora de comentario)",
  );
  assert(
    !/\bDELETE\b|\bTRUNCATE\b|\bDROP\b|\bEXECUTE\b|\bformat\s*\(/i.test(corpo),
    "sem delete/truncate/drop/SQL dinamico",
  );
  assertEquals(contar(corpo, "INSERT INTO"), 1, "uma unica escrita");
  assertEquals(
    contar(corpo, "UPDATE"),
    1,
    "o DO UPDATE do ON CONFLICT e' o unico update",
  );
  assertStringIncludes(
    norm(corpo),
    "VALUES (1, v_plano, v_status, v_ciclo, v_valor,",
  );
  // o arbitro da corrida e' o WHERE do ON CONFLICT (atomico), nao uma leitura antes
  assertStringIncludes(norm(corpo), "ON CONFLICT (id) DO UPDATE SET");
  assertStringIncludes(
    norm(corpo),
    "WHERE a.atualizado_em <= EXCLUDED.atualizado_em; GET DIAGNOSTICS v_linhas = ROW_COUNT; IF v_linhas = 0 THEN RETURN jsonb_build_object('gravado', false, 'motivo', 'mais_velho'); END IF;",
  );
  // simular nao escreve: o ramo de simulacao termina em RETURN antes do INSERT
  const iSimular = corpo.indexOf("IF p_simular THEN");
  const iInsert = corpo.indexOf("INSERT INTO public.assinatura_da_loja");
  assert(iSimular >= 0 && iInsert > iSimular);
  const ramo = corpo.slice(iSimular, iInsert);
  assert(
    !/\bINSERT\b|\bUPDATE\b/.test(ramo),
    "o ramo de simulacao nao escreve",
  );
  assertStringIncludes(
    norm(ramo),
    "RETURN jsonb_build_object('gravado', false, 'simulado', true,",
  );
  // as regras: simular nulo recusado, futuro recusado, lista branca antes dos tipos
  assertStringIncludes(corpo, "IF p_simular IS NULL THEN");
  assertStringIncludes(
    corpo,
    "IF v_instante > clock_timestamp() + interval '1 day' THEN",
  );
  assert(
    corpo.indexOf("campo_nao_permitido") < corpo.indexOf("campo_ausente") &&
      corpo.indexOf("campo_ausente") <
        corpo.indexOf("jsonb_typeof(p_dados -> 'plano')"),
  );
});

Deno.test("20261399998: definir_chave valida o hash (64 hex minusculos), nao substitui sem pedir e a rotacao e' explicita; so le/escreve a tabela da chave", () => {
  const c = norm(CORPO_DEFINIR);
  assertStringIncludes(
    c,
    "IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'hash_invalido' USING ERRCODE = '22023'; END IF;",
  );
  assertStringIncludes(c, "IF p_substituir IS TRUE THEN");
  assertStringIncludes(c, "ON CONFLICT (id) DO NOTHING;");
  assertStringIncludes(
    c,
    "RAISE EXCEPTION 'chave_ja_definida' USING ERRCODE = '23505';",
  );
  const corpo = semComentario(CORPO_DEFINIR);
  assert(
    !/assinatura_da_loja\b(?!_chave)/.test(corpo),
    "definir_chave nao toca o cartao",
  );
  assert(!/\bDELETE\b|\bTRUNCATE\b|\bEXECUTE\b/i.test(corpo));
  assert(
    !/RETURN\s+\S/.test(corpo.replace(/RETURN;/g, "")),
    "devolve void: nada sai da funcao",
  );
});

Deno.test("20261399998: pre-voo ANTES de qualquer CREATE, pos-voo DEPOIS dos GRANT, NOTIFY por ultimo, lock_timeout de 5 s", () => {
  assertStringIncludes(migration, "SET LOCAL lock_timeout = '5s';");
  assertStringIncludes(migration, "SET LOCAL statement_timeout = '30s';");
  const pre = blocoDo(migration, "preflight_20261399998000");
  const pos = blocoDo(migration, "conferencia_20261399998000");
  assert(
    migration.indexOf(pre) <
      migration.indexOf(
        "CREATE TABLE IF NOT EXISTS public.assinatura_da_loja_chave (",
      ),
  );
  for (const premissa of [
    "public.assinatura_da_loja",
    "public.store_config",
    "'store_name'",
    "pg_roles",
    "sobrecarga",
    "corpo desconhecido",
  ])
    assertStringIncludes(pre, premissa);
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  assert(
    migration.indexOf(pos) >
      migration.indexOf(
        "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_gravar",
      ),
  );
  assertStringIncludes(pos, "B2_POSVOO_DIVERGENTE");
  for (const marca of [
    "relrowsecurity",
    "relforcerowsecurity",
    "pg_policy",
    "has_table_privilege",
    "has_any_column_privilege",
    "has_function_privilege",
    "aclexplode",
    "proconfig",
    "prosecdef",
    "provolatile",
    "rolbypassrls",
    "'anon'",
    "'authenticated'",
    "'service_role'",
  ])
    assertStringIncludes(pos, marca);
  // catalogo apenas: o pos-voo nao chama as funcoes (chamar a porta mexeria no cartao REAL da loja)
  assert(
    !/assinatura_da_loja_gravar\s*\(\s*'/.test(pos) &&
      !/SELECT\s+public\.assinatura_da_loja_(gravar|definir_chave)\s*\(/i.test(
        pos,
      ),
    "o pos-voo nao chama as funcoes",
  );
  assert(
    !/\bINSERT\b|\bUPDATE\b|\bDELETE\b/.test(
      semComentario(pos).replace(/'[^']*'/g, "''"),
    ),
    "o pos-voo so le o catalogo",
  );
  assertStringIncludes(
    migration.trimEnd().split("\n").pop() ?? "",
    "NOTIFY pgrst, 'reload schema';",
  );
});

Deno.test("20261399998: o md5 dos DOIS corpos esta no pre-voo e no pos-voo (1x cada), no rollback (1x cada) e na consulta 150c (1x cada)", () => {
  const c150 = Deno.readTextFileSync(
    `${RAIZ}/scripts/publicacao/consultas/150c-conferir-a-loja-recebe-o-plano-por-porta-unica-aplicado.sql`,
  ).replace(/\r/g, "");
  for (const h of [H_GRAVAR, H_DEFINIR]) {
    assertEquals(
      contar(blocoDo(migration, "preflight_20261399998000"), `'${h}'`),
      1,
      `pre-voo: ${h}`,
    );
    assertEquals(
      contar(blocoDo(migration, "conferencia_20261399998000"), `'${h}'`),
      1,
      `pos-voo: ${h}`,
    );
    assertEquals(contar(migration, `'${h}'`), 2, `migration: ${h}`);
    assertEquals(contar(rollback, `'${h}'`), 1, `rollback: ${h}`);
    assertEquals(contar(c150, `'${h}'`), 1, `150c: ${h}`);
  }
  assert(
    contar(migration, "md5(replace(prosrc, E'\\r', ''))") >= 2,
    "pre-voo e pos-voo normalizam o CR",
  );
});

Deno.test("20261399998: o rollback derruba EXATAMENTE as duas funcoes e a tabela da chave (funcoes primeiro, sem CASCADE) e recusa corpo desconhecido", () => {
  const criadas = [
    ...migration.matchAll(
      /CREATE OR REPLACE FUNCTION (public\.\w+)\(([^)]*)\)/g,
    ),
  ].map(
    (m) =>
      `${m[1]}(${m[2]
        .split(",")
        .map((p) => p.trim().split(" ")[1])
        .join(", ")})`,
  );
  assertEquals(criadas, [
    "public.assinatura_da_loja_definir_chave(text, boolean)",
    "public.assinatura_da_loja_gravar(text, jsonb, boolean)",
  ]);
  const cod = soComandos(rollback);
  const drops = [
    ...cod.matchAll(/DROP\s+(\w+)\s+IF\s+EXISTS\s+([^;]+);/gi),
  ].map((m) => `${m[1].toUpperCase()} ${norm(m[2])}`);
  assertEquals(drops, [
    "FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean)",
    "FUNCTION public.assinatura_da_loja_definir_chave(text, boolean)",
    "TABLE public.assinatura_da_loja_chave",
  ]);
  assert(!/CASCADE/i.test(semComentario(rollback)), "sem CASCADE");
  assert(
    !/TRUNCATE|DELETE|UPDATE|INSERT/i.test(cod),
    "o rollback so apaga o que a migration criou",
  );
  // nunca toca o cartao nem a RPC de leitura
  assert(
    !/public\.assinatura_da_loja(?![a-z_])/.test(cod),
    "o rollback nao toca public.assinatura_da_loja",
  );
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(rollback, "SET LOCAL lock_timeout = '5s';");
  const conf = blocoDo(rollback, "conferencia_rollback_20261399998000");
  for (const nome of [
    "assinatura_da_loja_gravar",
    "assinatura_da_loja_definir_chave",
    "assinatura_da_loja_chave",
  ])
    assertStringIncludes(conf, nome);
  // o aviso do que se perde esta escrito
  assertStringIncludes(rollback, "SE PERDE");
});

Deno.test("20261399998: a porta esta na lista das portas abertas ao visitante, com o porque; definir_chave (so service_role) nao entra", () => {
  const lista = JSON.parse(
    Deno.readTextFileSync(
      `${RAIZ}/tests/banco/portas-do-visitante-permitidas.json`,
    ),
  );
  const linhas = lista.funcoes.filter((f: { funcao: string }) =>
    f.funcao.startsWith("public.assinatura_da_loja_"),
  );
  const gravar = linhas.find(
    (f: { funcao: string }) =>
      f.funcao ===
      "public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean)",
  );
  assert(gravar, "a porta nao esta na lista");
  assertEquals(gravar.executa, ["anon", "authenticated"]);
  assertEquals(gravar.secdef, true);
  assertEquals(gravar.tipo, "volatil");
  assert(
    !linhas.some((f: { funcao: string }) => f.funcao.includes("definir_chave")),
    "definir_chave e' so do service_role: classe fechada",
  );
});

Deno.test("150c/150d (rol fechado de 8 e 4 linhas), canais-de-backend, menu do conferir-banco, rpc-ci (2 caminhos + a prova) e db-apply registram a migration", async () => {
  const {
    contarStatements,
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO, lerCanais } = await import(
    new URL("../scripts/frota/publicar-release.mjs", import.meta.url).href
  );
  const A = "150c-conferir-a-loja-recebe-o-plano-por-porta-unica-aplicado";
  const B = "150d-antes-a-loja-recebe-o-plano-por-porta-unica-ausente";
  assertEquals(ROL_FECHADO_POR_CONSULTA[A]?.length, 8);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B]?.length, 4);
  const menu = Deno.readTextFileSync(
    `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`,
  ).replace(/\r/g, "");
  const rpc = Deno.readTextFileSync(
    `${RAIZ}/.github/workflows/rpc-ci.yml`,
  ).replace(/\r/g, "");
  for (const nome of [A, B]) {
    const sql = Deno.readTextFileSync(
      `${RAIZ}/scripts/publicacao/consultas/${nome}.sql`,
    );
    assertEquals(contarStatements(sql), 1, `${nome}: UM statement`);
    const rol = ROL_FECHADO_POR_CONSULTA[nome];
    assertEquals(new Set(rol).size, rol.length, `${nome}: rotulo repetido`);
    for (const item of rol) assertStringIncludes(sql, `'${item}'`);
    const rotulos = [...sql.matchAll(/SELECT '([^']+)', '(?:sim|nao)'/g)].map(
      (m) => m[1],
    );
    assertEquals(
      rotulos.sort(),
      [...rol].sort(),
      `${nome}: rotulos do SQL != rol`,
    );
    // so catalogo: nenhuma linha da chave nem do cartao, nenhuma escrita, nenhuma chamada das funcoes
    const codigo = sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/.test(
        codigo,
      ),
      `${nome}: so leitura`,
    );
    assert(
      !/\bFROM\s+(public\.)?assinatura_da_loja(_chave)?\b/i.test(codigo),
      `${nome}: nao le linha da chave nem do cartao`,
    );
    assert(
      !/assinatura_da_loja_(gravar|definir_chave)\s*\(/i.test(
        codigo.replace(/'[^']*'/g, ""),
      ),
      `${nome}: nao chama as funcoes`,
    );
    assert(
      CONSULTAS_DE_ROL_FECHADO.has(nome),
      `${nome} fora de CONSULTAS_DE_ROL_FECHADO`,
    );
    assertStringIncludes(menu, `          - ${nome}\n`);
    assertEquals(
      rpc.split(`"scripts/publicacao/consultas/${nome}.sql"`).length - 1,
      2,
      `${nome}: nas duas listas de caminhos do rpc-ci`,
    );
  }
  assertEquals(
    contar(
      rpc,
      "node tests/banco/rodar-isolado.cjs tests/banco/a-loja-recebe-o-plano-por-porta-unica-viva.cjs",
    ),
    1,
  );
  const lote = lerCanais().provasDeObjetos.find(
    (p: { consulta: string }) => p.consulta === A,
  );
  assert(lote, "lote ausente em canais-de-backend.json");
  assertEquals(lote.versoes, ["20261399998000"]);
  assertEquals(lote.ausenciaConfirmadaPor, B);
  assertEquals(lote.backfillLedger, undefined);
  assertEquals(lote.nuncaAplicar, undefined);
  assertStringIncludes(lote._comentario, "revisao Opus");
  assertStringIncludes(lote._comentario, "ROLLBACK");
  const dbApply = Deno.readTextFileSync(`${RAIZ}/scripts/db-apply.cjs`);
  assertStringIncludes(dbApply, `"${NOME}": [`);
});
