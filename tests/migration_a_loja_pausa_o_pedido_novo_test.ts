// @ts-nocheck
/* eslint-disable security/detect-object-injection -- os indices vem de listas fechadas deste arquivo, nunca de entrada de rede. */
/* eslint-disable security/detect-unsafe-regex -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), então não há ReDoS possível; mesma razão dos outros testes migration_*. */
// A LOJA PAUSA O PEDIDO NOVO — leitura do TEXTO da 20261600000000.
// O COMPORTAMENTO (a recusa do pedido online, a regra das datas, a marca do dia da suspensa, o motivo, a leitura do painel, reaplicar, rollback, pre/pos-voo
// e os mutantes) e' provado no Postgres efemero por tests/banco/a-loja-pausa-o-pedido-novo-viva.cjs; aqui ficam as ancoras que se leem do arquivo, sem banco:
//   - a migration e' ADITIVA e SEM transacao propria; nunca redefine quem cria pedido, a venda de balcao nem a porta do cartao da assinatura;
//   - a tabela pausa_de_vendas nasce fechada (RLS sem politica, REVOKE de todos os papeis de aplicacao, inclusive service_role) e vazia.
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
const NOME = "20261600000000_a_loja_pausa_o_pedido_novo.sql";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const migration = lerMig(NOME);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const semComentario = (s: string) => s.replace(/--.*$/gm, "");
const codigo = semComentario(migration);

Deno.test("20261600: sem transacao propria, texto LF, lock_timeout de 5 s e statement_timeout de 30 s", () => {
  const t = detectarTransacaoExplicita(removerRuido(migration));
  assertEquals(t.achados, [], `controle de transacao: ${t.achados.join("/")}`);
  assert(!migration.includes("\r"));
  assertStringIncludes(migration, "SET LOCAL lock_timeout = '5s';");
  assertStringIncludes(migration, "SET LOCAL statement_timeout = '30s';");
});

