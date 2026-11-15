"use strict";
/* eslint-disable security/detect-object-injection --
 * Os indices vem de contadores e de listas fechadas deste arquivo (nomes de campos e de casos), nunca de entrada de rede. */

/**
 * PROVA VIVA da migration 20261399998000_a_loja_recebe_o_plano_por_porta_unica.sql contra o Postgres EFEMERO (clone do rodar-isolado.cjs: a arvore migrada).
 * Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs.
 *
 * A porta nova e' UMA: assinatura_da_loja_gravar(p_chave, p_dados, p_simular), chamavel por anon e authenticated (o hub usa a chave PUBLICA da loja + a chave
 * PROPRIA da loja). O hash da chave entra por assinatura_da_loja_definir_chave (so service_role). O que esta prova mede:
 *
 *  AUTENTICACAO  sem chave definida, chave errada (variacoes de caixa, espaco, prefixo, nula, vazia, enorme, injecao) e o proprio HASH guardado usado como chave: a MESMA
 *                excecao nao_autorizado (42501), identica nos casos, ANTES de olhar p_dados (dados invalidos com chave errada continuam nao_autorizado); nada e' gravado.
 *  GRAVACAO      os 6 status; todos os campos gravados; recursos e observacao INTACTOS na atualizacao (e com o default na criacao); null apaga o valor antigo; o nome da loja
 *                (store_config) volta em "loja"; a mesma chave serve varias vezes.
 *  MAIS VELHO    a gravacao com atualizado_em anterior ao guardado e ignorada ({gravado:false, motivo:mais_velho}); igual grava; futuro (> 1 dia) e recusado.
 *  SIMULAR       p_simular nao grava (xmin/ctid iguais), mostra o diff {de, para} so do que muda (todos se a linha nao existe), "atual", "loja", o mais_velho, passa pela mesma
 *                validacao; p_simular NULL e' recusado.
 *  VALIDACAO     lista branca de 10 chaves (recursos, observacao, id e qualquer outra = campo_nao_permitido), todas obrigatorias, tipos e regras (nunca o valor na mensagem).
 *  PERMISSAO     ninguem de aplicacao toca a tabela da chave (42501 nos 4 papeis de escrita/leitura); definir_chave so do service_role; a porta nao e' do service_role;
 *                o logado nao altera o cartao direto; as regras de definir_chave (hash invalido, chave_ja_definida, substituir, rotacao); os CHECKs da tabela da chave.
 *  CONCORRENCIA  DUAS conexoes reais com COMMIT: a gravacao mais velha PERDE a corrida (sobre linha existente e sobre a primeira insercao), a primeira insercao concorrente nao
 *                da erro, definir_chave concorrente deixa uma so vencer. O mutante sem o WHERE do ON CONFLICT perde a corrida.
 *  MIGRATION     reaplicar (2x) e CRLF = mesmo estado e a chave guardada e o cartao ficam; rollback derruba as 2 funcoes e a tabela da chave e MANTEM o cartao; so objeto novo
 *                (retrato igual com e sem a migration); pre-voo recusa SEM escrever (corpo desconhecido, outra assinatura, sobrecarga, tabela da chave torta, cartao torto,
 *                store_config sem store_name); pos-voo recusa cada estrago; falha no meio numa conexao SEM BEGIN nao deixa nada; lock_timeout de 5 s sem travar a loja;
 *                consultas 150c/150d nos dois sentidos com o rol fechado.
 *  MUTANTES      comparacao de hash trocada por texto, sem chave que abre a porta, lista branca removida, mais velho gravado, igual nao grava, recursos tocados, GRANT de
 *                definir_chave ao anon, simular que grava, simular nulo que grava, null que nao apaga, dados antes da autenticacao, mensagem que diferencia os casos, futuro
 *                aceito, data solta, valor arredondado: cada um FICA VERMELHO na expectativa certa.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-recebe-o-plano-por-porta-unica-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, md5, sha256, emCRLF } = P;
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME = "20261399998000_a_loja_recebe_o_plano_por_porta_unica.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK_SQL = P.lerMigration(`rollback-manual-${NOME}`);
const A150C = "150c-conferir-a-loja-recebe-o-plano-por-porta-unica-aplicado";
const B150D = "150d-antes-a-loja-recebe-o-plano-por-porta-unica-ausente";
const NOVOS = {
  funcoes: ["assinatura_da_loja_definir_chave", "assinatura_da_loja_gravar"],
  gatilhos: [],
  restricoes: [
    "assinatura_da_loja_chave_pkey",
    "assinatura_da_loja_chave_id_check",
    "assinatura_da_loja_chave_chave_hash_check",
  ],
};
const GRAVAR = "public.assinatura_da_loja_gravar(text, jsonb, boolean)";
const DEFINIR = "public.assinatura_da_loja_definir_chave(text, boolean)";

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
const H_GRAVAR = md5(corpoDe(MIGRATION, "assinatura_da_loja_gravar"));
const H_DEFINIR = md5(corpoDe(MIGRATION, "assinatura_da_loja_definir_chave"));

const CHAVE = "chave-da-loja-de-teste-7f3a9c1e5b2d4f60a8c3e1d9b7a5f302";
const HASH = sha256(CHAVE);
const DADOS = {
  plano: "Pro",
  status: "ativa",
  ciclo: "mensal",
  valor_mensal: 49.9,
  inicio_em: "2026-01-01",
  teste_ate: null,
  proxima_cobranca_em: "2026-12-01",
  suporte_whatsapp: "5534999999999",
  gerenciar_url: "https://www.mercadopago.com.br/subscriptions/abc123",
  atualizado_em: "2026-10-13T10:00:00Z",
};
const CAMPOS = Object.keys(DADOS);
const NULAVEIS = [
  "valor_mensal",
  "inicio_em",
  "teste_ate",
  "proxima_cobranca_em",
  "suporte_whatsapp",
  "gerenciar_url",
];

const C = () => P.conexao();
const limpar = async () => {
  const c = C();
  await c.query("DELETE FROM public.assinatura_da_loja");
  await c.query("DELETE FROM public.assinatura_da_loja_chave");
  await c.query("DELETE FROM public.store_config WHERE id = 1");
};
const json = (d) => (d === null || d === undefined ? null : JSON.stringify(d));

/** A porta, como anon (o hub usa a chave publica da loja). */
const gravar = (chave, dados, simular = false, papel = "anon") =>
  P.tentar(
    papel,
    "SELECT public.assinatura_da_loja_gravar($1::text, $2::jsonb, $3::boolean) AS j",
    [chave, json(dados), simular],
    {},
  );
/** Guardar o hash: so service_role. */
const definir = (hash, substituir = false, papel = "service_role") =>
  P.tentar(
    papel,
    "SELECT public.assinatura_da_loja_definir_chave($1::text, $2::boolean) AS j",
    [hash, substituir],
    {},
  );
const cartao = async (c = C()) =>
  (
    await c.query(
      `SELECT id, plano, status, ciclo, valor_mensal::text AS valor_mensal, inicio_em::text AS inicio_em, teste_ate::text AS teste_ate,
              proxima_cobranca_em::text AS proxima_cobranca_em, suporte_whatsapp, gerenciar_url,
              to_char(atualizado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS atualizado_em, recursos, observacao
         FROM public.assinatura_da_loja ORDER BY id`,
    )
  ).rows;
const um = async (c = C()) => (await cartao(c))[0] || {};
const foto = async (c = C()) =>
  JSON.stringify(
    (
      await c.query(
        "SELECT xmin::text AS xmin, ctid::text AS ctid, to_jsonb(a)::text AS linha FROM public.assinatura_da_loja a",
      )
    ).rows,
  );
const hashGuardado = async (c = C()) =>
  (await c.query("SELECT chave_hash FROM public.assinatura_da_loja_chave"))
    .rows;
const ehNegado = (x) => x.erro === "nao_autorizado" && x.codigo === "42501";
const ehInvalido = (x, campo, msg = "valor_invalido") =>
  x.erro === msg &&
  x.codigo === "22023" &&
  (campo === undefined || x.detalhe === `campo: ${campo}`);
const iso = (ms) => new Date(ms).toISOString();

const DIAG = [];
const falhou = (r) =>
  Object.entries(r)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
    .sort();

