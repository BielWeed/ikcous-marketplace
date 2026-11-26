"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste; os únicos caminhos de arquivo são os da migration 20261490, dos rollbacks dela,
 * da 20261460 e das consultas 182a/184a/186a/186b dentro do repositório. */
/**
 * PROVA VIVA da migration 20261490000000_a_caderneta_confere_a_chave_sem_bcrypt_por_chamada.sql contra o Postgres EFÊMERO com as
 * migrations aplicadas do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O DEFEITO: resolver_loja e resolver_loja_com_estado (EXECUTE do anon, a chave publicável é pública) rodavam bcrypt custo 10 em TODA
 * chamada, antes de olhar o endereço: chave errada em laço ocupava a CPU do banco da caderneta e o porteiro de todas as lojas caía.
 * Agora o bcrypt roda uma vez por hash e a conferência seguinte é um sha256 (o atalho), válido só para o hash bcrypt ATUAL.
 *
 * O QUE SE PROVA (as chamadas de anon vão por SET LOCAL ROLE anon, como o PostgREST; o bcrypt é CONTADO por
 * pg_stat_get_xact_function_calls com track_functions = 'all' ligado no começo de cada transação):
 *   (a) comportamento, nas DUAS portas: chave errada, NULL e vazia sem atalho = zero linhas, nada gravado, e cada chave errada roda
 *       UM bcrypt (controle do contador); a chave certa resolve e grava o atalho (sha256 da chave + o hash a que vale); depois dele
 *       chave errada = zero linhas e ZERO bcrypt, chave certa = zero bcrypt; o atalho decide sozinho (trocado à mão, a grafia nova
 *       abre e a chave certa não); trocar a chave invalida o atalho (a velha para de abrir, a nova abre e regrava); transação só de
 *       leitura confere sem erro e não grava; chave de mais de 72 bytes: o atalho só aceita a grafia exata; o catálogo continua fechado;
 *   (b) linha que já existia antes da migration: nada muda nela (as colunas nascem nulas) e a primeira chamada certa grava o atalho;
 *   (c) reaplicar 2x (LF e CRLF) não muda nada, nem o atalho gravado;
 *   (d) rollback comum (2x) devolve as portas BYTE A BYTE aos corpos da 20261460 e preserva colunas e atalho; o destrutivo exige
 *       confirmação e o comum antes; reaplicar volta ao estado da migration;
 *   (e) pré-voo recusa estado divergente sem escrever; o rollback comum também;
 *   (f) transação: sem COMMIT escondido; leitor segurando frota_segredo faz a migration desistir no lock_timeout de 5 s;
 *   (g) duas conexões: com a linha de frota_segredo presa por uma troca de chave ainda aberta, a porta responde sem esperar e não grava;
 *   (h) consultas 186a/186b EXECUTADAS no catálogo real (como authenticated), com defeitos plantados; 182a e 184a aceitam a sucessora;
 *   (i) MUTANTES: o comportamento cai pelo motivo certo, e o pós-voo de cada um recusa sozinho.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-caderneta-confere-a-chave-sem-bcrypt-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const {
  desfazerChaveSemBcryptNaTransacao,
} = require("./a-caderneta-confere-a-chave-sem-bcrypt-posterior.cjs");

const NOME =
  "20261490000000_a_caderneta_confere_a_chave_sem_bcrypt_por_chamada.sql";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);
const ESTADO_DE_VIDA = ler("20261460000000_a_loja_tem_estado_de_vida.sql");
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const A186 = "186a-conferir-a-caderneta-confere-a-chave-sem-bcrypt-aplicado";
const B186 = "186b-antes-a-caderneta-confere-a-chave-sem-bcrypt-ausente";
const A182 = "182a-conferir-o-estado-de-vida-da-loja-aplicado";
const A184 = "184a-conferir-a-caderneta-fecha-para-o-service-role-aplicado";

const V1 = "public.resolver_loja(text, text)";
const V2 = "public.resolver_loja_com_estado(text, text)";
const PORTAS = [V1, V2];
const md5 = (s) => createHash("md5").update(s).digest("hex");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
/** O texto entre `AS $$` e `$$;` de uma função do arquivo: é o prosrc que o Postgres guarda. */
function bloco(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  assert(i >= 0, `${nome} não está no arquivo`);
  const fim = sql.indexOf("$$;", sql.indexOf("AS $$", i) + 5) + 3;
  return sql.slice(i, fim);
}
const corpo = (sql, nome) => {
  const b = bloco(sql, nome);
  return b.slice(b.indexOf("AS $$") + 5, b.length - 3);
};
const MD5_NOVO = {
  [V1]: md5(corpo(MIGRATION, "public.resolver_loja")),
  [V2]: md5(corpo(MIGRATION, "public.resolver_loja_com_estado")),
};
const MD5_1460 = {
  [V1]: md5(corpo(ESTADO_DE_VIDA, "public.resolver_loja")),
  [V2]: md5(corpo(ESTADO_DE_VIDA, "public.resolver_loja_com_estado")),
};
const CHAVE = "chave-da-prova-1490";
const CHAVE_NOVA = "chave-nova-da-prova-1490";
const LOJA = {
  id: "l1490-cofre",
  nome: "Loja da prova 1490",
  dominio_publico: "cofre.l1490.teste",
  project_ref: "aaaaaaaaaaaaaaaaaaaf",
  supabase_url: "https://aaaaaaaaaaaaaaaaaaaf.supabase.co",
  publishable_key: "pk_l1490_cofre",
};
const SQL_V = (fn) => `SELECT * FROM ${fn.replace("(text, text)", "")}($1, $2)`;
const ATALHO_VAZIO = { hash_rapido: null, hash_rapido_de: null };

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  const sp = `sp_1490_${++contaSavepoint}`;
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
/**
 * Roda `fn` numa transação SEMPRE desfeita. track_functions = 'all' é o PRIMEIRO comando: o executor decide contar a chamada de uma
 * função C quando monta a expressão, e o plpgsql monta as expressões das portas uma vez por transação.
 */
