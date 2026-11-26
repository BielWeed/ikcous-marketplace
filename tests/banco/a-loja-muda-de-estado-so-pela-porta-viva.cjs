"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename, security/detect-non-literal-regexp --
 * Toda chave indexada e todo fragmento de RegExp vêm de constante do próprio teste; os únicos caminhos de arquivo são os
 * das migrations 20261460/20261470, dos rollbacks e das consultas 183a/183b dentro do repositório. */
/**
 * PROVA VIVA da migration 20261470000000_a_loja_muda_de_estado_so_pela_porta.sql contra o Postgres EFÊMERO com as
 * migrations aplicadas do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O DEFEITO: depois da 20261460 o estado de vida da loja (ativa, adormecida, encerrada) mudava por qualquer UPDATE direto, sem
 * proteger a IKCOUS e a Savy, sem conferir a release e sem rastro. Agora só a porta public.frota_mudar_estado muda o estado, um
 * gatilho em frota_lojas recusa o resto e cada mudança deixa uma linha em public.frota_estado_historico.
 *
 * O QUE SE PROVA (como o dono do banco, o único que executa a porta; e como anon, authenticated e service_role para a ACL):
 *   (a) cada recusa da porta (vencida, sem validade, validade de mais de 1 h, destino desconhecido, de = para, sha, motivo, ENCERRAR
 *       saindo de ativa e de adormecida, loja inexistente ou de outro ref, estado atual diferente, REABRIR, base diferente ao acordar
 *       e ao reabrir) sem escrever nada;
 *   (b) adormecer, acordar, encerrar e reabrir: UMA linha no histórico cada, com quem = session_user e em = estado_desde = now();
 *       (b2) estado_sha só muda ao sair de ativa ou voltar a ela: adormecida na A, encerrada na B, adormecida de novo na C, e acordar
 *       exige a base A (B e C recusadas); o rastro guarda o sha de cada momento;
 *   (c) IKCOUS e Savy nunca saem de ativa: nem pela porta, nem com a variável ligada à mão, nem nascendo ou trocando de ref;
 *   (d) UPDATE direto de estado, estado_desde ou estado_sha (trocado ou apagado) e INSERT fora de ativa recusados; a variável da porta é desligada logo
 *       depois do UPDATE dela; rotação da publishable_key, troca de URL, nome e ativa passam;
 *   (e) ACL: anon, authenticated e service_role não executam a porta nem tocam o histórico nem a sequência;
 *   (f) atomicidade: se o rastro falha, a troca de estado volta junto;
 *   (g) duas conexões na mesma loja ao mesmo tempo: uma muda, a outra é recusada (FOR UPDATE), um rastro só;
 *   (h) linha que já existia antes da migration: nada muda nela e o histórico nasce vazio;
 *   (i) reaplicar 2x (LF e CRLF) não muda OID, corpo, ACL, gatilho, tabela nem linha;
 *   (j) rollback comum tira porta e gatilho e PRESERVA o histórico (2x igual; reaplicar volta); o destrutivo exige a confirmação e o
 *       comum antes; o destrutivo da 20261460 só depois do comum desta;
 *   (k) pré-voo recusa estado divergente (B1_BASELINE_DIVERGENT) sem escrever; o rollback comum também;
 *   (l) transação: sem COMMIT escondido e trava ocupada faz a migration desistir em 5 s sem escrever;
 *   (m) consultas 183a/183b EXECUTADAS no catálogo real, com defeitos plantados;
 *   (n) MUTANTES da migration (trava das refs, troca condicionada, REVOKE, conferências da porta, FOR UPDATE): cada um derruba uma
 *       asserção, pelo motivo certo.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-loja-muda-de-estado-so-pela-porta-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const NOME = "20261470000000_a_loja_muda_de_estado_so_pela_porta.sql";
const NOME_1460 = "20261460000000_a_loja_tem_estado_de_vida.sql";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);
const ROLLBACK_1460 = ler(`rollback-manual-${NOME_1460}`);
const DESTRUTIVO_1460 = ler(`rollback-manual-destrutivo-${NOME_1460}`);
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const A183 = "183a-conferir-a-loja-muda-de-estado-so-pela-porta-aplicado";
const B183 = "183b-antes-a-loja-muda-de-estado-so-pela-porta-ausente";

const MD5_PORTA = "d1dd1ae579be7a6f5c8687ea039cb3b8";
const MD5_GATILHO = "58d85afbab0acb79eef70d03c304fb80";
const PORTA =
  "public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)";
const GATILHO_FN = "public.frota_lojas_estado_so_pela_porta()";
const SEQ = "public.frota_estado_historico_id_seq";
const CAF = "cafkrminfnokvgjqtkle";
const SAVY = "gnjsrucsmjkajijrakzr";
const SHA1 = "1".repeat(40);
const SHA2 = "2".repeat(40);
const SHA3 = "3".repeat(40);
const COLUNAS_DA_PORTA = [
  "id",
  "nome",
  "dominio_publico",
  "estado",
  "estado_desde",
  "estado_sha",
];

const loja = (id, ref) => ({
  id: `l1470-${id}`,
  nome: `Loja ${id} da prova 1470`,
  dominio_publico: `${id}.l1470.teste`,
  project_ref: ref,
  supabase_url: `https://${ref}.supabase.co`,
  publishable_key: `pk_l1470_${id}`,
});
const ATIVA = loja("ativa", "aaaaaaaaaaaaaaaaaaab");
const OUTRA = loja("outra", "aaaaaaaaaaaaaaaaaaac");
const IKCOUS = loja("ikcous", CAF);
const SAVY_LOJA = loja("savy", SAVY);
const LOJAS = [ATIVA, OUTRA, IKCOUS, SAVY_LOJA];

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  const sp = `sp_1470_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  }
}
/** Roda `fn` numa transação SEMPRE desfeita. */
async function desfeita(c, fn) {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
async function semente(c, lojas = LOJAS) {
  for (const l of lojas)
    await c.query(
      "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa) VALUES ($1, $2, $3, $4, $5, $6, true)",
      [
        l.id,
        l.nome,
        l.dominio_publico,
        l.project_ref,
        l.supabase_url,
        l.publishable_key,
      ],
    );
}
const SQL_DA_PORTA = `SELECT * FROM public.frota_mudar_estado(p_id => $1, p_ref => $2, p_de => $3, p_para => $4, p_sha => $5, p_base => $6,
  p_motivo => $7, p_confirmacao => $8, p_valido_ate => clock_timestamp() + $9::interval)`;
/** Chama a porta (como quem estiver na sessão). Devolve o resultado; erro de banco sobe. */
function porta(c, o) {
  const p = {
    l: ATIVA,
    sha: SHA1,
    base: null,
    motivo: "Assinatura vencida (prova)",
    confirmacao: null,
    validade: "30 minutes",
    ...o,
  };
  return c.query(SQL_DA_PORTA, [
    p.id ?? p.l.id,
    p.ref ?? p.l.project_ref,
    p.de,
    p.para,
    p.sha,
    p.base,
    p.motivo,
    p.confirmacao,
    p.validade,
  ]);
}
/** A porta tem de aceitar: erro de banco vira falha de ASSERÇÃO (o mutante que quebra a porta morre pelo motivo certo). */
async function portaAceita(c, o, rotulo) {
  try {
    return await porta(c, o);
  } catch (e) {
    assert.fail(`${rotulo}: a porta recusou (${e.code}): ${e.message}`);
  }
}
/** A porta tem de RECUSAR com `fragmento`, sem escrever nada (linhas da prova e histórico iguais). */
async function portaRecusa(c, o, fragmento, rotulo) {
  const antes = await retrato(c);
  const e = await tentar(c, () => porta(c, o));
  assert.match(
    e?.message ?? "(aceitou)",
    new RegExp(fragmento),
    `${rotulo}: a porta deveria recusar com ${fragmento}`,
  );
  assert.deepEqual(await retrato(c), antes, `${rotulo}: a recusa escreveu`);
}
/** Recusa de um comando direto (UPDATE/INSERT) com `fragmento`. */
async function diretoRecusa(c, sql, params, fragmento, rotulo) {
  const e = await tentar(c, () => c.query(sql, params));
  assert.match(
    e?.message ?? "(aceitou)",
    new RegExp(fragmento),
    `${rotulo}: deveria recusar com ${fragmento}`,
  );
}
async function diretoAceita(c, sql, params, rotulo) {
  try {
    return await c.query(sql, params);
  } catch (e) {
    assert.fail(`${rotulo}: recusado (${e.code}): ${e.message}`);
  }
}
const LINHAS = `SELECT id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa, estado, estado_desde::text AS desde, estado_sha
  FROM public.frota_lojas WHERE id LIKE 'l1470-%' ORDER BY id`;
const HISTORICO =
  "SELECT loja_id, project_ref, de, para, sha, motivo, quem, em::text AS em FROM public.frota_estado_historico ORDER BY id";
async function retrato(c) {
  return {
    lojas: (await c.query(LINHAS)).rows,
    historico: (await c.query(HISTORICO)).rows,
  };
}
const estadoDe = async (c, l) =>
  (
    await c.query(
      "SELECT estado, estado_sha, estado_desde = now() AS desde_agora FROM public.frota_lojas WHERE id = $1",
      [l.id],
    )
  ).rows[0];
const contarHistorico = async (c) =>
  (
    await c.query(
      "SELECT count(*)::int AS n FROM public.frota_estado_historico",
    )
  ).rows[0].n;
const md5Vivo = async (c, fn) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [fn],
    )
  ).rows[0]?.h ?? null;
