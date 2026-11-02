"use strict";

/**
 * PROVA VIVA da migration 20261399000000_as_visitas_da_loja_contam_pelo_porteiro.sql (linha B da spec "Visitas da loja") contra o Postgres
 * EFEMERO (clone do rodar-isolado.cjs: a arvore migrada). Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs.
 *
 * A porta nova do visitante e' UMA: contar_entrada(p_canal), chamavel por anon (a chave publica da loja). O que esta prova mede:
 *
 *  SOMA        anon soma 1 por chamada, por canal; o dia e' o de Sao Paulo (relogio fixado em 23h30 e 00h30 de Brasilia, e na virada).
 *  TETO        50001 chamadas num comando param em 50000 sem erro; no teto a funcao NAO escreve (xmin/xmax/ctid/contagem iguais) e NAO
 *              trava a linha (outra conexao segurando a linha nao a faz esperar); abaixo do teto uma linha travada vale 55P03 em ~100 ms;
 *              a corrida real no teto nunca passa de 50000 (a WHERE do ON CONFLICT e' a barreira).
 *  ENTRADA     canal fora da lista, NULL, vazio, caixa/espaco diferente, texto enorme e injecao = 22023 sem gravar; nenhuma funcao aceita data.
 *  FECHADURA   anon/authenticated/service_role nao fazem SELECT/INSERT/UPDATE/DELETE/TRUNCATE na tabela (42501); authenticated nao executa
 *              contar_entrada; anon nao executa crm_visitas; RLS ligada sem politica; ninguem de aplicacao le a contagem.
 *  LEITURA     crm_visitas: anon sem EXECUTE, cliente 42501, ex-admin com JWT velho (nas duas direcoes) 42501, admin atual ok; previa fora de
 *              visitas; periodo anterior ao inicio e tabela vazia = NULL; periodo parcial soma desde contando_desde; dia sem entrada = 0;
 *              no_teto lista os pares {dia, canal} que bateram no teto DENTRO do periodo; periodo nulo/invertido/401 dias = o mesmo erro de crm_visao.
 *  ASSINCRONO  o commit de contar_entrada nao espera o disco (o WAL fica para tras), e a clausula SET da definicao NAO faria isso.
 *  CONCORRENCIA duas conexoes reais somando ao mesmo tempo (inclusive a primeira linha do dia) nao perdem conta.
 *  SO NOVO     o apply cria so a tabela e as duas funcoes: nenhuma outra funcao, tabela, politica, gatilho ou restricao muda.
 *  MIGRATION   reaplicar (2x) e CRLF = mesmo estado e a contagem existente fica; rollback comum derruba as 2 funcoes e MANTEM tabela e
 *              linhas; destrutivo exige confirmacao e o comum antes; pre-voo recusa SEM escrever; pos-voo recusa cada estrago; arquivo
 *              com pos-voo sabotado numa conexao SEM BEGIN nao deixa nada; consultas 117a/117b nos dois sentidos com o rol fechado.
 *  MUTANTES    sem o teto, sem a pre-leitura, sem a WHERE (corrida real), dia vindo de parametro, dia do relogio sem fuso, canal sem
 *              validar, sem o REVOKE da tabela, sem lock_timeout, previa somada, sem a trava de admin atual, no_teto sem o periodo:
 *              cada um FICA VERMELHO na expectativa certa.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/as-visitas-da-loja-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, md5, emCRLF } = P;
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME = "20261399000000_as_visitas_da_loja_contam_pelo_porteiro.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK = P.lerMigration(`rollback-manual-${NOME}`);
const DESTRUTIVO = P.lerMigration(`rollback-manual-destrutivo-${NOME}`);
const A117 = "117a-conferir-as-visitas-da-loja-contam-pelo-porteiro-aplicado";
const B117 = "117b-antes-as-visitas-da-loja-contam-pelo-porteiro-ausente";
const NOVOS = {
  funcoes: ["contar_entrada", "crm_visitas"],
  gatilhos: [],
  restricoes: [
    "visitas_por_dia_pkey",
    "visitas_por_dia_canal_check",
    "visitas_por_dia_contagem_check",
  ],
};
const PESSOAS = ["direto", "instagram", "whatsapp", "outros_sites"];

const corpoDe = (sql, nome) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  const a = sql.indexOf("AS $function$", i) + "AS $function$".length;
  return sql.slice(a, sql.indexOf("$function$;", a));
};
const textoDe = (nome) => {
  const i = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  const a = MIGRATION.indexOf("AS $function$", i);
  return MIGRATION.slice(
    i,
    MIGRATION.indexOf("$function$;", a) + "$function$;".length,
  );
};
const H_CONTAR = md5(corpoDe(MIGRATION, "contar_entrada"));
const H_CRM = md5(corpoDe(MIGRATION, "crm_visitas"));

const U = {
  admin: "b1399000-0000-4000-8000-0000000000ad",
  cliente: "b1399000-0000-4000-8000-0000000000a1",
  exProfiles: "b1399000-0000-4000-8000-0000000000e1", // rebaixado no perfil, ainda admin em auth.users e no JWT
  exAuth: "b1399000-0000-4000-8000-0000000000e2", // rebaixado em auth.users, ainda admin no perfil e no JWT
};
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const ADMIN = { uid: U.admin, claims: JWT_ADMIN };
const CLIENTE = {
  uid: U.cliente,
  claims: JSON.stringify({ role: "authenticated" }),
};
const EX_PROFILES = { uid: U.exProfiles, claims: JWT_ADMIN };
const EX_AUTH = { uid: U.exAuth, claims: JWT_ADMIN };

const C = () => P.conexao();
const antes = async () => {
  await C().query(ROLLBACK);
  await C().query("SET LOCAL app.confirmo_apagar_visitas_da_loja = 'APAGAR'");
  await C().query(DESTRUTIVO);
};
const depois = () => C().query(MIGRATION);

async function semear() {
  const c = C();
  for (const id of Object.values(U))
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@399.teste', '{}'::jsonb)",
      [id],
    );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin 399', 'admin'), ($2, 'Cliente 399', 'customer'), ($3, 'Ex 399 perfil', 'customer'), ($4, 'Ex 399 auth', 'admin')`,
    [U.admin, U.cliente, U.exProfiles, U.exAuth],
  );
  // admin de verdade = as DUAS fontes; exProfiles so em auth.users; exAuth so no perfil
  await c.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = ANY($1::uuid[])',
    [[U.admin, U.exProfiles]],
  );
  // o gatilho profiles -> auth.users promoveu o exAuth ao inserir o perfil; o rebaixamento so em auth.users vem DEPOIS dele
  await c.query(
    "UPDATE auth.users SET raw_app_meta_data = '{}'::jsonb WHERE id = $1::uuid",
    [U.exAuth],
  );
}

/** Linhas da tabela como a sessao direta (dono) as ve. */
const linhas = async (c = C()) =>
  (
    await c.query(
      "SELECT dia::text AS dia, canal, contagem FROM public.visitas_por_dia ORDER BY dia, canal",
    )
  ).rows;
const total = async (canal, c = C()) =>
  Number(
    (
      await c.query(
        "SELECT COALESCE(sum(contagem), 0)::int AS n FROM public.visitas_por_dia WHERE canal = $1",
        [canal],
      )
    ).rows[0].n,
  );
async function sembrar(rows, c = C()) {
  for (const [dia, canal, n] of rows)
    await c.query(
      "INSERT INTO public.visitas_por_dia (dia, canal, contagem) VALUES ($1::date, $2, $3)",
      [dia, canal, n],
    );
}
/** O relogio da loja fixado por GUC, com a MESMA expressao de fin__hoje() (o dia de Sao Paulo). So dentro de transacao desfeita. */
async function relogio(c = C()) {
  await c.query(
    `CREATE OR REPLACE FUNCTION public.fin__hoje() RETURNS date LANGUAGE sql STABLE SET search_path = public
       AS $$ SELECT (current_setting('prova.agora')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date $$`,
  );
}
const agora = (c, instante) =>
  c.query("SELECT set_config('prova.agora', $1, true)", [instante]);

const contar = (canal, papel = "anon") =>
  P.tentar(papel, "SELECT public.contar_entrada($1::text) AS r", [canal], {});
const ler = async (id, ini, fim, papel = "authenticated") => {
  const r = await P.tentar(
    papel,
    "SELECT public.crm_visitas($1::date, $2::date) AS j",
    [ini, fim],
    id,
  );
  return r.erro ? r : { json: r.linhas[0].j };
};