// ---------------------------------------------------------------------------------------------------------------------------
// O roteiro: cada chave e' uma expectativa que vale `true` quando o comportamento e' o desta migration.
// ---------------------------------------------------------------------------------------------------------------------------
async function roteiro() {
  const r = {};
  const c = C();

  // ---- sem chave definida: fechada por padrao, e a recusa e' a mesma com dados validos, invalidos ou nulos
  const semChave = [
    await gravar(CHAVE, DADOS),
    await gravar(CHAVE, { ...DADOS, recursos: [] }),
    await gravar(null, null),
    await gravar(CHAVE, DADOS, true),
  ];
  r.semChaveNegado = semChave.every(ehNegado) && (await cartao()).length === 0;

  // ---- definir a chave (so service_role) e a recusa da chave errada
  const def = await definir(HASH);
  r.definirOk = !def.erro && (await hashGuardado()).length === 1;
  const erradas = [
    `${CHAVE}x`,
    CHAVE.slice(0, -1),
    CHAVE.toUpperCase(),
    ` ${CHAVE}`,
    `${CHAVE}\n`,
    "",
    null,
    "outra",
    "' OR '1'='1",
    "x".repeat(100000),
  ];
  const resp = [];
  for (const e of erradas) resp.push(await gravar(e, DADOS));
  r.chaveErradaNegada = resp.every(ehNegado) && (await cartao()).length === 0;
  // o hash GUARDADO usado como chave nao abre (se o banco comparasse o texto, abriria)
  const comHash = await gravar(HASH, DADOS);
  r.hashNaoAbre =
    ehNegado(comHash) &&
    ehNegado(await gravar(HASH.toUpperCase(), DADOS)) &&
    (await cartao()).length === 0;
  // a recusa e' UMA so: mesma mensagem, mesmo codigo, mesmo detalhe no "sem chave" e em toda chave errada
  const assin = (x) =>
    JSON.stringify([x.erro, x.codigo, x.detalhe, x.restricao]);
  r.autorizacaoUniforme = [...semChave, ...resp, comHash].every(
    (x) => assin(x) === assin(semChave[0]),
  );
  // autentica ANTES de olhar os dados: chave errada com dados tortos continua nao_autorizado; chave certa com o mesmo dado torto ve o erro do dado
  const tortos = [
    { ...DADOS, recursos: ["a"] },
    { ...DADOS, plano: 5 },
    [1, 2],
    "texto",
    {},
  ];
  let precede = true;
  for (const t of tortos) {
    if (!ehNegado(await gravar("errada", t))) precede = false;
    if (ehNegado(await gravar(CHAVE, t))) precede = false;
  }
  r.autorizaPrecedeDados = precede && (await cartao()).length === 0;

  // ---- a gravacao feliz, nos 6 status, e a mesma chave serve varias vezes
  const statuses = [
    "ativa",
    "teste",
    "pendente",
    "atrasada",
    "suspensa",
    "cancelada",
  ];
  let feliz = true;
  for (const [i, st] of statuses.entries()) {
    const t = `2026-10-13T1${i}:00:00Z`;
    const x = await gravar(CHAVE, { ...DADOS, status: st, atualizado_em: t });
    const l = await um();
    feliz =
      feliz &&
      !x.erro &&
      x.linhas?.[0]?.j.gravado === true &&
      Date.parse(x.linhas?.[0]?.j.atualizado_em) === Date.parse(t) &&
      l.status === st &&
      l.plano === "Pro" &&
      l.ciclo === "mensal" &&
      l.valor_mensal === "49.90" &&
      l.inicio_em === "2026-01-01" &&
      l.teste_ate === null &&
      l.proxima_cobranca_em === "2026-12-01" &&
      l.suporte_whatsapp === "5534999999999" &&
      l.gerenciar_url === DADOS.gerenciar_url &&
      l.atualizado_em === t &&
      l.id === 1;
  }
  r.gravaFeliz = feliz && (await cartao()).length === 1;
  // 4 ciclos e as bordas do valor
  let ciclos = true;
  for (const [i, ci] of [
    "mensal",
    "trimestral",
    "semestral",
    "anual",
  ].entries()) {
    const x = await gravar(CHAVE, {
      ...DADOS,
      ciclo: ci,
      atualizado_em: `2026-10-14T0${i}:00:00Z`,
    });
    ciclos = ciclos && !x.erro && (await um()).ciclo === ci;
  }
  for (const [i, v] of [0, 99999999.99, 50, 49.9, 0.01].entries()) {
    const x = await gravar(CHAVE, {
      ...DADOS,
      valor_mensal: v,
      atualizado_em: `2026-10-15T0${i}:00:00Z`,
    });
    ciclos = ciclos && !x.erro && Number((await um()).valor_mensal) === v;
  }
  r.ciclosEValores = ciclos;

  // ---- recursos e observacao nunca sao tocados na atualizacao (e nascem com o default na criacao)
  await c.query("DELETE FROM public.assinatura_da_loja");
  const criada = await gravar(CHAVE, DADOS);
  const l0 = await um();
  const nasceu =
    !criada.erro && l0.recursos.length === 0 && l0.observacao === null;
  await c.query(
    "UPDATE public.assinatura_da_loja SET recursos = ARRAY['loja propria', 'dominio'], observacao = 'nota interna da gestao'",
  );
  const atualizada = await gravar(CHAVE, {
    ...DADOS,
    plano: "Max",
    atualizado_em: "2026-10-13T11:00:00Z",
  });
  const l1 = await um();
  r.recursosIntactos =
    nasceu &&
    !atualizada.erro &&
    l1.plano === "Max" &&
    JSON.stringify(l1.recursos) ===
      JSON.stringify(["loja propria", "dominio"]) &&
    l1.observacao === "nota interna da gestao";

  // ---- null apaga o valor antigo
  await c.query("DELETE FROM public.assinatura_da_loja");
  await gravar(CHAVE, DADOS);
  const apagou = await gravar(CHAVE, {
    ...DADOS,
    ...Object.fromEntries(NULAVEIS.map((k) => [k, null])),
    atualizado_em: "2026-10-13T12:00:00Z",
  });
  const l2 = await um();
  r.nullApaga = !apagou.erro && NULAVEIS.every((k) => l2[k] === null);

  // ---- mais velho: ignorado e a linha nao muda; igual grava (idempotente); mais novo grava
  await c.query("DELETE FROM public.assinatura_da_loja");
  await gravar(CHAVE, {
    ...DADOS,
    plano: "A",
    atualizado_em: "2026-10-13T10:00:00Z",
  });
  const velho = await gravar(CHAVE, {
    ...DADOS,
    plano: "B",
    status: "cancelada",
    atualizado_em: "2026-10-13T09:59:59Z",
  });
  const lv = await um();
  r.maisVelhoIgnorado =
    !velho.erro &&
    velho.linhas?.[0]?.j.gravado === false &&
    velho.linhas?.[0]?.j.motivo === "mais_velho" &&
    lv.plano === "A" &&
    lv.status === "ativa" &&
    lv.atualizado_em === "2026-10-13T10:00:00Z";
  const igual = await gravar(CHAVE, {
    ...DADOS,
    plano: "C",
    atualizado_em: "2026-10-13T10:00:00Z",
  });
  r.igualGrava =
    !igual.erro &&
    igual.linhas?.[0]?.j.gravado === true &&
    (await um()).plano === "C";
  const novo = await gravar(CHAVE, {
    ...DADOS,
    plano: "D",
    atualizado_em: "2026-10-13T10:00:01Z",
  });
  r.maisNovoGrava =
    !novo.erro &&
    novo.linhas?.[0]?.j.gravado === true &&
    (await um()).plano === "D";
  // o fuso conta: o mesmo instante escrito em outro fuso e IGUAL (grava); um segundo antes e mais velho
  const mesmoInstante = await gravar(CHAVE, {
    ...DADOS,
    plano: "E",
    atualizado_em: "2026-10-13T07:00:01-03:00",
  });
  const antesNoFuso = await gravar(CHAVE, {
    ...DADOS,
    plano: "F",
    atualizado_em: "2026-10-13T07:00:00-03:00",
  });
  r.fusoConta =
    mesmoInstante.linhas?.[0]?.j.gravado === true &&
    antesNoFuso.linhas?.[0]?.j.motivo === "mais_velho" &&
    (await um()).plano === "E";
  // futuro: mais de 1 dia e recusado (um relogio errado nao pode travar a gravacao para sempre); 1 hora passa
  const futuro = await gravar(CHAVE, {
    ...DADOS,
    atualizado_em: iso(Date.now() + 2 * 86400000),
  });
  const quaseAgora = await gravar(CHAVE, {
    ...DADOS,
    plano: "G",
    atualizado_em: iso(Date.now() + 3600000),
  });
  r.futuroRecusado =
    ehInvalido(futuro, "atualizado_em") &&
    !quaseAgora.erro &&
    (await um()).plano === "G";

  // ---- o nome da loja (store_config) volta em "loja"
  await c.query("DELETE FROM public.assinatura_da_loja");
  const semNome = await gravar(CHAVE, DADOS);
  await c.query(
    "INSERT INTO public.store_config (id, store_name) VALUES (1, '   ')",
  );
  const nomeVazio = await gravar(CHAVE, {
    ...DADOS,
    atualizado_em: "2026-10-13T10:00:01Z",
  });
  await c.query(
    "UPDATE public.store_config SET store_name = '  Loja do Teste  ' WHERE id = 1",
  );
  const comNome = await gravar(CHAVE, {
    ...DADOS,
    atualizado_em: "2026-10-13T10:00:02Z",
  });
  const sim = await gravar(CHAVE, DADOS, true);
  r.nomeDaLoja =
    semNome.linhas?.[0]?.j.loja === null &&
    nomeVazio.linhas?.[0]?.j.loja === null &&
    comNome.linhas?.[0]?.j.loja === "Loja do Teste" &&
    sim.linhas?.[0]?.j.loja === "Loja do Teste";
  await c.query("DELETE FROM public.store_config WHERE id = 1");

  // ---- simular: nao grava, mostra o diff, passa pela mesma validacao
  await c.query("DELETE FROM public.assinatura_da_loja");
  const s0 = await gravar(CHAVE, DADOS, true);
  const j0 = s0.linhas?.[0]?.j;
  r.simularLinhaNova =
    !s0.erro &&
    j0.gravado === false &&
    j0.simulado === true &&
    j0.atual === null &&
    Object.keys(j0.mudaria).sort().join() === [...CAMPOS].sort().join() &&
    j0.mudaria.plano.de === null &&
    j0.mudaria.plano.para === "Pro" &&
    j0.mudaria.valor_mensal.para === 49.9 &&
    j0.mudaria.teste_ate.para === null &&
    (await cartao()).length === 0;
  await gravar(CHAVE, DADOS);
  const antes = await foto();
  const s1 = await gravar(
    CHAVE,
    {
      ...DADOS,
      plano: "Max",
      suporte_whatsapp: null,
      atualizado_em: "2026-10-13T11:00:00Z",
    },
    true,
  );
  const j1 = s1.linhas?.[0]?.j;
  r.simularNaoGrava =
    !s1.erro &&
    j1.gravado === false &&
    j1.simulado === true &&
    (await foto()) === antes;
  r.simularDiff =
    !s1.erro &&
    Object.keys(j1.mudaria).sort().join() ===
      "atualizado_em,plano,suporte_whatsapp" &&
    j1.mudaria.plano.de === "Pro" &&
    j1.mudaria.plano.para === "Max" &&
    j1.mudaria.suporte_whatsapp.de === "5534999999999" &&
    j1.mudaria.suporte_whatsapp.para === null &&
    j1.atual.plano === "Pro" &&
    j1.atual.suporte_whatsapp === "5534999999999" &&
    j1.atual.gerenciar_url === DADOS.gerenciar_url &&
    !("recursos" in j1.atual) &&
    !("observacao" in j1.atual);
  const s2 = await gravar(CHAVE, DADOS, true);
  r.simularIgualNaoMuda =
    !s2.erro && Object.keys(s2.linhas?.[0]?.j.mudaria).length === 0;
  const s3 = await gravar(
    CHAVE,
    { ...DADOS, plano: "Velho", atualizado_em: "2026-10-13T09:00:00Z" },
    true,
  );
  r.simularMaisVelho =
    !s3.erro &&
    s3.linhas?.[0]?.j.motivo === "mais_velho" &&
    Object.keys(s3.linhas?.[0]?.j.mudaria).length === 0 &&
    (await foto()) === antes;
  const s4 = await gravar(CHAVE, { ...DADOS, valor_mensal: "49,90" }, true);
  const s5 = await gravar("errada", DADOS, true);
  r.simularValida =
    ehInvalido(s4, "valor_mensal") && ehNegado(s5) && (await foto()) === antes;
  const nulo = await P.tentar(
    "anon",
    "SELECT public.assinatura_da_loja_gravar($1::text, $2::jsonb, NULL::boolean) AS j",
    [
      CHAVE,
      json({ ...DADOS, plano: "Nulo", atualizado_em: "2026-10-13T12:00:00Z" }),
    ],
    {},
  );
  r.simularNuloRecusado =
    ehInvalido(nulo, "p_simular") && (await foto()) === antes;

  // ---- lista branca e campos obrigatorios
  await c.query("DELETE FROM public.assinatura_da_loja");
  let branca = true;
  for (const extra of [
    "recursos",
    "observacao",
    "id",
    "Plano",
    " plano",
    "plano ",
    "outro",
    "created_at",
    "x".repeat(300),
  ]) {
    const x = await gravar(CHAVE, { ...DADOS, [extra]: "x" });
    if (
      x.erro !== "campo_nao_permitido" ||
      x.codigo !== "22023" ||
      !(x.detalhe || "").startsWith("campo: ") ||
      (x.detalhe || "").length > 60
    )
      branca = false;
  }
  const soExtra = await gravar(CHAVE, { recursos: ["a"] });
  if (soExtra.erro !== "campo_nao_permitido") branca = false;
  r.listaBranca = branca && (await cartao()).length === 0;
  let obrigatorios = true;
  for (const k of CAMPOS) {
    const resto = { ...DADOS };
    delete resto[k];
    const x = await gravar(CHAVE, resto);
    if (!ehInvalido(x, k, "campo_ausente")) obrigatorios = false;
  }
  const vazio = await gravar(CHAVE, {});
  if (vazio.erro !== "campo_ausente") obrigatorios = false;
  for (const naoObjeto of [[1], "texto", 5, true]) {
    const x = await gravar(CHAVE, naoObjeto);
    if (x.erro !== "dados_invalidos" || x.codigo !== "22023")
      obrigatorios = false;
  }
  const sqlNull = await P.tentar(
    "anon",
    "SELECT public.assinatura_da_loja_gravar($1::text, NULL::jsonb, false) AS j",
    [CHAVE],
    {},
  );
  if (sqlNull.erro !== "dados_invalidos") obrigatorios = false;
  r.obrigatorios = obrigatorios && (await cartao()).length === 0;

  // ---- tipos e regras: cada valor ruim e' recusado com o NOME do campo (nunca o valor) e nada e' gravado
  const ruins = {
    plano: ["", "   ", "x".repeat(61), 5, null, ["a"], true],
    status: ["ativo", "Ativa", "ativa ", null, 1, "pausada"],
    ciclo: ["semanal", "mensal ", "Mensal", null, 1],
    valor_mensal: [
      "49.90",
      -1,
      -0.01,
      49.995,
      100000000,
      123456789.5,
      true,
      [1],
      {},
    ],
    inicio_em: [
      "2026-02-31",
      "2026-13-01",
      "2026-00-10",
      "20261113",
      "2026-1-5",
      "today",
      "infinity",
      "-infinity",
      "epoch",
      "2026-11-13 ",
      "2026-11-13\n",
      "2026-10-13T00:00:00Z",
      20261113,
      true,
      "",
    ],
    teste_ate: ["2026-02-30", "ontem", 5],
    proxima_cobranca_em: ["2026-04-31", "31/12/2026", {}],
    suporte_whatsapp: [
      "123456789",
      "1234567890123456",
      "+5534999999999",
      "55 34 99999-9999",
      "5534999999999\n",
      5534999999999,
      true,
      "",
    ],
    gerenciar_url: [
      "http://x.com",
      "HTTPS://x.com",
      "ftp://x",
      "javascript:alert(1)",
      "//x.com",
      " https://x.com",
      "x.com",
      5,
      "",
    ],
    atualizado_em: [
      "2026-11-13",
      "2026-10-13T10:00:00",
      "ontem",
      1699999999,
      null,
      "2026-13-45T10:00:00Z",
      "2026-10-13T25:00:00Z",
      "now",
      "2026-10-13T10:00Z x",
      "",
    ],
  };
  let tipos = true;
  const onde = [];
  for (const [campo, valores] of Object.entries(ruins)) {
    for (const v of valores) {
      const x = await gravar(CHAVE, { ...DADOS, [campo]: v });
      const msg = JSON.stringify(x);
      if (
        !ehInvalido(x, campo) ||
        (typeof v === "string" &&
          v.length > 3 &&
          msg.includes(v.trim()) &&
          v.trim() !== "")
      ) {
        tipos = false;
        onde.push(`${campo}=${JSON.stringify(v)} -> ${x.erro}`);
      }
    }
  }
  r.valoresRuinsNaoGravam = (await cartao()).length === 0;
  // e o que e' valido nas mesmas bordas passa
  let bordas = true;
  for (const [i, ex] of [
    { plano: " x " },
    { plano: "y".repeat(60) },
    { valor_mensal: 0 },
    { valor_mensal: 99999999.99 },
    { valor_mensal: 1e2 },
    { inicio_em: "2024-02-29" },
    { suporte_whatsapp: "1234567890" },
    { suporte_whatsapp: "123456789012345" },
    { gerenciar_url: "https://x" },
    { atualizado_em: "2026-10-13T10:00:00.123456+00:00" },
    { atualizado_em: "2026-10-13 10:00:00Z" },
    { atualizado_em: "2026-10-13T10:00-0300" },
  ].entries()) {
    const x = await gravar(CHAVE, {
      ...DADOS,
      atualizado_em: `2026-09-0${(i % 9) + 1}T10:00:00Z`,
      ...ex,
    });
    if (x.erro) {
      bordas = false;
      onde.push(`borda ${JSON.stringify(ex)} -> ${x.erro}`);
    }
  }
  r.tipos = tipos;
  r.bordasValidas = bordas;
  DIAG.push(...onde);

  // ---- injecao: o texto e' dado, nunca comando
  await c.query("DELETE FROM public.assinatura_da_loja");
  const veneno = "x'); DROP TABLE public.assinatura_da_loja; --";
  const comVeneno = await gravar(CHAVE, {
    ...DADOS,
    plano: veneno.slice(0, 60),
  });
  const chaveVeneno = await gravar("' OR '1'='1' --", DADOS);
  const campoVeneno = await gravar(CHAVE, {
    ...DADOS,
    'plano"); DROP TABLE public.assinatura_da_loja;--': 1,
  });
  const existe = (
    await c.query(
      "SELECT to_regclass('public.assinatura_da_loja') IS NOT NULL AND to_regclass('public.assinatura_da_loja_chave') IS NOT NULL AS x",
    )
  ).rows[0].x;
  r.injecao =
    !comVeneno.erro &&
    (await um()).plano === veneno.slice(0, 60) &&
    ehNegado(chaveVeneno) &&
    campoVeneno.erro === "campo_nao_permitido" &&
    existe === true;

  // ---- a tabela da chave e o cartao: ninguem de aplicacao toca (42501), o logado nao altera o cartao direto
  let fechada = true;
  for (const papel of ["anon", "authenticated", "service_role"])
    for (const sql of [
      "SELECT * FROM public.assinatura_da_loja_chave",
      "SELECT chave_hash FROM public.assinatura_da_loja_chave",
      "INSERT INTO public.assinatura_da_loja_chave (id, chave_hash) VALUES (1, repeat('a', 64))",
      "UPDATE public.assinatura_da_loja_chave SET chave_hash = repeat('b', 64)",
      "DELETE FROM public.assinatura_da_loja_chave",
      "TRUNCATE public.assinatura_da_loja_chave",
    ]) {
      const x = await P.tentar(papel, sql, [], {});
      if (x.codigo !== "42501") fechada = false;
    }
  r.tabelaDaChaveFechada =
    fechada &&
    (await hashGuardado()).length === 1 &&
    (await hashGuardado())[0].chave_hash === HASH;
  const logado = {
    uid: "b1399998-0000-4000-8000-0000000000a1",
    claims: JSON.stringify({
      role: "authenticated",
      app_metadata: { role: "admin" },
    }),
  };
  let cartaoFechado = true;
  for (const sql of [
    "UPDATE public.assinatura_da_loja SET plano = 'invadido'",
    "INSERT INTO public.assinatura_da_loja (id, plano, status) VALUES (1, 'x', 'ativa') ON CONFLICT (id) DO UPDATE SET plano = 'invadido'",
    "DELETE FROM public.assinatura_da_loja",
    "TRUNCATE public.assinatura_da_loja",
  ]) {
    const x = await P.tentar("authenticated", sql, [], logado);
    if (x.codigo !== "42501") cartaoFechado = false;
  }
  const anonLe = await P.tentar(
    "anon",
    "SELECT * FROM public.assinatura_da_loja",
    [],
    {},
  );
  if (anonLe.codigo !== "42501") cartaoFechado = false;
  r.cartaoFechadoAoLogado =
    cartaoFechado && (await um()).plano === veneno.slice(0, 60);

  // ---- quem executa o que
  const hashLimpo = sha256("outra-chave");
  const anonDefine = await definir(hashLimpo, true, "anon");
  const authDefine = await definir(hashLimpo, true, "authenticated");
  const srvGrava = await gravar(
    CHAVE,
    { ...DADOS, atualizado_em: "2026-10-20T10:00:00Z" },
    false,
    "service_role",
  );
  r.aclDefinir =
    anonDefine.codigo === "42501" &&
    authDefine.codigo === "42501" &&
    (await hashGuardado())[0].chave_hash === HASH;
  const authGrava = await gravar(
    CHAVE,
    { ...DADOS, plano: "Logada", atualizado_em: "2026-10-20T11:00:00Z" },
    false,
    "authenticated",
  );
  r.aclGravar =
    srvGrava.codigo === "42501" &&
    (srvGrava.erro || "").includes("permission denied") &&
    !authGrava.erro &&
    authGrava.linhas?.[0]?.j.gravado === true;

  // ---- definir_chave: regras e rotacao
  await c.query("DELETE FROM public.assinatura_da_loja_chave");
  let regras = true;
  for (const ruim of [
    null,
    "",
    "abc",
    HASH.toUpperCase(),
    HASH.slice(1),
    `${HASH}0`,
    `${HASH.slice(0, 63)}g`,
    ` ${HASH.slice(1)}`,
  ]) {
    const x = await definir(ruim);
    if (x.erro !== "hash_invalido" || x.codigo !== "22023") regras = false;
  }
  r.hashInvalido = regras && (await hashGuardado()).length === 0;
  const d1 = await definir(HASH);
  const d2 = await definir(HASH);
  const d3 = await definir(sha256("outra"), null);
  const d4 = await definir(sha256("outra"), false);
  r.jaDefinida =
    !d1.erro &&
    d2.erro === "chave_ja_definida" &&
    d2.codigo === "23505" &&
    d3.erro === "chave_ja_definida" &&
    d4.erro === "chave_ja_definida" &&
    (await hashGuardado())[0].chave_hash === HASH;
  const novaChave = "a-nova-chave-da-loja-depois-da-rotacao-1234567890abcdef";
  const rot = await definir(sha256(novaChave), true);
  const velhaAbre = await gravar(CHAVE, {
    ...DADOS,
    atualizado_em: "2026-10-25T10:00:00Z",
  });
  const novaAbre = await gravar(novaChave, {
    ...DADOS,
    plano: "Rodada",
    atualizado_em: "2026-10-25T10:00:00Z",
  });
  r.rotacao =
    !rot.erro &&
    ehNegado(velhaAbre) &&
    !novaAbre.erro &&
    novaAbre.linhas?.[0]?.j.gravado === true &&
    (await hashGuardado()).length === 1;
  const reuso = [];
  for (let i = 0; i < 3; i++)
    reuso.push(
      await gravar(novaChave, {
        ...DADOS,
        plano: `Reuso${i}`,
        atualizado_em: `2026-10-26T1${i}:00:00Z`,
      }),
    );
  r.mesmaChaveServeSempre =
    reuso.every((x) => !x.erro && x.linhas?.[0]?.j.gravado === true) &&
    (await um()).plano === "Reuso2";
  // os CHECKs da tabela da chave (sessao direta): so a linha 1 e so hash de 64 hex minusculos
  let checks = true;
  for (const sql of [
    "INSERT INTO public.assinatura_da_loja_chave (id, chave_hash) VALUES (2, repeat('a', 64))",
    "INSERT INTO public.assinatura_da_loja_chave (id, chave_hash) VALUES (1, repeat('A', 64))",
    "UPDATE public.assinatura_da_loja_chave SET chave_hash = repeat('a', 63)",
    "UPDATE public.assinatura_da_loja_chave SET chave_hash = repeat('g', 64)",
  ]) {
    const x = await P.tentar(null, sql, [], {});
    if (x.codigo !== "23514") checks = false;
  }
  r.checksDaTabelaDaChave = checks;
  return r;
}