const existeHistorico = async (c) =>
  (
    await c.query(
      "SELECT to_regclass('public.frota_estado_historico') IS NOT NULL AS x",
    )
  ).rows[0].x;
async function foto(c) {
  const fn = await c.query(
    `SELECT p.proname, p.oid::int AS oid, md5(replace(p.prosrc, E'\\r', '')) AS h, p.proacl::text AS acl, p.proowner::int AS dono,
            p.prosecdef, p.provolatile, p.proconfig::text AS config
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('frota_mudar_estado', 'frota_lojas_estado_so_pela_porta', 'resolver_loja', 'resolver_loja_com_estado') ORDER BY 1`,
  );
  const tg = await c.query(
    `SELECT t.tgname, t.oid::int AS oid, t.tgfoid::int AS fn, t.tgtype, t.tgattr::text AS attr, t.tgenabled
       FROM pg_trigger t WHERE t.tgrelid = 'public.frota_lojas'::regclass AND NOT t.tgisinternal ORDER BY 1`,
  );
  const tb = await c.query(
    `SELECT c.relname, c.oid::int AS oid, c.relacl::text AS acl, c.relrowsecurity,
            (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' ORDER BY a.attnum)
               FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
            (SELECT string_agg(pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid) AS checks,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
       FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
        AND c.relname IN ('frota_lojas', 'frota_estado_historico', 'frota_estado_historico_id_seq') ORDER BY 1`,
  );
  return { fn: fn.rows, tg: tg.rows, tb: tb.rows };
}
/** Volta à base de antes desta migration (a 20261460 aplicada, sem porta, gatilho nem histórico) DENTRO da transação do chamador. */
async function voltarAoAntes(c) {
  await c.query(ROLLBACK);
  await c.query(
    "SET LOCAL app.confirmo_apagar_historico_do_estado_da_loja = 'APAGAR'",
  );
  await c.query(DESTRUTIVO);
  assert.equal(await md5Vivo(c, PORTA), null, "base de antes: sem a porta");
  assert.equal(
    await md5Vivo(c, GATILHO_FN),
    null,
    "base de antes: sem a função do gatilho",
  );
  assert.equal(
    await existeHistorico(c),
    false,
    "base de antes: sem o histórico",
  );
}
/** Limpeza crua (para um MUTANTE commitado, que o pré-voo do rollback recusaria por md5). */
async function limparCru(c) {
  await c.query(
    "DROP TRIGGER IF EXISTS frota_lojas_estado_so_pela_porta ON public.frota_lojas",
  );
  await c.query(`DROP FUNCTION IF EXISTS ${GATILHO_FN}`);
  await c.query(`DROP FUNCTION IF EXISTS ${PORTA}`);
  await c.query("DROP TABLE IF EXISTS public.frota_estado_historico");
}