async function desfeita(c, fn) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL track_functions = 'all'");
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
/** Chama a porta como anon (o PostgREST); o que a porta grava FICA na transação do chamador. */
async function comoAnon(c, fn, host, chave) {
  const sp = `sp_1490_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    await c.query("SET LOCAL ROLE anon");
    const linhas = (await c.query(SQL_V(fn), [host, chave])).rows;
    await c.query("RESET ROLE");
    await c.query(`RELEASE SAVEPOINT ${sp}`);
    return { codigo: "ok", linhas };
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
    return { codigo: e.code, linhas: null, erro: e };
  }
}
const ids = (r) => (r.linhas ?? []).map((l) => l.id);
const colunasDoAtalho = async (c) =>
  (
    await c.query(
      "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.frota_segredo'::regclass AND attnum > 0 AND NOT attisdropped AND attname IN ('hash_rapido', 'hash_rapido_de')",
    )
  ).rows[0].n;
/** O segredo da frota com a `chave` (bcrypt custo 4: o custo não muda o que se prova) e SEM atalho; a loja ativa. */
async function semente(c, chave = CHAVE) {
  await c.query(
    "INSERT INTO public.frota_segredo (id, hash) VALUES (1, extensions.crypt($1, extensions.gen_salt('bf', 4))) ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash",
    [chave],
  );
  if ((await colunasDoAtalho(c)) === 2)
    await c.query(
      "UPDATE public.frota_segredo SET hash_rapido = NULL, hash_rapido_de = NULL WHERE id = 1",
    );
  // A 20261470 deixa a loja nascer ativa sem a porta (o gatilho só recusa nascer fora de ativa).
  await c.query(
    "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa) VALUES ($1, $2, $3, $4, $5, $6, true) ON CONFLICT (id) DO NOTHING",
    [
      LOJA.id,
      LOJA.nome,
      LOJA.dominio_publico,
      LOJA.project_ref,
      LOJA.supabase_url,
      LOJA.publishable_key,
    ],
  );
}
const segredo = async (c) =>
  (
    await c.query(
      "SELECT hash, hash_rapido, hash_rapido_de FROM public.frota_segredo WHERE id = 1",
    )
  ).rows[0];
const atalho = async (c) => {
  const s = await segredo(c);
  return { hash_rapido: s.hash_rapido, hash_rapido_de: s.hash_rapido_de };
};
/** Quantas vezes extensions.crypt rodou nesta transação. */
const bcrypts = async (c) =>
  Number(
    (
      await c.query(
        "SELECT coalesce(pg_stat_get_xact_function_calls('extensions.crypt(text, text)'::regprocedure), 0)::int AS n",
      )
    ).rows[0].n,
  );
/** Chama a porta `vezes` vezes (como o dono: a porta é SECURITY DEFINER e roda igual) e devolve quantos bcrypt isso custou. */
async function custo(c, fn, chave, vezes) {
  const antes = await bcrypts(c);
  for (let i = 0; i < vezes; i++)
    await c.query(SQL_V(fn), [LOJA.dominio_publico, chave]);
  return (await bcrypts(c)) - antes;
}
const md5Vivo = async (c, fn) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [fn],
    )
  ).rows[0]?.h ?? null;
async function foto(c) {
  const fn = await c.query(
    `SELECT p.proname, p.oid::int AS oid, md5(replace(p.prosrc, E'\\r', '')) AS h, p.proacl::text AS acl, p.proowner::int AS dono,
            p.prosecdef, p.provolatile, p.proconfig::text AS config
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado') ORDER BY 1`,
  );
  const tb = await c.query(
    `SELECT c.relname, c.oid::int AS oid, c.relowner::int AS dono, c.relacl::text AS acl, c.relrowsecurity, c.relforcerowsecurity,
            (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(a.attacl::text, '-'), ',' ORDER BY a.attnum)
               FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
       FROM pg_class c WHERE c.oid IN ('public.frota_lojas'::regclass, 'public.frota_segredo'::regclass) ORDER BY 1`,
  );
  return { fn: fn.rows, tb: tb.rows };
}
/** As linhas da caderneta, lidas como o dono. */
async function retrato(c) {
  const l = await c.query(
    "SELECT md5(string_agg(to_jsonb(f)::text, '|' ORDER BY f.id)) AS h, count(*)::int AS n FROM public.frota_lojas f",
  );
  const s = await c.query(
    "SELECT md5(string_agg(to_jsonb(f)::text, '|' ORDER BY f.id)) AS h, count(*)::int AS n FROM public.frota_segredo f",
  );
  return { lojas: l.rows[0], segredo: s.rows[0] };
}
/** Volta à base de antes desta migration (comum + destrutivo) DENTRO da transação do chamador. */
async function voltarAoAntes(c) {
  assert.equal(
    await desfazerChaveSemBcryptNaTransacao(c),
    true,
    "base de antes: a migration estava no ar",
  );
  for (const fn of PORTAS)
    assert.equal(await md5Vivo(c, fn), MD5_1460[fn], `base de antes: ${fn}`);
  assert.equal(await colunasDoAtalho(c), 0, "base de antes: sem as colunas");
}