const estado = async () => {
  const q = async (sql, params) => (await C().query(sql, params)).rows;
  return {
    fns: await q(
      `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, md5(replace(p.prosrc, chr(13), '')) AS md5, p.prosecdef, p.provolatile,
              p.proconfig::text AS cfg, p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS dono, pg_get_function_result(p.oid) AS ret
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[]) ORDER BY 1`,
      [NOVOS.funcoes],
    ),
    tabela: await q(
      `SELECT c.relkind, c.relrowsecurity AS rls, c.relforcerowsecurity AS forca, c.relacl::text AS acl, pg_get_userbyid(c.relowner) AS dono,
              (SELECT count(*)::int FROM pg_policy WHERE polrelid = c.oid) AS politicas
         FROM pg_class c WHERE c.oid = to_regclass('public.visitas_por_dia')`,
    ),
    colunas: await q(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS padrao
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = to_regclass('public.visitas_por_dia') AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
    ),
    restricoes: await q(
      "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = to_regclass('public.visitas_por_dia') ORDER BY 1",
    ),
  };
};
const semOid = (e) => ({ ...e, fns: e.fns.map((f) => ({ ...f, oid: null })) });
const aplicado = async (c = C()) =>
  (
    await c.query(
      "SELECT to_regprocedure('public.contar_entrada(text)') IS NOT NULL AND to_regprocedure('public.crm_visitas(date, date)') IS NOT NULL AND to_regclass('public.visitas_por_dia') IS NOT NULL AS x",
    )
  ).rows[0].x;
const retrato = async () => {
  const r = await P.retrato(NOVOS);
  r.tabelas = r.tabelas.filter((t) => t.t !== "visitas_por_dia");
  return r;
};

const falhou = (r) =>
  Object.entries(r)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
    .sort();

// ---------------------------------------------------------------------------------------------------------------------------
// Roteiros: cada chave e' uma expectativa que vale `true` quando o comportamento e' o desta migration.
// ---------------------------------------------------------------------------------------------------------------------------

/** A escrita: soma, entrada invalida, teto, data, fechadura. Roda dentro de uma transacao desfeita, com o fuso em UTC. */
async function roteiroEscrita() {
  const r = {};
  const c = C();
  // soma 1 por chamada, por canal; a resposta e' vazia
  const a = await contar("direto");
  r.respostaVazia =
    !a.erro &&
    a.linhas.length === 1 &&
    (a.linhas[0].r === "" || a.linhas[0].r === null);
  await contar("direto");
  await contar("direto");
  await contar("instagram");
  await contar("previa");
  r.soma =
    (await total("direto")) === 3 &&
    (await total("instagram")) === 1 &&
    (await total("previa")) === 1 &&
    (await total("whatsapp")) === 0;
  // canal invalido: 22023 e nada gravado
  const antesInvalido = JSON.stringify(await linhas());
  const invalidos = [
    null,
    "",
    "invalido",
    "Direto",
    "DIRETO",
    " direto",
    "direto ",
    "previa\n",
    "direto'; DROP TABLE public.visitas_por_dia; --",
    "x".repeat(10000),
  ];
  let todosRecusados = true;
  for (const canal of invalidos) {
    const e = await contar(canal);
    if (!e.erro || e.codigo !== "22023") todosRecusados = false;
  }
  r.canalInvalido =
    todosRecusados && JSON.stringify(await linhas()) === antesInvalido;
  // nenhuma funcao aceita data: com 2 argumentos a funcao nem existe (42883) e nada e' gravado
  const comData = await P.tentar(
    "anon",
    "SELECT public.contar_entrada('direto', DATE '2020-01-01')",
    [],
    {},
  );
  r.semDataLivre = comData.codigo === "42883" && (await total("direto")) === 3;
  const assinaturas = (
    await c.query(
      "SELECT pg_get_function_identity_arguments(oid) AS a FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'contar_entrada'",
    )
  ).rows.map((x) => x.a);
  r.umaAssinatura =
    assinaturas.length === 1 && assinaturas[0] === "p_canal text";
  // quem executa
  const auth = await contar("direto", "authenticated");
  r.authenticatedNaoExecuta = auth.codigo === "42501";
  const srv = await contar("direto", "service_role");
  r.serviceRoleExecuta = !srv.erro;
  // a tabela esta fechada: nenhum papel de aplicacao toca, nem le (42501, nao "zero linhas")
  let fechada = true;
  for (const papel of ["anon", "authenticated", "service_role"])
    for (const sql of [
      "SELECT * FROM public.visitas_por_dia",
      "SELECT contagem FROM public.visitas_por_dia",
      "INSERT INTO public.visitas_por_dia (dia, canal, contagem) VALUES (DATE '2026-01-01', 'direto', 1)",
      "UPDATE public.visitas_por_dia SET contagem = 0",
      "DELETE FROM public.visitas_por_dia",
      "TRUNCATE public.visitas_por_dia",
    ]) {
      const x = await P.tentar(papel, sql, [], {});
      if (x.codigo !== "42501") fechada = false;
    }
  r.tabelaFechada = fechada;
  // o teto: 5 abaixo dele e 12 chamadas num comando (as 50001 reais rodam uma vez so, na prova do teto inteiro: lentas demais por mutante)
  await c.query("DELETE FROM public.visitas_por_dia WHERE canal = 'whatsapp'");
  await sembrar(
    [
      [
        (await c.query("SELECT public.fin__hoje()::text AS d")).rows[0].d,
        "whatsapp",
        49995,
      ],
    ],
    c,
  );
  const mil = await P.tentar(
    "anon",
    "SELECT public.contar_entrada('whatsapp') FROM generate_series(1, 12)",
    [],
    {},
  );
  r.tetoSemErro = !mil.erro;
  r.tetoParaEm50000 = (await total("whatsapp")) === 50000;
  // no teto a funcao nao escreve: nem a versao da linha, nem o bloqueio (xmax) mudam
  const foto = async () =>
    (
      await c.query(
        "SELECT xmin::text AS xmin, xmax::text AS xmax, ctid::text AS ctid, contagem FROM public.visitas_por_dia WHERE canal = 'whatsapp'",
      )
    ).rows;
  const f0 = JSON.stringify(await foto());
  for (let i = 0; i < 5; i++) await contar("whatsapp");
  r.noTetoNaoEscreve = JSON.stringify(await foto()) === f0;
  return r;
}

/** O dia e' o de Sao Paulo, com o relogio da loja fixado e a sessao em UTC (o UTC adianta o dia depois das 21h de Brasilia). */
async function roteiroDia() {
  const r = {};
  const c = C();
  await relogio(c);
  const casos = [
    ["2026-03-10T23:30:00-03:00", "2026-03-10"], // 02:30 UTC do dia 11
    ["2026-03-10T23:59:59.999-03:00", "2026-03-10"],
    ["2026-03-11T00:00:00-03:00", "2026-03-11"], // 03:00 UTC
    ["2026-03-11T00:30:00-03:00", "2026-03-11"],
    ["2026-12-31T22:00:00-03:00", "2026-12-31"], // 01:00 UTC de 1/1: virada do ano
    ["2027-01-01T00:10:00-03:00", "2027-01-01"],
  ];
  let ok = true;
  for (const [instante, dia] of casos) {
    await agora(c, instante);
    await c.query("DELETE FROM public.visitas_por_dia");
    const x = await contar("outros_sites");
    const l = await linhas();
    if (x.erro || l.length !== 1 || l[0].dia !== dia || l[0].contagem !== 1)
      ok = false;
  }
  r.diaDeSaoPaulo = ok;
  // duas chamadas em instantes de dias diferentes viram duas linhas (nao se somam)
  await c.query("DELETE FROM public.visitas_por_dia");
  await agora(c, "2026-03-10T23:30:00-03:00");
  await contar("direto");
  await agora(c, "2026-03-11T00:30:00-03:00");
  await contar("direto");
  await contar("direto");
  const l = await linhas();
  r.viraDoDia =
    l.length === 2 &&
    l[0].dia === "2026-03-10" &&
    l[0].contagem === 1 &&
    l[1].dia === "2026-03-11" &&
    l[1].contagem === 2;
  return r;
}