// ---------------------------------------------------------------------------
// (a)-(e) o comportamento (o MESMO que os mutantes têm de derrubar)
// ---------------------------------------------------------------------------
async function comportamento(c) {
  await semente(c);
  assert.equal(await contarHistorico(c), 0, "o histórico nasce vazio");
  const ADORMECER = { de: "ativa", para: "adormecida" };

  // (a) recusas, sem escrever nada.
  await portaRecusa(
    c,
    { ...ADORMECER, validade: "-1 second" },
    "FROTA_ESTADO_INSTRUCAO_VENCIDA",
    "instrução vencida",
  );
  await portaRecusa(
    c,
    { ...ADORMECER, validade: null },
    "FROTA_ESTADO_INSTRUCAO_VENCIDA",
    "instrução sem validade",
  );
  await portaRecusa(
    c,
    { ...ADORMECER, validade: "61 minutes" },
    "FROTA_ESTADO_VALIDADE_LONGA",
    "validade de mais de 1 hora",
  );
  await portaRecusa(
    c,
    { de: "ativa", para: "pausada" },
    "FROTA_ESTADO_DESCONHECIDO",
    "destino desconhecido",
  );
  await portaRecusa(
    c,
    { de: "ativa", para: null },
    "FROTA_ESTADO_DESCONHECIDO",
    "destino NULL",
  );
  await portaRecusa(
    c,
    { de: "ativa", para: "ativa" },
    "FROTA_ESTADO_SEM_MUDANCA",
    "de = para",
  );
  for (const sha of ["A".repeat(40), "1".repeat(39), "g".repeat(40), null])
    await portaRecusa(
      c,
      { ...ADORMECER, sha },
      "FROTA_ESTADO_SHA_INVALIDO",
      `sha ${JSON.stringify(sha)}`,
    );
  for (const motivo of ["", "   ", null, "m".repeat(201)])
    await portaRecusa(
      c,
      { ...ADORMECER, motivo },
      "FROTA_ESTADO_MOTIVO",
      `motivo ${JSON.stringify(motivo?.slice(0, 5))}`,
    );
  for (const confirmacao of [
    null,
    `ENCERRAR ${OUTRA.id}`,
    `encerrar ${ATIVA.id}`,
  ])
    await portaRecusa(
      c,
      { de: "ativa", para: "encerrada", confirmacao },
      "FROTA_ESTADO_ENCERRAR_SEM_CONFIRMACAO",
      `encerrar sem confirmação (${confirmacao})`,
    );
  await portaRecusa(
    c,
    { ...ADORMECER, ref: OUTRA.project_ref },
    "FROTA_ESTADO_LOJA_NAO_ENCONTRADA",
    "loja de outro ref",
  );
  await portaRecusa(
    c,
    { ...ADORMECER, id: "l1470-ninguem" },
    "FROTA_ESTADO_LOJA_NAO_ENCONTRADA",
    "loja inexistente",
  );
  await portaRecusa(
    c,
    {
      de: "adormecida",
      para: "encerrada",
      confirmacao: `ENCERRAR ${ATIVA.id}`,
    },
    "FROTA_ESTADO_DIVERGENTE: a loja l1470-ativa está ativa",
    "estado atual diferente",
  );
  await portaRecusa(
    c,
    { de: "adormecida", para: "ativa", base: null },
    "FROTA_ESTADO_DIVERGENTE",
    "acordar quem está ativa",
  );

  // (b) adormecer: troca só o estado e deixa UM rastro.
  const r = await portaAceita(
    c,
    { ...ADORMECER, sha: SHA1, motivo: "Assinatura vencida há 7 dias" },
    "adormecer",
  );
  assert.deepEqual(
    r.fields.map((f) => f.name),
    COLUNAS_DA_PORTA,
    "a porta devolve as 6 colunas",
  );
  assert.equal(r.rowCount, 1, "a porta devolve a loja que mudou");
  assert.deepEqual(
    [
      r.rows[0].id,
      r.rows[0].nome,
      r.rows[0].dominio_publico,
      r.rows[0].estado,
      r.rows[0].estado_sha,
    ],
    [ATIVA.id, ATIVA.nome, ATIVA.dominio_publico, "adormecida", SHA1],
    "adormecer grava a release em que a loja saiu do ar",
  );
  assert.deepEqual(await estadoDe(c, ATIVA), {
    estado: "adormecida",
    estado_sha: SHA1,
    desde_agora: true,
  });
  const rastro = (
    await c.query(
      "SELECT loja_id, project_ref, de, para, sha, motivo, quem = session_user AS quem_e_a_sessao, em = now() AS em_agora FROM public.frota_estado_historico",
    )
  ).rows;
  assert.deepEqual(
    rastro,
    [
      {
        loja_id: ATIVA.id,
        project_ref: ATIVA.project_ref,
        de: "ativa",
        para: "adormecida",
        sha: SHA1,
        motivo: "Assinatura vencida há 7 dias",
        quem_e_a_sessao: true,
        em_agora: true,
      },
    ],
    "adormecer: UM rastro com quem, quando, de, para, sha e motivo",
  );
  // (d) a variável da porta é desligada logo depois do UPDATE dela: na MESMA transação, UPDATE direto continua recusado.
  await diretoRecusa(
    c,
    "UPDATE public.frota_lojas SET estado = 'ativa' WHERE id = $1",
    [ATIVA.id],
    "FROTA_ESTADO_SO_PELA_PORTA",
    "depois da porta, UPDATE direto recusado",
  );
  assert.equal(
    (
      await c.query(
        "SELECT COALESCE(current_setting('ikcous.frota_estado_pela_porta', true), '') AS v",
      )
    ).rows[0].v,
    "",
    "depois da porta, a variável fica desligada",
  );

  // acordar: base errada ou ausente recusa; a base certa (a release em que dormiu) passa.
  await portaRecusa(
    c,
    { de: "adormecida", para: "ativa", sha: SHA2, base: SHA2 },
    "FROTA_ESTADO_BASE_DIVERGENTE",
    "acordar com base errada",
  );
  await portaRecusa(
    c,
    { de: "adormecida", para: "ativa", sha: SHA2, base: null },
    "FROTA_ESTADO_BASE_DIVERGENTE",
    "acordar sem base",
  );
  await portaRecusa(
    c,
    { ...ADORMECER },
    "FROTA_ESTADO_DIVERGENTE: a loja l1470-ativa está adormecida",
    "adormecer quem já dorme",
  );
  // Encerrar quem DORME também exige a frase (a recusa acima só saía de ativa).
  for (const confirmacao of [
    null,
    `ENCERRAR ${OUTRA.id}`,
    `REABRIR ${ATIVA.id}`,
  ])
    await portaRecusa(
      c,
      { de: "adormecida", para: "encerrada", sha: SHA2, confirmacao },
      "FROTA_ESTADO_ENCERRAR_SEM_CONFIRMACAO",
      `encerrar quem dorme sem confirmação (${confirmacao})`,
    );
  await portaAceita(
    c,
    { de: "adormecida", para: "ativa", sha: SHA2, base: SHA1, motivo: "Pagou" },
    "acordar",
  );
  assert.deepEqual(await estadoDe(c, ATIVA), {
    estado: "ativa",
    estado_sha: SHA2,
    desde_agora: true,
  });

  // encerrar (com a frase) e reabrir (só com REABRIR <id> e a base certa).
  await portaAceita(
    c,
    {
      de: "ativa",
      para: "encerrada",
      sha: SHA2,
      confirmacao: `ENCERRAR ${ATIVA.id}`,
      motivo: "Ordem escrita do dono",
    },
    "encerrar",
  );
  assert.equal((await estadoDe(c, ATIVA)).estado, "encerrada");
  for (const confirmacao of [
    null,
    `REABRIR ${OUTRA.id}`,
    `ENCERRAR ${ATIVA.id}`,
  ]) {
    await portaRecusa(
      c,
      { de: "encerrada", para: "ativa", sha: SHA2, base: SHA2, confirmacao },
      "FROTA_ESTADO_REABRIR_SEM_CONFIRMACAO",
      `reabrir sem confirmação (${confirmacao})`,
    );
    await portaRecusa(
      c,
      { de: "encerrada", para: "adormecida", sha: SHA2, confirmacao },
      "FROTA_ESTADO_REABRIR_SEM_CONFIRMACAO",
      `sair de encerrada sem confirmação (${confirmacao})`,
    );
  }
  // Reabrir com a frase certa ainda exige a base certa (a release em que ela saiu do ar, SHA2), como acordar de adormecida.
  for (const base of [SHA1, null])
    await portaRecusa(
      c,
      {
        de: "encerrada",
        para: "ativa",
        sha: SHA2,
        base,
        confirmacao: `REABRIR ${ATIVA.id}`,
      },
      "FROTA_ESTADO_BASE_DIVERGENTE",
      `reabrir com base errada (${base})`,
    );
  await portaAceita(
    c,
    {
      de: "encerrada",
      para: "ativa",
      sha: SHA2,
      base: SHA2,
      confirmacao: `REABRIR ${ATIVA.id}`,
      motivo: "Voltou a assinar",
    },
    "reabrir",
  );
  assert.deepEqual(
    (
      await c.query(
        "SELECT de || '>' || para AS passo FROM public.frota_estado_historico ORDER BY id",
      )
    ).rows.map((x) => x.passo),
    [
      "ativa>adormecida",
      "adormecida>ativa",
      "ativa>encerrada",
      "encerrada>ativa",
    ],
    "rastro: um por mudança, na ordem",
  );

  // (b2) estado_sha é a release em que a loja SAIU do ar: adormecida na A, encerrada na B, de volta a adormecida na C — a base para
  // acordar continua A (com B ou C a prontidão pularia as migrations entre A e elas). O rastro guarda o sha de CADA momento.
  // Num SAVEPOINT desfeito: a OUTRA volta ativa e sem rastro para as provas seguintes.
  const erroB2 = await tentar(c, async () => {
    await portaAceita(
      c,
      { l: OUTRA, ...ADORMECER, sha: SHA1 },
      "b2: adormecer na A",
    );
    await portaAceita(
      c,
      {
        l: OUTRA,
        de: "adormecida",
        para: "encerrada",
        sha: SHA2,
        confirmacao: `ENCERRAR ${OUTRA.id}`,
      },
      "b2: encerrar na B",
    );
    assert.equal(
      (await estadoDe(c, OUTRA)).estado_sha,
      SHA1,
      "b2: adormecida -> encerrada preserva o estado_sha (a release em que saiu do ar)",
    );
    await portaAceita(
      c,
      {
        l: OUTRA,
        de: "encerrada",
        para: "adormecida",
        sha: SHA3,
        confirmacao: `REABRIR ${OUTRA.id}`,
      },
      "b2: de encerrada para adormecida na C",
    );
    assert.equal(
      (await estadoDe(c, OUTRA)).estado_sha,
      SHA1,
      "b2: encerrada -> adormecida preserva o estado_sha",
    );
    for (const base of [SHA2, SHA3])
      await portaRecusa(
        c,
        { l: OUTRA, de: "adormecida", para: "ativa", sha: SHA3, base },
        "FROTA_ESTADO_BASE_DIVERGENTE",
        `b2: acordar com a base ${base.slice(0, 1)} (não a A em que saiu do ar)`,
      );
    await portaAceita(
      c,
      { l: OUTRA, de: "adormecida", para: "ativa", sha: SHA3, base: SHA1 },
      "b2: acordar com a base A",
    );
    assert.deepEqual(
      await estadoDe(c, OUTRA),
      { estado: "ativa", estado_sha: SHA3, desde_agora: true },
      "b2: voltar a ativa grava a release do momento",
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT de || '>' || para || ':' || left(sha, 1) AS passo FROM public.frota_estado_historico WHERE loja_id = $1 ORDER BY id",
          [OUTRA.id],
        )
      ).rows.map((x) => x.passo),
      [
        "ativa>adormecida:1",
        "adormecida>encerrada:2",
        "encerrada>adormecida:3",
        "adormecida>ativa:3",
      ],
      "b2: o rastro guarda o sha de cada momento",
    );
  });
  if (erroB2) throw erroB2;

  // (c) IKCOUS e Savy nunca saem de ativa.
  for (const l of [IKCOUS, SAVY_LOJA]) {
    await portaRecusa(
      c,
      { l, ...ADORMECER },
      "FROTA_ESTADO_LOJA_QUE_NUNCA_DORME",
      `${l.id}: IKCOUS nunca sai de ativa (porta)`,
    );
    await portaRecusa(
      c,
      { l, de: "ativa", para: "encerrada", confirmacao: `ENCERRAR ${l.id}` },
      "FROTA_ESTADO_LOJA_QUE_NUNCA_DORME",
      `${l.id}: IKCOUS nunca sai de ativa (encerrar)`,
    );
    const e = await tentar(c, async () => {
      await c.query(
        "SELECT set_config('ikcous.frota_estado_pela_porta', 'sim', true)",
      );
      await c.query(
        "UPDATE public.frota_lojas SET estado = 'adormecida' WHERE id = $1",
        [l.id],
      );
    });
    assert.match(
      e?.message ?? "(aceitou)",
      /FROTA_ESTADO_LOJA_QUE_NUNCA_DORME/,
      `${l.id}: IKCOUS nunca sai de ativa (variável ligada à mão)`,
    );
  }
  const nasce = await tentar(c, async () => {
    await c.query(
      "SELECT set_config('ikcous.frota_estado_pela_porta', 'sim', true)",
    );
    await c.query(
      "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, estado) VALUES ('l1470-nova-caf', 'x', 'nova-caf.l1470.teste', $1, 'https://x', 'pk', 'encerrada')",
      [CAF],
    );
  });
  assert.match(
    nasce?.message ?? "(aceitou)",
    /FROTA_ESTADO_LOJA_QUE_NUNCA_DORME/,
    "IKCOUS nunca sai de ativa (nascendo)",
  );
  await portaAceita(
    c,
    { l: OUTRA, ...ADORMECER, sha: SHA1 },
    "adormecer a outra",
  );
  await diretoRecusa(
    c,
    "UPDATE public.frota_lojas SET project_ref = $1 WHERE id = $2",
    [SAVY, OUTRA.id],
    "FROTA_ESTADO_LOJA_QUE_NUNCA_DORME",
    "IKCOUS nunca sai de ativa (loja dormindo trocando para o ref da Savy)",
  );

  // (d) o gatilho: só a porta muda o estado; o resto da linha continua livre.
  await diretoRecusa(
    c,
    "UPDATE public.frota_lojas SET estado = 'adormecida' WHERE id = $1",
    [ATIVA.id],
    "FROTA_ESTADO_SO_PELA_PORTA",
    "UPDATE direto do estado",
  );
  await diretoRecusa(
    c,
    "UPDATE public.frota_lojas SET estado_sha = $1 WHERE id = $2",
    [SHA2, OUTRA.id],
    "FROTA_ESTADO_SO_PELA_PORTA",
    "UPDATE direto do estado_sha",
  );
  // Apagar o estado_sha (a OUTRA dorme com SHA1) também é troca: NULL contra um sha preenchido.
  await diretoRecusa(
    c,
    "UPDATE public.frota_lojas SET estado_sha = NULL WHERE id = $1",
    [OUTRA.id],
    "FROTA_ESTADO_SO_PELA_PORTA",
    "UPDATE direto que apaga o estado_sha",
  );
  await diretoRecusa(
    c,
    "UPDATE public.frota_lojas SET estado_desde = now() - interval '1 day' WHERE id = $1",
    [OUTRA.id],
    "FROTA_ESTADO_SO_PELA_PORTA",
    "UPDATE direto do estado_desde",
  );
  await diretoRecusa(
    c,
    "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, estado) VALUES ('l1470-nasce-dormindo', 'x', 'nasce.l1470.teste', 'aaaaaaaaaaaaaaaaaaad', 'https://x', 'pk', 'adormecida')",
    [],
    "FROTA_ESTADO_SO_PELA_PORTA",
    "INSERT direto fora de ativa",
  );
  await diretoAceita(
    c,
    "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key) VALUES ('l1470-nasce-ativa', 'x', 'nasce-ativa.l1470.teste', 'aaaaaaaaaaaaaaaaaaae', 'https://x', 'pk')",
    [],
    "loja nova nasce ativa sem a porta",
  );
  const rot = await diretoAceita(
    c,
    "UPDATE public.frota_lojas SET publishable_key = 'pk_l1470_rodada', supabase_url = 'https://nova.supabase.co', nome = 'Outro nome', ativa = false WHERE id = $1 RETURNING estado, estado_sha",
    [OUTRA.id],
    "rotação de chave, URL, nome e ativa",
  );
  assert.deepEqual(
    rot.rows,
    [{ estado: "adormecida", estado_sha: SHA1 }],
    "a rotação não mexe no estado",
  );
  await diretoAceita(
    c,
    "UPDATE public.frota_lojas SET estado = estado, publishable_key = 'pk2' WHERE id = $1",
    [OUTRA.id],
    "SET estado = estado (sem troca) passa",
  );
  await diretoAceita(
    c,
    "UPDATE public.frota_lojas SET publishable_key = 'pk_caf_rodada' WHERE id = $1",
    [IKCOUS.id],
    "rotação da chave da IKCOUS",
  );

  // (e) ACL: só o dono executa a porta e toca o histórico. O privilégio é medido no catálogo (a porta é SECURITY INVOKER: um papel
  // com EXECUTE ainda cairia no 42501 da tabela, e só a tentativa não distinguiria "sem EXECUTE" de "sem a tabela").
  for (const papel of ["anon", "authenticated", "service_role"]) {
    const priv = (
      await c.query(
        `SELECT has_function_privilege($1, $2, 'EXECUTE') AS porta,
                has_table_privilege($1, 'public.frota_estado_historico', 'SELECT') AS le,
                has_table_privilege($1, 'public.frota_estado_historico', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS escreve,
                has_sequence_privilege($1, '${SEQ}', 'USAGE, SELECT, UPDATE') AS sequencia`,
        [papel, PORTA],
      )
    ).rows[0];
    assert.equal(priv.porta, false, `ACL: ${papel} não executa a porta`);
    assert.equal(priv.le, false, `ACL: ${papel} não lê o histórico`);
    assert.equal(priv.escreve, false, `ACL: ${papel} não escreve no histórico`);
    assert.equal(priv.sequencia, false, `ACL: ${papel} não usa a sequência`);
    for (const [rotulo, sql] of [
      [
        `ACL: ${papel} não executa a porta`,
        `SELECT * FROM public.frota_mudar_estado('x', 'x', 'ativa', 'adormecida', '${SHA1}', NULL, 'x', NULL, clock_timestamp() + interval '1 minute')`,
      ],
      [
        `ACL: ${papel} não lê o histórico`,
        "SELECT * FROM public.frota_estado_historico",
      ],
      [
        `ACL: ${papel} não escreve no histórico`,
        `INSERT INTO public.frota_estado_historico (loja_id, project_ref, de, para, sha, motivo) VALUES ('x', 'x', 'ativa', 'adormecida', '${SHA1}', 'x')`,
      ],
      [`ACL: ${papel} não usa a sequência`, `SELECT nextval('${SEQ}')`],
    ]) {
      const e = await tentar(c, async () => {
        await c.query(`SET LOCAL ROLE ${papel}`);
        await c.query(sql);
      });
      assert.equal(e?.code, "42501", rotulo);
    }
  }
  const cat = (
    await c.query(
      "SELECT p.prosecdef, p.provolatile, p.proconfig::text AS config FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
      [PORTA],
    )
  ).rows[0];
  assert.deepEqual(
    cat,
    { prosecdef: false, provolatile: "v", config: '{"search_path=\\"\\""}' },
    "catálogo: porta SECURITY INVOKER, VOLATILE, search_path vazio",
  );
}