// ---------------------------------------------------------------------------
// (a) comportamento (o MESMO que os mutantes têm de derrubar)
// ---------------------------------------------------------------------------
async function comportamento(c) {
  await semente(c);
  // Catálogo: a tabela continua só do dono, inclusive nas colunas novas.
  for (const papel of ["anon", "authenticated", "service_role"]) {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"])
      assert.equal(
        (
          await c.query(
            "SELECT has_table_privilege($1::name, 'public.frota_segredo'::regclass, $2::text) AS x",
            [papel, p],
          )
        ).rows[0].x,
        false,
        `catálogo: ${papel} sem ${p} em frota_segredo`,
      );
    for (const col of ["hash_rapido", "hash_rapido_de"])
      assert.equal(
        (
          await c.query(
            "SELECT has_column_privilege($1::name, 'public.frota_segredo'::regclass, $2::text, 'SELECT, UPDATE') AS x",
            [papel, col],
          )
        ).rows[0].x,
        false,
        `catálogo: ${papel} sem privilégio na coluna ${col}`,
      );
  }

  // 1. Sem atalho: chave errada, NULL e vazia = zero linhas, sem erro, nada gravado.
  for (const fn of PORTAS)
    for (const [rotulo, chave] of [
      ["errada", "errada"],
      ["NULL", null],
      ["vazia", ""],
    ]) {
      const r = await comoAnon(c, fn, LOJA.dominio_publico, chave);
      assert.deepEqual(
        [r.codigo, r.linhas],
        ["ok", []],
        `sem atalho: chave ${rotulo} não resolve por ${fn}`,
      );
      // A cada chamada, não depois do laço: um atalho gravado pela chave errada vira, já na chamada seguinte, a porta que a deixa
      // entrar — conferido só no fim, o defeito aparecia como "resolve" e escondia a causa (a gravação).
      assert.deepEqual(
        await atalho(c),
        ATALHO_VAZIO,
        `sem atalho: chave ${rotulo} não grava nada (${fn})`,
      );
    }
  assert.deepEqual(
    await atalho(c),
    ATALHO_VAZIO,
    "sem atalho: chave errada, NULL e vazia não gravam nada",
  );
  // Controle do contador: sem atalho, cada chave errada roda UM bcrypt (é o defeito; se der 0, o contador não está medindo).
  assert.equal(
    await custo(c, V1, "errada", 3),
    3,
    "controle do contador: sem atalho, cada chave errada roda um bcrypt",
  );
  assert.deepEqual(await atalho(c), ATALHO_VAZIO, "sem atalho: nada gravado");

  // 2. A chave certa abre pelo bcrypt e grava o atalho deste hash.
  const { hash } = await segredo(c);
  const certa = await comoAnon(c, V2, LOJA.dominio_publico, CHAVE);
  assert.deepEqual(
    certa.linhas?.map((l) => [l.id, l.supabase_url, l.estado]),
    [[LOJA.id, LOJA.supabase_url, "ativa"]],
    "chave certa resolve pela v2",
  );
  assert.deepEqual(
    await atalho(c),
    { hash_rapido: sha256(CHAVE), hash_rapido_de: hash },
    "a chave certa grava o atalho: sha256 da chave e o hash a que ele vale",
  );
  assert.equal((await segredo(c)).hash, hash, "o hash bcrypt não muda");

  // 3. Com o atalho: a chave certa resolve nas duas sem bcrypt; chave errada não resolve e não roda bcrypt.
  for (const fn of PORTAS) {
    assert.deepEqual(
      ids(await comoAnon(c, fn, LOJA.dominio_publico, CHAVE)),
      [LOJA.id],
      `com o atalho: a chave certa resolve por ${fn}`,
    );
    for (const chave of ["errada", null, ""])
      assert.deepEqual(
        (await comoAnon(c, fn, LOJA.dominio_publico, chave)).linhas,
        [],
        `depois do atalho, chave errada não resolve por ${fn} (${chave})`,
      );
  }
  assert.equal(
    (await custo(c, V1, "errada", 10)) + (await custo(c, V2, "errada", 10)),
    0,
    "depois do atalho, chave errada não roda bcrypt",
  );
  assert.equal(
    (await custo(c, V1, CHAVE, 3)) + (await custo(c, V2, CHAVE, 3)),
    0,
    "depois do atalho, a chave certa não roda bcrypt",
  );
  assert.deepEqual(
    await atalho(c),
    { hash_rapido: sha256(CHAVE), hash_rapido_de: hash },
    "depois do atalho, nenhuma chamada regrava nada",
  );

  // 4. O atalho decide sozinho: trocado à mão (mesmo hash_rapido_de), a grafia nova abre e a chave certa não.
  await c.query(
    "UPDATE public.frota_segredo SET hash_rapido = $1 WHERE id = 1",
    [sha256("outra-grafia")],
  );
  for (const fn of PORTAS) {
    assert.deepEqual(
      ids(await comoAnon(c, fn, LOJA.dominio_publico, "outra-grafia")),
      [LOJA.id],
      `o atalho decide: a grafia do atalho abre por ${fn}`,
    );
    assert.deepEqual(
      ids(await comoAnon(c, fn, LOJA.dominio_publico, CHAVE)),
      [],
      `o atalho decide: a chave do bcrypt não abre por ${fn} quando o atalho diz outra`,
    );
  }
  await c.query(
    "UPDATE public.frota_segredo SET hash_rapido = $1 WHERE id = 1",
    [sha256(CHAVE)],
  );

  // 5. Troca de chave: o hash muda, o atalho velho deixa de valer sozinho; a velha não abre, a nova abre e regrava.
  await c.query(
    "UPDATE public.frota_segredo SET hash = extensions.crypt($1, extensions.gen_salt('bf', 4)) WHERE id = 1",
    [CHAVE_NOVA],
  );
  const novo = (await segredo(c)).hash;
  for (const fn of PORTAS)
    assert.deepEqual(
      ids(await comoAnon(c, fn, LOJA.dominio_publico, CHAVE)),
      [],
      `troca de chave: a chave velha não abre por ${fn}`,
    );
  assert.deepEqual(
    await atalho(c),
    { hash_rapido: sha256(CHAVE), hash_rapido_de: hash },
    "troca de chave: a chave velha não regrava o atalho",
  );
  assert.deepEqual(
    ids(await comoAnon(c, V1, LOJA.dominio_publico, CHAVE_NOVA)),
    [LOJA.id],
    "troca de chave: a chave nova abre",
  );
  assert.deepEqual(
    await atalho(c),
    { hash_rapido: sha256(CHAVE_NOVA), hash_rapido_de: novo },
    "troca de chave: a chave nova regrava o atalho para o hash novo",
  );
  assert.deepEqual(
    ids(await comoAnon(c, V2, LOJA.dominio_publico, CHAVE)),
    [],
    "troca de chave: a chave velha continua sem abrir depois do atalho novo",
  );

  // 6. Transação só de leitura (o GET do PostgREST, uma réplica): confere pelo bcrypt sem erro e não grava.
  await c.query(
    "UPDATE public.frota_segredo SET hash_rapido = NULL, hash_rapido_de = NULL WHERE id = 1",
  );
  for (const fn of PORTAS) {
    let lido = null;
    let gravado = null;
    const e = await tentar(c, async () => {
      await c.query("SET LOCAL transaction_read_only = on");
      await c.query("SET LOCAL ROLE anon");
      lido = (await c.query(SQL_V(fn), [LOJA.dominio_publico, CHAVE_NOVA]))
        .rows;
      await c.query("RESET ROLE");
      gravado = await atalho(c);
    });
    assert.equal(
      e?.code ?? "ok",
      "ok",
      `transação só de leitura: ${fn} confere sem erro (${e?.message})`,
    );
    assert.deepEqual(
      ids({ linhas: lido }),
      [LOJA.id],
      `transação só de leitura: a chave certa resolve por ${fn}`,
    );
    assert.deepEqual(
      gravado,
      ATALHO_VAZIO,
      `transação só de leitura: ${fn} não grava o atalho`,
    );
  }

  // 7. Chave de mais de 72 bytes: o bcrypt só lê os 72 primeiros; o atalho aceita só a grafia exata que abriu.
  const longa = `${"k".repeat(72)}A`;
  const vizinha = `${"k".repeat(72)}B`;
  await semente(c, longa);
  const eLonga = await tentar(c, async () => {
    await c.query("SET LOCAL transaction_read_only = on");
    assert.deepEqual(
      ids({
        linhas: (await c.query(SQL_V(V1), [LOJA.dominio_publico, vizinha]))
          .rows,
      }),
      [LOJA.id],
      "controle: sem atalho, o bcrypt aceita a vizinha (só lê 72 bytes)",
    );
  });
  assert.equal(eLonga, null, eLonga?.message);
  assert.deepEqual(
    ids(await comoAnon(c, V1, LOJA.dominio_publico, longa)),
    [LOJA.id],
    "chave longa: a grafia exata abre e grava o atalho",
  );
  assert.deepEqual(
    ids(await comoAnon(c, V1, LOJA.dominio_publico, vizinha)),
    [],
    "chave longa: com o atalho, a vizinha de 72 bytes iguais não abre",
  );
  assert.deepEqual(
    ids(await comoAnon(c, V2, LOJA.dominio_publico, longa)),
    [LOJA.id],
    "chave longa: a grafia exata continua abrindo",
  );
}