/** A leitura. A tabela e' semeada pela sessao direta (o dono), com dias fixos. */
async function roteiroLeitura() {
  const r = {};
  const c = C();
  const D = "2026-03-10";
  // tabela vazia
  const vazia = await ler(ADMIN, "2026-03-01", "2026-03-31");
  r.vazia =
    !vazia.erro &&
    vazia.json.visitas === null &&
    vazia.json.contando_desde === null &&
    vazia.json.previas === null &&
    vazia.json.periodo_completo === false &&
    Array.isArray(vazia.json.no_teto) &&
    vazia.json.no_teto.length === 0 &&
    vazia.json.canais.length === 4 &&
    vazia.json.canais.every((x) => x.visitas === null);
  await sembrar([
    [D, "direto", 5],
    [D, "instagram", 3],
    [D, "whatsapp", 2],
    [D, "outros_sites", 1],
    [D, "previa", 100],
    ["2026-03-12", "direto", 7],
    ["2026-03-12", "previa", 9],
    ["2026-03-20", "direto", 50000],
    ["2026-03-20", "previa", 50000],
    ["2026-03-21", "direto", 49999],
  ]);
  const todo = await ler(ADMIN, D, "2026-03-31");
  r.formato =
    !todo.erro &&
    JSON.stringify(Object.keys(todo.json).sort()) ===
      JSON.stringify([
        "canais",
        "contando_desde",
        "no_teto",
        "periodo_completo",
        "previas",
        "visitas",
      ]);
  r.canaisEmOrdem =
    !todo.erro &&
    JSON.stringify(todo.json.canais.map((x) => x.canal)) ===
      JSON.stringify(PESSOAS);
  // previa fora de visitas: visitas = soma dos 4 canais de pessoa (11 no dia D, 7 em 12/3, 50000 + 49999 nos dias 20 e 21)
  const soDia = await ler(ADMIN, D, D);
  r.previaFora =
    !soDia.erro &&
    soDia.json.visitas === 11 &&
    soDia.json.previas === 100 &&
    JSON.stringify(soDia.json.canais.map((x) => x.visitas)) ===
      JSON.stringify([5, 3, 2, 1]);
  r.contandoDesde =
    !soDia.erro &&
    soDia.json.contando_desde === D &&
    soDia.json.periodo_completo === true;
  // periodo anterior ao inicio: NULL (nunca zero)
  const anterior = await ler(ADMIN, "2026-02-01", "2026-03-09");
  r.anteriorAoInicio =
    !anterior.erro &&
    anterior.json.visitas === null &&
    anterior.json.previas === null &&
    anterior.json.periodo_completo === false &&
    anterior.json.contando_desde === D &&
    anterior.json.canais.every((x) => x.visitas === null) &&
    anterior.json.no_teto.length === 0;
  // periodo parcial: comeca antes do contador, soma desde contando_desde, e avisa que nao e completo
  const parcial = await ler(ADMIN, "2026-03-01", "2026-03-12");
  r.parcial =
    !parcial.erro &&
    parcial.json.visitas === 18 &&
    parcial.json.previas === 109 &&
    parcial.json.periodo_completo === false &&
    parcial.json.contando_desde === D;
  // contador ligado, dia sem entrada: zero de verdade (nao NULL)
  const semEntrada = await ler(ADMIN, "2026-03-15", "2026-03-16");
  r.diaSemEntradaEZero =
    !semEntrada.erro &&
    semEntrada.json.visitas === 0 &&
    semEntrada.json.previas === 0 &&
    semEntrada.json.canais.every((x) => x.visitas === 0) &&
    semEntrada.json.periodo_completo === true;
  // no_teto: so os pares de canal de PESSOA que chegaram a 50000, dentro do periodo, em ordem; 49999 nao conta; fora do periodo nao
  // aparece; a PREVIA no teto (2026-03-20, 50000) nunca aparece (previa inflada nao invalida a contagem de pessoas)
  const noTeto = await ler(ADMIN, "2026-03-19", "2026-03-22");
  r.noTeto =
    !noTeto.erro &&
    JSON.stringify(noTeto.json.no_teto) ===
      JSON.stringify([{ dia: "2026-03-20", canal: "direto" }]);
  r.previaNoTetoNaoAparece =
    !noTeto.erro &&
    !todo.erro &&
    !noTeto.json.no_teto.some((x) => x.canal === "previa") &&
    !todo.json.no_teto.some((x) => x.canal === "previa") &&
    noTeto.json.previas === 50000;
  // um par de canal de pessoa no teto dentro do periodo aparece, tambem numa data diferente e noutro canal
  await sembrar([
    ["2026-03-25", "whatsapp", 50000],
    ["2026-03-25", "previa", 50000],
  ]);
  const outroPar = await ler(ADMIN, "2026-03-25", "2026-03-25");
  r.pessoaNoTetoAparece =
    !outroPar.erro &&
    JSON.stringify(outroPar.json.no_teto) ===
      JSON.stringify([{ dia: "2026-03-25", canal: "whatsapp" }]);
  const comTudo = await ler(ADMIN, D, "2026-03-31");
  r.noTetoDoPeriodoTodo =
    !comTudo.erro &&
    JSON.stringify(comTudo.json.no_teto) ===
      JSON.stringify([
        { dia: "2026-03-20", canal: "direto" },
        { dia: "2026-03-25", canal: "whatsapp" },
      ]);
  const foraDoPeriodo = await ler(ADMIN, D, "2026-03-19");
  const depoisDoPeriodo = await ler(ADMIN, "2026-03-21", "2026-03-22");
  r.noTetoSoDoPeriodo =
    !foraDoPeriodo.erro &&
    foraDoPeriodo.json.no_teto.length === 0 &&
    !depoisDoPeriodo.erro &&
    depoisDoPeriodo.json.no_teto.length === 0;
  r.tetoNaoEnganaTotal =
    !noTeto.erro &&
    noTeto.json.visitas === 99999 &&
    todo.json.no_teto.length === 1;
  // quem le: so o admin de AGORA
  const cliente = await ler(CLIENTE, D, D);
  const exP = await ler(EX_PROFILES, D, D);
  const exA = await ler(EX_AUTH, D, D);
  const anon = await ler({ uid: "", claims: "" }, D, D, "anon");
  r.clienteNegado =
    cliente.codigo === "42501" && /Acesso negado/.test(cliente.erro);
  r.exAdminPerfilNegado =
    exP.codigo === "42501" && /Acesso negado/.test(exP.erro);
  r.exAdminAuthNegado =
    exA.codigo === "42501" && /Acesso negado/.test(exA.erro);
  r.anonSemExecute =
    anon.codigo === "42501" && /permission denied/.test(anon.erro);
  const srv = await ler({ uid: "", claims: "" }, D, D, "service_role");
  r.serviceRoleLe = !srv.erro && srv.json.visitas === 11;
  // a ordem das guardas: quem nao e' admin leva 42501 mesmo com periodo invalido (nao descobre nada da tabela)
  const clienteInvalido = await ler(CLIENTE, null, null);
  r.gateAntesDoPeriodo = clienteInvalido.codigo === "42501";
  // periodo nulo, invertido e de 401 dias: o MESMO erro de crm_visao (codigo e mensagem); 400 dias passa
  let igual = true;
  for (const [ini, fim] of [
    [null, "2026-03-10"],
    ["2026-03-10", null],
    [null, null],
    ["2026-03-11", "2026-03-10"],
    ["2026-01-01", "2027-02-06"],
  ]) {
    const v = await P.tentar(
      "authenticated",
      "SELECT public.crm_visitas($1::date, $2::date)",
      [ini, fim],
      ADMIN,
    );
    const o = await P.tentar(
      "authenticated",
      "SELECT public.crm_visao($1::date, $2::date)",
      [ini, fim],
      ADMIN,
    );
    if (
      !v.erro ||
      !o.erro ||
      v.codigo !== "22023" ||
      v.codigo !== o.codigo ||
      v.erro !== o.erro
    )
      igual = false;
  }
  r.periodoInvalidoComoCrmVisao = igual;
  const quatrocentos = await ler(ADMIN, "2026-01-01", "2027-02-05");
  r.quatrocentosDiasPassa = !quatrocentos.erro;
  const quatrocentosEUm = await ler(ADMIN, "2026-01-01", "2027-02-06");
  r.quatrocentosEUmRecusa = quatrocentosEUm.codigo === "22023";
  void c;
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------------
prova(
  "o corpo e a ACL: md5 conhecido (pre-voo, conferencia, rollback e 117a), atributos e quem executa",
  async () => {
    assert.equal(MIGRATION.split(`'${H_CONTAR}'`).length - 1, 2);
    assert.equal(MIGRATION.split(`'${H_CRM}'`).length - 1, 2);
    assert.ok(
      ROLLBACK.includes(`'${H_CONTAR}'`) && ROLLBACK.includes(`'${H_CRM}'`),
    );
    const a = P.lerConsulta(A117);
    assert.ok(a.includes(`'${H_CONTAR}'`) && a.includes(`'${H_CRM}'`));
    await P.emTransacao(async () => {
      const e = await estado();
      assert.equal(e.fns.length, 2);
      const [contarFn, crm] = e.fns;
      assert.equal(contarFn.f, "contar_entrada(text)");
      assert.equal(contarFn.md5, H_CONTAR);
      assert.equal(contarFn.prosecdef, true);
      assert.equal(contarFn.provolatile, "v");
      assert.equal(contarFn.cfg, "{search_path=public,lock_timeout=100ms}");
      assert.equal(contarFn.ret, "void");
      assert.equal(crm.f, "crm_visitas(date,date)");
      assert.equal(crm.md5, H_CRM);
      assert.equal(crm.provolatile, "s");
      assert.equal(crm.cfg, "{search_path=public}");
      assert.equal(crm.ret, "jsonb");
      const acl = (
        await C().query(
          `SELECT f.nome,
                has_function_privilege('anon', f.o, 'EXECUTE') AS anon, has_function_privilege('authenticated', f.o, 'EXECUTE') AS auth,
                has_function_privilege('service_role', f.o, 'EXECUTE') AS srv,
                EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = f.o AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
           FROM (VALUES ('contar_entrada', 'public.contar_entrada(text)'::regprocedure), ('crm_visitas', 'public.crm_visitas(date, date)'::regprocedure)) f(nome, o) ORDER BY 1`,
        )
      ).rows;
      assert.deepEqual(acl, [
        {
          nome: "contar_entrada",
          anon: true,
          auth: false,
          srv: true,
          publico: false,
        },
        {
          nome: "crm_visitas",
          anon: false,
          auth: true,
          srv: true,
          publico: false,
        },
      ]);
      assert.equal(e.tabela[0].rls, true);
      assert.equal(e.tabela[0].forca, false);
      assert.equal(e.tabela[0].politicas, 0);
      assert.equal(e.tabela[0].relkind, "r");
    });
  },
);

prova(
  "ANTES (controle): sem a migration nao ha tabela nem funcao e o visitante nao conta nada (a 117b esta toda verde)",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), false);
        assert.equal(
          (await C().query("SELECT to_regclass('public.visitas_por_dia') AS t"))
            .rows[0].t,
          null,
        );
        const x = await contar("direto");
        assert.equal(
          x.codigo,
          "42883",
          "sem a funcao o porteiro recebe 404 (funcao ausente)",
        );
        const l = await ler(ADMIN, "2026-03-01", "2026-03-31");
        assert.equal(l.codigo, "42883");
        assert.deepEqual(await P.consulta(B117), [], "117b no estado ANTES");
        assert.equal(
          (await P.consulta(A117)).length,
          7,
          "117a no estado ANTES reprova as 7 linhas do objeto",
        );
      },
      async () => {
        await semear();
        await antes();
      },
    );
  },
);