// ---------------------------------------------------------------------------
// (f) atomicidade
// ---------------------------------------------------------------------------
async function atomicidade(c) {
  await desfeita(c, async () => {
    await semente(c, [ATIVA]);
    // O rastro passa a recusar um motivo: a porta falha no INSERT, DEPOIS do UPDATE. A troca de estado tem de voltar junto.
    await c.query(
      "ALTER TABLE public.frota_estado_historico ADD CONSTRAINT prova_falha_no_rastro CHECK (motivo <> 'falha no rastro')",
    );
    const antes = await retrato(c);
    const e = await tentar(c, () =>
      porta(c, { de: "ativa", para: "adormecida", motivo: "falha no rastro" }),
    );
    assert.equal(e?.code, "23514", "o rastro falhou");
    assert.deepEqual(
      await retrato(c),
      antes,
      "sem rastro, sem troca de estado",
    );
  });
}

// ---------------------------------------------------------------------------
// (g) duas conexões na mesma loja ao mesmo tempo
// ---------------------------------------------------------------------------
const CORRIDA = loja("corrida", "aaaaaaaaaaaaaaaaaaaf");
async function corrida(c, url) {
  await c.query("BEGIN");
  await semente(c, [{ ...CORRIDA, id: "c1470-corrida" }]);
  await c.query("COMMIT");
  const l = { ...CORRIDA, id: "c1470-corrida" };
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  await a.connect();
  await b.connect();
  try {
    await a.query("BEGIN");
    await porta(a, { l, de: "ativa", para: "adormecida", motivo: "corrida A" });
    const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    let resultadoB = null;
    const pedidoB = porta(b, {
      l,
      de: "ativa",
      para: "adormecida",
      motivo: "corrida B",
    }).then(
      (r) => {
        resultadoB = { ok: r };
      },
      (e) => {
        resultadoB = { erro: e };
      },
    );
    // B tem de estar ESPERANDO a trava de A (a linha), não correndo por fora dela.
    let esperando = false;
    for (let i = 0; i < 50 && !esperando && !resultadoB; i++) {
      const w = (
        await c.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
          [pidB],
        )
      ).rows[0];
      esperando = w?.wait_event_type === "Lock";
      if (!esperando) await new Promise((r) => setTimeout(r, 100));
    }
    await a.query("COMMIT");
    await pedidoB;
    assert.match(
      resultadoB?.erro?.message ?? "(B mudou também)",
      /FROTA_ESTADO_DIVERGENTE/,
      "corrida: a segunda chamada espera a primeira e é recusada pelo estado já trocado",
    );
    assert(esperando || resultadoB?.erro, "corrida: B esperou a trava de A");
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM public.frota_estado_historico WHERE loja_id = $1",
          [l.id],
        )
      ).rows[0].n,
      1,
      "corrida: UM rastro só",
    );
  } finally {
    await a.query("ROLLBACK").catch(() => {});
    await a.end();
    await b.end();
    await c
      .query(
        "DELETE FROM public.frota_estado_historico WHERE loja_id = 'c1470-corrida'",
      )
      .catch(() => {});
    await c.query("DELETE FROM public.frota_lojas WHERE id = 'c1470-corrida'");
  }
}

// ---------------------------------------------------------------------------
// (h) linha que já existia antes da migration
// ---------------------------------------------------------------------------
async function dadoExistente(c) {
  await desfeita(c, async () => {
    await voltarAoAntes(c);
    await semente(c);
    // Sem o gatilho, a base de antes deixava gravar o estado à mão: a loja que já dormia (com a release dela) continua dormindo.
    await c.query(
      "UPDATE public.frota_lojas SET estado = 'adormecida', estado_sha = $1, estado_desde = '2026-11-01 00:00:00+00' WHERE id = $2",
      [SHA1, OUTRA.id],
    );
    const antes = (await c.query(LINHAS)).rows;
    await c.query(MIGRATION);
    assert.deepEqual(
      (await c.query(LINHAS)).rows,
      antes,
      "nenhuma linha de frota_lojas muda",
    );
    assert.equal(await contarHistorico(c), 0, "o histórico nasce vazio");
    // A loja que já dormia acorda pela porta com a base dela.
    await portaAceita(
      c,
      { l: OUTRA, de: "adormecida", para: "ativa", sha: SHA2, base: SHA1 },
      "acordar loja que já dormia antes da migration",
    );
  });
}