// ---------------------------------------------------------------------------
// (b) linha que já existia antes da migration
// ---------------------------------------------------------------------------
async function dadoExistente(c) {
  await desfeita(c, async () => {
    await voltarAoAntes(c);
    await semente(c);
    const antes = await retrato(c);
    const linhaAntes = (
      await c.query(
        "SELECT id, hash, updated_at FROM public.frota_segredo WHERE id = 1",
      )
    ).rows;
    await c.query(MIGRATION);
    assert.deepEqual(
      (await retrato(c)).lojas,
      antes.lojas,
      "a migration não toca frota_lojas",
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT id, hash, updated_at FROM public.frota_segredo WHERE id = 1",
        )
      ).rows,
      linhaAntes,
      "a linha de frota_segredo não muda",
    );
    assert.deepEqual(
      await atalho(c),
      ATALHO_VAZIO,
      "as colunas nascem nulas na linha que já existia",
    );
    assert.deepEqual(
      ids(await comoAnon(c, V2, LOJA.dominio_publico, CHAVE)),
      [LOJA.id],
      "a chave de antes continua abrindo",
    );
    const comAtalho = await retrato(c);
    assert.equal((await atalho(c)).hash_rapido, sha256(CHAVE));
    await c.query(ROLLBACK);
    assert.deepEqual(
      await retrato(c),
      comAtalho,
      "o rollback comum não toca linha nenhuma (o atalho fica)",
    );
  });
}

// ---------------------------------------------------------------------------
// (c) reaplicar 2x (LF e CRLF)
// ---------------------------------------------------------------------------
async function reaplicar(c) {
  await desfeita(c, async () => {
    await semente(c);
    await comoAnon(c, V1, LOJA.dominio_publico, CHAVE);
    assert.equal((await atalho(c)).hash_rapido, sha256(CHAVE));
    const antesDe = await foto(c);
    const dados = await retrato(c);
    await c.query(MIGRATION);
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      antesDe,
      "reaplicar (LF, CRLF, LF) não muda OID, corpo, ACL nem coluna",
    );
    assert.deepEqual(
      await retrato(c),
      dados,
      "reaplicar não toca linha (o atalho gravado fica)",
    );
  });
}

// ---------------------------------------------------------------------------
// (d) rollbacks
// ---------------------------------------------------------------------------
async function rollbacks(c) {
  await desfeita(c, async () => {
    await semente(c);
    await comoAnon(c, V1, LOJA.dominio_publico, CHAVE);
    const depois = await foto(c);
    const dados = await retrato(c);
    for (const vez of [1, 2]) {
      await c.query(ROLLBACK);
      for (const fn of PORTAS)
        assert.equal(
          await md5Vivo(c, fn),
          MD5_1460[fn],
          `rollback ${vez}: ${fn} volta BYTE A BYTE ao corpo da 20261460`,
        );
    }
    const desfeito = await foto(c);
    assert.deepEqual(
      { ...desfeito, fn: desfeito.fn.map((f) => ({ ...f, h: null })) },
      { ...depois, fn: depois.fn.map((f) => ({ ...f, h: null })) },
      "o rollback comum só muda o texto das portas (OID, dono, ACL, atributos e colunas iguais)",
    );
    assert.deepEqual(
      await retrato(c),
      dados,
      "o rollback comum preserva as linhas e o atalho",
    );
    // O corpo antigo de volta: bcrypt em toda chamada, chave certa abre, errada não.
    for (const fn of PORTAS) {
      assert.deepEqual(
        ids(await comoAnon(c, fn, LOJA.dominio_publico, CHAVE)),
        [LOJA.id],
      );
      assert.deepEqual(
        ids(await comoAnon(c, fn, LOJA.dominio_publico, "errada")),
        [],
      );
    }
    assert.equal(
      await custo(c, V1, "errada", 2),
      2,
      "depois do rollback, o bcrypt volta a rodar em toda chamada",
    );
    // Reaplicar depois do rollback comum volta ao estado da migration (o atalho gravado volta a valer).
    await c.query(MIGRATION);
    assert.deepEqual(await foto(c), depois, "reaplicar depois do comum");
    assert.equal(await custo(c, V2, "errada", 2), 0, "o atalho volta a valer");
    // Destrutivo: exige a confirmação e o comum antes.
    let e = await tentar(c, () => c.query(DESTRUTIVO));
    assert.match(
      e?.message ?? "(apagou)",
      /ATALHO_DA_CHAVE_SO_COM_O_DONO/,
      "destrutivo sem confirmação",
    );
    e = await tentar(c, async () => {
      await c.query(
        "SET LOCAL app.confirmo_apagar_atalho_da_chave_da_frota = 'APAGAR'",
      );
      await c.query(DESTRUTIVO);
    });
    assert.match(
      e?.message ?? "(apagou)",
      /ATALHO_DA_CHAVE_ROLLBACK_COMUM_PRIMEIRO/,
      "destrutivo com as portas novas no ar",
    );
    await c.query(ROLLBACK);
    const { hash } = await segredo(c);
    await c.query(
      "SET LOCAL app.confirmo_apagar_atalho_da_chave_da_frota = 'APAGAR'",
    );
    await c.query(DESTRUTIVO);
    await c.query(DESTRUTIVO);
    assert.equal(await colunasDoAtalho(c), 0, "o destrutivo tira as colunas");
    assert.deepEqual(
      (await c.query("SELECT id, hash FROM public.frota_segredo WHERE id = 1"))
        .rows,
      [{ id: 1, hash }],
      "o destrutivo deixa a linha e o hash",
    );
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      depois,
      "reaplicar depois do destrutivo volta ao estado da migration",
    );
    assert.deepEqual(await atalho(c), ATALHO_VAZIO, "atalho recomeça nulo");
  });
}