const montarLimpo = async () => {
  await limpar();
};
const rodar = () => P.emTransacao(roteiro, montarLimpo);

prova(
  "ROTEIRO: com o corpo desta migration todas as expectativas valem (autenticacao, gravacao, mais velho, simular, validacao, permissao)",
  async () => {
    const r = await rodar();
    assert.deepEqual(falhou(r), [], DIAG.slice(0, 5).join(" | "));
    assert.ok(
      Object.keys(r).length >= 38,
      `o roteiro encolheu: ${Object.keys(r).length}`,
    );
  },
);

// ---- MUTANTES: o mesmo roteiro sobre objetos sabotados fica vermelho na expectativa certa --------------------------------------
const trocar = (texto, de, para) => {
  assert.ok(texto.includes(de), `o trecho a sabotar sumiu: ${de.slice(0, 70)}`);
  const novo = texto.replace(de, para);
  assert.notEqual(novo, texto);
  return novo;
};
const GRAV = textoDe("assinatura_da_loja_gravar");
const MUTANTES = [
  [
    "compara o TEXTO cru da chave (nao o hash)",
    () =>
      trocar(
        GRAV,
        "v_enviado := encode(sha256(convert_to(COALESCE(p_chave, ''), 'UTF8')), 'hex');",
        "v_enviado := COALESCE(p_chave, '');",
      ),
    ["hashNaoAbre", "gravaFeliz"],
  ],
  [
    "sem chave definida abre a porta (o NULL da comparacao passa)",
    () =>
      trocar(
        GRAV,
        "IF v_guardado IS NULL OR p_chave IS NULL",
        "IF p_chave IS NULL",
      ),
    ["semChaveNegado"],
  ],
  [
    "lista branca removida (grava qualquer campo)",
    () =>
      trocar(
        GRAV,
        "IF FOUND THEN\n    RAISE EXCEPTION 'campo_nao_permitido'",
        "IF false THEN\n    RAISE EXCEPTION 'campo_nao_permitido'",
      ),
    ["listaBranca"],
  ],
  [
    "a gravacao mais velha tambem grava (sem o WHERE do ON CONFLICT)",
    () =>
      trocar(GRAV, "\n  WHERE a.atualizado_em <= EXCLUDED.atualizado_em;", ";"),
    ["maisVelhoIgnorado"],
  ],
  [
    "regravar o mesmo carimbo nao grava (< no lugar de <=)",
    () =>
      trocar(
        GRAV,
        "WHERE a.atualizado_em <= EXCLUDED.atualizado_em;",
        "WHERE a.atualizado_em < EXCLUDED.atualizado_em;",
      ),
    ["igualGrava"],
  ],
  [
    "a atualizacao toca recursos",
    () =>
      trocar(
        GRAV,
        "    atualizado_em = EXCLUDED.atualizado_em\n  WHERE",
        "    atualizado_em = EXCLUDED.atualizado_em,\n    recursos = '{}'::text[]\n  WHERE",
      ),
    ["recursosIntactos"],
  ],
  [
    "a atualizacao toca observacao",
    () =>
      trocar(
        GRAV,
        "    atualizado_em = EXCLUDED.atualizado_em\n  WHERE",
        "    atualizado_em = EXCLUDED.atualizado_em,\n    observacao = NULL\n  WHERE",
      ),
    ["recursosIntactos"],
  ],
  [
    "GRANT de definir_chave ao anon",
    () =>
      "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) TO anon;",
    ["aclDefinir"],
  ],
  [
    "o service_role executa a porta",
    () =>
      "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) TO service_role;",
    ["aclGravar"],
  ],
  [
    "simular tambem grava",
    () =>
      trocar(
        GRAV,
        "    RETURN jsonb_build_object('gravado', false, 'simulado', true, 'loja', v_loja, 'mudaria', v_mudaria,",
        "    INSERT INTO public.assinatura_da_loja AS a (id, plano, status, ciclo, atualizado_em) VALUES (1, v_plano, v_status, v_ciclo, v_instante) ON CONFLICT (id) DO UPDATE SET plano = EXCLUDED.plano;\n    RETURN jsonb_build_object('gravado', false, 'simulado', true, 'loja', v_loja, 'mudaria', v_mudaria,",
      ),
    ["simularNaoGrava", "simularLinhaNova"],
  ],
  [
    "simular NULL vira escrita (a recusa do NULL sumiu)",
    () => trocar(GRAV, "IF p_simular IS NULL THEN", "IF false THEN"),
    ["simularNuloRecusado"],
  ],
  [
    "null nao apaga o valor antigo (COALESCE no UPDATE)",
    () =>
      trocar(
        GRAV,
        "    suporte_whatsapp = EXCLUDED.suporte_whatsapp,",
        "    suporte_whatsapp = COALESCE(EXCLUDED.suporte_whatsapp, a.suporte_whatsapp),",
      ),
    ["nullApaga"],
  ],
  [
    "olha p_dados ANTES de autenticar",
    () =>
      trocar(
        GRAV,
        "BEGIN\n  -- a) Autentica",
        "BEGIN\n  IF p_dados IS NOT NULL AND jsonb_typeof(p_dados) = 'object' AND EXISTS (SELECT 1 FROM jsonb_object_keys(p_dados) AS x WHERE x <> ALL (v_chaves)) THEN\n    RAISE EXCEPTION 'campo_nao_permitido' USING ERRCODE = '22023';\n  END IF;\n  -- a) Autentica",
      ),
    ["autorizaPrecedeDados"],
  ],
  [
    "a mensagem diferencia 'sem chave' de 'chave errada'",
    () =>
      trocar(
        GRAV,
        "  IF v_guardado IS NULL OR p_chave IS NULL",
        "  IF v_guardado IS NULL THEN\n    RAISE EXCEPTION 'sem_chave_definida' USING ERRCODE = '42501';\n  END IF;\n  IF p_chave IS NULL",
      ),
    ["autorizacaoUniforme"],
  ],
  [
    "atualizado_em no futuro e aceito",
    () =>
      trocar(
        GRAV,
        "IF v_instante > clock_timestamp() + interval '1 day' THEN",
        "IF false THEN",
      ),
    ["futuroRecusado"],
  ],
  [
    "data solta (so o cast, sem a forma AAAA-MM-DD)",
    () =>
      trocar(
        GRAV,
        "IF v_texto IS NULL OR v_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN",
        "IF v_texto IS NULL THEN",
      ),
    ["tipos"],
  ],
  [
    "valor arredondado em silencio (49.995 vira 50.00)",
    () => trocar(GRAV, " OR v_numero <> round(v_numero, 2) THEN", " THEN"),
    ["tipos"],
  ],
  [
    "valor aceita texto",
    () =>
      trocar(
        GRAV,
        "IF jsonb_typeof(p_dados -> 'valor_mensal') = 'number' THEN\n    v_numero := (p_dados -> 'valor_mensal')::numeric;",
        "IF jsonb_typeof(p_dados -> 'valor_mensal') IN ('number', 'string') THEN\n    v_numero := (p_dados ->> 'valor_mensal')::numeric;",
      ),
    ["tipos"],
  ],
];
for (const [nome, sabotar, esperado] of MUTANTES) {
  prova(
    `MUTANTE ${nome}: o roteiro fica vermelho na expectativa certa`,
    async () => {
      const sql = sabotar();
      const r = await P.emTransacao(async () => {
        await C().query(sql);
        return roteiro();
      }, montarLimpo);
      const f = falhou(r);
      for (const k of esperado)
        assert.ok(
          f.includes(k),
          `o mutante '${nome}' devia reprovar ${k}, reprovou ${JSON.stringify(f)}`,
        );
    },
  );
}

