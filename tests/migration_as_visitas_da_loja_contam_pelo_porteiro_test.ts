// @ts-nocheck
// AS VISITAS DA LOJA CONTAM PELO PORTEIRO — leitura do TEXTO do trio 20261399000000 + rollback comum + rollback destrutivo
// (spec "Visitas da loja", linha B; 02/11/2026). O COMPORTAMENTO (soma, teto, canal invalido, ACL por papel, dia de Sao Paulo,
// concorrencia, reaplicar, rollback) e' provado no Postgres efemero por tests/banco/as-visitas-da-loja-viva.cjs; aqui ficam as
// ancoras que se leem do arquivo, sem banco:
//   - a migration e' ADITIVA e SEM transacao propria (regra da casa), a tabela nasce selada e a unica porta do visitante e' contar_entrada;
//   - a ameaca que o texto tem de impedir: quem so tem a chave publica NAO le, NAO escolhe data, NAO grava texto e NAO cria linha alem
//     de 5 por dia, e cada contador para em 50000;
//   - o rollback comum e o destrutivo citam EXATAMENTE os objetos que a migration cria.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0, detectarTransacaoExplicita, removerRuido } = require(
  "../scripts/db-prove-rollback.cjs",
);

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261399000000_as_visitas_da_loja_contam_pelo_porteiro.sql";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${DIR}../supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const migration = lerMig(NOME);
const rollback = lerMig(`rollback-manual-${NOME}`);
const destrutivo = lerMig(`rollback-manual-destrutivo-${NOME}`);

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const contar = (texto: string, trecho: string) =>
  texto.split(trecho).length - 1;

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

const CORPO_CONTAR = corpoDe(migration, "contar_entrada");
const CORPO_CRM = corpoDe(migration, "crm_visitas");
const H_CONTAR = md5(CORPO_CONTAR);
const H_CRM = md5(CORPO_CRM);
const CANAIS = ["direto", "instagram", "whatsapp", "outros_sites", "previa"];