// ---------------------------------------------------------------------------
// (e) pré-voo
// ---------------------------------------------------------------------------
const CRIAR_OUTRO = "CREATE ROLE prova_1490_outro NOLOGIN";
const PORTA_1470 =
  "public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)";
const OUTRO_CORPO_V1 =
  "CREATE OR REPLACE FUNCTION public.resolver_loja(p_host text, p_chave text) RETURNS TABLE (id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text) LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = '' AS $f$ BEGIN RETURN; END $f$";
const SABOTAGENS_DA_BASE = [
  ["resolver_loja com outro corpo", [OUTRO_CORPO_V1]],
  ["resolver_loja_com_estado ausente", [`DROP FUNCTION ${V2}`]],
  ["só a v1 com o corpo novo", [bloco(MIGRATION, "public.resolver_loja")]],
  [
    "as duas com o corpo novo sem as colunas",
    [
      bloco(MIGRATION, "public.resolver_loja"),
      bloco(MIGRATION, "public.resolver_loja_com_estado"),
    ],
  ],
  [
    "só a coluna hash_rapido",
    ["ALTER TABLE public.frota_segredo ADD COLUMN hash_rapido text"],
  ],
  [
    "hash_rapido com outro tipo",
    [
      "ALTER TABLE public.frota_segredo ADD COLUMN hash_rapido bytea, ADD COLUMN hash_rapido_de text",
    ],
  ],
  [
    "coluna do atalho aberta ao anon",
    [
      "ALTER TABLE public.frota_segredo ADD COLUMN hash_rapido text, ADD COLUMN hash_rapido_de text",
      "GRANT SELECT (hash_rapido) ON public.frota_segredo TO anon",
    ],
  ],
  [
    "a 20261480 desfeita (service_role com tudo em frota_segredo)",
    ["GRANT ALL ON public.frota_segredo TO service_role"],
  ],
  ["a 20261470 ausente (sem a porta)", [`DROP FUNCTION ${PORTA_1470}`]],
  [
    "v1 executável por authenticated",
    [`GRANT EXECUTE ON FUNCTION ${V1} TO authenticated`],
  ],
  ["v2 SECURITY INVOKER", [`ALTER FUNCTION ${V2} SECURITY INVOKER`]],
  [
    "frota_segredo com outro dono",
    [CRIAR_OUTRO, "ALTER TABLE public.frota_segredo OWNER TO prova_1490_outro"],
  ],
  [
    "sem extensions.digest",
    [
      "ALTER FUNCTION extensions.digest(text, text) RENAME TO digest_prova_1490",
    ],
  ],
  ["frota_segredo ausente", ["DROP TABLE public.frota_segredo"]],
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
  // O rollback comum recusa o que não é nem o estado da migration nem o da 20261460.
  await desfeita(c, async () => {
    const base = await foto(c);
    for (const [nome, sabotagem] of [
      ["outro corpo na v1", OUTRO_CORPO_V1],
      [
        "v1 executável por authenticated",
        `GRANT EXECUTE ON FUNCTION ${V1} TO authenticated`,
      ],
      ["v2 ausente", `DROP FUNCTION ${V2}`],
    ]) {
      const r = await tentar(c, async () => {
        await c.query(sabotagem);
        await c.query(ROLLBACK);
      });
      assert.match(
        r?.message ?? "(desfez)",
        /B1_BASELINE_DIVERGENT/,
        `rollback deveria recusar: ${nome}`,
      );
    }
    assert.deepEqual(await foto(c), base);
  });
  return SABOTAGENS_DA_BASE.length + 3;
}

// ---------------------------------------------------------------------------
// (f) transação: sem COMMIT escondido; leitor segurando frota_segredo faz desistir em 5 s
// ---------------------------------------------------------------------------
async function transacao(c, url) {
  const base = await foto(c);
  await c.query("BEGIN");
  await voltarAoAntes(c);
  await c.query("COMMIT");
  try {
    const antes = await foto(c);
    await c.query("BEGIN");
    await c.query(MIGRATION);
    await c.query("ROLLBACK");
    assert.deepEqual(
      await foto(c),
      antes,
      "aplicar e desfazer não deixa nada: não há COMMIT dentro da migration",
    );
    const outro = new Client({ connectionString: url });
    await outro.connect();
    try {
      // Uma porta lendo frota_segredo numa transação aberta (ACCESS SHARE) segura o ADD COLUMN: lock_timeout e desiste.
      await outro.query("BEGIN");
      await outro.query("LOCK TABLE public.frota_segredo IN ACCESS SHARE MODE");
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
      assert.equal(
        e?.code,
        "55P03",
        "leitor aberto em frota_segredo: lock_timeout",
      );
      assert(
        ms >= 4500 && ms < 20000,
        `desistiu em ${ms} ms (lock_timeout de 5 s)`,
      );
      await outro.query("ROLLBACK");
    } finally {
      await outro.end();
    }
    assert.deepEqual(await foto(c), antes, "a desistência não escreveu nada");
  } finally {
    await c.query("BEGIN");
    await c.query(MIGRATION);
    await c.query("COMMIT");
  }
  assert.deepEqual(await foto(c), base, "de volta ao estado da migration");
}