// ---- CONCORRENCIA: duas conexoes reais com COMMIT ---------------------------------------------------------------------------------
const nova = async () => {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  await c.query("SET TIME ZONE 'UTC'");
  return c;
};
const dorme = (ms) => new Promise((res) => setTimeout(res, ms));
const SQL_GRAVAR =
  "SELECT public.assinatura_da_loja_gravar($1::text, $2::jsonb, false) AS j";
/** BEGIN + SET LOCAL ROLE anon + a chamada (a transacao fica ABERTA se `abrir`). */
async function emVoo(c, dados, abrir) {
  await c.query("BEGIN");
  await c.query("SET LOCAL ROLE anon");
  const p = c.query(SQL_GRAVAR, [CHAVE, JSON.stringify(dados)]);
  if (abrir) return p;
  const r = await p;
  await c.query("COMMIT");
  return r;
}
const pendente = async (p, ms = 400) => {
  let resolveu = false;
  p.then(
    () => (resolveu = true),
    () => (resolveu = true),
  );
  await dorme(ms);
  return !resolveu;
};
async function zerar(dono) {
  await dono.query("DELETE FROM public.assinatura_da_loja");
  await dono.query("DELETE FROM public.assinatura_da_loja_chave");
  await dono.query(
    "INSERT INTO public.assinatura_da_loja_chave (id, chave_hash) VALUES (1, $1)",
    [HASH],
  );
}