// ---------------------------------------------------------------------------
// (i) reaplicar 2x (LF e CRLF)
// ---------------------------------------------------------------------------
async function reaplicar(c) {
  await desfeita(c, async () => {
    await semente(c);
    await porta(c, { de: "ativa", para: "adormecida" });
    const antes = await foto(c);
    const dados = await retrato(c);
    await c.query(MIGRATION);
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      antes,
      "reaplicar (LF, CRLF, LF) não muda OID, corpo, ACL, gatilho nem tabela",
    );
    assert.deepEqual(
      await retrato(c),
      dados,
      "reaplicar não toca linha nem rastro",
    );
  });
}

// ---------------------------------------------------------------------------
// (j) rollback comum e destrutivo (e a ordem com os da 20261460)
// ---------------------------------------------------------------------------
async function rollbacks(c) {
  await desfeita(c, async () => {
    await semente(c);
    await porta(c, { de: "ativa", para: "adormecida" });
    const dados = await retrato(c);
    const tabela = (await foto(c)).tb;
    for (const vez of [1, 2]) {
      await c.query(ROLLBACK);
      assert.equal(
        await md5Vivo(c, PORTA),
        null,
        `rollback ${vez}: a porta saiu`,
      );
      assert.equal(
        await md5Vivo(c, GATILHO_FN),
        null,
        `rollback ${vez}: a função do gatilho saiu`,
      );
      assert.deepEqual(
        (await foto(c)).tg.filter(
          (t) => t.tgname === "frota_lojas_estado_so_pela_porta",
        ),
        [],
        `rollback ${vez}: o gatilho saiu`,
      );
      assert.deepEqual(
        await retrato(c),
        dados,
        `rollback ${vez}: linhas e histórico preservados`,
      );
      assert.deepEqual(
        (await foto(c)).tb,
        tabela,
        `rollback ${vez}: a tabela do histórico fica fechada como estava`,
      );
    }
    // Sem o gatilho volta o comportamento de antes: UPDATE direto passa.
    await diretoAceita(
      c,
      "UPDATE public.frota_lojas SET estado = 'ativa' WHERE id = $1",
      [ATIVA.id],
      "depois do rollback, UPDATE direto volta a passar",
    );
    await c.query(
      "UPDATE public.frota_lojas SET estado = 'adormecida' WHERE id = $1",
      [ATIVA.id],
    );
    await c.query(MIGRATION);
    assert.equal(await md5Vivo(c, PORTA), MD5_PORTA);
    assert.deepEqual(
      (await retrato(c)).historico,
      dados.historico,
      "reaplicar depois do rollback: o histórico continua o mesmo",
    );
    await diretoRecusa(
      c,
      "UPDATE public.frota_lojas SET estado = 'ativa' WHERE id = $1",
      [ATIVA.id],
      "FROTA_ESTADO_SO_PELA_PORTA",
      "reaplicado, o gatilho volta",
    );
  });
  // destrutivo
  await desfeita(c, async () => {
    await semente(c);
    await porta(c, { de: "ativa", para: "adormecida" });
    let e = await tentar(c, () => c.query(DESTRUTIVO));
    assert.match(
      e?.message ?? "",
      /HISTORICO_DO_ESTADO_SO_COM_O_DONO/,
      "destrutivo sem confirmação recusa",
    );
    await c.query(
      "SET LOCAL app.confirmo_apagar_historico_do_estado_da_loja = 'APAGAR'",
    );
    e = await tentar(c, () => c.query(DESTRUTIVO));
    assert.match(
      e?.message ?? "",
      /HISTORICO_DO_ESTADO_ROLLBACK_COMUM_PRIMEIRO/,
      "destrutivo antes do rollback comum recusa",
    );
    assert.equal(await contarHistorico(c), 1, "a recusa não apagou nada");
    await c.query(ROLLBACK);
    await c.query(DESTRUTIVO);
    assert.equal(
      await existeHistorico(c),
      false,
      "destrutivo tira o histórico",
    );
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM public.frota_lojas WHERE id LIKE 'l1470-%'",
        )
      ).rows[0].n,
      LOJAS.length,
      "destrutivo não apaga loja nenhuma",
    );
    assert.equal(
      (await estadoDe(c, ATIVA)).estado,
      "adormecida",
      "destrutivo não mexe no estado das lojas",
    );
    await c.query(DESTRUTIVO); // repetir é no-op
    await c.query(MIGRATION);
    assert.equal(
      await contarHistorico(c),
      0,
      "depois do destrutivo, reaplicar recria o histórico vazio",
    );
  });
  // a ordem com os rollbacks da 20261460: o destrutivo dela só depois do comum desta (o gatilho depende das colunas)
  await desfeita(c, async () => {
    await c.query(ROLLBACK_1460);
    await c.query("SET LOCAL app.confirmo_apagar_estado_de_vida = 'APAGAR'");
    const e = await tentar(c, () => c.query(DESTRUTIVO_1460));
    assert.equal(
      e?.code,
      "2BP01",
      "o destrutivo da 20261460 com o gatilho no ar: o Postgres recusa (dependência)",
    );
    await c.query(ROLLBACK);
    await c.query(DESTRUTIVO_1460);
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.frota_lojas'::regclass AND attname = 'estado' AND NOT attisdropped",
        )
      ).rows[0].n,
      0,
      "depois do comum desta, o destrutivo da 20261460 passa",
    );
  });
}

// ---------------------------------------------------------------------------
// (k) pré-voo
// ---------------------------------------------------------------------------
const CORPO_FALSO = "LANGUAGE plpgsql AS $f$ BEGIN END $f$";
/** O CREATE OR REPLACE da função `nome` desta migration com UMA troca no corpo (mesma assinatura, outro md5). */
function comOutroCorpo(nome, de, para) {
  const inicio = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  const bloco = MIGRATION.slice(inicio).split("$$;")[0];
  assert.equal(
    bloco.split(de).length > 1,
    true,
    `comOutroCorpo: ${de} em ${nome}`,
  );
  return `${bloco.replace(de, para)}$$;`;
}
const SABOTAGENS_DA_BASE = [
  ["a 20261460 desfeita (v1 da 20261141, sem a v2)", [ROLLBACK_1460]],
  [
    "sem as colunas de estado",
    [
      ROLLBACK_1460,
      "SET LOCAL app.confirmo_apagar_estado_de_vida = 'APAGAR'",
      DESTRUTIVO_1460,
    ],
  ],
  [
    "IKCOUS adormecida",
    [
      `INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, estado, estado_sha) VALUES ('l1470-caf', 'x', 'caf.l1470.teste', '${CAF}', 'x', 'x', 'adormecida', '${SHA1}')`,
    ],
  ],
  [
    "Savy encerrada",
    [
      `INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, estado, estado_sha) VALUES ('l1470-savy', 'x', 'savy.l1470.teste', '${SAVY}', 'x', 'x', 'encerrada', '${SHA1}')`,
    ],
  ],
  [
    "loja adormecida sem a release de referência",
    [
      "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, estado) VALUES ('l1470-sem-sha', 'x', 'sem-sha.l1470.teste', 'aaaaaaaaaaaaaaaaaaag', 'x', 'x', 'adormecida')",
    ],
  ],
  [
    "loja encerrada com sha inválido",
    [
      "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, estado, estado_sha) VALUES ('l1470-sha-ruim', 'x', 'sha-ruim.l1470.teste', 'aaaaaaaaaaaaaaaaaaah', 'x', 'x', 'encerrada', 'abc')",
    ],
  ],
  [
    "só a porta, com outro corpo",
    [
      `CREATE FUNCTION ${PORTA.replace("(text, text, text, text, text, text, text, text, timestamptz)", "(p_id text, p_ref text, p_de text, p_para text, p_sha text, p_base text, p_motivo text, p_confirmacao text, p_valido_ate timestamptz)")} RETURNS void ${CORPO_FALSO}`,
    ],
  ],
  [
    "só a função do gatilho",
    [`CREATE FUNCTION ${GATILHO_FN} RETURNS trigger ${CORPO_FALSO}`],
  ],
  [
    "a porta com sobrecarga",
    [
      "CREATE FUNCTION public.frota_mudar_estado(p text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
    ],
  ],
  [
    "o histórico com outra forma",
    ["CREATE TABLE public.frota_estado_historico (id int)"],
  ],
  [
    "o histórico (do rollback comum) aberto ao authenticated",
    [
      MIGRATION,
      ROLLBACK,
      "GRANT SELECT ON public.frota_estado_historico TO authenticated",
    ],
  ],
  [
    "o histórico (do rollback comum) com política",
    [
      MIGRATION,
      ROLLBACK,
      "CREATE POLICY aberta ON public.frota_estado_historico FOR SELECT TO authenticated USING (true)",
    ],
  ],
  [
    "o histórico (do rollback comum) sem RLS",
    [
      MIGRATION,
      ROLLBACK,
      "ALTER TABLE public.frota_estado_historico DISABLE ROW LEVEL SECURITY",
    ],
  ],
  [
    "o histórico (do rollback comum) com a sequência aberta",
    [MIGRATION, ROLLBACK, `GRANT USAGE ON SEQUENCE ${SEQ} TO service_role`],
  ],
  [
    "o histórico (do rollback comum) com coluna a mais",
    [
      MIGRATION,
      ROLLBACK,
      "ALTER TABLE public.frota_estado_historico ADD COLUMN extra text",
    ],
  ],
  [
    "reaplicação com o gatilho desligado",
    [
      MIGRATION,
      "ALTER TABLE public.frota_lojas DISABLE TRIGGER frota_lojas_estado_so_pela_porta",
    ],
  ],
  [
    "reaplicação com a porta aberta ao service_role",
    [MIGRATION, `GRANT EXECUTE ON FUNCTION ${PORTA} TO service_role`],
  ],
  [
    "reaplicação com o gatilho só no estado",
    [
      MIGRATION,
      "CREATE OR REPLACE TRIGGER frota_lojas_estado_so_pela_porta BEFORE INSERT OR UPDATE OF estado ON public.frota_lojas FOR EACH ROW EXECUTE FUNCTION public.frota_lojas_estado_so_pela_porta()",
    ],
  ],
  [
    "reaplicação sem o histórico",
    [MIGRATION, "DROP TABLE public.frota_estado_historico"],
  ],
];
async function preVoo(c) {
  await desfeita(c, async () => {
    await voltarAoAntes(c);
    const base = await foto(c);
    for (const [nome, sabotagem] of SABOTAGENS_DA_BASE) {
      const e = await tentar(c, async () => {
        for (const s of sabotagem) await c.query(s);
        await c.query(MIGRATION);
      });
      assert.match(
        e?.message ?? "(aplicou)",
        /B1_BASELINE_DIVERGENT/,
        `pré-voo deveria recusar: ${nome}`,
      );
    }
    assert.deepEqual(await foto(c), base, "nenhuma recusa escreveu nada");
    assert.equal(
      await tentar(c, () => c.query(MIGRATION)),
      null,
      "controle: sem sabotagem, a mesma base aplica",
    );
  });
  // o rollback comum também recusa estado desconhecido sem escrever
  await desfeita(c, async () => {
    const base = await foto(c);
    for (const [nome, sabotagem] of [
      [
        "porta com outro corpo",
        comOutroCorpo(
          "public.frota_mudar_estado",
          "DECLARE",
          "DECLARE\n  v_outro int;",
        ),
      ],
      [
        "função do gatilho com outro corpo",
        comOutroCorpo(
          "public.frota_lojas_estado_so_pela_porta",
          "BEGIN",
          "BEGIN\n  -- outro",
        ),
      ],
      [
        "gatilho apontando para outra função",
        `CREATE FUNCTION public.prova_outro_gatilho() RETURNS trigger ${CORPO_FALSO.replace("BEGIN END", "BEGIN RETURN NEW; END")}; CREATE OR REPLACE TRIGGER frota_lojas_estado_so_pela_porta BEFORE INSERT OR UPDATE OF estado, estado_desde, estado_sha, project_ref ON public.frota_lojas FOR EACH ROW EXECUTE FUNCTION public.prova_outro_gatilho()`,
      ],
      [
        "porta com sobrecarga",
        "CREATE FUNCTION public.frota_mudar_estado(p text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
      ],
    ]) {
      const e = await tentar(c, async () => {
        await c.query(sabotagem);
        await c.query(ROLLBACK);
      });
      assert.match(
        e?.message ?? "(desfez)",
        /B1_BASELINE_DIVERGENT/,
        `rollback deveria recusar: ${nome}`,
      );
    }
    assert.deepEqual(await foto(c), base);
  });
}