Deno.test("20261399: o trio nao abre nem fecha transacao e passa a Fase 0 do db-prove-rollback", () => {
  for (const [rotulo, sql] of [
    ["migration", migration],
    ["rollback comum", rollback],
    ["rollback destrutivo", destrutivo],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${rotulo} tem controle de transacao: ${t.achados.join("/")}`);
  }
  for (const rb of [rollback, destrutivo]) {
    const r = avaliarFase0({
      sqlMigration: migration,
      sqlRollback: rb,
      temRollback: true,
    });
    assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  }
});

Deno.test("20261399: a tabela nasce com o formato da spec, RLS ligada, sem politica e fechada a todo papel de aplicacao", () => {
  const n = norm(migration);
  assertStringIncludes(n, "CREATE TABLE IF NOT EXISTS public.visitas_por_dia (");
  assertStringIncludes(n, "dia date NOT NULL,");
  assertStringIncludes(n, "canal text NOT NULL,");
  assertStringIncludes(n, "contagem integer NOT NULL DEFAULT 0,");
  assertStringIncludes(n, "PRIMARY KEY (dia, canal)");
  // O CHECK dos 5 canais, na ordem da spec, e o CHECK de contagem nao negativa.
  assertStringIncludes(
    n,
    "CHECK (canal IN ('direto', 'instagram', 'whatsapp', 'outros_sites', 'previa'))",
  );
  assertStringIncludes(n, "CHECK (contagem >= 0)");
  assertStringIncludes(
    n,
    "ALTER TABLE public.visitas_por_dia ENABLE ROW LEVEL SECURITY;",
  );
  // A tabela nasce selada: o REVOKE fecha PUBLIC, anon e authenticated (e service_role, que o Supabase abre por padrao em objeto novo).
  assertStringIncludes(
    n,
    "REVOKE ALL ON TABLE public.visitas_por_dia FROM PUBLIC, anon, authenticated, service_role;",
  );
  // O REVOKE vem depois do CREATE e nenhum GRANT de tabela existe: a unica porta e' a funcao.
  const cod = soComandos(migration);
  assert(
    cod.indexOf("CREATE TABLE IF NOT EXISTS public.visitas_por_dia") <
      cod.indexOf("REVOKE ALL ON TABLE public.visitas_por_dia"),
  );
  assert(!/GRANT\s+[A-Z, ]+\s+ON\s+(TABLE\s+)?public\.visitas_por_dia/i.test(cod.replace(/REVOKE[^;]*;/g, "")), "nenhum GRANT na tabela");
  assert(!/CREATE\s+POLICY/i.test(cod), "tabela sem politica: a RLS fecha tudo");
  assert(!/FORCE\s+ROW\s+LEVEL/i.test(cod), "sem FORCE: o dono (a funcao SECURITY DEFINER) precisa passar");
});

Deno.test("20261399: contar_entrada e' a UNICA porta do visitante: sem retorno, so o canal como argumento, SECURITY DEFINER com search_path fixo", () => {
  const n = norm(migration);
  assertStringIncludes(
    n,
    "CREATE OR REPLACE FUNCTION public.contar_entrada(p_canal text) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $function$",
  );
  // Nao devolve dado: nenhum RETURN com valor, nenhum SELECT, nenhum RETURNING, nenhum RAISE com dado da tabela.
  assert(!/\bRETURN\s+\S/i.test(CORPO_CONTAR), "contar_entrada nao devolve valor");
  assert(!/\bSELECT\b/i.test(CORPO_CONTAR), "contar_entrada nao le a tabela");
  assert(!/\bRETURNING\b/i.test(CORPO_CONTAR), "contar_entrada nao devolve a linha");
  // Nao aceita data nem texto livre: o unico argumento e' o canal, conferido contra a lista fechada ANTES de qualquer escrita.
  const assinaturas = [...migration.replace(/--.*$/gm, "").matchAll(/public\.contar_entrada\(([^)]*)\)/g)].map((m) => m[1]);
  assert(assinaturas.length > 0 && assinaturas.every((x) => x === "p_canal text" || x === "text"), `so a assinatura (p_canal text): ${assinaturas.join(" | ")}`);
  const iCheca = CORPO_CONTAR.indexOf("p_canal IS NULL OR p_canal NOT IN (");
  const iGrava = CORPO_CONTAR.indexOf("INSERT INTO public.visitas_por_dia");
  assert(iCheca >= 0 && iGrava > iCheca, "o canal e' conferido antes do INSERT");
  assertStringIncludes(
    norm(CORPO_CONTAR),
    "p_canal IS NULL OR p_canal NOT IN ('direto', 'instagram', 'whatsapp', 'outros_sites', 'previa')",
  );
  assertStringIncludes(CORPO_CONTAR, "ERRCODE = '22023'");
  // O que e' gravado vem da propria funcao: o dia de fin__hoje() (nunca de parametro, nunca do relogio do servidor sem fuso) e o canal ja validado.
  assertStringIncludes(norm(CORPO_CONTAR), "VALUES (public.fin__hoje(), p_canal, 1)");
  assert(!/\bp_dia\b|\bCURRENT_DATE\b|\bnow\s*\(|\bCURRENT_TIMESTAMP\b|\bLOCALTIMESTAMP\b/i.test(CORPO_CONTAR), "o dia nao vem de parametro nem de relogio sem fuso");
  assertEquals(contar(CORPO_CONTAR, "public.fin__hoje()"), 1);
  // Exatamente uma escrita, e ela so soma 1 e para no teto.
  assertEquals(contar(CORPO_CONTAR, "INSERT INTO"), 1);
  assertEquals(contar(CORPO_CONTAR, "UPDATE"), 1); // o DO UPDATE do ON CONFLICT
  assert(!/\bDELETE\b|\bTRUNCATE\b|\bEXECUTE\b|\bformat\s*\(/i.test(CORPO_CONTAR), "sem delete/truncate/SQL dinamico");
});

Deno.test("20261399: o teto de 50000 por canal e por dia mora no ON CONFLICT e e' o unico numero de limite", () => {
  const c = norm(CORPO_CONTAR);
  assertStringIncludes(
    c,
    "ON CONFLICT (dia, canal) DO UPDATE SET contagem = v.contagem + 1 WHERE v.contagem < 50000;",
  );
  assertEquals(contar(migration.replace(/--.*$/gm, ""), "50000"), 1, "o teto aparece uma vez no codigo");
});

Deno.test("20261399: crm_visitas tem as duas travas de admin de crm_visao, leitura estavel, previa fora de 'visitas'", () => {
  const n = norm(migration);
  assertStringIncludes(
    n,
    "CREATE OR REPLACE FUNCTION public.crm_visitas(p_inicio date, p_fim date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$",
  );
  const i1 = CORPO_CRM.indexOf("IF NOT public.is_admin() THEN");
  const i2 = CORPO_CRM.indexOf("IF NOT public.is_admin_atual() THEN");
  const i3 = CORPO_CRM.indexOf("p_inicio IS NULL OR p_fim IS NULL");
  assert(i1 >= 0 && i2 > i1 && i3 > i2, "as travas de admin vem antes de qualquer leitura, nesta ordem");
  assertEquals(contar(CORPO_CRM, "ERRCODE = '42501'"), 2);
  assertStringIncludes(CORPO_CRM, "ERRCODE = '22023'");
  assert(!/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i.test(CORPO_CRM), "crm_visitas so le");
  // As chaves do contrato com o painel.
  for (const chave of ["'contando_desde'", "'visitas'", "'canais'", "'previas'", "'periodo_completo'"])
    assertStringIncludes(CORPO_CRM, chave);
  // 'visitas' soma os 4 canais de PESSOA; a previa fica em 'previas'.
  const soma = /v_pessoas\s*:=\s*([^;]+);/.exec(CORPO_CRM);
  assert(soma, "v_pessoas calculada");
  assert(!/previa/.test(soma[1]), "a previa nao entra em visitas");
  for (const v of ["v_direto", "v_instagram", "v_whatsapp", "v_outros"]) assertStringIncludes(soma[1], v);
  // O contador comeca no primeiro dia gravado; antes dele ou com a tabela vazia, 'visitas' e' NULL (nunca zero).
  assertStringIncludes(norm(CORPO_CRM), "SELECT min(dia) INTO v_desde FROM public.visitas_por_dia;");
  assertStringIncludes(norm(CORPO_CRM), "IF v_desde IS NULL OR p_fim < v_desde THEN");
});

Deno.test("20261399: ACL das funcoes: contar_entrada para anon/authenticated/service_role, crm_visitas SEM anon, nada para PUBLIC", () => {
  const n = norm(migration);
  const revC = "REVOKE ALL ON FUNCTION public.contar_entrada(text) FROM PUBLIC, anon, authenticated, service_role;";
  const granC = "GRANT EXECUTE ON FUNCTION public.contar_entrada(text) TO anon, authenticated, service_role;";
  const revR = "REVOKE ALL ON FUNCTION public.crm_visitas(date, date) FROM PUBLIC, anon, authenticated, service_role;";
  const granR = "GRANT EXECUTE ON FUNCTION public.crm_visitas(date, date) TO authenticated, service_role;";
  for (const t of [revC, granC, revR, granR]) assertEquals(contar(n, t), 1, t);
  assert(n.indexOf(revC) < n.indexOf(granC) && n.indexOf(revR) < n.indexOf(granR), "REVOKE antes do GRANT (ACL deterministica, nao a de fabrica da loja)");
  const cod = soComandos(migration);
  assert(!/GRANT[^;]*\bPUBLIC\b/.test(cod), "nada e' concedido a PUBLIC");
  const grantsDeCrm = (cod.match(/GRANT[^;]*crm_visitas[^;]*;/g) ?? []).join(" ");
  assert(grantsDeCrm.length > 0 && !/\banon\b/.test(grantsDeCrm), "crm_visitas sem anon");
  const grantsDeTudo = (cod.match(/GRANT[^;]*;/g) ?? []).length;
  assertEquals(grantsDeTudo, 2, "so dois GRANT na migration inteira");
});

Deno.test("20261399: ADITIVA: so cria objeto novo; nada existente e' redefinido, apagado ou regravado; nenhuma mencao a tabela de analise antiga", () => {
  const cod = soComandos(migration);
  const criados = [...cod.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(\w+(?:\s+\w+)?)\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(\w+)/gi)].map(
    (m) => `${m[1].toUpperCase()} ${m[2]}`,
  );
  // Os corpos das funcoes ficam mascarados; o que sobra sao os tres CREATE de nivel superior.
  assertEquals(criados, ["TABLE visitas_por_dia", "FUNCTION contar_entrada", "FUNCTION crm_visitas"]);
  const funcoes = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  assertEquals(funcoes, ["contar_entrada", "crm_visitas"]);
  for (const proibido of [/\bDROP\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bUPDATE\b/i, /\bINSERT\b/i, /CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i, /CREATE\s+POLICY/i, /CREATE\s+(UNIQUE\s+)?INDEX/i, /ALTER\s+DEFAULT/i, /CREATE\s+EXTENSION/i]) {
    assert(!proibido.test(cod), `comando de nivel superior proibido: ${proibido}`);
  }
  const alters = cod.match(/ALTER\s+[^;]*;/gi) ?? [];
  assertEquals(alters.map(norm), ["ALTER TABLE public.visitas_por_dia ENABLE ROW LEVEL SECURITY;"]);
  for (const [rotulo, sql] of [["migration", migration], ["rollback", rollback], ["destrutivo", destrutivo]]) {
    assert(!/analytics_events/i.test(sql), `${rotulo}: nao cita a tabela de eventos antiga`);
  }
});

Deno.test("20261399: pre-voo recusa sem escrever e pos-voo confere ACL, atributos e RLS; lock_timeout de 5s", () => {
  assertStringIncludes(migration, "SET LOCAL lock_timeout = '5s';");
  assertStringIncludes(migration, "SET LOCAL statement_timeout = '30s';");
  const pre = blocoDo(migration, "preflight_20261399000000");
  const pos = blocoDo(migration, "conferencia_20261399000000");
  // O pre-voo fica ANTES de qualquer CREATE e exige as tres premissas.
  assert(migration.indexOf(pre) < migration.indexOf("CREATE TABLE IF NOT EXISTS public.visitas_por_dia ("), "pre-voo antes do CREATE");
  for (const premissa of ["public.fin__hoje()", "public.is_admin()", "public.is_admin_atual()"])
    assertStringIncludes(pre, premissa);
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  // O pos-voo vem DEPOIS de tudo e confere cada fechadura.
  assert(migration.indexOf(pos) > migration.indexOf("GRANT EXECUTE ON FUNCTION public.crm_visitas"), "pos-voo depois dos GRANT");
  assertStringIncludes(pos, "B2_POSVOO_DIVERGENTE");
  for (const marca of ["relrowsecurity", "relforcerowsecurity", "pg_policy", "has_table_privilege", "has_any_column_privilege", "has_function_privilege", "aclexplode", "proconfig", "prosecdef", "provolatile", "'anon'", "'authenticated'", "'service_role'", "canal", "contagem"])
    assertStringIncludes(pos, marca);
  assertStringIncludes(migration.trimEnd().split("\n").pop() ?? "", "NOTIFY pgrst, 'reload schema';");
});

Deno.test("20261399: o md5 dos DOIS corpos esta no pre-voo e na conferencia (2x cada) e no pre-voo do rollback comum (1x cada)", () => {
  for (const h of [H_CONTAR, H_CRM]) {
    assertEquals(contar(migration, `'${h}'`), 2, `migration: ${h}`);
    assertEquals(contar(rollback, `'${h}'`), 1, `rollback comum: ${h}`);
    assertEquals(contar(destrutivo, `'${h}'`), 0, `destrutivo: ${h}`);
  }
  // O hash e' o de replace(prosrc, E'\r', '') e o aplicador pode entregar CRLF: a migration normaliza antes de comparar.
  assert(contar(migration, "md5(replace(prosrc, E'\\r', ''))") >= 2, "pre-voo e conferencia normalizam o CR");
});

Deno.test("20261399: o rollback comum derruba EXATAMENTE as duas funcoes e mantem a tabela e as linhas", () => {
  const criadas = [...migration.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(([^)]*)\)/g)].map(
    (m) => `${m[1]}(${m[2].split(",").map((p) => p.trim().split(" ").pop()).join(", ")})`,
  );
  assertEquals(criadas, ["public.contar_entrada(text)", "public.crm_visitas(date, date)"]);
  const cod = soComandos(rollback);
  const drops = [...cod.matchAll(/DROP\s+(\w+)\s+IF\s+EXISTS\s+([^;]+);/gi)].map((m) => `${m[1].toUpperCase()} ${norm(m[2])}`);
  assertEquals(drops, ["FUNCTION public.contar_entrada(text)", "FUNCTION public.crm_visitas(date, date)"]);
  assert(!/DROP\s+TABLE|TRUNCATE|DELETE|UPDATE|INSERT|CASCADE/i.test(cod), "o rollback comum nao toca a tabela nem as linhas");
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(rollback, "SET LOCAL lock_timeout = '5s';");
  // A conferencia final: nenhuma das duas funcoes existe e a tabela continua la.
  const conf = blocoDo(rollback, "conferencia_rollback_20261399000000");
  assertStringIncludes(conf, "contar_entrada");
  assertStringIncludes(conf, "crm_visitas");
  assertStringIncludes(conf, "visitas_por_dia");
});

Deno.test("20261399: o rollback destrutivo apaga SO a tabela, so com confirmacao explicita e so depois do comum, sem CASCADE", () => {
  const cod = soComandos(destrutivo);
  const drops = [...cod.matchAll(/DROP\s+(\w+)\s+IF\s+EXISTS\s+([^;]+);/gi)].map((m) => `${m[1].toUpperCase()} ${norm(m[2])}`);
  assertEquals(drops, ["TABLE public.visitas_por_dia"]);
  assert(!/CASCADE/i.test(destrutivo.replace(/--.*$/gm, "")), "sem CASCADE: dependente que escapou faz o Postgres recusar");
  assertStringIncludes(destrutivo, "app.confirmo_apagar_visitas_da_loja");
  assertStringIncludes(destrutivo, "'APAGAR'");
  // A confirmacao e a ordem (comum primeiro) sao conferidas ANTES do DROP.
  const iDrop = destrutivo.indexOf("DROP TABLE IF EXISTS public.visitas_por_dia");
  assert(destrutivo.indexOf("<> 'APAGAR'") >= 0 && destrutivo.indexOf("<> 'APAGAR'") < iDrop);
  assert(destrutivo.indexOf("to_regprocedure('public.contar_entrada(text)')") >= 0 && destrutivo.indexOf("to_regprocedure('public.contar_entrada(text)')") < iDrop);
  assert(destrutivo.indexOf("to_regprocedure('public.crm_visitas(date, date)')") >= 0, "tambem confere a funcao de leitura");
});