/** Roda os cenarios de corrida; `mutante` (SQL) e' instalado antes e a funcao volta ao corpo da migration no fim. */
async function corridas(mutante) {
  const dono = await nova();
  const c1 = await nova();
  const c2 = await nova();
  const r = {};
  try {
    if (mutante) await dono.query(mutante);
    // (1) sobre linha EXISTENTE: c1 atualiza (T2) e segura; c2 tenta T1 (< T2, > guardado): espera a trava da linha e, depois do COMMIT de c1, reavalia o WHERE -> mais_velho
    await zerar(dono);
    await dono.query(
      "INSERT INTO public.assinatura_da_loja (id, plano, status, ciclo, atualizado_em) VALUES (1, 'T0', 'ativa', 'mensal', '2026-10-13T09:00:00Z')",
    );
    const p1 = emVoo(
      c1,
      { ...DADOS, plano: "T2", atualizado_em: "2026-10-13T12:00:00Z" },
      true,
    );
    await p1;
    const p2 = emVoo(
      c2,
      { ...DADOS, plano: "T1", atualizado_em: "2026-10-13T11:00:00Z" },
      true,
    );
    const esperou = await pendente(p2);
    await c1.query("COMMIT");
    const r2 = (await p2).rows[0].j;
    await c2.query("COMMIT");
    const l = (await dono.query("SELECT plano FROM public.assinatura_da_loja"))
      .rows;
    r.maisVelhoPerdeACorrida =
      esperou &&
      r2.gravado === false &&
      r2.motivo === "mais_velho" &&
      l.length === 1 &&
      l[0].plano === "T2";

    // (2) PRIMEIRA insercao concorrente (sem linha): c1 insere T1 e segura; c2 insere T2 > T1: espera, nao da erro de chave duplicada e vence (T2)
    await zerar(dono);
    const q1 = emVoo(
      c1,
      { ...DADOS, plano: "P1", atualizado_em: "2026-10-13T10:00:00Z" },
      true,
    );
    await q1;
    const q2 = emVoo(
      c2,
      { ...DADOS, plano: "P2", atualizado_em: "2026-10-13T10:00:05Z" },
      true,
    );
    const esperou2 = await pendente(q2);
    await c1.query("COMMIT");
    const s2 = (await q2).rows[0].j;
    await c2.query("COMMIT");
    const l2 = (
      await dono.query(
        "SELECT plano, to_char(atualizado_em AT TIME ZONE 'UTC', 'HH24:MI:SS') AS t FROM public.assinatura_da_loja",
      )
    ).rows;
    r.primeiraInsercaoConcorrente =
      esperou2 &&
      s2.gravado === true &&
      l2.length === 1 &&
      l2[0].plano === "P2" &&
      l2[0].t === "10:00:05";

    // (3) o inverso: a insercao concorrente mais VELHA que a primeira e' ignorada, sem erro
    await zerar(dono);
    const t1 = emVoo(
      c1,
      { ...DADOS, plano: "N1", atualizado_em: "2026-10-13T10:00:05Z" },
      true,
    );
    await t1;
    const t2 = emVoo(
      c2,
      { ...DADOS, plano: "N0", atualizado_em: "2026-10-13T10:00:00Z" },
      true,
    );
    await pendente(t2);
    await c1.query("COMMIT");
    const s3 = (await t2).rows[0].j;
    await c2.query("COMMIT");
    const l3 = (await dono.query("SELECT plano FROM public.assinatura_da_loja"))
      .rows;
    r.insercaoVelhaConcorrenteIgnorada =
      s3.gravado === false &&
      s3.motivo === "mais_velho" &&
      l3.length === 1 &&
      l3[0].plano === "N1";
  } finally {
    for (const c of [c1, c2]) await c.query("ROLLBACK").catch(() => {});
    if (mutante)
      await dono.query(textoDe("assinatura_da_loja_gravar")).catch(() => {});
    await dono.query("DELETE FROM public.assinatura_da_loja").catch(() => {});
    await dono
      .query("DELETE FROM public.assinatura_da_loja_chave")
      .catch(() => {});
    for (const c of [c1, c2, dono]) await c.end().catch(() => {});
  }
  return r;
}