prova(
  "ESCRITA (DEPOIS): soma 1 por chamada, canal invalido = 22023 sem gravar, sem data livre, tabela fechada, teto em 50000 sem erro e sem escrever",
  async () => {
    await P.emTransacao(
      async () => {
        const r = await roteiroEscrita();
        assert.deepEqual(falhou(r), [], JSON.stringify(r));
      },
      async () => {
        await semear();
        await depois();
        await C().query("DELETE FROM public.visitas_por_dia");
      },
    );
  },
);

prova(
  "DIA DE SAO PAULO: 23h30 e 00h30 de Brasilia, virada do dia e do ano, com a sessao em UTC",
  async () => {
    await P.emTransacao(
      async () => {
        const live = (
          await C().query(
            "SELECT trim(prosrc) AS s FROM pg_proc WHERE oid = 'public.fin__hoje()'::regprocedure",
          )
        ).rows[0].s;
        assert.equal(
          live,
          "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date",
          "o relogio simulado aqui tem de ser a MESMA expressao da fin__hoje real",
        );
        // o relogio de verdade: a linha gravada e' a de fin__hoje()
        await C().query("DELETE FROM public.visitas_por_dia");
        await contar("direto");
        const real = (
          await C().query(
            "SELECT (SELECT dia::text FROM public.visitas_por_dia) AS gravado, public.fin__hoje()::text AS hoje",
          )
        ).rows[0];
        assert.equal(real.gravado, real.hoje);
        const r = await roteiroDia();
        assert.deepEqual(falhou(r), [], JSON.stringify(r));
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "LEITURA: admin atual le; anon, cliente e ex-admin (JWT velho) nao; previa fora; antes do inicio NULL; parcial; no_teto; periodo como crm_visao",
  async () => {
    await P.emTransacao(
      async () => {
        const r = await roteiroLeitura();
        assert.deepEqual(falhou(r), [], JSON.stringify(r));
      },
      async () => {
        await semear();
        await depois();
        await C().query("DELETE FROM public.visitas_por_dia");
      },
    );
  },
);

prova(
  "DADOS e SO NOVO: o apply nao toca linha de lugar nenhum e cria so a tabela e as duas funcoes (retrato igual)",
  async () => {
    await P.emTransacao(async () => {
      await antes();
      const r0 = await retrato();
      const contas = async () =>
        (
          await C().query(
            "SELECT (SELECT count(*) FROM public.profiles)::int AS perfis, (SELECT count(*) FROM public.marketplace_orders)::int AS pedidos, (SELECT count(*) FROM public.produtos)::int AS produtos",
          )
        ).rows[0];
      const c0 = await contas();
      assert.equal(await aplicado(), false);
      await depois();
      assert.equal(await aplicado(), true);
      assert.deepEqual(
        await retrato(),
        r0,
        "o apply mexeu em objeto que nao era dele",
      );
      assert.deepEqual(
        await contas(),
        c0,
        "o apply mexeu em linha de outra tabela",
      );
      assert.deepEqual(
        await linhas(),
        [],
        "a tabela nasce vazia (nao ha backfill)",
      );
      const funcoes = (
        await C().query(
          "SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1::text[])",
          [NOVOS.funcoes],
        )
      ).rows[0].n;
      assert.equal(funcoes, 2);
    });
  },
);

prova(
  "reaplicar 2x e em CRLF = mesmo estado, e a contagem que ja existia NAO muda",
  async () => {
    await P.emTransacao(
      async () => {
        await sembrar([
          ["2026-03-10", "direto", 12],
          ["2026-03-10", "previa", 3],
          ["2026-03-11", "instagram", 50000],
        ]);
        const l0 = await linhas();
        const e1 = semOid(await estado());
        await depois();
        await depois();
        assert.deepEqual(
          semOid(await estado()),
          e1,
          "reaplicar 2x mudou o estado",
        );
        assert.deepEqual(await linhas(), l0, "reaplicar mexeu na contagem");
        await C().query(emCRLF(MIGRATION));
        assert.deepEqual(
          semOid(await estado()),
          e1,
          "em CRLF o estado mudou (a migration normaliza CR no pre-voo e na conferencia)",
        );
        assert.deepEqual(await linhas(), l0);
      },
      async () => {
        await antes();
        await depois();
      },
    );
  },
);

prova(
  "rollback comum: derruba so as 2 funcoes, MANTEM tabela e linhas, 2x e' no-op; destrutivo exige confirmacao e o comum antes",
  async () => {
    await P.emTransacao(
      async () => {
        await sembrar([
          ["2026-03-10", "direto", 12],
          ["2026-03-11", "previa", 5],
        ]);
        const l0 = await linhas();
        const t0 = (await estado()).tabela;
        const r0 = await retrato();
        await C().query(ROLLBACK);
        assert.equal(
          (
            await C().query(
              "SELECT to_regprocedure('public.contar_entrada(text)') IS NULL AND to_regprocedure('public.crm_visitas(date, date)') IS NULL AS x",
            )
          ).rows[0].x,
          true,
        );
        assert.deepEqual(
          await linhas(),
          l0,
          "o rollback comum mexeu na contagem",
        );
        assert.deepEqual(
          (await estado()).tabela,
          t0,
          "o rollback comum mexeu na tabela",
        );
        assert.deepEqual(
          await retrato(),
          r0,
          "o rollback comum mexeu em outro objeto",
        );
        await C().query(ROLLBACK);
        assert.deepEqual(
          await linhas(),
          l0,
          "o segundo rollback nao foi no-op",
        );
        // o destrutivo: sem confirmacao recusa e nao apaga
        await P.recusa(DESTRUTIVO, /VISITAS_DA_LOJA_SO_COM_O_DONO/);
        assert.deepEqual(await linhas(), l0);
        await C().query(
          "SET LOCAL app.confirmo_apagar_visitas_da_loja = 'QUASE'",
        );
        await P.recusa(DESTRUTIVO, /VISITAS_DA_LOJA_SO_COM_O_DONO/);
        await C().query(
          "SET LOCAL app.confirmo_apagar_visitas_da_loja = 'APAGAR'",
        );
        await C().query("SAVEPOINT s");
        await depois(); // com as funcoes de volta, o destrutivo pede o comum primeiro
        await P.recusa(DESTRUTIVO, /VISITAS_DA_LOJA_ROLLBACK_COMUM_PRIMEIRO/);
        assert.deepEqual(await linhas(), l0);
        await C().query("ROLLBACK TO SAVEPOINT s");
        await C().query(DESTRUTIVO);
        assert.equal(
          (await C().query("SELECT to_regclass('public.visitas_por_dia') AS t"))
            .rows[0].t,
          null,
          "o destrutivo nao apagou a tabela",
        );
        // ida e volta: depois do destrutivo a migration recria a tabela VAZIA
        await depois();
        assert.deepEqual(await linhas(), []);
        assert.equal(await aplicado(), true);
      },
      async () => {
        await depois();
      },
    );
  },
);

prova(
  "pre-voo recusa SEM escrever em cada estado ruim (premissa ausente, tabela de outra forma, funcao desconhecida, sobrecarga)",
  async () => {
    const sabotagens = [
      [
        "fin__hoje ausente",
        "ALTER FUNCTION public.fin__hoje() RENAME TO fin__hoje_sumida",
      ],
      [
        "is_admin_atual ausente",
        "ALTER FUNCTION public.is_admin_atual() RENAME TO is_admin_atual_sumida",
      ],
      [
        "is_admin ausente",
        "ALTER FUNCTION public.is_admin() RENAME TO is_admin_sumida",
      ],
      [
        "fin__hoje devolvendo texto",
        "DROP FUNCTION public.fin__hoje() CASCADE; CREATE FUNCTION public.fin__hoje() RETURNS text LANGUAGE sql AS $f$ SELECT 'x' $f$",
      ],
      [
        "tabela de outra forma",
        "CREATE TABLE public.visitas_por_dia (x integer)",
      ],
      [
        "tabela com a coluna a mais",
        "CREATE TABLE public.visitas_por_dia (dia date NOT NULL, canal text NOT NULL, contagem integer NOT NULL DEFAULT 0, extra text)",
      ],
      [
        "visao com o nome da tabela",
        "CREATE VIEW public.visitas_por_dia AS SELECT DATE '2026-01-01' AS dia, 'direto'::text AS canal, 1 AS contagem",
      ],
      [
        "contar_entrada com corpo desconhecido",
        "CREATE FUNCTION public.contar_entrada(p_canal text) RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$",
      ],
      [
        "contar_entrada com sobrecarga",
        "CREATE FUNCTION public.contar_entrada(p_canal text, p_dia date) RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$",
      ],
      [
        "contar_entrada so com outra assinatura",
        "CREATE FUNCTION public.contar_entrada(p_canal integer) RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$",
      ],
      [
        "crm_visitas com corpo desconhecido",
        "CREATE FUNCTION public.crm_visitas(p_inicio date, p_fim date) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$",
      ],
      [
        "crm_visitas so com outra assinatura",
        "CREATE FUNCTION public.crm_visitas(p_inicio date) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$",
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await P.emTransacao(
        async () => {
          await C().query(sabotar);
          const r0 = await retrato();
          const t0 = (
            await C().query(
              "SELECT to_regclass('public.visitas_por_dia')::text AS t, (SELECT string_agg(p.oid::regprocedure::text || md5(p.prosrc), ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[])) AS f",
              [NOVOS.funcoes],
            )
          ).rows[0];
          await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            await retrato(),
            r0,
            `pre-voo (${nome}) mexeu em objeto`,
          );
          const t1 = (
            await C().query(
              "SELECT to_regclass('public.visitas_por_dia')::text AS t, (SELECT string_agg(p.oid::regprocedure::text || md5(p.prosrc), ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[])) AS f",
              [NOVOS.funcoes],
            )
          ).rows[0];
          assert.deepEqual(
            t1,
            t0,
            `pre-voo (${nome}) escreveu antes de recusar`,
          );
        },
        async () => {
          await semear();
          await antes();
        },
      );
    }
  },
);

prova(
  "a conferencia final (pos-voo) recusa cada estrago: RLS, FORCE, politica, privilegio de tabela e de coluna, PUBLIC, EXECUTE, corpo, atributos, CHECK, padrao, chave",
  async () => {
    const bloco = P.blocoDe(MIGRATION, "conferencia_20261399000000");
    const estragos = [
      [
        "RLS desligada",
        "ALTER TABLE public.visitas_por_dia DISABLE ROW LEVEL SECURITY",
        /RLS/,
      ],
      [
        "FORCE RLS",
        "ALTER TABLE public.visitas_por_dia FORCE ROW LEVEL SECURITY",
        /RLS/,
      ],
      [
        "politica criada",
        "CREATE POLICY p ON public.visitas_por_dia FOR SELECT TO anon USING (true)",
        /politica/,
      ],
      [
        "SELECT do anon",
        "GRANT SELECT ON public.visitas_por_dia TO anon",
        /anon tem SELECT/,
      ],
      [
        "INSERT do authenticated",
        "GRANT INSERT ON public.visitas_por_dia TO authenticated",
        /authenticated tem INSERT/,
      ],
      [
        "UPDATE do service_role",
        "GRANT UPDATE ON public.visitas_por_dia TO service_role",
        /service_role tem UPDATE/,
      ],
      [
        "TRUNCATE do anon",
        "GRANT TRUNCATE ON public.visitas_por_dia TO anon",
        /anon tem TRUNCATE/,
      ],
      [
        "coluna do anon",
        "GRANT SELECT (dia) ON public.visitas_por_dia TO anon",
        /privilegio de coluna/,
      ],
      [
        "PUBLIC na tabela",
        "GRANT SELECT ON public.visitas_por_dia TO PUBLIC",
        /(PUBLIC|anon|authenticated|service_role) tem/,
      ],
      [
        "EXECUTE do authenticated na contar_entrada",
        "GRANT EXECUTE ON FUNCTION public.contar_entrada(text) TO authenticated",
        /EXECUTE/,
      ],
      [
        "EXECUTE do anon na crm_visitas",
        "GRANT EXECUTE ON FUNCTION public.crm_visitas(date, date) TO anon",
        /EXECUTE/,
      ],
      [
        "EXECUTE de PUBLIC na contar_entrada",
        "GRANT EXECUTE ON FUNCTION public.contar_entrada(text) TO PUBLIC",
        /PUBLIC/,
      ],
      [
        "service_role sem EXECUTE na crm_visitas",
        "REVOKE EXECUTE ON FUNCTION public.crm_visitas(date, date) FROM service_role",
        /EXECUTE/,
      ],
      [
        "corpo trocado",
        "CREATE OR REPLACE FUNCTION public.contar_entrada(p_canal text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '100ms' AS $f$ BEGIN NULL; END; $f$",
        /corpo vivo/,
      ],
      [
        "search_path solto",
        "ALTER FUNCTION public.contar_entrada(text) RESET search_path",
        /atributos/,
      ],
      [
        "sem lock_timeout",
        "ALTER FUNCTION public.contar_entrada(text) RESET lock_timeout",
        /atributos/,
      ],
      [
        "SECURITY INVOKER",
        "ALTER FUNCTION public.crm_visitas(date, date) SECURITY INVOKER",
        /atributos/,
      ],
      [
        "volatilidade",
        "ALTER FUNCTION public.crm_visitas(date, date) VOLATILE",
        /atributos/,
      ],
      [
        "CHECK da contagem fora",
        "ALTER TABLE public.visitas_por_dia DROP CONSTRAINT visitas_por_dia_contagem_check",
        /colunas|CHECK/,
      ],
      [
        "CHECK do canal fora",
        "ALTER TABLE public.visitas_por_dia DROP CONSTRAINT visitas_por_dia_canal_check",
        /colunas|CHECK/,
      ],
      [
        "CHECK do canal com um canal a mais",
        "ALTER TABLE public.visitas_por_dia DROP CONSTRAINT visitas_por_dia_canal_check, ADD CONSTRAINT visitas_por_dia_canal_check CHECK (canal IN ('direto','instagram','whatsapp','outros_sites','previa','extra'))",
        /colunas|CHECK/,
      ],
      [
        "padrao da contagem",
        "ALTER TABLE public.visitas_por_dia ALTER COLUMN contagem SET DEFAULT 5",
        /colunas|default/,
      ],
      [
        "chave primaria fora",
        "ALTER TABLE public.visitas_por_dia DROP CONSTRAINT visitas_por_dia_pkey",
        /colunas|chave/,
      ],
      ["tabela sumiu", "DROP TABLE public.visitas_por_dia", /RLS|tabela/],
    ];
    for (const [nome, estrago, padrao] of estragos) {
      await P.emTransacao(
        async () => {
          await C().query(estrago);
          const r = await P.recusa(bloco, /B2_POSVOO_DIVERGENTE/);
          assert.match(
            r.erro,
            padrao,
            `${nome}: a conferencia recusou pelo motivo errado (${r.erro})`,
          );
        },
        async () => {
          await semear();
          await depois();
        },
      );
    }
  },
);

prova(
  "pre-voo do rollback comum recusa o que nao e' dele (corpo redefinido, sobrecarga, outra assinatura) sem apagar nada",
  async () => {
    const sabotagens = [
      [
        "contar_entrada redefinida",
        "CREATE OR REPLACE FUNCTION public.contar_entrada(p_canal text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN NULL; END; $f$",
      ],
      [
        "crm_visitas redefinida",
        "CREATE OR REPLACE FUNCTION public.crm_visitas(p_inicio date, p_fim date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f$ BEGIN RETURN '{}'::jsonb; END; $f$",
      ],
      [
        "sobrecarga",
        "CREATE FUNCTION public.crm_visitas(p_x integer) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$",
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await P.emTransacao(
        async () => {
          await C().query(sabotar);
          const antesDeTentar = semOid(await estado());
          await P.recusa(ROLLBACK, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            semOid(await estado()),
            antesDeTentar,
            `o pre-voo do rollback (${nome}) apagou antes de recusar`,
          );
        },
        async () => {
          await depois();
        },
      );
    }
  },
);

prova(
  "consultas 117a/117b nos dois sentidos, com o rol fechado, e cada linha reprova no estrago certo",
  async () => {
    await P.emTransacao(
      async () => {
        assert.deepEqual(await P.consulta(A117), [], "117a no estado DEPOIS");
        const naoSao = await P.consulta(B117);
        assert.equal(
          naoSao.length,
          1,
          "117b depois do apply reprova SO a linha de ausencia",
        );
        assert.match(naoSao[0], /ainda NAO existem/);
        // depois do rollback COMUM: as funcoes somem, a tabela fica (117b reprova a ausencia de proposito)
        await C().query(ROLLBACK);
        assert.equal(
          (await P.consulta(A117)).length,
          4,
          "117a reprova as 4 linhas das funcoes",
        );
        assert.equal((await P.consulta(B117)).length, 1);
        await antes().catch(() => {});
      },
      async () => {
        await depois();
      },
    );
    await P.emTransacao(
      async () => {
        await antes();
        assert.deepEqual(
          await P.consulta(B117),
          [],
          "117b no estado ANTES (depois do destrutivo)",
        );
        await depois();
        for (const [estrago, linha] of [
          [
            "GRANT SELECT ON public.visitas_por_dia TO anon",
            /nenhum privilegio/,
          ],
          [
            "GRANT SELECT (dia) ON public.visitas_por_dia TO authenticated",
            /nenhum privilegio/,
          ],
          [
            "ALTER TABLE public.visitas_por_dia DISABLE ROW LEVEL SECURITY",
            /RLS ligada/,
          ],
          [
            "CREATE POLICY p ON public.visitas_por_dia FOR SELECT TO anon USING (true)",
            /RLS ligada/,
          ],
          [
            "GRANT EXECUTE ON FUNCTION public.contar_entrada(text) TO authenticated",
            /contar_entrada: atributos/,
          ],
          [
            "ALTER FUNCTION public.contar_entrada(text) RESET lock_timeout",
            /contar_entrada: atributos/,
          ],
          [
            "GRANT EXECUTE ON FUNCTION public.crm_visitas(date, date) TO anon",
            /crm_visitas: atributos/,
          ],
          [
            "ALTER FUNCTION public.crm_visitas(date, date) SECURITY INVOKER",
            /crm_visitas: atributos/,
          ],
          [
            "CREATE OR REPLACE FUNCTION public.contar_entrada(p_canal text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '100ms' AS $f$ BEGIN NULL; END; $f$",
            /contar_entrada: uma so/,
          ],
          [
            "ALTER TABLE public.visitas_por_dia DROP CONSTRAINT visitas_por_dia_canal_check",
            /3 colunas/,
          ],
          [
            "ALTER TABLE public.visitas_por_dia ALTER COLUMN contagem SET DEFAULT 1",
            /3 colunas/,
          ],
        ]) {
          await C().query("SAVEPOINT estrago");
          await C().query(estrago);
          const reprovadas = await P.consulta(A117);
          assert.ok(
            reprovadas.some((i) => linha.test(i)),
            `a 117a nao reprovou a linha certa para '${estrago.slice(0, 60)}': ${JSON.stringify(reprovadas)}`,
          );
          await C().query("ROLLBACK TO SAVEPOINT estrago");
        }
      },
      async () => {},
    );
  },
);

// ---- MUTANTES: o mesmo roteiro sobre objetos sabotados fica vermelho na expectativa certa ------------------------------------
// O mutante "sem a pre-leitura" nao aparece aqui: dentro da transacao que criou a linha o bloqueio (xmax) nao se distingue; ele e'
// provado de forma deterministica na prova "TRAVA no teto" (outra conexao segurando a linha: o mutante leva 55P03, o real nao espera).
const MUTANTES_ESCRITA = [
  [
    "sem o teto (sem pre-leitura e sem WHERE)",
    () =>
      textoDe("contar_entrada")
        .replace(" WHERE v.contagem < 50000;", ";")
        .replace("IF v_atual >= 50000 THEN\n    RETURN;\n  END IF;", "NULL;"),
    ["tetoParaEm50000"],
  ],
  [
    "canal sem validar",
    () =>
      textoDe("contar_entrada").replace(
        /IF p_canal IS NULL OR p_canal NOT IN \([^)]*\) THEN\s+RAISE EXCEPTION 'Canal invalido\.' USING ERRCODE = '22023';\s+END IF;/,
        "NULL;",
      ),
    ["canalInvalido"],
  ],
  [
    "dia vindo de parametro (sobrecarga com data)",
    () =>
      "CREATE OR REPLACE FUNCTION public.contar_entrada(p_canal text, p_dia date) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$ INSERT INTO public.visitas_por_dia AS v (dia, canal, contagem) VALUES (p_dia, p_canal, 1) ON CONFLICT (dia, canal) DO UPDATE SET contagem = v.contagem + 1 $f$; GRANT EXECUTE ON FUNCTION public.contar_entrada(text, date) TO anon",
    ["semDataLivre", "umaAssinatura"],
  ],
  [
    "authenticated tambem executa",
    () =>
      "GRANT EXECUTE ON FUNCTION public.contar_entrada(text) TO authenticated",
    ["authenticatedNaoExecuta"],
  ],
  [
    "sem o REVOKE da tabela (anon e authenticated com tudo)",
    () => "GRANT ALL ON TABLE public.visitas_por_dia TO anon, authenticated",
    ["tabelaFechada"],
  ],
  [
    "so o SELECT do anon na tabela",
    () => "GRANT SELECT ON TABLE public.visitas_por_dia TO anon",
    ["tabelaFechada"],
  ],
];
for (const [nome, sabotar, esperado] of MUTANTES_ESCRITA) {
  prova(
    `MUTANTE ${nome}: o roteiro da escrita fica vermelho na expectativa certa`,
    async () => {
      const sql = sabotar();
      await P.emTransacao(
        async () => {
          const f = falhou(await roteiroEscrita());
          for (const k of esperado)
            assert.ok(
              f.includes(k),
              `o mutante '${nome}' devia reprovar ${k}, reprovou ${JSON.stringify(f)}`,
            );
          assert.ok(f.length > 0);
        },
        async () => {
          await semear();
          await depois();
          await C().query("DELETE FROM public.visitas_por_dia");
          await C().query(sql);
        },
      );
    },
  );
}
prova(
  "MUTANTE dia do relogio sem fuso (CURRENT_DATE): o roteiro do dia fica vermelho",
  async () => {
    const mutada = textoDe("contar_entrada").replace(
      "v_dia date := public.fin__hoje();",
      "v_dia date := CURRENT_DATE;",
    );
    assert.notEqual(mutada, textoDe("contar_entrada"));
    await P.emTransacao(
      async () => {
        const f = falhou(await roteiroDia());
        assert.ok(
          f.includes("diaDeSaoPaulo") && f.includes("viraDoDia"),
          `reprovou ${JSON.stringify(f)}`,
        );
      },
      async () => {
        await semear();
        await depois();
        await C().query(mutada);
      },
    );
  },
);
const MUTANTES_LEITURA = [
  [
    "previa somada em visitas",
    () =>
      textoDe("crm_visitas").replace(
        "v_pessoas := v_direto + v_instagram + v_whatsapp + v_outros;",
        "v_pessoas := v_direto + v_instagram + v_whatsapp + v_outros + v_previa;",
      ),
    ["previaFora", "parcial", "tetoNaoEnganaTotal"],
  ],
  [
    "sem a trava de admin ATUAL",
    () =>
      textoDe("crm_visitas").replace(
        /IF NOT public\.is_admin_atual\(\) THEN\s+RAISE EXCEPTION 'Acesso negado\.' USING ERRCODE = '42501';\s+END IF;/,
        "NULL;",
      ),
    ["exAdminPerfilNegado", "exAdminAuthNegado"],
  ],
  [
    "sem nenhuma trava de admin",
    () =>
      textoDe("crm_visitas")
        .replace(
          /IF NOT public\.is_admin\(\) THEN\s+RAISE EXCEPTION 'Acesso negado\.' USING ERRCODE = '42501';\s+END IF;/,
          "NULL;",
        )
        .replace(
          /IF NOT public\.is_admin_atual\(\) THEN\s+RAISE EXCEPTION 'Acesso negado\.' USING ERRCODE = '42501';\s+END IF;/,
          "NULL;",
        ),
    [
      "clienteNegado",
      "exAdminPerfilNegado",
      "exAdminAuthNegado",
      "gateAntesDoPeriodo",
    ],
  ],
  [
    "no_teto que inclui a previa",
    () => textoDe("crm_visitas").replace("\n     AND canal <> 'previa'", ""),
    ["noTeto", "previaNoTetoNaoAparece", "tetoNaoEnganaTotal"],
  ],
  [
    "no_teto sem o recorte do periodo",
    () =>
      textoDe("crm_visitas").replace(
        "WHERE dia BETWEEN v_de AND p_fim\n     AND canal <> 'previa'\n     AND contagem >= 50000",
        "WHERE canal <> 'previa'\n     AND contagem >= 50000",
      ),
    ["noTetoSoDoPeriodo"],
  ],
  [
    "no_teto com 49999",
    () =>
      textoDe("crm_visitas").replace(
        "AND contagem >= 50000",
        "AND contagem >= 49999",
      ),
    ["noTeto"],
  ],
  [
    "contando_desde por periodo (nao pela tabela)",
    () =>
      textoDe("crm_visitas").replace(
        "SELECT min(dia) INTO v_desde FROM public.visitas_por_dia;",
        "SELECT min(dia) INTO v_desde FROM public.visitas_por_dia WHERE dia >= p_inicio;",
      ),
    ["diaSemEntradaEZero"],
  ],
  [
    "periodo sem a checagem de 400 dias",
    () => textoDe("crm_visitas").replace(" OR p_fim - p_inicio > 400", ""),
    ["quatrocentosEUmRecusa", "periodoInvalidoComoCrmVisao"],
  ],
  [
    "anon tambem le",
    () => "GRANT EXECUTE ON FUNCTION public.crm_visitas(date, date) TO anon",
    ["anonSemExecute"],
  ],
];
for (const [nome, sabotar, esperado] of MUTANTES_LEITURA) {
  prova(
    `MUTANTE ${nome}: o roteiro da leitura fica vermelho na expectativa certa`,
    async () => {
      const sql = sabotar();
      await P.emTransacao(
        async () => {
          const f = falhou(await roteiroLeitura());
          for (const k of esperado)
            assert.ok(
              f.includes(k),
              `o mutante '${nome}' devia reprovar ${k}, reprovou ${JSON.stringify(f)}`,
            );
          assert.ok(f.length > 0);
        },
        async () => {
          await semear();
          await depois();
          await C().query("DELETE FROM public.visitas_por_dia");
          await C().query(sql);
        },
      );
    },
  );
}

// ---- ATOMICIDADE e CONEXOES REAIS (conexoes proprias; deixam o clone no estado DEPOIS, limpo — ficam por ULTIMO) ---------------
const nova = async () => {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  return c;
};
const limpar = async (c) => c.query("DELETE FROM public.visitas_por_dia");
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
/** Uma chamada da porta do visitante numa transacao propria: {ok, codigo, ms}. `mutante` (SQL) e' instalado nela antes. */
async function chamar(c, canal, { mutante, prazo = 0 } = {}) {
  await c.query("BEGIN");
  const t0 = Date.now();
  try {
    if (mutante) await c.query(mutante);
    if (prazo) await c.query(`SET LOCAL statement_timeout = ${prazo}`);
    await c.query("SET LOCAL ROLE anon");
    await c.query("SELECT public.contar_entrada($1::text)", [canal]);
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, codigo: e.code, ms: Date.now() - t0 };
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

prova(
  "ATOMICIDADE: sem BEGIN, o pos-voo sabotado derruba o arquivo inteiro e nao deixa tabela nem funcao",
  async () => {
    const c3 = await nova();
    try {
      await c3.query("BEGIN");
      await c3.query(ROLLBACK);
      await c3.query(
        "SET LOCAL app.confirmo_apagar_visitas_da_loja = 'APAGAR'",
      );
      await c3.query(DESTRUTIVO);
      await c3.query("COMMIT");
      assert.equal(await aplicado(c3), false);
      // so o hash da CONFERENCIA (a ultima ocorrencia) e' sabotado; o pre-voo passa e as escritas acontecem antes de o pos-voo recusar
      const i = MIGRATION.lastIndexOf(`'${H_CONTAR}'`);
      assert.ok(i > MIGRATION.indexOf("DO $conferencia_20261399000000$"));
      const quebrada = `${MIGRATION.slice(0, i)}'ffffffffffffffffffffffffffffffff'${MIGRATION.slice(i + H_CONTAR.length + 2)}`;
      assert.notEqual(quebrada, MIGRATION);
      await assert.rejects(() => c3.query(quebrada), /B2_POSVOO_DIVERGENTE/);
      const resto = (
        await c3.query(
          "SELECT to_regclass('public.visitas_por_dia') IS NOT NULL AS t, to_regprocedure('public.contar_entrada(text)') IS NOT NULL AS f1, to_regprocedure('public.crm_visitas(date, date)') IS NOT NULL AS f2",
        )
      ).rows[0];
      assert.deepEqual(
        resto,
        { t: false, f1: false, f2: false },
        "o pos-voo reprovou e deixou objeto para tras",
      );
      await c3.query(MIGRATION); // e a migration inteira volta a aplicar
      assert.equal(await aplicado(c3), true);
    } finally {
      await c3.end();
    }
  },
);

prova(
  "TRAVA no teto: outra conexao SEGURANDO a linha nao faz a chamada esperar (nao escreve, nao trava); abaixo do teto a espera acaba em ~100 ms com 55P03",
  async () => {
    const c1 = await nova();
    const c2 = await nova();
    const dono = await nova();
    try {
      await limpar(dono);
      const hoje = (await dono.query("SELECT public.fin__hoje()::text AS d"))
        .rows[0].d;
      // 1) na linha do TETO
      await sembrar([[hoje, "direto", 50000]], dono);
      await c2.query("BEGIN");
      await c2.query(
        "SELECT 1 FROM public.visitas_por_dia WHERE canal = 'direto' FOR UPDATE",
      );
      const noTeto = await chamar(c1, "direto", { prazo: 3000 });
      assert.equal(
        noTeto.ok,
        true,
        `no teto a chamada devia sair sem esperar nem errar (veio ${JSON.stringify(noTeto)})`,
      );
      assert.ok(noTeto.ms < 1000, `no teto a chamada esperou ${noTeto.ms} ms`);
      // o MUTANTE sem a pre-leitura espera a trava e leva 55P03 (a pre-leitura e' o que poupa a linha quente)
      const semPre = await chamar(c1, "direto", {
        prazo: 3000,
        mutante: textoDe("contar_entrada").replace(
          "IF v_atual >= 50000 THEN\n    RETURN;\n  END IF;",
          "NULL;",
        ),
      });
      assert.equal(
        semPre.ok,
        false,
        "sem a pre-leitura a chamada no teto devia esbarrar na trava",
      );
      assert.equal(semPre.codigo, "55P03");
      await c2.query("ROLLBACK");
      // 2) ABAIXO do teto: a linha travada por outra transacao vale lock_timeout de 100 ms
      await limpar(dono);
      await sembrar([[hoje, "direto", 10]], dono);
      await c2.query("BEGIN");
      await c2.query(
        "SELECT 1 FROM public.visitas_por_dia WHERE canal = 'direto' FOR UPDATE",
      );
      const abaixo = await chamar(c1, "direto", { prazo: 5000 });
      assert.equal(abaixo.ok, false);
      assert.equal(
        abaixo.codigo,
        "55P03",
        `esperava lock_not_available, veio ${abaixo.codigo}`,
      );
      assert.ok(
        abaixo.ms >= 80 && abaixo.ms < 2000,
        `a espera foi de ${abaixo.ms} ms (esperado ~100)`,
      );
      // o MUTANTE sem lock_timeout fica esperando a trava ate o prazo do comando (57014): a trava de 100 ms e' o que protege o porteiro
      const semPrazo = await chamar(c1, "direto", {
        prazo: 700,
        mutante: textoDe("contar_entrada").replace(
          "\n SET lock_timeout = '100ms'",
          "",
        ),
      });
      assert.equal(semPrazo.ok, false);
      assert.equal(
        semPrazo.codigo,
        "57014",
        `sem lock_timeout a chamada devia esperar ate o prazo do comando (veio ${semPrazo.codigo})`,
      );
      assert.ok(
        semPrazo.ms >= 650,
        `sem lock_timeout esperou so ${semPrazo.ms} ms`,
      );
      await c2.query("ROLLBACK");
      assert.equal(
        (await linhas(dono))[0].contagem,
        10,
        "uma chamada que falhou gravou",
      );
    } finally {
      await c2.query("ROLLBACK").catch(() => {});
      await limpar(dono).catch(() => {});
      await c1.end();
      await c2.end();
      await dono.end();
    }
  },
);

prova(
  "CORRIDA no teto: duas conexoes em 49999 nunca passam de 50000 (a WHERE do ON CONFLICT e' a barreira); o mutante sem a WHERE chega a 50001",
  async () => {
    const c1 = await nova();
    const c2 = await nova();
    const dono = await nova();
    const espera = async () => {
      for (let i = 0; i < 200; i++) {
        const r = await dono.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND state = 'active' AND pid = $1",
          [c1.processID],
        );
        if (r.rows[0].n > 0) return true;
        await dorme(2);
      }
      return false;
    };
    /** c2 chega a 50000 (sem commitar); c1 le 49999 (a pre-leitura nao ve c2) e espera a linha; quando c1 esta esperando, c2 commita. */
    async function corrida(mutante) {
      await limpar(dono);
      const hoje = (await dono.query("SELECT public.fin__hoje()::text AS d"))
        .rows[0].d;
      await sembrar([[hoje, "direto", 49999]], dono);
      await c2.query("BEGIN");
      await c2.query("SET LOCAL ROLE anon");
      await c2.query("SELECT public.contar_entrada('direto')");
      await c2.query("RESET ROLE");
      await c1.query("BEGIN");
      if (mutante) await c1.query(mutante);
      await c1.query("SET LOCAL ROLE anon");
      const chamada = c1.query("SELECT public.contar_entrada('direto')").then(
        () => ({ ok: true }),
        (e) => ({ ok: false, codigo: e.code }),
      );
      const bloqueou = await espera();
      await c2.query("COMMIT");
      const res = await chamada;
      await c1.query("COMMIT").catch(() => c1.query("ROLLBACK"));
      return { bloqueou, res, final: (await linhas(dono))[0].contagem };
    }
    try {
      // o real: nunca passa de 50000 (se o computador atrasar e o lock_timeout de 100 ms estourar, a chamada erra 55P03 — nunca soma a mais)
      const real = await corrida(null);
      assert.ok(
        real.final <= 50000,
        `o contador passou do teto: ${real.final}`,
      );
      assert.ok(
        real.res.ok || real.res.codigo === "55P03",
        `erro inesperado: ${JSON.stringify(real.res)}`,
      );
      // o mutante: sem a WHERE e com tempo de espera longo, a corrida e' deterministica e o contador passa do teto
      const semWhere = textoDe("contar_entrada")
        .replace(" WHERE v.contagem < 50000;", ";")
        .replace("SET lock_timeout = '100ms'", "SET lock_timeout = '10s'");
      assert.notEqual(semWhere, textoDe("contar_entrada"));
      const mut = await corrida(semWhere);
      assert.equal(
        mut.bloqueou,
        true,
        "a corrida do mutante nao chegou a bloquear",
      );
      assert.equal(
        mut.final,
        50001,
        "sem a WHERE o contador devia passar do teto",
      );
    } finally {
      await c1.query("ROLLBACK").catch(() => {});
      await c2.query("ROLLBACK").catch(() => {});
      await limpar(dono).catch(() => {});
      await c1.end();
      await c2.end();
      await dono.end();
    }
  },
);

prova(
  "CONCORRENCIA: duas conexoes reais somando ao mesmo tempo (inclusive a primeira linha do dia) nao perdem conta",
  async () => {
    const dono = await nova();
    const cs = [await nova(), await nova()];
    try {
      await limpar(dono);
      for (const c of cs) {
        await c.query("SET ROLE anon");
      }
      const N = 150;
      const resultados = await Promise.all(
        cs.map(async (c) => {
          let ok = 0;
          let outros = 0;
          for (let i = 0; i < N; i++) {
            try {
              await c.query("SELECT public.contar_entrada('instagram')");
              ok += 1;
            } catch (e) {
              if (e.code !== "55P03") outros += 1;
            }
          }
          return { ok, outros };
        }),
      );
      const certas = resultados.reduce((s, r) => s + r.ok, 0);
      assert.equal(
        resultados.reduce((s, r) => s + r.outros, 0),
        0,
        "erro que nao e' lock_timeout",
      );
      assert.equal(
        await total("instagram", dono),
        certas,
        "a contagem nao e' a soma das chamadas que deram certo (perdeu conta)",
      );
      assert.ok(
        certas >= 2 * N * 0.9,
        `so ${certas} de ${2 * N} chamadas deram certo`,
      );
      // varios dias na mesma tabela: a soma por canal continua batendo
      assert.ok(
        (await linhas(dono)).length <= 2,
        "a corrida criou linha demais (so 1 dia, ou 2 se virou a meia-noite)",
      );
    } finally {
      await limpar(dono).catch(() => {});
      for (const c of cs) await c.end();
      await dono.end();
    }
  },
);

prova(
  "COMMIT ASSINCRONO: a chamada nao espera o WAL ir ao disco (o flush fica para tras); sem o set_config LOCAL do corpo e com a clausula SET da definicao, espera",
  async () => {
    const dono = await nova();
    const c = await nova();
    const original = textoDe("contar_entrada");
    // a medida: logo depois do commit de uma chamada, o WAL gravado (insert) esta a frente do WAL ja descarregado (flush)?
    const medir = async (n) => {
      let atrasos = 0;
      for (let i = 0; i < n; i++) {
        await c.query("SELECT public.contar_entrada('direto')");
        const r = await c.query(
          "SELECT pg_current_wal_flush_lsn() < pg_current_wal_insert_lsn() AS atras",
        );
        if (r.rows[0].atras) atrasos += 1;
        await dorme(3);
      }
      return atrasos;
    };
    try {
      await limpar(dono);
      await c.query("SET synchronous_commit = on"); // o padrao do CI; o corpo da funcao e' o que muda isso para a transacao dela
      await c.query("SET ROLE anon");
      const real = await medir(20);
      assert.ok(
        real >= 10,
        `o commit da chamada devia ser assincrono (flush atras em ${real} de 20)`,
      );
      // controle: uma gravacao comum (sem a funcao) com synchronous_commit=on descarrega o WAL no commit
      await c.query("RESET ROLE");
      let controle = 0;
      for (let i = 0; i < 20; i++) {
        await c.query(
          "UPDATE public.visitas_por_dia SET contagem = contagem WHERE canal = 'direto'",
        );
        const r = await c.query(
          "SELECT pg_current_wal_flush_lsn() < pg_current_wal_insert_lsn() AS atras",
        );
        if (r.rows[0].atras) controle += 1;
        await dorme(3);
      }
      assert.ok(
        controle <= 5,
        `o controle sincrono ficou atras do WAL em ${controle} de 20: a medida nao distingue`,
      );
      // MUTANTE 1: sem o set_config do corpo, o commit espera
      const semSet = original.replace(
        "PERFORM set_config('synchronous_commit', 'off', true);",
        "NULL;",
      );
      assert.notEqual(semSet, original);
      // MUTANTE 2: a clausula SET na DEFINICAO (o que parecia equivalente) nao muda o commit: o valor e' restaurado na saida da funcao
      const comClausula = semSet.replace(
        "\n SET lock_timeout = '100ms'",
        "\n SET lock_timeout = '100ms'\n SET synchronous_commit = off",
      );
      assert.notEqual(comClausula, semSet);
      for (const [nome, sql] of [
        ["sem o set_config", semSet],
        ["com a clausula SET na definicao", comClausula],
      ]) {
        try {
          await dono.query(sql);
          await c.query("SET ROLE anon");
          const atras = await medir(20);
          assert.ok(
            atras <= 5,
            `o mutante '${nome}' ficou assincrono (${atras} de 20): a prova nao distingue`,
          );
        } finally {
          await c.query("RESET ROLE").catch(() => {});
          await dono.query(original);
        }
      }
      assert.equal(
        (
          await dono.query(
            "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = 'public.contar_entrada(text)'::regprocedure",
          )
        ).rows[0].h,
        H_CONTAR,
        "a funcao nao voltou ao corpo da migration",
      );
    } finally {
      await limpar(dono).catch(() => {});
      await dono.query(original).catch(() => {});
      await c.end();
      await dono.end();
    }
  },
);

prova(
  "TETO inteiro: 50001 chamadas reais (em blocos de 2500 por transacao) param em 50000 sem erro e a seguinte nao escreve",
  async () => {
    const dono = await nova();
    const c = await nova();
    try {
      await limpar(dono);
      await c.query("SET ROLE anon");
      let erros = 0;
      for (let feitas = 0; feitas < 50001; feitas += 2500) {
        const n = Math.min(2500, 50001 - feitas);
        try {
          await c.query("BEGIN");
          await c.query(
            "SELECT public.contar_entrada('whatsapp') FROM generate_series(1, $1::int)",
            [n],
          );
          await c.query("COMMIT");
        } catch {
          erros += 1;
          await c.query("ROLLBACK").catch(() => {});
        }
      }
      assert.equal(erros, 0, "alguma chamada deu erro antes ou no teto");
      assert.equal(await total("whatsapp", dono), 50000);
      assert.equal((await linhas(dono)).length, 1, "o teto abriu linha a mais");
      const foto = async () =>
        JSON.stringify(
          (
            await dono.query(
              "SELECT xmin::text, xmax::text, ctid::text, contagem FROM public.visitas_por_dia",
            )
          ).rows,
        );
      const f0 = await foto();
      for (let i = 0; i < 5; i++)
        assert.equal(
          (await c.query("SELECT public.contar_entrada('whatsapp')")).rowCount,
          1,
        );
      assert.equal(
        await foto(),
        f0,
        "no teto a chamada escreveu (xmin, xmax, ctid ou contagem mudou)",
      );
    } finally {
      await c.query("RESET ROLE").catch(() => {});
      await limpar(dono).catch(() => {});
      await c.end();
      await dono.end();
    }
  },
);

(async () => {
  await P.conectar();
  try {
    await P.executar("as-visitas-da-loja");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