Deno.test("20261600: ADITIVA - nunca redefine quem cria pedido, a venda de balcao, a porta do cartao nem o leitor; nada de DROP TABLE, DROP COLUMN, DELETE, UPDATE nem TRUNCATE", () => {
  for (const proibido of [
    "FUNCTION public.create_marketplace_order",
    "FUNCTION public.registrar_venda_presencial",
    "FUNCTION public.assinatura_da_loja_gravar",
    "FUNCTION public.assinatura_da_loja_ler",
    "FUNCTION public.assinatura_da_loja_definir_chave",
  ])
    assert(!migration.includes(proibido), `a migration toca ${proibido}`);
  for (const proibido of [
    /\bDROP\s+TABLE\b/i,
    /\bDROP\s+COLUMN\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\s+(TABLE\s+)?public\./i,
    /\bUPDATE\s+public\.(?!pausa_de_vendas\b)/i,
    /\bALTER\s+TABLE\s+public\.(marketplace_orders|assinatura_da_loja|store_config)\b/i,
    /\bINSERT\s+INTO\s+public\.pausa_de_vendas\s*\(id,\s*vale_pela_assinatura/i,
  ])
    assert(!proibido.test(codigo), `a migration tem ${proibido}`);
});

Deno.test("20261600: a tabela pausa_de_vendas nasce fechada - linha unica, RLS ligada sem politica e REVOKE de PUBLIC, anon, authenticated e service_role", () => {
  assertStringIncludes(
    norm(codigo),
    norm(`CREATE TABLE IF NOT EXISTS public.pausa_de_vendas (
  id smallint NOT NULL,
  vale_pela_assinatura boolean NOT NULL DEFAULT false,
  ligada_em timestamptz,
  suspensa_desde date,
  CONSTRAINT pausa_de_vendas_pkey PRIMARY KEY (id),
  CONSTRAINT pausa_de_vendas_linha_unica CHECK (id = 1)
);`),
  );
  assertStringIncludes(
    codigo,
    "ALTER TABLE public.pausa_de_vendas ENABLE ROW LEVEL SECURITY;",
  );
  assertStringIncludes(
    codigo,
    "REVOKE ALL ON TABLE public.pausa_de_vendas FROM PUBLIC, anon, authenticated, service_role;",
  );
  assert(!/\bCREATE\s+POLICY\b/i.test(codigo), "politica nova");
  assert(
    !/\bGRANT\b[^;]*\bON\s+TABLE\s+public\.pausa_de_vendas\b/i.test(codigo),
    "GRANT na tabela",
  );
});

Deno.test("20261600: o pre-voo vem ANTES de criar qualquer coisa e exige canal, idempotency_key, manutencao, is_admin_atual, o cartao com pausa_em e a tabela da chave", () => {
  const pre = migration.indexOf("DO $preflight_20261600000000$");
  assert(pre >= 0, "sem pre-voo");
  assert(
    pre <
      migration.indexOf("CREATE TABLE IF NOT EXISTS public.pausa_de_vendas"),
  );
  const bloco = migration.slice(
    pre,
    migration.indexOf("END $preflight_20261600000000$;"),
  );
  for (const exigido of [
    "a.attname = 'canal'",
    "a.attname = 'idempotency_key'",
    "a.attname = 'manutencao'",
    "to_regprocedure('public.is_admin_atual()')",
    "pausa_em:date:false",
    "to_regclass('public.assinatura_da_loja_chave')",
    "'B1_BASELINE_DIVERGENT: public.pausa_de_vendas ja existe com outra forma",
  ])
    assertStringIncludes(bloco, exigido);
});

/** O texto do CREATE OR REPLACE FUNCTION public.<nome>(...) ate o $function$; final. */
function funcaoDe(sql: string, nome: string): string {
  const marca = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  assertEquals(sql.split(marca).length - 1, 1, `uma definicao de ${nome}`);
  const i = sql.indexOf(marca);
  const a = sql.indexOf("AS $function$", i);
  return sql.slice(i, sql.indexOf("$function$;", a) + "$function$;".length);
}

Deno.test("20261600: data_da_pausa_de_vendas recebe p_pausa_em, e' SQL IMMUTABLE sem relogio, com search_path fixo e EXECUTE de ninguem", () => {
  const f = funcaoDe(migration, "data_da_pausa_de_vendas");
  assertStringIncludes(
    f,
    "data_da_pausa_de_vendas(p_teste_ate date, p_proxima date, p_suspensa_desde date, p_pausa_em date)\n RETURNS date\n LANGUAGE sql\n IMMUTABLE\n SET search_path = public, pg_temp\n",
  );
  assert(!/SECURITY DEFINER/.test(f));
  assert(
    !/\b(now|current_date|clock_timestamp|localtimestamp|current_timestamp)\b/i.test(
      semComentario(f.slice(f.indexOf("AS $function$"))),
    ),
    "relogio na regra pura",
  );
  // a regra: tolerancia 3 (sinal de teste) ou 10, +1; o piso pausa_em; sexta a domingo para a segunda; sinal de teste sem pausa_em = NULL
  for (const trecho of [
    "WHEN p_proxima IS NULL OR p_suspensa_desde IS NULL THEN NULL",
    "WHEN p_teste_ate IS NOT NULL AND p_teste_ate = p_proxima AND p_pausa_em IS NULL THEN NULL",
    "THEN 3 ELSE 10 END + 1,",
    "p_suspensa_desde, p_pausa_em) AS inicio",
    "IN (5, 6, 7) THEN 8 - extract(isodow FROM d.inicio)::integer ELSE 0 END",
  ])
    assertStringIncludes(f, trecho);
  assertStringIncludes(
    codigo,
    "REVOKE ALL ON FUNCTION public.data_da_pausa_de_vendas(date, date, date, date) FROM PUBLIC, anon, authenticated, service_role;",
  );
  assert(
    !/GRANT[^;]*data_da_pausa_de_vendas/.test(codigo),
    "GRANT na regra pura",
  );
});

Deno.test("20261600: a marca suspensa_desde e' um gatilho AFTER INSERT OR UPDATE OF status que nunca levanta erro e nunca liga a pausa", () => {
  const f = funcaoDe(migration, "marcar_suspensa_desde");
  assertStringIncludes(
    f,
    "marcar_suspensa_desde()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path = public, pg_temp\n",
  );
  const corpo = semComentario(f.slice(f.indexOf("AS $function$")));
  // tudo o que escreve fica DENTRO do bloco protegido; a falha vira WARNING
  const inicioProtegido = corpo.indexOf(
    "  BEGIN\n    IF NEW.status = 'suspensa' THEN",
  );
  const excecao = corpo.indexOf(
    "  EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'marcar_suspensa_desde:",
  );
  assert(inicioProtegido >= 0 && excecao > inicioProtegido, "bloco protegido");
  assert(
    corpo.indexOf("INSERT INTO") > inicioProtegido &&
      corpo.indexOf("INSERT INTO") < excecao,
  );
  assert(
    corpo.indexOf("UPDATE public.pausa_de_vendas") > inicioProtegido &&
      corpo.indexOf("UPDATE public.pausa_de_vendas") < excecao,
  );
  assert(!/RAISE EXCEPTION/.test(corpo), "a marca nunca levanta erro");
  assertStringIncludes(corpo, "(now() AT TIME ZONE 'America/Sao_Paulo')::date");
  assertStringIncludes(
    corpo,
    "IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'suspensa' THEN",
  );
  assert(
    !/vale_pela_assinatura|ligada_em/.test(corpo),
    "a marca mexe na chave que liga a pausa",
  );
  assertStringIncludes(corpo, "RETURN NULL;");
  assertStringIncludes(
    codigo,
    "REVOKE ALL ON FUNCTION public.marcar_suspensa_desde() FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    norm(codigo),
    "CREATE OR REPLACE TRIGGER tr_assinatura_marca_suspensa_desde AFTER INSERT OR UPDATE OF status ON public.assinatura_da_loja FOR EACH ROW EXECUTE FUNCTION public.marcar_suspensa_desde();",
  );
});

Deno.test("20261600: o motivo le manutencao primeiro, exige as 5 chaves (ligada, chave, suspensa, data com pausa_em) e devolve NULL sem as tabelas da porta", () => {
  const f = funcaoDe(migration, "motivo_da_loja_nao_aceitar_pedido");
  assertStringIncludes(
    f,
    "motivo_da_loja_nao_aceitar_pedido()\n RETURNS text\n LANGUAGE plpgsql\n STABLE\n SECURITY DEFINER\n SET search_path = public, pg_temp\n",
  );
  const corpo = semComentario(f.slice(f.indexOf("AS $function$")));
  const ordem = [
    "SELECT s.manutencao INTO v_manutencao FROM public.store_config s WHERE s.id = 1;",
    "RETURN 'manutencao';",
    "to_regclass('public.pausa_de_vendas') IS NULL OR to_regclass('public.assinatura_da_loja') IS NULL",
    "IF v_vale IS NOT TRUE THEN",
    "IF NOT EXISTS (SELECT 1 FROM public.assinatura_da_loja_chave) THEN",
    "a.pausa_em INTO v_status, v_teste_ate, v_proxima, v_pausa_em",
    "IF v_status IS DISTINCT FROM 'suspensa' THEN",
    "v_inicio := public.data_da_pausa_de_vendas(v_teste_ate, v_proxima, v_suspensa_desde, v_pausa_em);",
    "IF v_inicio IS NULL OR v_hoje < v_inicio THEN",
    "RETURN 'vendas_pausadas';",
  ];
  let ultimo = -1;
  for (const trecho of ordem) {
    const i = corpo.indexOf(trecho);
    assert(i > ultimo, `fora de ordem ou ausente: ${trecho}`);
    ultimo = i;
  }
  assertStringIncludes(
    corpo,
    "v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;",
  );
  assert(!/'atrasada'/.test(corpo), "atrasada nunca pausa");
  assert(!/RAISE/.test(corpo), "o motivo nao levanta erro de proposito");
  assertStringIncludes(
    codigo,
    "REVOKE ALL ON FUNCTION public.motivo_da_loja_nao_aceitar_pedido() FROM PUBLIC, anon, authenticated, service_role;",
  );
  assert(!/GRANT[^;]*motivo_da_loja_nao_aceitar_pedido/.test(codigo));
});

Deno.test("20261600: o gatilho do pedido novo - atalho gemeo primeiro, leitura do motivo protegida (defeito = vende), manutencao isenta so o admin atual, pausa sem isencao, as frases exatas", () => {
  const f = funcaoDe(migration, "a_loja_aceita_pedido_novo");
  assertStringIncludes(
    f,
    "a_loja_aceita_pedido_novo()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path = public, pg_temp\n",
  );
  const corpo = semComentario(f.slice(f.indexOf("AS $function$")));
  const ordem = [
    "IF NEW.idempotency_key IS NOT NULL\n     AND EXISTS (SELECT 1 FROM public.marketplace_orders WHERE idempotency_key = NEW.idempotency_key) THEN\n    RETURN NEW;",
    "    v_motivo := public.motivo_da_loja_nao_aceitar_pedido();\n  EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'a_loja_aceita_pedido_novo:",
    "IF v_motivo = 'manutencao' THEN",
    "v_admin_atual := COALESCE(public.is_admin() AND public.is_admin_atual(), false);",
    "RAISE EXCEPTION 'A loja está em manutenção. Tente de novo mais tarde.' USING ERRCODE = 'P0001';",
    "ELSIF v_motivo = 'vendas_pausadas' THEN",
    "RAISE EXCEPTION 'Esta loja não está aceitando pedidos agora.' USING ERRCODE = 'P0001';",
  ];
  let ultimo = -1;
  for (const trecho of ordem) {
    const i = corpo.indexOf(trecho);
    assert(i > ultimo, `fora de ordem ou ausente: ${trecho}`);
    ultimo = i;
  }
  // a frase nunca fala de pagamento nem de assinatura
  assert(
    !/pagamento|assinatura|mensalidade/i.test(
      corpo.match(/RAISE EXCEPTION '[^']*'/g).join(" "),
    ),
  );
  assertStringIncludes(
    codigo,
    "REVOKE ALL ON FUNCTION public.a_loja_aceita_pedido_novo() FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    norm(codigo),
    "CREATE OR REPLACE TRIGGER tr_a_loja_aceita_pedido_novo BEFORE INSERT ON public.marketplace_orders FOR EACH ROW WHEN (NEW.canal IS DISTINCT FROM 'presencial') EXECUTE FUNCTION public.a_loja_aceita_pedido_novo();",
  );
  // o nome decide a ordem: antes de todo gatilho BEFORE INSERT do cupom
  assert(
    "tr_a_loja_aceita_pedido_novo" < "tr_pedido_com_cupom_exige_a_chave_ligada",
  );
});

Deno.test("20261600: a leitura do painel exige o admin atual, devolve aceita/motivo/pausada_desde (nunca a chave pausa_em) e so o authenticated executa; a porta esta na lista do visitante", () => {
  const f = funcaoDe(migration, "situacao_das_vendas_da_loja");
  assertStringIncludes(
    f,
    "situacao_das_vendas_da_loja()\n RETURNS jsonb\n LANGUAGE plpgsql\n STABLE\n SECURITY DEFINER\n SET search_path = public, pg_temp\n",
  );
  const corpo = semComentario(f.slice(f.indexOf("AS $function$")));
  assertStringIncludes(
    corpo,
    "IF NOT COALESCE(public.is_admin() AND public.is_admin_atual(), false) THEN\n    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';",
  );
  assertStringIncludes(
    corpo,
    "jsonb_build_object('aceita', v_motivo IS NULL, 'motivo', v_motivo, 'pausada_desde', v_pausada_desde)",
  );
  assert(
    !corpo.includes("'pausa_em'"),
    "a chave da resposta e' pausada_desde, nao pausa_em",
  );
  assertStringIncludes(
    codigo,
    "REVOKE ALL ON FUNCTION public.situacao_das_vendas_da_loja() FROM PUBLIC, anon, authenticated, service_role;\nGRANT EXECUTE ON FUNCTION public.situacao_das_vendas_da_loja() TO authenticated;",
  );
  // a unica funcao nova com GRANT
  assertEquals([...codigo.matchAll(/\bGRANT\b/g)].length, 1);
  const lista = JSON.parse(
    Deno.readTextFileSync(
      `${RAIZ}/tests/banco/portas-do-visitante-permitidas.json`,
    ),
  );
  const porta = lista.funcoes.find(
    (p: { funcao: string }) =>
      p.funcao === "public.situacao_das_vendas_da_loja()",
  );
  assert(porta, "a porta nao esta na lista do visitante");
  assertEquals(porta.executa, ["authenticated"]);
  assertEquals(porta.tipo, "leitura");
  assertEquals(porta.secdef, true);
  assertEquals(porta.situacao, "logado");
});

const rollback = lerMig(`rollback-manual-${NOME}`);
const destrutivo = lerMig(`rollback-manual-destrutivo-${NOME}`);
const md5 = (t: string) => createHash("md5").update(t).digest("hex");
/** As 5 funcoes novas: nome e assinatura (como to_regprocedure le). */
const FUNCOES = [
  [
    "data_da_pausa_de_vendas",
    "public.data_da_pausa_de_vendas(date, date, date, date)",
  ],
  ["marcar_suspensa_desde", "public.marcar_suspensa_desde()"],
  [
    "motivo_da_loja_nao_aceitar_pedido",
    "public.motivo_da_loja_nao_aceitar_pedido()",
  ],
  ["a_loja_aceita_pedido_novo", "public.a_loja_aceita_pedido_novo()"],
  ["situacao_das_vendas_da_loja", "public.situacao_das_vendas_da_loja()"],
];
/** O md5 do corpo (prosrc): o texto entre os dois $function$. */
const hashDe = (nome: string) => {
  const f = funcaoDe(migration, nome);
  const a = f.indexOf("AS $function$") + "AS $function$".length;
  return md5(f.slice(a, f.lastIndexOf("$function$;")));
};
const blocoDo = (sql: string, marca: string) => {
  const i = sql.indexOf(`DO $${marca}$`);
  assert(i >= 0, `bloco ${marca} ausente`);
  return sql.slice(i, sql.indexOf(`END $${marca}$;`, i));
};

Deno.test("20261600: os md5 do pre-voo, do pos-voo e do rollback comum sao os dos corpos que o arquivo carrega", () => {
  const pre = blocoDo(migration, "preflight_20261600000000");
  const pos = blocoDo(migration, "conferencia_20261600000000");
  const rb = blocoDo(rollback, "preflight_rollback_20261600000000");
  for (const [nome, assinatura] of FUNCOES) {
    const h = hashDe(nome);
    assertStringIncludes(pre, `('${nome}', '${assinatura}', '${h}')`);
    assertStringIncludes(pos, `('${nome}', '${assinatura}', '${h}',`);
    assertStringIncludes(rb, `('${assinatura}', '${h}')`);
  }
  // o pos-voo vem DEPOIS de tudo que cria, e o NOTIFY e' a ultima linha
  const iPos = migration.indexOf("DO $conferencia_20261600000000$");
  assert(
    iPos >
      migration.indexOf(
        "CREATE OR REPLACE TRIGGER tr_a_loja_aceita_pedido_novo",
      ),
  );
  assert(
    iPos >
      migration.indexOf(
        "GRANT EXECUTE ON FUNCTION public.situacao_das_vendas_da_loja() TO authenticated;",
      ),
  );
  assertStringIncludes(
    migration.trimEnd().split("\n").pop() ?? "",
    "NOTIFY pgrst, 'reload schema';",
  );
  // a tabela fechada, o EXECUTE por papel e os 2 gatilhos pela definicao exata
  for (const trecho of [
    "has_table_privilege(v_papel, v_tab, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
    "has_any_column_privilege(v_papel, v_tab, 'SELECT,INSERT,UPDATE,REFERENCES')",
    "EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = v_tab)",
    "WHEN ((new.canal IS DISTINCT FROM ''presencial''::text)) EXECUTE FUNCTION public.a_loja_aceita_pedido_novo()",
    "AFTER INSERT OR UPDATE OF status ON public.assinatura_da_loja FOR EACH ROW EXECUTE FUNCTION public.marcar_suspensa_desde()",
    "t.tgenabled = 'O'",
  ])
    assertStringIncludes(pos, trecho);
});

Deno.test("20261600: o par passa a Fase 0 do db-prove-rollback e nenhum dos dois rollbacks abre transacao propria", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  for (const [rotulo, sql] of [
    ["rollback", rollback],
    ["destrutivo", destrutivo],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${rotulo}: ${t.achados.join("/")}`);
    assert(!sql.includes("\r"), `${rotulo}: LF`);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
  }
});

Deno.test("20261600: o rollback COMUM tira os 2 gatilhos e as 5 funcoes, sem CASCADE, e MANTEM a tabela", () => {
  const sem = semComentario(rollback);
  for (const [, assinatura] of FUNCOES)
    assertStringIncludes(sem, `DROP FUNCTION IF EXISTS ${assinatura};`);
  assertStringIncludes(
    sem,
    "DROP TRIGGER IF EXISTS tr_a_loja_aceita_pedido_novo ON public.marketplace_orders;",
  );
  assertStringIncludes(
    sem,
    "DROP TRIGGER IF EXISTS tr_assinatura_marca_suspensa_desde ON public.assinatura_da_loja;",
  );
  assert(!/\bCASCADE\b/i.test(sem));
  assert(!/DROP\s+TABLE/i.test(sem), "o comum nao apaga a tabela");
  assert(
    !/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sem),
    "o estado anterior e' a ausencia: nada a recriar",
  );
});

Deno.test("20261600: o rollback DESTRUTIVO so apaga a tabela, so com confirmacao, so depois do comum e so se nenhuma funcao ainda le a tabela", () => {
  const sem = semComentario(destrutivo);
  const pre = blocoDo(destrutivo, "destrutivo_20261600000000");
  for (const trecho of [
    "current_setting('app.confirmo_apagar_pausa_de_vendas', true), '') <> 'APAGAR'",
    "PAUSA_DE_VENDAS_ROLLBACK_COMUM_PRIMEIRO",
    "p.prosrc LIKE '%pausa_de_vendas%'",
  ])
    assertStringIncludes(pre, trecho);
  assert(
    sem.indexOf("DROP TABLE IF EXISTS public.pausa_de_vendas;") >
      sem.indexOf("END $destrutivo_20261600000000$;"),
  );
  assertEquals([...sem.matchAll(/\bDROP\b/g)].length, 1, "um DROP so");
  assert(!/\bCASCADE\b/i.test(sem));
});

const contar = (texto: string, trecho: string) =>
  texto.split(trecho).length - 1;
const A196 = "196a-conferir-a-loja-pausa-o-pedido-novo-aplicado";
const B196 = "196b-antes-a-loja-pausa-o-pedido-novo-ausente";

Deno.test("20261600: o db-apply confere as 4 funcoes com decisao pelos marcadores, cada um UMA vez no arquivo", () => {
  const dbApply = Deno.readTextFileSync(`${RAIZ}/scripts/db-apply.cjs`).replace(
    /\r/g,
    "",
  );
  const i = dbApply.indexOf(`"${NOME}": [`);
  assert(i >= 0, "a entrada da 20261600000000 nao esta no db-apply");
  const entrada = dbApply.slice(i, dbApply.indexOf("\n  ],\n", i));
  for (const funcao of [
    "data_da_pausa_de_vendas",
    "motivo_da_loja_nao_aceitar_pedido",
    "a_loja_aceita_pedido_novo",
    "situacao_das_vendas_da_loja",
  ])
    assertStringIncludes(entrada, `funcao: "${funcao}"`);
  for (const marcador of [
    "WHEN p_teste_ate IS NOT NULL AND p_teste_ate = p_proxima AND p_pausa_em IS NULL THEN NULL",
    "p_suspensa_desde, p_pausa_em) AS inicio",
    "IF v_inicio IS NULL OR v_hoje < v_inicio THEN",
    "RAISE EXCEPTION 'Esta loja não está aceitando pedidos agora.' USING ERRCODE = 'P0001';",
    "RAISE EXCEPTION 'A loja está em manutenção. Tente de novo mais tarde.' USING ERRCODE = 'P0001';",
  ]) {
    assertStringIncludes(entrada, marcador);
    assertEquals(contar(migration, marcador), 1, marcador);
  }
});

Deno.test("196a/196b (rol fechado de 10 e 8), canais-de-backend, menu do conferir-banco, rpc-ci (2 caminhos + a prova) e CONSULTAS_DE_ROL_FECHADO registram a migration", async () => {
  const {
    contarStatements,
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO, lerCanais } = await import(
    new URL("../scripts/frota/publicar-release.mjs", import.meta.url).href
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A196]?.length, 10);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B196]?.length, 8);
  const menu = Deno.readTextFileSync(
    `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`,
  ).replace(/\r/g, "");
  const rpc = Deno.readTextFileSync(
    `${RAIZ}/.github/workflows/rpc-ci.yml`,
  ).replace(/\r/g, "");
  for (const nome of [A196, B196]) {
    const sql = Deno.readTextFileSync(
      `${RAIZ}/scripts/publicacao/consultas/${nome}.sql`,
    ).replace(/\r/g, "");
    assertEquals(contarStatements(sql), 1, `${nome}: UM statement`);
    const rol = ROL_FECHADO_POR_CONSULTA[nome];
    const rotulos = [...sql.matchAll(/SELECT '([^']+)', '(?:sim|nao)'/g)].map(
      (m) => m[1],
    );
    assertEquals(rotulos.sort(), [...rol].sort(), `${nome}: rotulos != rol`);
    const cod = sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|EXECUTE|COPY|SET)\b/.test(
        cod,
      ),
      `${nome}: so leitura`,
    );
    // nenhuma linha de pedido, do cartao, da chave nem da pausa; nenhuma funcao da migration chamada
    assert(
      !/\bFROM\s+(public\.)?(marketplace_orders|assinatura_da_loja(_chave)?|pausa_de_vendas)\b/i.test(
        cod,
      ),
      `${nome}: nao le linha de pedido, cartao, chave nem pausa`,
    );
    for (const f of [
      "data_da_pausa_de_vendas(",
      "motivo_da_loja_nao_aceitar_pedido(",
      "situacao_das_vendas_da_loja(",
    ])
      assert(!cod.includes(f), `${nome}: chama ${f}`);
    assertStringIncludes(sql, "ORDER BY ok, item;");
    assert(
      CONSULTAS_DE_ROL_FECHADO.has(nome),
      `${nome} fora de CONSULTAS_DE_ROL_FECHADO`,
    );
    assertStringIncludes(menu, `          - ${nome}\n`);
    assertEquals(
      contar(rpc, `"scripts/publicacao/consultas/${nome}.sql"`),
      2,
      `${nome}: nas duas listas de caminhos do rpc-ci`,
    );
  }
  // a 196a confere os md5 que o arquivo carrega (o mesmo corpo que o pos-voo exige)
  const a196 = Deno.readTextFileSync(
    `${RAIZ}/scripts/publicacao/consultas/${A196}.sql`,
  );
  for (const [nome] of FUNCOES)
    assertStringIncludes(a196, `('${nome}', '${hashDe(nome)}',`);
  // a 196b le de dado SO a contagem de manutencao de store_config, por to_jsonb
  const b196 = semComentario(
    Deno.readTextFileSync(`${RAIZ}/scripts/publicacao/consultas/${B196}.sql`),
  );
  assertEquals(
    [...b196.matchAll(/\bFROM\s+public\.(\w+)/g)].map((m) => m[1]),
    ["store_config"],
  );
  assertStringIncludes(b196, "(to_jsonb(s) ->> 'manutencao') = 'true'");
  assertEquals(
    contar(
      rpc,
      "node tests/banco/rodar-isolado.cjs tests/banco/a-loja-pausa-o-pedido-novo-viva.cjs",
    ),
    1,
  );
  const lote = lerCanais().provasDeObjetos.find(
    (p: { consulta: string }) => p.consulta === A196,
  );
  assert(lote, "lote ausente em canais-de-backend.json");
  assertEquals(lote.versoes, ["20261600000000"]);
  assertEquals(lote.ausenciaConfirmadaPor, B196);
  assertEquals(lote.backfillLedger, undefined);
  assertEquals(lote.nuncaAplicar, undefined);
  for (const trecho of [
    "aditiva",
    "exige a 20261197000000",
    "20261399998000",
    "20261590000000",
    "manutencao",
  ])
    assertStringIncludes(lote._comentario, trecho);
  // o lote desta vem logo antes dos das SUCESSORAS conhecidas, em ordem (os anteriores nao se reordenam)
  const SUCESSORAS_DA_1600 = [
    // 20261610000000: o catalogo e a configuracao chegam ao vivo em toda loja.
    "197a-conferir-o-catalogo-chega-ao-vivo-aplicado",
    // 20261620000000: a soma das categorias fecha com o faturamento no centavo.
    "198a-conferir-a-soma-das-categorias-fecha-no-centavo-aplicado",
    // 20261630000000: a loja ja suspensa tambem pausa (sucessora da marca desta).
    "199a-conferir-a-loja-ja-suspensa-tambem-pausa-aplicado",
    // 20261640000000: a devolucao com a mesma chave nao paga duas vezes.
    "200a-conferir-a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-aplicado",
    // 20261641000000: uma avaliacao por cliente e produto, e a media do painel so das publicadas.
    "201a-conferir-uma-avaliacao-por-cliente-e-a-media-so-das-publicadas-aplicado",
    // 20261642000000: a peca que volta sem tamanho espera a lojista.
    "202a-conferir-a-peca-que-volta-sem-tamanho-aplicado",
    // 20261643000000: as listas dos ajustes nao somem entre aparelhos.
    "203a-conferir-as-listas-dos-ajustes-nao-somem-entre-aparelhos-aplicado",
    // 20261645000000: o aviso do vale-troca diz que a loja combina.
    "205a-conferir-o-aviso-do-vale-troca-diz-que-a-loja-combina-aplicado",
    // 20261650000000: a categoria so com produto excluido pode sair.
    "206a-conferir-a-categoria-so-com-produto-excluido-pode-sair-aplicado",
    // 20261651000000: a ordem dos banners muda numa trava so.
    "207a-conferir-a-ordem-dos-banners-numa-trava-so-aplicado",
    // 20261653000000: a peca da variacao desligada espera a lojista.
    "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
  ];
  const lotes = lerCanais().provasDeObjetos;
  assertEquals(
    lotes.slice(-(SUCESSORAS_DA_1600.length + 1)).map((p) => p.consulta),
    [A196, ...SUCESSORAS_DA_1600],
  );
});

Deno.test("20261600: os tipos do app conhecem SO a leitura do painel (Args never, Returns Json); a regra, a marca, o motivo e o gatilho ficam fora", () => {
  const tipos = Deno.readTextFileSync(
    `${RAIZ}/src/types/database.types.ts`,
  ).replace(/\r/g, "");
  assertStringIncludes(
    tipos,
    "      situacao_das_vendas_da_loja: {\n        Args: never;\n        Returns: Json;\n      };\n",
  );
  assertEquals(contar(tipos, "situacao_das_vendas_da_loja"), 1);
  for (const fora of [
    "data_da_pausa_de_vendas",
    "marcar_suspensa_desde",
    "motivo_da_loja_nao_aceitar_pedido",
    "a_loja_aceita_pedido_novo",
    "pausa_de_vendas:",
  ])
    assert(!tipos.includes(fora), `${fora} nao e' do app`);
});