prova(
  "CONCORRENCIA: duas conexoes reais - a mais velha perde a corrida (sobre linha existente e sobre a primeira insercao) e nunca ha erro de chave duplicada",
  async () => {
    const r = await corridas(null);
    assert.deepEqual(falhou(r), [], JSON.stringify(r));
    assert.equal(Object.keys(r).length, 3);
  },
);

prova(
  "CONCORRENCIA: o mutante sem o WHERE do ON CONFLICT PERDE a corrida (a mais velha sobrescreve a mais nova); o corpo volta ao da migration",
  async () => {
    const sabotada = trocar(
      GRAV,
      "\n  WHERE a.atualizado_em <= EXCLUDED.atualizado_em;",
      ";",
    );
    const r = await corridas(sabotada);
    const f = falhou(r);
    assert.ok(
      f.includes("maisVelhoPerdeACorrida"),
      `o mutante devia perder a corrida, reprovou ${JSON.stringify(f)}`,
    );
    const dono = await nova();
    try {
      const h = (
        await dono.query(
          `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = '${GRAVAR}'::regprocedure`,
        )
      ).rows[0].h;
      assert.equal(h, H_GRAVAR, "a funcao nao voltou ao corpo da migration");
    } finally {
      await dono.end();
    }
  },
);

prova(
  "CONCORRENCIA: definir_chave concorrente sem substituir - uma so vence, a outra recebe chave_ja_definida, e a que venceu e' a que ficou",
  async () => {
    const dono = await nova();
    const c1 = await nova();
    const c2 = await nova();
    try {
      await dono.query("DELETE FROM public.assinatura_da_loja_chave");
      await c1.query("BEGIN");
      await c1.query("SET LOCAL ROLE service_role");
      await c1.query(
        "SELECT public.assinatura_da_loja_definir_chave($1::text, false)",
        [sha256("primeira")],
      );
      await c2.query("BEGIN");
      await c2.query("SET LOCAL ROLE service_role");
      const p2 = c2
        .query(
          "SELECT public.assinatura_da_loja_definir_chave($1::text, false)",
          [sha256("segunda")],
        )
        .then(
          () => ({ ok: true }),
          (e) => ({ ok: false, codigo: e.code, erro: e.message }),
        );
      assert.ok(await pendente(p2), "a segunda devia esperar a primeira");
      await c1.query("COMMIT");
      const x = await p2;
      await c2.query("ROLLBACK");
      assert.equal(x.ok, false);
      assert.equal(x.erro, "chave_ja_definida");
      assert.equal(x.codigo, "23505");
      const l = (
        await dono.query(
          "SELECT chave_hash FROM public.assinatura_da_loja_chave",
        )
      ).rows;
      assert.equal(l.length, 1);
      assert.equal(l[0].chave_hash, sha256("primeira"));
    } finally {
      for (const c of [c1, c2]) await c.query("ROLLBACK").catch(() => {});
      await dono
        .query("DELETE FROM public.assinatura_da_loja_chave")
        .catch(() => {});
      for (const c of [c1, c2, dono]) await c.end().catch(() => {});
    }
  },
);

// ---- A MIGRATION: so objeto novo, reaplicar, rollback, pre-voo, pos-voo, atomicidade, trava, consultas ---------------------------------------------
const estado = async () => {
  const q = async (sql, params) => (await C().query(sql, params)).rows;
  return {
    fns: await q(
      `SELECT p.oid::regprocedure::text AS f, md5(replace(p.prosrc, chr(13), '')) AS md5, p.prosecdef, p.provolatile, p.proconfig::text AS cfg,
              p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS dono, pg_get_function_result(p.oid) AS ret, pg_get_function_arguments(p.oid) AS args
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[]) ORDER BY 1`,
      [NOVOS.funcoes],
    ),
    tabela: await q(
      `SELECT c.relkind, c.relrowsecurity AS rls, c.relforcerowsecurity AS forca, c.relacl::text AS acl, pg_get_userbyid(c.relowner) AS dono,
              (SELECT count(*)::int FROM pg_policy WHERE polrelid = c.oid) AS politicas
         FROM pg_class c WHERE c.oid = to_regclass('public.assinatura_da_loja_chave')`,
    ),
    colunas: await q(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS padrao
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = to_regclass('public.assinatura_da_loja_chave') AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
    ),
    restricoes: await q(
      "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = to_regclass('public.assinatura_da_loja_chave') ORDER BY 1",
    ),
  };
};
const aplicado = async (c = C()) =>
  (
    await c.query(
      `SELECT to_regprocedure('${GRAVAR}') IS NOT NULL AND to_regprocedure('${DEFINIR}') IS NOT NULL AND to_regclass('public.assinatura_da_loja_chave') IS NOT NULL AS x`,
    )
  ).rows[0].x;
const naoExiste = async () =>
  (
    await C().query(
      `SELECT to_regprocedure('${GRAVAR}') IS NULL AND to_regprocedure('${DEFINIR}') IS NULL AND to_regclass('public.assinatura_da_loja_chave') IS NULL AS x`,
    )
  ).rows[0].x;
const retrato = async () => {
  const r = await P.retrato(NOVOS);
  r.tabelas = r.tabelas.filter((t) => t.t !== "assinatura_da_loja_chave");
  return r;
};