// ---------------------------------------------------------------------------
// (g) duas conexões: a linha presa por uma troca de chave aberta não faz a porta esperar
// ---------------------------------------------------------------------------
async function concorrencia(c, url, sql = null) {
  const original = (
    await c.query("SELECT to_jsonb(s) AS j FROM public.frota_segredo s")
  ).rows;
  await c.query("BEGIN");
  if (sql) await c.query(sql);
  await semente(c);
  await c.query("COMMIT");
  const outro = new Client({ connectionString: url });
  await outro.connect();
  try {
    await outro.query("BEGIN");
    await outro.query(
      "UPDATE public.frota_segredo SET hash = extensions.crypt($1, extensions.gen_salt('bf', 4)) WHERE id = 1",
      [CHAVE_NOVA],
    );
    let linhas = null;
    let e = null;
    const t0 = Date.now();
    await c.query("SET ROLE anon");
    await c.query("SET statement_timeout = '3s'");
    try {
      linhas = (await c.query(SQL_V(V2), [LOJA.dominio_publico, CHAVE])).rows;
    } catch (err) {
      e = err;
    } finally {
      await c.query("RESET statement_timeout");
      await c.query("RESET ROLE");
    }
    const ms = Date.now() - t0;
    assert(
      !e && ms < 2000,
      `linha presa por outra conexão: a porta não espera quem segura a linha (${ms} ms; ${e?.code ?? "sem erro"} ${e?.message ?? ""})`,
    );
    assert.deepEqual(
      ids({ linhas }),
      [LOJA.id],
      "linha presa: a chave de antes ainda abre (a troca não comitou)",
    );
    assert.deepEqual(
      await atalho(c),
      ATALHO_VAZIO,
      "linha presa: nada gravado",
    );
    await outro.query("COMMIT");
    await c.query("SET ROLE anon");
    try {
      assert.deepEqual(
        (await c.query(SQL_V(V1), [LOJA.dominio_publico, CHAVE])).rows,
        [],
        "troca comitada: a chave velha não abre",
      );
      assert.deepEqual(
        ids({
          linhas: (await c.query(SQL_V(V1), [LOJA.dominio_publico, CHAVE_NOVA]))
            .rows,
        }),
        [LOJA.id],
        "troca comitada: a chave nova abre",
      );
    } finally {
      await c.query("RESET ROLE");
    }
    const s = await segredo(c);
    assert.deepEqual(
      await atalho(c),
      { hash_rapido: sha256(CHAVE_NOVA), hash_rapido_de: s.hash },
      "troca comitada: o atalho é gravado (autocommit) para o hash novo",
    );
  } finally {
    await outro.query("ROLLBACK").catch(() => {});
    await outro.end();
    await c.query("BEGIN");
    await c.query("DELETE FROM public.frota_lojas WHERE id = $1", [LOJA.id]);
    await c.query("DELETE FROM public.frota_segredo");
    for (const { j } of original)
      await c.query(
        "INSERT INTO public.frota_segredo SELECT * FROM jsonb_populate_record(NULL::public.frota_segredo, $1::jsonb)",
        [JSON.stringify(j)],
      );
    if (sql) await c.query(MIGRATION);
    await c.query("COMMIT");
  }
}