// ---------------------------------------------------------------------------
// (l) transação: sem COMMIT escondido; trava ocupada desiste em 5 s
// ---------------------------------------------------------------------------
async function transacao(c, url) {
  await c.query("BEGIN");
  await voltarAoAntes(c);
  await c.query("COMMIT");
  try {
    const base = await foto(c);
    await c.query("BEGIN");
    await c.query(MIGRATION);
    await c.query("ROLLBACK");
    assert.deepEqual(
      await foto(c),
      base,
      "aplicar e desfazer não deixa nada: não há COMMIT dentro da migration",
    );
    // Alguém ESCREVENDO na caderneta segura a tabela: o CREATE TRIGGER espera no máximo o lock_timeout e desiste sem escrever.
    const outro = new Client({ connectionString: url });
    await outro.connect();
    try {
      await outro.query("BEGIN");
      await outro.query("LOCK TABLE public.frota_lojas IN ROW EXCLUSIVE MODE");
      const t0 = Date.now();
      await c.query("BEGIN");
      let e = null;
      try {
        await c.query(MIGRATION);
      } catch (err) {
        e = err;
      } finally {
        await c.query("ROLLBACK");
      }
      const ms = Date.now() - t0;
      assert.equal(e?.code, "55P03", "trava ocupada: lock_timeout");
      assert(
        ms >= 4500 && ms < 20000,
        `desistiu em ${ms} ms (lock_timeout de 5 s)`,
      );
      await outro.query("ROLLBACK");
    } finally {
      await outro.end();
    }
    assert.deepEqual(await foto(c), base, "a desistência não escreveu nada");
  } finally {
    await c.query("BEGIN");
    await c.query(MIGRATION);
    await c.query("COMMIT");
  }
  assert.equal(await md5Vivo(c, PORTA), MD5_PORTA);
  assert.equal(await md5Vivo(c, GATILHO_FN), MD5_GATILHO);
}