prova(
  "MIGRATION: o estado desta arvore e' o da migration (corpos, ACL, atributos, tabela selada, colunas, restricoes) e o dono das funcoes e' quem escreve",
  async () => {
    await P.emTransacao(async () => {
      const e = await estado();
      assert.equal(e.fns.length, 2);
      const por = (n) => e.fns.find((f) => f.f.startsWith(`${n}(`));
      assert.equal(por("assinatura_da_loja_gravar").md5, H_GRAVAR);
      assert.equal(por("assinatura_da_loja_definir_chave").md5, H_DEFINIR);
      for (const f of e.fns) {
        assert.equal(f.prosecdef, true);
        assert.equal(f.provolatile, "v");
        assert.equal(f.cfg, '{"search_path=public, pg_temp"}');
      }
      assert.equal(e.tabela[0].relkind, "r");
      assert.equal(e.tabela[0].rls, true);
      assert.equal(e.tabela[0].forca, false);
      assert.equal(e.tabela[0].politicas, 0);
      assert.deepEqual(
        e.colunas.map(
          (c) => `${c.attname}:${c.tipo}:${c.attnotnull}:${c.padrao}`,
        ),
        [
          "id:smallint:true:1",
          "chave_hash:text:true:null",
          "criada_em:timestamp with time zone:true:now()",
        ],
      );
      assert.equal(e.restricoes.length, 3);
    });
  },
);

prova(
  "MIGRATION: so objeto novo - o retrato do que ja existia e' IDENTICO com a migration, sem ela (depois do rollback) e reaplicada",
  async () => {
    await P.emTransacao(async () => {
      const com = await retrato();
      await C().query(ROLLBACK_SQL);
      assert.equal(await naoExiste(), true);
      const sem = await retrato();
      await C().query(MIGRATION);
      const depois = await retrato();
      assert.deepEqual(sem, com, "a migration mudou algo que ja existia");
      assert.deepEqual(depois, com, "reaplicar mudou algo que ja existia");
    });
  },
);

prova(
  "MIGRATION: reaplicar (2x) e em CRLF deixa o MESMO estado; a chave guardada e o cartao ficam como estavam",
  async () => {
    await P.emTransacao(async () => {
      await limpar();
      await C().query(
        "INSERT INTO public.assinatura_da_loja_chave (id, chave_hash) VALUES (1, $1)",
        [HASH],
      );
      await C().query(
        "INSERT INTO public.assinatura_da_loja (id, plano, status, ciclo, recursos, observacao, atualizado_em) VALUES (1, 'Pro', 'ativa', 'anual', ARRAY['x'], 'nota', '2026-10-13T10:00:00Z')",
      );
      const antes = await estado();
      const cartaoAntes = JSON.stringify(await cartao());
      await C().query(MIGRATION);
      await C().query(emCRLF(MIGRATION));
      assert.deepEqual(await estado(), antes);
      assert.equal(JSON.stringify(await cartao()), cartaoAntes);
      assert.deepEqual(await hashGuardado(), [{ chave_hash: HASH }]);
      const x = await gravar(CHAVE, {
        ...DADOS,
        atualizado_em: "2026-10-14T10:00:00Z",
      });
      assert.equal(
        x.linhas?.[0]?.j.gravado,
        true,
        "a chave guardada deixou de abrir a porta",
      );
    });
  },
);

prova(
  "MIGRATION: o rollback derruba as 2 funcoes e a tabela da chave, MANTEM o cartao, e repetir e reaplicar e seguro (a chave guardada se perde)",
  async () => {
    await P.emTransacao(async () => {
      await limpar();
      await C().query(
        "INSERT INTO public.assinatura_da_loja_chave (id, chave_hash) VALUES (1, $1)",
        [HASH],
      );
      await C().query(
        "INSERT INTO public.assinatura_da_loja (id, plano, status, ciclo, recursos, atualizado_em) VALUES (1, 'Pro', 'ativa', 'mensal', ARRAY['a'], '2026-10-13T10:00:00Z')",
      );
      await C().query(ROLLBACK_SQL);
      assert.equal(await naoExiste(), true);
      assert.equal((await cartao()).length, 1, "o rollback apagou o cartao");
      assert.equal((await um()).plano, "Pro");
      await C().query(ROLLBACK_SQL); // no-op
      assert.equal(await naoExiste(), true);
      await C().query(MIGRATION);
      assert.equal(await aplicado(), true);
      assert.deepEqual(
        await hashGuardado(),
        [],
        "a chave guardada devia ter se perdido com a tabela",
      );
      assert.equal(
        ehNegado(await gravar(CHAVE, DADOS)),
        true,
        "sem chave definida a porta fica fechada",
      );
      assert.equal((await um()).plano, "Pro");
    });
  },
);

prova(
  "MIGRATION: o rollback RECUSA corpo desconhecido e tabela da chave torta, sem apagar nada",
  async () => {
    await P.emTransacao(async () => {
      await C().query(
        "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
      );
      await P.recusa(
        ROLLBACK_SQL,
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.assinatura_da_loja_gravar/,
      );
      assert.equal(
        await aplicado(),
        true,
        "o rollback apagou algo antes de recusar",
      );
      await C().query(textoDe("assinatura_da_loja_gravar"));
      await C().query(
        "ALTER TABLE public.assinatura_da_loja_chave ADD COLUMN extra text",
      );
      await P.recusa(ROLLBACK_SQL, /nao tem a forma da 20261399998000/);
      assert.equal(await aplicado(), true);
    });
  },
);

prova(
  "PRE-VOO: recusa SEM escrever (corpo desconhecido, outra assinatura, sobrecarga, tabela da chave torta, cartao torto, store_config sem store_name, cartao ausente)",
  async () => {
    const casos = [
      [
        "corpo desconhecido da porta (o resto nao pode ser criado)",
        async () => {
          await C().query(ROLLBACK_SQL);
          await C().query(
            "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
          );
        },
        /public\.assinatura_da_loja_gravar\(text, jsonb, boolean\) ja existe com corpo desconhecido/,
      ],
      [
        "porta com OUTRA assinatura",
        async () => {
          await C().query(ROLLBACK_SQL);
          await C().query(
            "CREATE FUNCTION public.assinatura_da_loja_gravar(p_x text) RETURNS void LANGUAGE sql AS $$ SELECT $$",
          );
        },
        /existe em public com outra assinatura/,
      ],
      [
        "sobrecarga da porta",
        async () => {
          await C().query(
            "CREATE FUNCTION public.assinatura_da_loja_gravar(p_x text) RETURNS void LANGUAGE sql AS $$ SELECT $$",
          );
        },
        /tem sobrecarga em public/,
      ],
      [
        "tabela da chave com outra forma",
        async () => {
          await C().query(ROLLBACK_SQL);
          await C().query(
            "CREATE TABLE public.assinatura_da_loja_chave (id integer, chave text)",
          );
        },
        /assinatura_da_loja_chave existe e nao tem a forma desta migration/,
      ],
      [
        "cartao com coluna a mais",
        async () => {
          await C().query(ROLLBACK_SQL);
          await C().query(
            "ALTER TABLE public.assinatura_da_loja ADD COLUMN extra text",
          );
        },
        /assinatura_da_loja nao tem a forma da 20261177000000/,
      ],
      [
        "cartao ausente",
        async () => {
          await C().query(ROLLBACK_SQL);
          await C().query(
            "ALTER TABLE public.assinatura_da_loja RENAME TO assinatura_da_loja_x",
          );
        },
        /public\.assinatura_da_loja nao existe/,
      ],
      [
        "store_config sem store_name",
        async () => {
          await C().query(ROLLBACK_SQL);
          await C().query(
            "ALTER TABLE public.store_config RENAME COLUMN store_name TO nome_x",
          );
        },
        /store_config nao tem id bigint e store_name text/,
      ],
    ];
    for (const [nome, montar, padrao] of casos) {
      await P.emTransacao(async () => {
        await montar();
        const antes = await estado();
        const r = await P.recusa(MIGRATION, padrao);
        assert.match(r.erro, /B1_BASELINE_DIVERGENT/, nome);
        assert.deepEqual(
          await estado(),
          antes,
          `${nome}: o pre-voo recusou mas deixou rastro`,
        );
      });
    }
  },
);