// ---------------------------------------------------------------------------
// (h) consultas 186a/186b, EXECUTADAS no catálogo real; 182a e 184a com a sucessora
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
  let defeitos = 0;
  const plantar = async (rol, sabotagem, esperados) => {
    await c.query("SAVEPOINT defeito");
    try {
      for (const s of [].concat(sabotagem)) await c.query(s);
      assert.deepEqual(
        await consulta(c, rol),
        esperados.map((i) => item(rol, i)).sort(),
        `${rol} com o defeito "${[].concat(sabotagem).join("; ").slice(0, 90)}" reprova exatamente o item certo`,
      );
      defeitos++;
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT defeito");
    }
  };
  const COLUNAS = "frota_segredo: as colunas hash_rapido e hash_rapido_de (";
  const PORTA_V1 = "resolver_loja: uma so";
  const PORTA_V2 = "resolver_loja_com_estado: uma so";
  const FECHADAS = "frota_lojas e frota_segredo continuam fechadas";
  const PGCRYPTO = "extensions.crypt(text, text) e extensions.digest";
  await desfeita(c, async () => {
    await semente(c); // linhas não mudam o veredito (as consultas não leem linha)
    assert.deepEqual(
      await consulta(c, A186),
      [],
      "186a positiva depois da migration",
    );
    assert.deepEqual(await consulta(c, A182), [], "182a aceita a sucessora");
    assert.deepEqual(await consulta(c, A184), [], "184a aceita a sucessora");
    assert.deepEqual(
      await consulta(c, B186),
      [
        item(
          B186,
          "frota_segredo: as colunas hash_rapido e hash_rapido_de ainda NAO",
        ),
        item(B186, "a 20261460000000 esta aplicada"),
      ].sort(),
      "186b reprova só o que a migration mudou",
    );
    for (const [sabotagem, esperados] of [
      [
        "GRANT SELECT (hash_rapido) ON public.frota_segredo TO anon",
        [COLUNAS, FECHADAS],
      ],
      ["GRANT SELECT ON public.frota_segredo TO service_role", [FECHADAS]],
      [
        "ALTER TABLE public.frota_segredo ALTER COLUMN hash_rapido SET DEFAULT ''",
        [COLUNAS],
      ],
      [
        "ALTER TABLE public.frota_segredo DROP COLUMN hash_rapido_de",
        [COLUNAS],
      ],
      [OUTRO_CORPO_V1, [PORTA_V1]],
      [`ALTER FUNCTION ${V2} SECURITY INVOKER`, [PORTA_V2]],
      [`ALTER FUNCTION ${V1} SET search_path = public`, [PORTA_V1]],
      [`GRANT EXECUTE ON FUNCTION ${V1} TO authenticated`, [PORTA_V1]],
      [`REVOKE EXECUTE ON FUNCTION ${V2} FROM anon`, [PORTA_V2]],
      [
        "CREATE FUNCTION public.resolver_loja(p text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
        [PORTA_V1, FECHADAS],
      ],
      [
        "CREATE POLICY aberta ON public.frota_segredo FOR SELECT TO anon USING (true)",
        [FECHADAS],
      ],
      ["ALTER TABLE public.frota_lojas DISABLE ROW LEVEL SECURITY", [FECHADAS]],
      [
        [
          CRIAR_OUTRO,
          "ALTER TABLE public.frota_segredo OWNER TO prova_1490_outro",
        ],
        [FECHADAS],
      ],
      [
        "ALTER FUNCTION extensions.digest(text, text) RENAME TO digest_prova_1490",
        [PGCRYPTO],
      ],
    ])
      await plantar(A186, sabotagem, esperados);
    // Depois do rollback comum: 186a reprova as duas portas; 182a e 184a voltam ao corpo da 20261460 e seguem positivas.
    await c.query(ROLLBACK);
    assert.deepEqual(
      await consulta(c, A186),
      [item(A186, PORTA_V1), item(A186, PORTA_V2)].sort(),
    );
    assert.deepEqual(await consulta(c, A182), []);
    assert.deepEqual(await consulta(c, A184), []);
    assert.deepEqual(
      await consulta(c, B186),
      [
        item(
          B186,
          "frota_segredo: as colunas hash_rapido e hash_rapido_de ainda NAO",
        ),
      ],
      "186b depois do comum: só as colunas (o destrutivo as tira)",
    );
    // Depois do destrutivo: 186b positiva; 186a reprova colunas e portas.
    await c.query(
      "SET LOCAL app.confirmo_apagar_atalho_da_chave_da_frota = 'APAGAR'",
    );
    await c.query(DESTRUTIVO);
    assert.deepEqual(
      await consulta(c, B186),
      [],
      "186b positiva na base de antes",
    );
    assert.deepEqual(
      await consulta(c, A186),
      [item(A186, COLUNAS), item(A186, PORTA_V1), item(A186, PORTA_V2)].sort(),
    );
    const BASE_1460 = "a 20261460000000 esta aplicada";
    const BASE_1470_1480 = "a 20261470000000 e a 20261480000000";
    for (const [sabotagem, esperados] of [
      [
        "ALTER TABLE public.frota_segredo ADD COLUMN hash_rapido text",
        ["frota_segredo: as colunas hash_rapido e hash_rapido_de ainda NAO"],
      ],
      [OUTRO_CORPO_V1, [BASE_1460]],
      [`ALTER FUNCTION ${V2} SECURITY INVOKER`, [BASE_1460]],
      [
        [
          CRIAR_OUTRO,
          "ALTER TABLE public.frota_segredo OWNER TO prova_1490_outro",
        ],
        [BASE_1460],
      ],
      ["GRANT SELECT ON public.frota_lojas TO service_role", [BASE_1470_1480]],
      [
        "GRANT UPDATE (hash) ON public.frota_segredo TO service_role",
        [BASE_1470_1480],
      ],
      [`DROP FUNCTION ${PORTA_1470}`, [BASE_1470_1480]],
      [
        "ALTER FUNCTION extensions.digest(text, text) RENAME TO digest_prova_1490",
        ["extensions.crypt(text, text) e extensions.digest"],
      ],
    ])
      await plantar(B186, sabotagem, esperados);
  });
  return defeitos;
}

// ---------------------------------------------------------------------------
// (i) MUTANTES: a MESMA prova de comportamento tem de cair com cada defeito; e o pós-voo de cada um recusa sozinho.
// ---------------------------------------------------------------------------
const SEM_CONFERENCIA = (sql) =>
  sql
    .replace(
      /DO \$preflight_20261490000000\$[\s\S]*?END \$preflight_20261490000000\$;\n?/,
      "",
    )
    .replace(
      /DO \$posvoo_20261490000000\$[\s\S]*?END \$posvoo_20261490000000\$;\n?/,
      "",
    );
/** Troca um trecho que aparece EXATAMENTE `vezes` vezes (uma em cada porta: 2). */
const trocar = (sql, de, para, vezes = 2) => {
  assert.equal(
    sql.split(de).length - 1,
    vezes,
    `mutante: o trecho tem de aparecer ${vezes} vez(es): ${de.slice(0, 60)}`,
  );
  return sql.split(de).join(para);
};
const SE_ATALHO = "IF v_rapido IS NOT NULL AND v_rapido_de = v_hash THEN";
const CONFERE_ATALHO =
  "IF v_rapido IS DISTINCT FROM encode(extensions.digest(p_chave, 'sha256'), 'hex') THEN";
const CONFERE_BCRYPT =
  "IF v_hash IS NULL OR v_hash IS DISTINCT FROM extensions.crypt(p_chave, v_hash) THEN";