// ---------------------------------------------------------------------------
// (m) as consultas 183a/183b, EXECUTADAS no catálogo real
// ---------------------------------------------------------------------------
async function consulta(c, nome) {
  const sql = fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
  assert.equal(CONF.contarStatements(sql), 1);
  await c.query("SAVEPOINT leitura_catalogo");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const rows = (await c.query(sql)).rows;
    assert.equal(
      CONF.estruturaDoRolFechado(rows, CONF.ROL_FECHADO_POR_CONSULTA[nome]),
      null,
      `${nome}: rol fechado`,
    );
    return rows
      .filter((r) => r.ok !== true)
      .map((r) => r.item)
      .sort();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT leitura_catalogo");
  }
}
async function portao(c) {
  const item = (rol, inicio) => {
    const x = CONF.ROL_FECHADO_POR_CONSULTA[rol].filter((i) =>
      i.startsWith(inicio),
    );
    assert.equal(x.length, 1, `item de ${rol}: ${inicio}`);
    return x[0];
  };
  const itemB = (i) => item(B183, i);
  let defeitos = 0;
  const plantar = async (rol, sabotagem, esperados) => {
    await c.query("SAVEPOINT defeito");
    try {
      await c.query(sabotagem);
      assert.deepEqual(
        await consulta(c, rol),
        esperados.map((i) => item(rol, i)).sort(),
        `${rol} com o defeito "${sabotagem.slice(0, 90)}" reprova exatamente o item certo`,
      );
      defeitos++;
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT defeito");
    }
  };
  await desfeita(c, async () => {
    await semente(c);
    await porta(c, { de: "ativa", para: "adormecida" }); // linhas não mudam o veredito (as consultas não leem linha)
    assert.deepEqual(
      await consulta(c, A183),
      [],
      "183a positiva depois da migration",
    );
    assert.deepEqual(
      await consulta(c, B183),
      [
        itemB("frota_mudar_estado: ainda"),
        itemB("frota_lojas_estado_so_pela_porta: ainda"),
        itemB("frota_estado_historico: a tabela"),
      ].sort(),
      "183b reprova só o que a migration criou",
    );
    const corpoOutro = comOutroCorpo(
      "public.frota_mudar_estado",
      "DECLARE",
      "DECLARE\n  v_outro int;",
    );
    for (const [sabotagem, esperados] of [
      [
        `GRANT EXECUTE ON FUNCTION ${PORTA} TO authenticated`,
        ["frota_mudar_estado: atributos"],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${PORTA} TO PUBLIC`,
        ["frota_mudar_estado: atributos"],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${PORTA} TO service_role`,
        ["frota_mudar_estado: atributos"],
      ],
      [
        `ALTER FUNCTION ${PORTA} SECURITY DEFINER`,
        ["frota_mudar_estado: atributos"],
      ],
      [
        `ALTER FUNCTION ${PORTA} SET search_path = public`,
        ["frota_mudar_estado: atributos"],
      ],
      [`ALTER FUNCTION ${PORTA} STABLE`, ["frota_mudar_estado: atributos"]],
      [corpoOutro, ["frota_mudar_estado: uma so"]],
      [
        `DROP FUNCTION ${PORTA}`,
        ["frota_mudar_estado: uma so", "frota_mudar_estado: atributos"],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${GATILHO_FN} TO service_role`,
        ["frota_lojas_estado_so_pela_porta: uma so"],
      ],
      [
        `ALTER FUNCTION ${GATILHO_FN} SECURITY DEFINER`,
        ["frota_lojas_estado_so_pela_porta: uma so"],
      ],
      [
        "ALTER TABLE public.frota_lojas DISABLE TRIGGER frota_lojas_estado_so_pela_porta",
        ["frota_lojas: um so gatilho"],
      ],
      [
        "DROP TRIGGER frota_lojas_estado_so_pela_porta ON public.frota_lojas",
        ["frota_lojas: um so gatilho"],
      ],
      [
        "CREATE OR REPLACE TRIGGER frota_lojas_estado_so_pela_porta BEFORE UPDATE OF estado ON public.frota_lojas FOR EACH ROW EXECUTE FUNCTION public.frota_lojas_estado_so_pela_porta()",
        ["frota_lojas: um so gatilho"],
      ],
      [
        "ALTER TABLE public.frota_estado_historico ALTER COLUMN quem SET DEFAULT 'x'",
        ["frota_estado_historico: colunas"],
      ],
      [
        "ALTER TABLE public.frota_estado_historico ALTER COLUMN motivo DROP NOT NULL",
        ["frota_estado_historico: colunas"],
      ],
      [
        "ALTER TABLE public.frota_estado_historico DROP CONSTRAINT frota_estado_historico_sha_check",
        ["frota_estado_historico: chave primaria"],
      ],
      [
        "ALTER TABLE public.frota_estado_historico ADD CONSTRAINT extra CHECK (loja_id <> '') NOT VALID",
        ["frota_estado_historico: chave primaria"],
      ],
      [
        "GRANT SELECT ON public.frota_estado_historico TO service_role",
        ["frota_estado_historico: tabela comum"],
      ],
      [
        "GRANT SELECT (motivo) ON public.frota_estado_historico TO authenticated",
        ["frota_estado_historico: tabela comum"],
      ],
      [
        `GRANT USAGE ON SEQUENCE ${SEQ} TO anon`,
        ["frota_estado_historico: tabela comum"],
      ],
      [
        "CREATE POLICY aberta ON public.frota_estado_historico FOR SELECT TO authenticated USING (true)",
        ["frota_estado_historico: tabela comum"],
      ],
      [
        "ALTER TABLE public.frota_estado_historico DISABLE ROW LEVEL SECURITY",
        ["frota_estado_historico: tabela comum"],
      ],
      [
        "ALTER TABLE public.frota_lojas ALTER COLUMN estado_sha SET DEFAULT 'x'",
        ["a base da 20261460000000"],
      ],
    ])
      await plantar(A183, sabotagem, esperados);
    // depois do rollback comum: a 183a reprova e a 183b só reprova a tabela (fica, com o histórico, de propósito)
    await c.query(ROLLBACK);
    assert.deepEqual(await consulta(c, B183), [
      itemB("frota_estado_historico: a tabela"),
    ]);
    assert.notDeepEqual(await consulta(c, A183), []);
    // depois do destrutivo: a 183b é POSITIVA
    await c.query(
      "SET LOCAL app.confirmo_apagar_historico_do_estado_da_loja = 'APAGAR'",
    );
    await c.query(DESTRUTIVO);
    assert.deepEqual(
      await consulta(c, B183),
      [],
      "183b positiva na base de antes",
    );
    for (const [sabotagem, esperados] of [
      [
        "CREATE FUNCTION public.frota_mudar_estado(p text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
        ["frota_mudar_estado: ainda"],
      ],
      [
        `CREATE FUNCTION public.frota_lojas_estado_so_pela_porta() RETURNS trigger ${CORPO_FALSO}`,
        ["frota_lojas_estado_so_pela_porta: ainda"],
      ],
      [
        `CREATE FUNCTION public.prova_outro_gatilho() RETURNS trigger ${CORPO_FALSO}; CREATE TRIGGER frota_lojas_estado_so_pela_porta BEFORE UPDATE ON public.frota_lojas FOR EACH ROW EXECUTE FUNCTION public.prova_outro_gatilho()`,
        ["frota_lojas_estado_so_pela_porta: ainda"],
      ],
      [
        "CREATE TABLE public.frota_estado_historico (id int)",
        ["frota_estado_historico: a tabela"],
      ],
      [ROLLBACK_1460, ["a 20261460000000 esta aplicada"]],
      [
        "ALTER TABLE public.frota_lojas ALTER COLUMN estado SET DEFAULT 'adormecida'",
        ["a 20261460000000 esta aplicada"],
      ],
    ])
      await plantar(B183, sabotagem, esperados);
  });
  return defeitos;
}

// ---------------------------------------------------------------------------
// (n) MUTANTES: a MESMA prova de comportamento tem de cair com cada defeito.
// ---------------------------------------------------------------------------
const SEM_CONFERENCIA = (sql) =>
  sql
    .replace(
      /DO \$preflight_20261470000000\$[\s\S]*?END \$preflight_20261470000000\$;\n?/,
      "",
    )
    .replace(
      /DO \$posvoo_20261470000000\$[\s\S]*?END \$posvoo_20261470000000\$;\n?/,
      "",
    );
const trocar = (sql, de, para) => {
  assert.equal(
    sql.split(de).length,
    2,
    `mutante: o trecho tem de aparecer UMA vez: ${de.slice(0, 60)}`,
  );
  return sql.replace(de, () => para);
};
const MUTANTES = [
  [
    "gatilho sem a trava das refs (IKCOUS e Savy)",
    (s) =>
      trocar(
        s,
        "  IF NEW.project_ref IN ('cafkrminfnokvgjqtkle', 'gnjsrucsmjkajijrakzr') AND NEW.estado IS DISTINCT FROM 'ativa' THEN",
        "  IF false THEN",
      ),
    "IKCOUS nunca sai de ativa",
  ],
  [
    "gatilho sem a troca condicionada (UPDATE direto passa)",
    (s) =>
      trocar(
        s,
        "  ELSIF NEW.estado IS DISTINCT FROM OLD.estado\n     OR NEW.estado_desde IS DISTINCT FROM OLD.estado_desde\n     OR NEW.estado_sha IS DISTINCT FROM OLD.estado_sha THEN",
        "  ELSIF false THEN",
      ),
    "UPDATE direto recusado",
  ],
  [
    "gatilho só olha o estado (estado_sha livre)",
    (s) =>
      trocar(
        s,
        "\n     OR NEW.estado_sha IS DISTINCT FROM OLD.estado_sha THEN",
        " THEN",
      ),
    "UPDATE direto do estado_sha",
  ],
  [
    "gatilho compara o estado_sha com <> (apagar o estado_sha passa: NULL <> sha não é verdadeiro)",
    (s) =>
      trocar(
        s,
        "     OR NEW.estado_sha IS DISTINCT FROM OLD.estado_sha THEN",
        "     OR NEW.estado_sha <> OLD.estado_sha THEN",
      ),
    "UPDATE direto que apaga o estado_sha",
  ],
  [
    "gatilho deixa a loja nascer fora de ativa",
    (s) =>
      trocar(
        s,
        "    IF NEW.estado IS DISTINCT FROM 'ativa' THEN\n      RAISE EXCEPTION 'FROTA_ESTADO_SO_PELA_PORTA: a loja % nasce ativa",
        "    IF false THEN\n      RAISE EXCEPTION 'FROTA_ESTADO_SO_PELA_PORTA: a loja % nasce ativa",
      ),
    "INSERT direto fora de ativa",
  ],
  [
    "gatilho sem o project_ref nas colunas",
    (s) =>
      trocar(
        s,
        "BEFORE INSERT OR UPDATE OF estado, estado_desde, estado_sha, project_ref ON",
        "BEFORE INSERT OR UPDATE OF estado, estado_desde, estado_sha ON",
      ),
    "trocando para o ref da Savy",
  ],
  [
    "sem REVOKE da porta",
    (s) =>
      trocar(
        s,
        "REVOKE ALL ON FUNCTION public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;\n",
        "",
      ),
    "ACL: anon não executa a porta",
  ],
  [
    "REVOKE da porta esquece o service_role",
    (s) =>
      trocar(
        s,
        "REVOKE ALL ON FUNCTION public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;",
        "REVOKE ALL ON FUNCTION public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;",
      ),
    "ACL: service_role não executa a porta",
  ],
  [
    "sem REVOKE da tabela do histórico",
    (s) =>
      trocar(
        s,
        "REVOKE ALL ON TABLE public.frota_estado_historico FROM PUBLIC, anon, authenticated, service_role;\n",
        "",
      ),
    "ACL: anon não lê o histórico",
  ],
  [
    "sem REVOKE da sequência",
    (s) =>
      trocar(
        s,
        "REVOKE ALL ON SEQUENCE public.frota_estado_historico_id_seq FROM PUBLIC, anon, authenticated, service_role;\n",
        "",
      ),
    "ACL: anon não usa a sequência",
  ],
  [
    "porta não confere o estado atual (p_de)",
    (s) =>
      trocar(s, "  IF v_atual IS DISTINCT FROM p_de THEN", "  IF false THEN"),
    "estado atual diferente",
  ],
  [
    "porta não confere a base ao acordar",
    (s) =>
      trocar(
        s,
        "  IF p_para = 'ativa' AND (p_base IS NULL OR v_sha_atual IS DISTINCT FROM p_base) THEN",
        "  IF false THEN",
      ),
    "acordar com base errada",
  ],
  [
    "porta só confere a base ao acordar de adormecida (reabrir de encerrada passa com qualquer base)",
    (s) =>
      trocar(
        s,
        "  IF p_para = 'ativa' AND (p_base IS NULL OR v_sha_atual IS DISTINCT FROM p_base) THEN",
        "  IF p_para = 'ativa' AND v_atual = 'adormecida' AND (p_base IS NULL OR v_sha_atual IS DISTINCT FROM p_base) THEN",
      ),
    "reabrir com base errada",
  ],
  [
    "porta não desliga a variável depois do UPDATE",
    (s) =>
      trocar(
        s,
        "  PERFORM set_config('ikcous.frota_estado_pela_porta', '', true);\n",
        "",
      ),
    "depois da porta, UPDATE direto recusado",
  ],
  [
    "porta encerra sem a confirmação",
    (s) =>
      trocar(
        s,
        "  IF p_para = 'encerrada' AND p_confirmacao IS DISTINCT FROM 'ENCERRAR ' || p_id THEN",
        "  IF false THEN",
      ),
    "encerrar sem confirmação",
  ],
  [
    "porta só pede a confirmação para encerrar quem está ativa (adormecida encerra sem a frase)",
    (s) =>
      trocar(
        s,
        "  IF p_para = 'encerrada' AND p_confirmacao IS DISTINCT FROM 'ENCERRAR ' || p_id THEN",
        "  IF p_para = 'encerrada' AND p_de = 'ativa' AND p_confirmacao IS DISTINCT FROM 'ENCERRAR ' || p_id THEN",
      ),
    "encerrar quem dorme sem confirmação",
  ],
  [
    "porta reabre sem a confirmação",
    (s) =>
      trocar(
        s,
        "  IF v_atual = 'encerrada' AND p_confirmacao IS DISTINCT FROM 'REABRIR ' || p_id THEN",
        "  IF false THEN",
      ),
    "reabrir sem confirmação",
  ],
  [
    "porta aceita validade de mais de 1 hora",
    (s) =>
      trocar(
        s,
        "  IF p_valido_ate > clock_timestamp() + interval '1 hour' THEN",
        "  IF false THEN",
      ),
    "validade de mais de 1 hora",
  ],
  [
    "porta aceita instrução vencida",
    (s) =>
      trocar(
        s,
        "  IF p_valido_ate IS NULL OR clock_timestamp() > p_valido_ate THEN",
        "  IF false THEN",
      ),
    "instrução vencida",
  ],
  [
    "porta sem o rastro",
    (s) =>
      trocar(
        s,
        "  INSERT INTO public.frota_estado_historico (loja_id, project_ref, de, para, sha, motivo)\n  VALUES (p_id, p_ref, p_de, p_para, p_sha, p_motivo);\n",
        "",
      ),
    "adormecer: UM rastro",
  ],
  [
    "porta regrava o estado_sha em toda troca (adormecida -> encerrada perde a release em que a loja saiu do ar)",
    (s) =>
      trocar(
        s,
        "estado_sha = CASE WHEN v_atual <> 'ativa' AND p_para <> 'ativa' THEN fl.estado_sha ELSE p_sha END",
        "estado_sha = p_sha",
      ),
    "b2: adormecida -> encerrada preserva o estado_sha",
  ],
  [
    "porta preserva o estado_sha também ao sair de ativa (adormecer não grava a release)",
    (s) =>
      trocar(
        s,
        "CASE WHEN v_atual <> 'ativa' AND p_para <> 'ativa' THEN fl.estado_sha ELSE p_sha END",
        "CASE WHEN p_para <> 'ativa' THEN fl.estado_sha ELSE p_sha END",
      ),
    "adormecer grava a release em que a loja saiu do ar",
  ],
  [
    "porta aceita sha fora do formato",
    (s) =>
      trocar(
        s,
        "  IF p_sha IS NULL OR p_sha !~ '^[0-9a-f]{40}$' THEN",
        "  IF p_sha IS NULL THEN",
      ),
    'sha "',
  ],
];
async function mutantes(c) {
  const rodar = (sql) =>
    desfeita(c, async () => {
      await voltarAoAntes(c);
      await c.query(sql);
      await comportamento(c);
    });
  await rodar(SEM_CONFERENCIA(MIGRATION)); // controle: verde
  let mortos = 0;
  for (const [nome, muta, fragmento] of MUTANTES) {
    const alterada = SEM_CONFERENCIA(muta(MIGRATION));
    assert.notEqual(
      alterada,
      SEM_CONFERENCIA(MIGRATION),
      `mutante "${nome}" não mudou nada`,
    );
    let motivo = null;
    try {
      await rodar(alterada);
    } catch (e) {
      motivo = e;
    }
    assert(motivo, `MUTANTE SOBREVIVEU: ${nome}`);
    assert.equal(
      motivo.code,
      "ERR_ASSERTION",
      `mutante "${nome}" morreu por erro inesperado (e não por asserção): ${motivo.message}`,
    );
    assert(
      motivo.message.includes(fragmento),
      `mutante "${nome}" morreu pelo motivo errado: ${motivo.message.split("\n")[0]}`,
    );
    mortos++;
    console.log(
      `    mutante morto: ${nome}: ${motivo.message.split("\n")[0].slice(0, 150)}`,
    );
  }
  return mortos;
}
/** O mutante que tira o FOR UPDATE só aparece com DUAS conexões: aplicado COMMITADO no clone, depois desfeito à mão. */
async function mutanteDaCorrida(c, url) {
  const semTrava = SEM_CONFERENCIA(
    trocar(
      MIGRATION,
      "   WHERE fl.id = p_id AND fl.project_ref = p_ref\n     FOR UPDATE;",
      "   WHERE fl.id = p_id AND fl.project_ref = p_ref;",
    ),
  );
  await c.query("BEGIN");
  await voltarAoAntes(c);
  await c.query(semTrava);
  await c.query("COMMIT");
  let motivo = null;
  try {
    await corrida(c, url);
  } catch (e) {
    motivo = e;
  } finally {
    await c.query("BEGIN");
    await limparCru(c);
    await c.query(MIGRATION);
    await c.query("COMMIT");
  }
  assert(motivo, "MUTANTE SOBREVIVEU: porta sem FOR UPDATE");
  assert.equal(
    motivo.code,
    "ERR_ASSERTION",
    `mutante sem FOR UPDATE morreu por erro inesperado: ${motivo.message}`,
  );
  assert(
    motivo.message.includes("corrida:"),
    `mutante sem FOR UPDATE morreu pelo motivo errado: ${motivo.message.split("\n")[0]}`,
  );
  console.log(
    `    mutante morto: porta sem FOR UPDATE: ${motivo.message.split("\n")[0].slice(0, 150)}`,
  );
  assert.equal(
    await md5Vivo(c, PORTA),
    MD5_PORTA,
    "depois do mutante da corrida a porta verdadeira volta",
  );
  return 1;
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  let provas = 0;
  const provar = async (nome, fn) => {
    const r = await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
    return r;
  };
  try {
    assert.equal(
      await md5Vivo(c, PORTA),
      MD5_PORTA,
      "o clone deve estar com a migration nova (porta)",
    );
    assert.equal(
      await md5Vivo(c, GATILHO_FN),
      MD5_GATILHO,
      "o clone deve estar com a migration nova (gatilho)",
    );
    await provar(
      "recusas da porta, adormecer/acordar/encerrar/reabrir com rastro, IKCOUS e Savy presas em ativa, gatilho, ACL",
      () => desfeita(c, () => comportamento(c)),
    );
    await provar("atomicidade: rastro que falha desfaz a troca de estado", () =>
      atomicidade(c),
    );
    await provar(
      "duas conexões na mesma loja: uma muda, a outra é recusada, um rastro só",
      () => corrida(c, url),
    );
    await provar(
      "linha que já existia: nada muda nela, o histórico nasce vazio e ela acorda pela porta",
      () => dadoExistente(c),
    );
    await provar("reaplicar 2x (LF e CRLF) não muda nada nem as linhas", () =>
      reaplicar(c),
    );
    await provar(
      "rollback comum (2x) preserva o histórico; destrutivo exige confirmação e o comum antes; ordem com a 20261460",
      () => rollbacks(c),
    );
    await provar(
      `pré-voo recusa ${SABOTAGENS_DA_BASE.length} estados divergentes sem escrever; o rollback recusa 4`,
      () => preVoo(c),
    );
    await provar(
      "transação: sem COMMIT escondido; trava ocupada desiste em 5 s sem escrever",
      () => transacao(c, url),
    );
    const defeitos = await provar(
      "consultas 183a/183b: catálogo real, defeitos plantados, rollback comum e destrutivo",
      () => portao(c),
    );
    const mortos =
      (await provar("mutantes da migration", () => mutantes(c))) +
      (await provar("mutante da corrida (sem FOR UPDATE)", () =>
        mutanteDaCorrida(c, url),
      ));
    console.log(
      `\na-loja-muda-de-estado-so-pela-porta-viva: ${provas} provas ok; ${defeitos} defeitos plantados nas consultas; ${mortos} mutantes mortos`,
    );
    anexarAoSummary(
      "Porta do estado da loja (PG17)",
      `${provas} provas, ${defeitos} defeitos plantados nas consultas 183a/183b, ${mortos} mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) => falhar("PORTA_DO_ESTADO_DA_LOJA", e.stack || e.message));