prova(
  "POS-VOO: passa no estado da migration e recusa cada estrago (tabela aberta, politica, RLS, ACL das funcoes, corpo, atributos, sobrecarga, coluna, CHECK, dono)",
  async () => {
    const bloco = P.blocoDe(MIGRATION, "conferencia_20261399998000");
    await P.emTransacao(async () => {
      assert.equal(
        await P.aplicar(bloco),
        null,
        "o pos-voo devia passar no estado da migration",
      );
    });
    const estragos = [
      [
        "anon le a tabela da chave",
        "GRANT SELECT ON public.assinatura_da_loja_chave TO anon",
      ],
      [
        "service_role escreve na tabela da chave",
        "GRANT INSERT ON public.assinatura_da_loja_chave TO service_role",
      ],
      [
        "PUBLIC na tabela da chave",
        "GRANT SELECT ON public.assinatura_da_loja_chave TO PUBLIC",
      ],
      [
        "coluna aberta ao authenticated",
        "GRANT SELECT (chave_hash) ON public.assinatura_da_loja_chave TO authenticated",
      ],
      [
        "politica na tabela da chave",
        "CREATE POLICY p ON public.assinatura_da_loja_chave FOR SELECT TO authenticated USING (true)",
      ],
      [
        "RLS desligada",
        "ALTER TABLE public.assinatura_da_loja_chave DISABLE ROW LEVEL SECURITY",
      ],
      [
        "RLS forcada",
        "ALTER TABLE public.assinatura_da_loja_chave FORCE ROW LEVEL SECURITY",
      ],
      [
        "definir_chave ao anon",
        "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) TO anon",
      ],
      [
        "definir_chave ao authenticated",
        "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) TO authenticated",
      ],
      [
        "definir_chave sem o service_role",
        "REVOKE EXECUTE ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) FROM service_role",
      ],
      [
        "definir_chave a PUBLIC",
        "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) TO PUBLIC",
      ],
      [
        "a porta sem o authenticated",
        "REVOKE EXECUTE ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) FROM authenticated",
      ],
      [
        "a porta sem o anon",
        "REVOKE EXECUTE ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) FROM anon",
      ],
      [
        "a porta ao service_role",
        "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) TO service_role",
      ],
      [
        "a porta a PUBLIC",
        "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) TO PUBLIC",
      ],
      [
        "corpo da porta trocado",
        "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{}'::jsonb; END; $f$",
      ],
      [
        "search_path da porta",
        "ALTER FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) SET search_path = public",
      ],
      [
        "porta como SECURITY INVOKER",
        "ALTER FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) SECURITY INVOKER",
      ],
      [
        "definir_chave como STABLE",
        "ALTER FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) STABLE",
      ],
      [
        "sobrecarga da porta",
        "CREATE FUNCTION public.assinatura_da_loja_gravar(p_x text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$",
      ],
      [
        "coluna a mais na tabela da chave",
        "ALTER TABLE public.assinatura_da_loja_chave ADD COLUMN extra text",
      ],
      [
        "CHECK do hash removido",
        "ALTER TABLE public.assinatura_da_loja_chave DROP CONSTRAINT assinatura_da_loja_chave_chave_hash_check",
      ],
      [
        "CHECK da linha unica removido",
        "ALTER TABLE public.assinatura_da_loja_chave DROP CONSTRAINT assinatura_da_loja_chave_id_check",
      ],
      [
        "default do id removido",
        "ALTER TABLE public.assinatura_da_loja_chave ALTER COLUMN id DROP DEFAULT",
      ],
    ];
    for (const [nome, sql] of estragos) {
      await P.emTransacao(async () => {
        await C().query(sql);
        const r = await P.recusa(bloco, /B2_POSVOO_DIVERGENTE/);
        assert.ok(r, nome);
      });
    }
  },
);

prova(
  "ATOMICIDADE: pos-voo que falha numa conexao SEM BEGIN desfaz o arquivo inteiro (nada fica: nem tabela, nem funcao)",
  async () => {
    const dono = await nova();
    try {
      await dono.query(ROLLBACK_SQL); // commit proprio: estado "antes"
      assert.equal(await aplicado(dono), false);
      const sabotada = trocar(
        MIGRATION,
        `'${H_GRAVAR}', 'jsonb', true, true)`,
        `'${"0".repeat(32)}', 'jsonb', true, true)`,
      );
      let erro;
      try {
        await dono.query(sabotada);
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "o arquivo sabotado devia falhar no pos-voo");
      assert.match(erro.message, /B2_POSVOO_DIVERGENTE/);
      const r = (
        await dono.query(
          `SELECT to_regprocedure('${GRAVAR}') IS NULL AND to_regprocedure('${DEFINIR}') IS NULL AND to_regclass('public.assinatura_da_loja_chave') IS NULL AS vazio`,
        )
      ).rows[0].vazio;
      assert.equal(r, true, "a falha no fim deixou objetos para tras");
    } finally {
      await dono.query(MIGRATION).catch(() => {});
      await dono.end();
    }
    const ok = await nova();
    try {
      assert.equal(
        await aplicado(ok),
        true,
        "a migration nao foi restaurada no clone",
      );
    } finally {
      await ok.end();
    }
  },
);

prova(
  "TRAVA: uma leitura em voo da tabela da chave faz a migration FALHAR LIMPA no lock_timeout de 5 s (55P03) sem mudar nada, e depois aplica",
  async () => {
    const c2 = await nova();
    const c1 = await nova();
    try {
      await c2.query("BEGIN");
      await c2.query("SELECT count(*) FROM public.assinatura_da_loja_chave"); // segura ACCESS SHARE
      await c1.query("BEGIN");
      const antes = await c1.query(
        "SELECT md5(prosrc) AS h FROM pg_proc WHERE oid = $1::regprocedure",
        [GRAVAR],
      );
      const t0 = Date.now();
      let erro;
      try {
        await c1.query(MIGRATION);
      } catch (e) {
        erro = e;
      }
      const espera = Date.now() - t0;
      await c1.query("ROLLBACK");
      assert.ok(
        erro,
        "a migration devia falhar no lock_timeout, nao travar nem passar",
      );
      assert.equal(
        erro.code,
        "55P03",
        `esperava lock_not_available, veio ${erro.code}: ${erro.message}`,
      );
      assert.ok(
        espera >= 4000 && espera < 15000,
        `esperou ${espera} ms (esperado ~5 s)`,
      );
      await c2.query("ROLLBACK");
      await c1.query("BEGIN");
      await c1.query(MIGRATION);
      assert.equal(await aplicado(c1), true);
      const depois = await c1.query(
        "SELECT md5(prosrc) AS h FROM pg_proc WHERE oid = $1::regprocedure",
        [GRAVAR],
      );
      assert.equal(depois.rows[0].h, antes.rows[0].h);
      await c1.query("ROLLBACK");
    } finally {
      await c2.query("ROLLBACK").catch(() => {});
      await c1.query("ROLLBACK").catch(() => {});
      await c2.end().catch(() => {});
      await c1.end().catch(() => {});
    }
  },
);

prova(
  "CONSULTAS 150c/150d: a 150c fecha 8 de 8 com a migration e abre 7 sem ela; a 150d faz o contrario; cada estrago reprova o item certo; o rol e o do conferir-banco",
  async () => {
    await P.emTransacao(async () => {
      assert.deepEqual(await P.consulta(A150C), []);
      assert.deepEqual(await P.consulta(B150D), [
        "assinatura_da_loja_chave, assinatura_da_loja_definir_chave e assinatura_da_loja_gravar: ainda NAO existem",
      ]);
    });
    await P.emTransacao(async () => {
      await C().query(ROLLBACK_SQL);
      const f = await P.consulta(A150C);
      assert.equal(f.length, 7, "sem a migration so o controle responde sim");
      assert.deepEqual(await P.consulta(B150D), []);
    });
    const estragos = [
      [
        "definir_chave ao anon",
        "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_definir_chave(text, boolean) TO anon",
        /definir_chave: atributos/,
      ],
      [
        "a porta ao service_role",
        "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_gravar(text, jsonb, boolean) TO service_role",
        /gravar: atributos/,
      ],
      [
        "tabela da chave lida pelo anon",
        "GRANT SELECT ON public.assinatura_da_loja_chave TO anon",
        /nenhum privilegio/,
      ],
      [
        "politica na tabela da chave",
        "CREATE POLICY p ON public.assinatura_da_loja_chave FOR SELECT TO authenticated USING (true)",
        /RLS ligada sem FORCE e nenhuma politica/,
      ],
      [
        "corpo da porta trocado",
        "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{}'::jsonb; END; $f$",
        /gravar: uma so, com o corpo/,
      ],
    ];
    for (const [nome, sql, padrao] of estragos) {
      await P.emTransacao(async () => {
        await C().query(sql);
        const f = await P.consulta(A150C);
        assert.equal(
          f.length >= 1 && f.every((x) => padrao.test(x)),
          true,
          `${nome}: reprovou ${JSON.stringify(f)}`,
        );
      });
    }
  },
);

(async () => {
  await P.conectar();
  try {
    await P.executar("a-loja-recebe-o-plano-por-porta-unica");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