const MUTANTES = [
  [
    "atalho sem conferir hash_rapido_de",
    (s) => trocar(s, SE_ATALHO, "IF v_rapido IS NOT NULL THEN"),
    "troca de chave: a chave velha não abre",
  ],
  [
    "grava o atalho com qualquer chave",
    (s) =>
      trocar(
        s,
        `  ELSE\n    ${CONFERE_BCRYPT}`,
        `  ELSE\n    UPDATE public.frota_segredo fs SET hash_rapido = encode(extensions.digest(p_chave, 'sha256'), 'hex'), hash_rapido_de = v_hash WHERE fs.id = 1;\n    ${CONFERE_BCRYPT}`,
      ),
    // Morre na 1ª chamada (v1, "errada"): ela devolve zero linhas, mas o atalho da chave errada já ficou gravado.
    "sem atalho: chave errada não grava nada (public.resolver_loja(text, text))",
  ],
  [
    "sem atalho (bcrypt em toda chamada)",
    (s) => trocar(s, SE_ATALHO, "IF false THEN"),
    "depois do atalho, chave errada não roda bcrypt",
  ],
  [
    "atalho que aceita qualquer chave",
    (s) => trocar(s, CONFERE_ATALHO, "IF false THEN"),
    "depois do atalho, chave errada não resolve",
  ],
  [
    "bcrypt que não confere a chave",
    (s) => trocar(s, CONFERE_BCRYPT, "IF v_hash IS NULL THEN"),
    "sem atalho: chave errada não resolve",
  ],
  [
    "grava mesmo em transação só de leitura",
    (s) =>
      trocar(
        s,
        "IF current_setting('transaction_read_only') = 'off' THEN",
        "IF true THEN",
      ),
    "transação só de leitura",
  ],
  [
    "atalho de outra coisa que não a chave inteira (só 8 caracteres)",
    (s) =>
      trocar(
        s,
        "encode(extensions.digest(p_chave, 'sha256'), 'hex')",
        "encode(extensions.digest(left(p_chave, 8), 'sha256'), 'hex')",
        4,
      ),
    "a chave certa grava o atalho",
  ],
  [
    "abre a coluna do atalho ao anon",
    (s) =>
      trocar(
        s,
        "  ADD COLUMN IF NOT EXISTS hash_rapido_de text;\n",
        "  ADD COLUMN IF NOT EXISTS hash_rapido_de text;\nGRANT SELECT (hash_rapido) ON public.frota_segredo TO anon;\n",
        1,
      ),
    "catálogo: anon sem privilégio na coluna hash_rapido",
  ],
];
const MUTANTE_DA_TRAVA = [
  "espera a linha presa (FOR UPDATE sem SKIP LOCKED)",
  // A âncora leva o fim do WHERE: "FOR UPDATE SKIP LOCKED" sozinho aparece também no cabeçalho da migration.
  (s) =>
    trocar(
      s,
      "AND fs.hash = v_hash FOR UPDATE SKIP LOCKED;",
      "AND fs.hash = v_hash FOR UPDATE;",
    ),
  "a porta não espera quem segura a linha",
];
async function morreuPeloMotivoCerto(nome, fragmento, rodar) {
  let motivo = null;
  try {
    await rodar();
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
  console.log(
    `    mutante morto: ${nome}: ${motivo.message.split("\n")[0].slice(0, 150)}`,
  );
}
async function mutantes(c, url) {
  const rodar = (sql) =>
    desfeita(c, async () => {
      await c.query(sql);
      await comportamento(c);
    });
  await rodar(SEM_CONFERENCIA(MIGRATION)); // controle: verde
  let mortos = 0;
  for (const [nome, muta, fragmento] of [...MUTANTES, MUTANTE_DA_TRAVA]) {
    const alterada = SEM_CONFERENCIA(muta(MIGRATION));
    assert.notEqual(
      alterada,
      SEM_CONFERENCIA(MIGRATION),
      `mutante "${nome}" não mudou nada`,
    );
    if (muta === MUTANTE_DA_TRAVA[1])
      await morreuPeloMotivoCerto(nome, fragmento, () =>
        concorrencia(c, url, alterada),
      );
    else await morreuPeloMotivoCerto(nome, fragmento, () => rodar(alterada));
    // O mesmo defeito COM as conferências: o pós-voo recusa sem deixar nada.
    await desfeita(c, async () => {
      const e = await tentar(c, () => c.query(muta(MIGRATION)));
      assert.match(
        e?.message ?? "(aplicou)",
        /POSVOO_20261490000000/,
        `pós-voo deveria recusar: ${nome}`,
      );
    });
    mortos++;
  }
  return mortos;
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
    for (const fn of PORTAS)
      assert.equal(
        await md5Vivo(c, fn),
        MD5_NOVO[fn],
        `o clone deve estar com a migration nova (${fn})`,
      );
    assert.equal(
      await colunasDoAtalho(c),
      2,
      "o clone deve ter as colunas do atalho",
    );
    await provar(
      "as duas portas: sem atalho chave errada/NULL/vazia nada; a certa grava o atalho; depois dele zero bcrypt; troca de chave; só leitura; chave longa",
      () => desfeita(c, () => comportamento(c)),
    );
    await provar(
      "linha que já existia: nada muda nela; a primeira chamada certa grava o atalho",
      () => dadoExistente(c),
    );
    await provar(
      "reaplicar 2x (LF e CRLF) não muda nada nem o atalho gravado",
      () => reaplicar(c),
    );
    await provar(
      "rollback comum (2x) devolve as portas byte a byte e preserva o atalho; destrutivo com confirmação e o comum antes",
      () => rollbacks(c),
    );
    const recusas = await provar(
      "pré-voo recusa estado divergente sem escrever; o rollback recusa 3",
      () => preVoo(c),
    );
    await provar(
      "transação: sem COMMIT escondido; leitor aberto em frota_segredo faz desistir em 5 s",
      () => transacao(c, url),
    );
    await provar(
      "duas conexões: troca de chave aberta prende a linha e a porta responde sem esperar nem gravar",
      () => concorrencia(c, url),
    );
    const defeitos = await provar(
      "consultas 186a/186b: catálogo real, defeitos plantados, rollback comum e destrutivo; 182a e 184a com a sucessora",
      () => portao(c),
    );
    const mortos = await provar("mutantes da migration", () =>
      mutantes(c, url),
    );
    console.log(
      `\na-caderneta-confere-a-chave-sem-bcrypt-viva: ${provas} provas ok; ${recusas} recusas do pré-voo; ${defeitos} defeitos plantados nas consultas; ${mortos} mutantes mortos`,
    );
    anexarAoSummary(
      "Caderneta confere a chave sem bcrypt por chamada (PG17)",
      `${provas} provas, ${defeitos} defeitos plantados nas consultas 186a/186b, ${mortos} mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) =>
  falhar("CADERNETA_CONFERE_A_CHAVE_SEM_BCRYPT", e.stack || e.message),
);
