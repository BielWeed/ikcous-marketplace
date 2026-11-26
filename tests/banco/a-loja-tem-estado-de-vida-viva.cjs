"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste; os únicos caminhos de arquivo são os
 * da migration, dos rollbacks e das consultas 182a/182b dentro do repositório. */
/**
 * PROVA VIVA da migration 20261460000000_a_loja_tem_estado_de_vida.sql contra o Postgres EFÊMERO com as
 * migrations aplicadas do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O DEFEITO: a caderneta da frota só sabia "ativa ou não". Loja que parou de pagar (adormecida) ou saiu
 * (encerrada) só podia sumir. Agora o estado existe, a v1 (resolver_loja, a do porteiro de hoje) ignora
 * loja fora do ar e a v2 (resolver_loja_com_estado) diz o estado SEM entregar a URL e a chave do banco
 * da loja fora do ar.
 *
 * O QUE SE PROVA (como anon, o único papel que executa as duas portas):
 *   (a) chave errada, vazia ou NULL: zero linhas nas duas versões, para todo endereço;
 *   (b) ativa: v1 e v2 dão URL e chave (host sem maiúscula); loja gravada sem estado nasce ativa;
 *   (c) adormecida e encerrada: v2 dá id, nome, domínio, ref e estado com URL e chave NULAS; v1 não resolve;
 *   (d) ativa = false (com qualquer estado): zero linhas nas duas;
 *   (e) CHECK recusa estado desconhecido e NULL; authenticated e service_role não executam nenhuma das duas;
 *   (f) linha que já existia ANTES da migration: nasce ativa, estado_desde = instante do apply, sha NULL,
 *       e resolve igual a antes;
 *   (g) reaplicar 2x (LF e CRLF) não muda OID, corpo, ACL nem nenhuma linha (estado, estado_desde, sha);
 *   (h) rollback comum devolve a v1 BYTE A BYTE ao corpo da 20261141, tira a v2 e PRESERVA colunas e
 *       linhas (2x igual; reaplicar volta); o destrutivo exige a confirmação e o comum antes;
 *   (i) pré-voo recusa estado divergente (B1_BASELINE_DIVERGENT) sem escrever;
 *   (j) transação: sem COMMIT escondido (aplicar e desfazer não deixa nada) e trava ocupada faz a
 *       migration desistir em 5 s (lock_timeout) sem escrever;
 *   (k) consultas 182a/182b EXECUTADAS no catálogo real, com defeitos plantados;
 *   (l) MUTANTES da migration: cada um derruba uma asserção, pelo motivo certo.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-loja-tem-estado-de-vida-viva.cjs
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
// A 20261490 sucede os corpos das portas da caderneta e o pre-voo desta migration (o md5 da 20261460) a recusaria: o clone e exclusivo,
// entao main() a desfaz (comum + destrutivo, COMITADO) antes de qualquer prova. Definicao unica no modulo abaixo.
const {
  desfazerChaveSemBcryptNoClone,
} = require("./a-caderneta-confere-a-chave-sem-bcrypt-posterior.cjs");

const NOME = "20261460000000_a_loja_tem_estado_de_vida.sql";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);
const CADERNETA = ler("20261141000000_caderneta_da_frota.sql");
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
// A 20261470000000 (a loja muda de estado so pela porta) SUCEDE esta: o gatilho dela recusa gravar estado, estado_desde ou estado_sha
// fora da porta e depende das colunas desta. Toda prova daqui que grava estado a mao liga a variavel da porta (so na transacao dela), e
// toda que desfaz as colunas desta desfaz a 20261470 ANTES, na propria transacao (a mais nova antes). Nunca se afrouxa o pre-voo de
// nenhuma das duas.
const NOME_1470 = "20261470000000_a_loja_muda_de_estado_so_pela_porta.sql";
const ROLLBACK_1470 = ler(`rollback-manual-${NOME_1470}`);
const DESTRUTIVO_1470 = ler(`rollback-manual-destrutivo-${NOME_1470}`);
// Os destrutivos (e o rollback da 20261141) recusam caderneta com linha (CADERNETA_SEMEADA) mesmo com o APAGAR: esta prova semeia
// lojas e, toda vez que confirma o APAGAR, confirma tambem a caderneta (so na transacao dela). A recusa e' provada em
// a-caderneta-muda-de-banco-viva.cjs.
const CONFIRMAR_CADERNETA = "SET LOCAL ikcous.apagar_caderneta = 'sim'";
const LIGAR_A_PORTA =
  "SELECT set_config('ikcous.frota_estado_pela_porta', 'sim', true)";
/** Desfaz a 20261470 (comum + destrutivo confirmado) DENTRO da transação do chamador, se ela estiver no banco. */
async function desfazerAPosterior(c) {
  const no_ar = (
    await c.query(
      "SELECT to_regprocedure('public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)') IS NOT NULL OR to_regclass('public.frota_estado_historico') IS NOT NULL AS x",
    )
  ).rows[0].x;
  if (!no_ar) return;
  await c.query(ROLLBACK_1470);
  await c.query(
    "SET LOCAL app.confirmo_apagar_historico_do_estado_da_loja = 'APAGAR'",
  );
  await c.query(CONFIRMAR_CADERNETA);
  await c.query(DESTRUTIVO_1470);
}
const A182 = "182a-conferir-o-estado-de-vida-da-loja-aplicado";
const B182 = "182b-antes-o-estado-de-vida-da-loja-ausente";

const MD5_V1_ANTIGO = "fcb01b1e25e00481d8085d53dec291e5";
const MD5_V1_NOVO = "19072d99f3253583342a0bb6c42447dd";
const MD5_V2 = "92682af1143806d3662411b6d5788096";
const V1 = "public.resolver_loja(text, text)";
const V2 = "public.resolver_loja_com_estado(text, text)";
const CHAVE = "prova-1460-chave-da-frota";
const COLUNAS_V1 = [
  "id",
  "nome",
  "dominio_publico",
  "project_ref",
  "supabase_url",
  "publishable_key",
];
const COLUNAS_V2 = [...COLUNAS_V1, "estado"];

/** O corpo da v1 na 20261141 (entre `AS $$` e `$$;`): é com ele que o rollback se compara byte a byte. */
const CORPO_V1_ANTIGO = (() => {
  const i = CADERNETA.indexOf(
    "CREATE OR REPLACE FUNCTION public.resolver_loja(",
  );
  const abre = CADERNETA.indexOf("AS $$", i) + "AS $$".length;
  return CADERNETA.slice(abre, CADERNETA.indexOf("$$;", abre));
})();

const loja = (id, ref, ativa, estado) => ({
  id: `l1460-${id}`,
  nome: `Loja ${id} da prova 1460`,
  dominio_publico: `${id}.l1460.teste`,
  project_ref: ref,
  supabase_url: `https://${ref}.supabase.co`,
  publishable_key: `pk_l1460_${id}`,
  ativa,
  estado,
});
const ATIVA = loja("ativa", "aaaaaaaaaaaaaaaaaaaa", true, "ativa");
const SEM_ESTADO = loja("nova", "bbbbbbbbbbbbbbbbbbbb", true, undefined);
const DORMINDO = loja("dormindo", "cccccccccccccccccccc", true, "adormecida");
const ENCERRADA = loja("encerrada", "dddddddddddddddddddd", true, "encerrada");
const DESLIGADA = loja("desligada", "eeeeeeeeeeeeeeeeeeee", false, "ativa");
const DESLIGADA_DORMINDO = loja(
  "desligada-dormindo",
  "ffffffffffffffffffff",
  false,
  "adormecida",
);
const LOJAS = [
  ATIVA,
  SEM_ESTADO,
  DORMINDO,
  ENCERRADA,
  DESLIGADA,
  DESLIGADA_DORMINDO,
];

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  const sp = `sp_1460_${++contaSavepoint}`;
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
async function semente(c) {
  // A 20261470 so deixa gravar estado pela porta: as lojas fora do ar desta prova nascem com a variavel dela ligada (so nesta transacao).
  await c.query(LIGAR_A_PORTA);
  await c.query(
    "INSERT INTO public.frota_segredo (id, hash) VALUES (1, extensions.crypt($1, extensions.gen_salt('bf', 4))) ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash",
    [CHAVE],
  );
  for (const l of LOJAS) {
    if (l.estado === undefined)
      await c.query(
        "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          l.id,
          l.nome,
          l.dominio_publico,
          l.project_ref,
          l.supabase_url,
          l.publishable_key,
          l.ativa,
        ],
      );
    else
      await c.query(
        "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [
          l.id,
          l.nome,
          l.dominio_publico,
          l.project_ref,
          l.supabase_url,
          l.publishable_key,
          l.ativa,
          l.estado,
        ],
      );
  }
}
const esperadoV1 = (l) => Object.fromEntries(COLUNAS_V1.map((k) => [k, l[k]]));
const esperadoV2 = (l, estado) => ({
  ...esperadoV1(l),
  supabase_url: estado === "ativa" ? l.supabase_url : null,
  publishable_key: estado === "ativa" ? l.publishable_key : null,
  estado,
});
const sqlDaVersao = (versao) =>
  `SELECT * FROM public.${versao === 1 ? "resolver_loja" : "resolver_loja_com_estado"}($1, $2)`;
/** Chama a porta; erro de banco vira falha de ASSERÇÃO (o mutante que quebra a porta morre pelo motivo certo). */
async function chamar(c, versao, host, chave = CHAVE) {
  try {
    return await c.query(sqlDaVersao(versao), [host, chave]);
  } catch (e) {
    assert.fail(`v${versao} falhou (${e.code}): ${e.message}`);
  }
}
async function foto(c) {
  const fn = await c.query(
    `SELECT p.proname, p.oid::int AS oid, md5(replace(p.prosrc, E'\\r', '')) AS h, p.proacl::text AS acl, p.proowner::int AS dono,
            p.prosecdef, p.provolatile, p.proconfig::text AS config
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado') ORDER BY 1`,
  );
  const col = await c.query(
    `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS padrao
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.frota_lojas'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attname`,
  );
  const chk = await c.query(
    "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.frota_lojas'::regclass ORDER BY 1",
  );
  return { fn: fn.rows, col: col.rows, chk: chk.rows };
}
const temColunaEstado = async (c) =>
  (
    await c.query(
      "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.frota_lojas'::regclass AND attnum > 0 AND NOT attisdropped AND attname IN ('estado', 'estado_desde', 'estado_sha')",
    )
  ).rows[0].n;
const md5Vivo = async (c, fn) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [fn],
    )
  ).rows[0]?.h ?? null;
/** Volta a caderneta à base de antes (a da 20261141) DENTRO da transação do chamador: rollback comum + destrutivo confirmado. */
async function voltarAoAntes(c) {
  await desfazerAPosterior(c);
  await c.query(ROLLBACK);
  await c.query("SET LOCAL app.confirmo_apagar_estado_de_vida = 'APAGAR'");
  await c.query(CONFIRMAR_CADERNETA);
  await c.query(DESTRUTIVO);
  assert.equal(await temColunaEstado(c), 0, "base de antes: sem as colunas");
  assert.equal(await md5Vivo(c, V1), MD5_V1_ANTIGO);
  assert.equal(await md5Vivo(c, V2), null);
}

// ---------------------------------------------------------------------------
// (a)-(e) o comportamento (o MESMO que os mutantes têm de derrubar)
// ---------------------------------------------------------------------------
async function comportamento(c) {
  await semente(c);
  // Num SAVEPOINT: se a porta falhar (erro de banco), a transação do chamador volta utilizável e a asserção chega intacta.
  await c.query("SAVEPOINT como_anon");
  await c.query("SET LOCAL ROLE anon");
  try {
    // (a) sem a chave certa, nada — para todo endereço, nas duas versões.
    for (const versao of [1, 2])
      for (const l of LOJAS)
        for (const chave of ["chave-errada-de-proposito", "", null])
          assert.equal(
            (await chamar(c, versao, l.dominio_publico, chave)).rowCount,
            0,
            `v${versao}: chave errada não resolve (${l.id}, ${JSON.stringify(chave)})`,
          );
    // (b) ativa: as duas resolvem, com URL e chave; o host não diferencia maiúscula.
    const v2Ativa = await chamar(c, 2, ATIVA.dominio_publico.toUpperCase());
    assert.deepEqual(
      v2Ativa.fields.map((f) => f.name),
      COLUNAS_V2,
      "v2: as 7 colunas",
    );
    assert.deepEqual(
      v2Ativa.rows,
      [esperadoV2(ATIVA, "ativa")],
      "v2: ativa resolve com URL e chave",
    );
    const v1Ativa = await chamar(c, 1, ATIVA.dominio_publico.toUpperCase());
    assert.deepEqual(
      v1Ativa.fields.map((f) => f.name),
      COLUNAS_V1,
      "v1: as 6 colunas de sempre",
    );
    assert.deepEqual(
      v1Ativa.rows,
      [esperadoV1(ATIVA)],
      "v1: ativa resolve com URL e chave",
    );
    assert.deepEqual(
      (await chamar(c, 2, SEM_ESTADO.dominio_publico)).rows,
      [esperadoV2(SEM_ESTADO, "ativa")],
      "v2: loja gravada sem estado nasce ativa",
    );
    assert.deepEqual(
      (await chamar(c, 1, SEM_ESTADO.dominio_publico)).rows,
      [esperadoV1(SEM_ESTADO)],
      "v1: loja gravada sem estado nasce ativa",
    );
    // (c) fora do ar: a v2 diz o estado sem URL nem chave; a v1 não resolve.
    for (const l of [DORMINDO, ENCERRADA]) {
      assert.deepEqual(
        (await chamar(c, 2, l.dominio_publico)).rows,
        [esperadoV2(l, l.estado)],
        `v2: ${l.estado} vem com o estado e SEM URL e chave`,
      );
      assert.equal(
        (await chamar(c, 1, l.dominio_publico)).rowCount,
        0,
        `v1: ${l.estado} não resolve`,
      );
    }
    // (d) ativa = false é endereço desconhecido nas duas, com qualquer estado.
    for (const versao of [1, 2]) {
      for (const l of [DESLIGADA, DESLIGADA_DORMINDO])
        assert.equal(
          (await chamar(c, versao, l.dominio_publico)).rowCount,
          0,
          `v${versao}: ativa = false não resolve (${l.estado})`,
        );
      assert.equal(
        (await chamar(c, versao, "ninguem.l1460.teste")).rowCount,
        0,
        `v${versao}: host desconhecido não resolve`,
      );
    }
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT como_anon");
    throw e;
  }
  await c.query("RESET ROLE");
  await c.query("RELEASE SAVEPOINT como_anon");
  // (e) o CHECK e a ACL.
  for (const [valor, codigo] of [
    ["pausada", "23514"],
    ["ATIVA", "23514"],
    [null, "23502"],
  ]) {
    const e = await tentar(c, () =>
      c.query("UPDATE public.frota_lojas SET estado = $1 WHERE id = $2", [
        valor,
        ATIVA.id,
      ]),
    );
    assert.equal(
      e?.code,
      codigo,
      `CHECK: estado ${JSON.stringify(valor)} é recusado`,
    );
  }
  for (const papel of ["authenticated", "service_role"])
    for (const versao of [1, 2]) {
      const e = await tentar(c, async () => {
        await c.query(`SET LOCAL ROLE ${papel}`);
        await c.query(sqlDaVersao(versao), [ATIVA.dominio_publico, CHAVE]);
      });
      assert.equal(e?.code, "42501", `ACL: ${papel} não executa a v${versao}`);
    }
  for (const versao of [1, 2]) {
    const fn = versao === 1 ? V1 : V2;
    const r = (
      await c.query(
        `SELECT p.prosecdef, p.provolatile, p.proconfig::text AS config,
                EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g WHERE g.grantee = 0 AND g.privilege_type = 'EXECUTE') AS publico
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
        [fn],
      )
    ).rows[0];
    assert.deepEqual(
      r,
      {
        prosecdef: true,
        provolatile: "v",
        config: '{"search_path=\\"\\""}',
        publico: false,
      },
      `catálogo: v${versao} SECURITY DEFINER, VOLATILE, search_path vazio, sem PUBLIC`,
    );
  }
}

// ---------------------------------------------------------------------------
// (f) linha que já existia antes da migration
// ---------------------------------------------------------------------------
async function dadoExistente(c) {
  await desfeita(c, async () => {
    await voltarAoAntes(c);
    await c.query(
      "INSERT INTO public.frota_segredo (id, hash) VALUES (1, extensions.crypt($1, extensions.gen_salt('bf', 4))) ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash",
      [CHAVE],
    );
    for (const l of [ATIVA, DESLIGADA])
      await c.query(
        "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          l.id,
          l.nome,
          l.dominio_publico,
          l.project_ref,
          l.supabase_url,
          l.publishable_key,
          l.ativa,
        ],
      );
    const antes = (
      await c.query(
        "SELECT id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa, created_at, updated_at FROM public.frota_lojas WHERE id LIKE 'l1460-%' ORDER BY id",
      )
    ).rows;
    const v1Antes = (await chamar(c, 1, ATIVA.dominio_publico)).rows;
    await c.query(MIGRATION);
    const depois = (
      await c.query(
        "SELECT id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa, created_at, updated_at, estado, estado_desde = now() AS desde_o_apply, estado_sha FROM public.frota_lojas WHERE id LIKE 'l1460-%' ORDER BY id",
      )
    ).rows;
    assert.deepEqual(
      depois.map(({ estado, desde_o_apply, estado_sha, ...resto }) => resto),
      antes,
      "nenhuma coluna antiga muda",
    );
    for (const l of depois)
      assert.deepEqual(
        [l.estado, l.desde_o_apply, l.estado_sha],
        ["ativa", true, null],
        `${l.id}: nasce ativa, desde o apply, sem sha`,
      );
    assert.deepEqual(
      (await chamar(c, 1, ATIVA.dominio_publico)).rows,
      v1Antes,
      "a v1 responde igual a antes para a loja que já existia",
    );
    assert.deepEqual((await chamar(c, 2, ATIVA.dominio_publico)).rows, [
      esperadoV2(ATIVA, "ativa"),
    ]);
    assert.equal((await chamar(c, 1, DESLIGADA.dominio_publico)).rowCount, 0);
    assert.equal((await chamar(c, 2, DESLIGADA.dominio_publico)).rowCount, 0);
  });
}

// ---------------------------------------------------------------------------
// (g) reaplicar 2x (LF e CRLF)
// ---------------------------------------------------------------------------
const LINHAS = `SELECT id, ativa, estado, estado_desde::text AS desde, estado_sha FROM public.frota_lojas WHERE id LIKE 'l1460-%' ORDER BY id`;
async function reaplicar(c) {
  await desfeita(c, async () => {
    await semente(c);
    await c.query(
      "UPDATE public.frota_lojas SET estado_desde = '2026-01-02 03:04:05+00', estado_sha = 'abc1460' WHERE id = $1",
      [DORMINDO.id],
    );
    const antes = await foto(c);
    const linhas = (await c.query(LINHAS)).rows;
    await c.query(MIGRATION);
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      antes,
      "reaplicar (LF, CRLF, LF) não muda OID, corpo, ACL, colunas nem CHECK",
    );
    assert.deepEqual(
      (await c.query(LINHAS)).rows,
      linhas,
      "reaplicar não toca nenhuma linha (estado, desde, sha)",
    );
  });
}

// ---------------------------------------------------------------------------
// (h) rollback comum e destrutivo
// ---------------------------------------------------------------------------
async function rollbacks(c) {
  await desfeita(c, async () => {
    await semente(c);
    const v1Antes = (
      await c.query(
        "SELECT oid::int AS oid, proacl::text AS acl, proowner::int AS dono FROM pg_proc WHERE oid = to_regprocedure($1)",
        [V1],
      )
    ).rows[0];
    const linhas = (await c.query(LINHAS)).rows;
    for (const vez of [1, 2]) {
      await c.query(ROLLBACK);
      const v1 = (
        await c.query(
          "SELECT oid::int AS oid, proacl::text AS acl, proowner::int AS dono, prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
          [V1],
        )
      ).rows[0];
      assert.equal(
        v1.prosrc,
        CORPO_V1_ANTIGO,
        `rollback ${vez}: a v1 volta BYTE A BYTE ao corpo da 20261141`,
      );
      assert.deepEqual(
        { oid: v1.oid, acl: v1.acl, dono: v1.dono },
        v1Antes,
        `rollback ${vez}: OID, ACL e dono da v1 iguais`,
      );
      assert.equal(await md5Vivo(c, V2), null, `rollback ${vez}: a v2 saiu`);
      assert.deepEqual(
        (await c.query(LINHAS)).rows,
        linhas,
        `rollback ${vez}: colunas e linhas preservadas`,
      );
      // O comportamento de antes volta: a v1 não olha o estado.
      assert.deepEqual(
        (await chamar(c, 1, DORMINDO.dominio_publico)).rows,
        [esperadoV1(DORMINDO)],
        `rollback ${vez}: a v1 da 20261141 resolve a loja adormecida (como antes)`,
      );
    }
    await c.query(MIGRATION);
    assert.equal(await md5Vivo(c, V1), MD5_V1_NOVO);
    assert.equal(await md5Vivo(c, V2), MD5_V2);
    assert.deepEqual(
      (await c.query(LINHAS)).rows,
      linhas,
      "reaplicar depois do rollback: o estado gravado volta a valer",
    );
    assert.equal((await chamar(c, 1, DORMINDO.dominio_publico)).rowCount, 0);
  });
  // destrutivo
  await desfeita(c, async () => {
    await semente(c);
    let e = await tentar(c, () => c.query(DESTRUTIVO));
    assert.match(
      e?.message ?? "",
      /ESTADO_DE_VIDA_SO_COM_O_DONO/,
      "destrutivo sem confirmação recusa",
    );
    await c.query("SET LOCAL app.confirmo_apagar_estado_de_vida = 'APAGAR'");
    await c.query(CONFIRMAR_CADERNETA);
    e = await tentar(c, () => c.query(DESTRUTIVO));
    assert.match(
      e?.message ?? "",
      /ESTADO_DE_VIDA_ROLLBACK_COMUM_PRIMEIRO/,
      "destrutivo antes do rollback comum recusa",
    );
    assert.equal(await temColunaEstado(c), 3, "a recusa não apagou nada");
    await c.query(ROLLBACK);
    await desfazerAPosterior(c);
    await c.query(DESTRUTIVO);
    assert.equal(
      await temColunaEstado(c),
      0,
      "destrutivo tira as três colunas",
    );
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.frota_lojas'::regclass AND conname = 'frota_lojas_estado_check'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM public.frota_lojas WHERE id LIKE 'l1460-%'",
        )
      ).rows[0].n,
      LOJAS.length,
      "destrutivo não apaga loja nenhuma",
    );
    await c.query(DESTRUTIVO); // repetir é no-op
    await c.query(MIGRATION);
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM public.frota_lojas WHERE id LIKE 'l1460-%' AND estado = 'ativa'",
        )
      ).rows[0].n,
      LOJAS.length,
      "depois do destrutivo, reaplicar faz toda loja nascer ativa de novo",
    );
  });
}

// ---------------------------------------------------------------------------
// (i) pré-voo
// ---------------------------------------------------------------------------
const BLOCO_V1_ANTIGO = (() => {
  const i = CADERNETA.indexOf(
    "CREATE OR REPLACE FUNCTION public.resolver_loja(",
  );
  return CADERNETA.slice(
    i,
    CADERNETA.indexOf("$$;", CADERNETA.indexOf("AS $$", i)) + 3,
  );
})();
const BLOCO_V1_NOVO = (() => {
  const i = MIGRATION.indexOf(
    "CREATE OR REPLACE FUNCTION public.resolver_loja(",
  );
  return MIGRATION.slice(
    i,
    MIGRATION.indexOf("$$;", MIGRATION.indexOf("AS $$", i)) + 3,
  );
})();
const SABOTAGENS_DA_BASE = [
  [
    "v1 com outro corpo",
    [BLOCO_V1_ANTIGO.replace("BEGIN\n", "BEGIN\n  -- outro\n")],
  ],
  [
    "v1 aberta ao authenticated",
    [`GRANT EXECUTE ON FUNCTION ${V1} TO authenticated`],
  ],
  ["v1 aberta ao PUBLIC", [`GRANT EXECUTE ON FUNCTION ${V1} TO PUBLIC`]],
  ["v1 SECURITY INVOKER", [`ALTER FUNCTION ${V1} SECURITY INVOKER`]],
  [
    "v1 com search_path public",
    [`ALTER FUNCTION ${V1} SET search_path = public`],
  ],
  ["v1 ausente", [`DROP FUNCTION ${V1}`]],
  [
    "v1 com sobrecarga",
    [
      "CREATE FUNCTION public.resolver_loja(p_host text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
    ],
  ],
  ["v1 já com o corpo novo sem as colunas", [BLOCO_V1_NOVO]],
  [
    "só a coluna estado",
    [
      "ALTER TABLE public.frota_lojas ADD COLUMN estado text NOT NULL DEFAULT 'ativa'",
    ],
  ],
  [
    "as três colunas com outro padrão",
    [
      "ALTER TABLE public.frota_lojas ADD COLUMN estado text NOT NULL DEFAULT 'adormecida' CONSTRAINT frota_lojas_estado_check CHECK (estado IN ('ativa', 'adormecida', 'encerrada')), ADD COLUMN estado_desde timestamptz NOT NULL DEFAULT now(), ADD COLUMN estado_sha text",
    ],
  ],
  [
    "o CHECK com outra lista",
    [
      "ALTER TABLE public.frota_lojas ADD COLUMN estado text NOT NULL DEFAULT 'ativa' CONSTRAINT frota_lojas_estado_check CHECK (estado IN ('ativa', 'adormecida')), ADD COLUMN estado_desde timestamptz NOT NULL DEFAULT now(), ADD COLUMN estado_sha text",
    ],
  ],
  [
    "v2 com outro corpo",
    [
      "CREATE FUNCTION public.resolver_loja_com_estado(p_host text, p_chave text) RETURNS TABLE (id text) LANGUAGE sql AS 'SELECT NULL::text'",
    ],
  ],
  [
    "v2 com outra assinatura",
    [
      "CREATE FUNCTION public.resolver_loja_com_estado(p_host text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
    ],
  ],
  ["frota_segredo ausente", ["DROP TABLE public.frota_segredo"]],
  [
    "frota_lojas sem a coluna ativa",
    ["ALTER TABLE public.frota_lojas DROP COLUMN ativa"],
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
    // controle: sem sabotagem, a mesma base aplica.
    assert.equal(await tentar(c, () => c.query(MIGRATION)), null);
  });
  // o rollback comum também recusa estado desconhecido sem escrever
  await desfeita(c, async () => {
    const base = await foto(c);
    for (const [nome, sabotagem] of [
      [
        "v1 com outro corpo",
        BLOCO_V1_ANTIGO.replace("BEGIN\n", "BEGIN\n  -- outro\n"),
      ],
      [
        "v2 com outro corpo",
        `${MIGRATION.slice(MIGRATION.indexOf(INICIO_V2))
          .split("$$;")[0]
          .replace("RETURN;", "RETURN; -- outro")}$$;`,
      ],
      [
        "v1 aberta ao authenticated",
        `GRANT EXECUTE ON FUNCTION ${V1} TO authenticated`,
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
// (j) transação: sem COMMIT escondido; trava ocupada desiste em 5 s
// ---------------------------------------------------------------------------
async function transacao(c, url) {
  // A base de antes COMMITADA no clone (o clone é descartável; no fim a migration volta).
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
    // Alguém lendo a caderneta segura a tabela: a migration espera no máximo o lock_timeout e desiste sem escrever.
    const outro = new Client({ connectionString: url });
    await outro.connect();
    try {
      await outro.query("BEGIN");
      await outro.query("LOCK TABLE public.frota_lojas IN ACCESS SHARE MODE");
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
  assert.equal(await md5Vivo(c, V1), MD5_V1_NOVO);
  assert.equal(await md5Vivo(c, V2), MD5_V2);
}

// ---------------------------------------------------------------------------
// (k) as consultas 182a/182b, EXECUTADAS no catálogo real
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
  const rolA = CONF.ROL_FECHADO_POR_CONSULTA[A182];
  const rolB = CONF.ROL_FECHADO_POR_CONSULTA[B182];
  const itemA = (inicio) => {
    const x = rolA.filter((i) => i.startsWith(inicio));
    assert.equal(x.length, 1, `item da 182a: ${inicio}`);
    return x[0];
  };
  const itemB = (inicio) => {
    const x = rolB.filter((i) => i.startsWith(inicio));
    assert.equal(x.length, 1, `item da 182b: ${inicio}`);
    return x[0];
  };
  let defeitos = 0;
  await desfeita(c, async () => {
    await semente(c); // linhas não mudam o veredito (as consultas não leem linha)
    assert.deepEqual(
      await consulta(c, A182),
      [],
      "182a positiva depois da migration",
    );
    assert.deepEqual(
      await consulta(c, B182),
      [
        itemB("frota_lojas: as colunas"),
        itemB("resolver_loja: uma so"),
        itemB("resolver_loja_com_estado: ainda"),
      ].sort(),
      "182b reprova só o que a migration criou ou trocou",
    );
    const plantados = [
      [
        `GRANT EXECUTE ON FUNCTION ${V1} TO authenticated`,
        ["resolver_loja: atributos"],
      ],
      [
        `ALTER FUNCTION ${V1} SET search_path = public`,
        ["resolver_loja: atributos"],
      ],
      [BLOCO_V1_ANTIGO, ["resolver_loja: uma so"]],
      [
        `GRANT EXECUTE ON FUNCTION ${V2} TO authenticated`,
        ["resolver_loja_com_estado: as travas"],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${V2} TO PUBLIC`,
        ["resolver_loja_com_estado: as travas"],
      ],
      [
        `ALTER FUNCTION ${V2} SECURITY INVOKER`,
        ["resolver_loja_com_estado: as travas"],
      ],
      [`ALTER FUNCTION ${V2} STABLE`, ["resolver_loja_com_estado: as travas"]],
      [
        `DROP FUNCTION ${V2}`,
        [
          "resolver_loja_com_estado: as travas",
          "resolver_loja_com_estado: uma so",
        ],
      ],
      [
        "ALTER TABLE public.frota_lojas ALTER COLUMN estado_sha SET DEFAULT 'x'",
        ["frota_lojas: as colunas"],
      ],
      [
        "ALTER TABLE public.frota_lojas ALTER COLUMN estado SET DEFAULT 'adormecida'",
        ["frota_lojas: as colunas"],
      ],
      [
        "ALTER TABLE public.frota_lojas DROP CONSTRAINT frota_lojas_estado_check, ADD CONSTRAINT frota_lojas_estado_check CHECK (estado IN ('ativa', 'adormecida', 'encerrada', 'pausada'))",
        ["frota_lojas: o CHECK"],
      ],
      [
        "ALTER TABLE public.frota_lojas DROP CONSTRAINT frota_lojas_estado_check, ADD CONSTRAINT frota_lojas_estado_check CHECK (estado IN ('ativa', 'adormecida', 'encerrada')) NOT VALID",
        ["frota_lojas: o CHECK"],
      ],
      [
        "GRANT SELECT ON public.frota_lojas TO anon",
        ["frota_lojas e frota_segredo"],
      ],
      [
        "GRANT SELECT (hash) ON public.frota_segredo TO authenticated",
        ["frota_lojas e frota_segredo"],
      ],
      [
        "CREATE POLICY aberta ON public.frota_segredo FOR SELECT TO anon USING (true)",
        ["frota_lojas e frota_segredo"],
      ],
      [
        "ALTER TABLE public.frota_lojas DISABLE ROW LEVEL SECURITY",
        ["frota_lojas e frota_segredo"],
      ],
    ];
    for (const [sabotagem, esperados] of plantados) {
      await c.query("SAVEPOINT defeito");
      try {
        await c.query(sabotagem);
        assert.deepEqual(
          await consulta(c, A182),
          esperados.map(itemA).sort(),
          `182a com o defeito "${sabotagem.slice(0, 80)}" reprova exatamente o item certo`,
        );
        defeitos++;
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT defeito");
      }
    }
    // depois do rollback comum: a 182a reprova e a 182b só reprova as colunas (ficam, com o dado, de propósito)
    await c.query(ROLLBACK);
    assert.deepEqual(await consulta(c, B182), [
      itemB("frota_lojas: as colunas"),
    ]);
    assert.notDeepEqual(await consulta(c, A182), []);
    // depois do destrutivo: a 182b é POSITIVA
    await desfazerAPosterior(c);
    await c.query("SET LOCAL app.confirmo_apagar_estado_de_vida = 'APAGAR'");
    await c.query(CONFIRMAR_CADERNETA);
    await c.query(DESTRUTIVO);
    assert.deepEqual(
      await consulta(c, B182),
      [],
      "182b positiva na base de antes",
    );
    for (const [sabotagem, esperados] of [
      [
        `GRANT EXECUTE ON FUNCTION ${V1} TO service_role`,
        ["resolver_loja: uma so"],
      ],
      [
        BLOCO_V1_ANTIGO.replace("BEGIN\n", "BEGIN\n  -- outro\n"),
        ["resolver_loja: uma so"],
      ],
      [
        "ALTER TABLE public.frota_segredo OWNER TO service_role",
        ["frota_lojas e frota_segredo existem"],
      ],
      [
        "ALTER TABLE public.frota_lojas ADD COLUMN estado_sha text",
        ["frota_lojas: as colunas"],
      ],
      [
        "CREATE FUNCTION public.resolver_loja_com_estado(p_host text) RETURNS int LANGUAGE sql AS 'SELECT 1'",
        ["resolver_loja_com_estado: ainda"],
      ],
    ]) {
      await c.query("SAVEPOINT defeito");
      try {
        await c.query(sabotagem);
        assert.deepEqual(
          await consulta(c, B182),
          esperados.map(itemB).sort(),
          `182b com o defeito "${sabotagem.slice(0, 80)}" reprova exatamente o item certo`,
        );
        defeitos++;
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT defeito");
      }
    }
  });
  return defeitos;
}

// ---------------------------------------------------------------------------
// (l) MUTANTES: a MESMA prova de comportamento tem de cair com cada defeito.
// ---------------------------------------------------------------------------
const SEM_CONFERENCIA = (sql) =>
  sql
    .replace(
      /DO \$preflight_20261460000000\$[\s\S]*?END \$preflight_20261460000000\$;\n?/,
      "",
    )
    .replace(
      /DO \$posvoo_20261460000000\$[\s\S]*?END \$posvoo_20261460000000\$;\n?/,
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
const INICIO_V2 = "CREATE OR REPLACE FUNCTION public.resolver_loja_com_estado(";
/** Troca `de` por `para` só dentro do bloco da v2 (a porta da chave é igual nas duas versões). */
const trocarNaV2 = (sql, de, para) => {
  const i = sql.indexOf(INICIO_V2);
  return sql.slice(0, i) + trocar(sql.slice(i), de, para);
};
const PORTA_DA_CHAVE =
  '  IF NOT EXISTS (\n    SELECT 1\n      FROM public.frota_segredo fs\n     WHERE fs.id = 1\n       AND fs.hash = extensions.crypt(p_chave, fs.hash)\n  ) THEN\n    RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"\n  END IF;\n';
const MUTANTES = [
  [
    "v2 entrega a URL da loja fora do ar",
    (s) =>
      trocar(
        s,
        "CASE WHEN fl.estado = 'ativa' THEN fl.supabase_url END",
        "fl.supabase_url",
      ),
    "SEM URL e chave",
  ],
  [
    "v2 entrega a chave da loja fora do ar",
    (s) =>
      trocar(
        s,
        "CASE WHEN fl.estado = 'ativa' THEN fl.publishable_key END",
        "fl.publishable_key",
      ),
    "SEM URL e chave",
  ],
  [
    "v1 sem o filtro do estado",
    (s) => trocar(s, "\n     AND fl.estado = 'ativa';", "\n     ;"),
    "v1: adormecida não resolve",
  ],
  [
    "v2 sem o filtro ativa",
    (s) => trocar(s, "     AND fl.ativa;\n", "     ;\n"),
    "v2: ativa = false não resolve",
  ],
  [
    "v2 esconde a loja fora do ar",
    (s) =>
      trocar(
        s,
        "     AND fl.ativa;\n",
        "     AND fl.ativa AND fl.estado = 'ativa';\n",
      ),
    "v2: adormecida vem com o estado",
  ],
  [
    "v2 sem a porta da chave",
    (s) => trocarNaV2(s, PORTA_DA_CHAVE, ""),
    "v2: chave errada não resolve",
  ],
  [
    "v2 aberta ao authenticated (sem o REVOKE dele)",
    (s) =>
      trocar(
        s,
        "REVOKE ALL ON FUNCTION public.resolver_loja_com_estado(text, text) FROM PUBLIC, authenticated, service_role;",
        "REVOKE ALL ON FUNCTION public.resolver_loja_com_estado(text, text) FROM PUBLIC, service_role;",
      ),
    "ACL: authenticated não executa a v2",
  ],
  [
    "v2 sem REVOKE nenhum",
    (s) =>
      trocar(
        s,
        "REVOKE ALL ON FUNCTION public.resolver_loja_com_estado(text, text) FROM PUBLIC, authenticated, service_role;\n",
        "",
      ),
    "ACL: authenticated não executa a v2",
  ],
  [
    "v2 SECURITY INVOKER",
    (s) => trocarNaV2(s, "SECURITY DEFINER\n", "SECURITY INVOKER\n"),
    "v2 falhou (42501)",
  ],
  [
    "estado nasce adormecida",
    (s) =>
      trocar(
        s,
        "estado text NOT NULL DEFAULT 'ativa'",
        "estado text NOT NULL DEFAULT 'adormecida'",
      ),
    "loja gravada sem estado nasce ativa",
  ],
  [
    "sem o CHECK",
    (s) =>
      trocar(
        s,
        "\n    CONSTRAINT frota_lojas_estado_check CHECK (estado IN ('ativa', 'adormecida', 'encerrada'))",
        "",
      ),
    'CHECK: estado "pausada" é recusado',
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
    // A sucessora 20261490 sai antes de tudo (ver o require do modulo -posterior no topo).
    await desfazerChaveSemBcryptNoClone(c);
    assert.equal(
      await md5Vivo(c, V1),
      MD5_V1_NOVO,
      "o clone deve estar com a migration nova (v1)",
    );
    assert.equal(
      await md5Vivo(c, V2),
      MD5_V2,
      "o clone deve estar com a migration nova (v2)",
    );
    await provar(
      "chave errada, ativa, adormecida, encerrada, ativa = false, CHECK e ACL (como anon)",
      () => desfeita(c, () => comportamento(c)),
    );
    await provar(
      "linha que já existia: nasce ativa, desde o apply, sem sha, e resolve igual",
      () => dadoExistente(c),
    );
    await provar("reaplicar 2x (LF e CRLF) não muda nada nem as linhas", () =>
      reaplicar(c),
    );
    await provar(
      "rollback comum byte a byte (2x), preserva o dado; destrutivo exige confirmação e o comum antes",
      () => rollbacks(c),
    );
    await provar(
      `pré-voo recusa ${SABOTAGENS_DA_BASE.length} estados divergentes sem escrever; o rollback recusa 3`,
      () => preVoo(c),
    );
    await provar(
      "transação: sem COMMIT escondido; trava ocupada desiste em 5 s sem escrever",
      () => transacao(c, url),
    );
    const defeitos = await provar(
      "consultas 182a/182b: catálogo real, defeitos plantados, rollback comum e destrutivo",
      () => portao(c),
    );
    const mortos = await provar("mutantes da migration", () => mutantes(c));
    console.log(
      `\na-loja-tem-estado-de-vida-viva: ${provas} provas ok; ${defeitos} defeitos plantados nas consultas; ${mortos} mutantes mortos`,
    );
    anexarAoSummary(
      "Estado de vida da loja na caderneta (PG17)",
      `${provas} provas como anon, ${defeitos} defeitos plantados nas consultas 182a/182b, ${mortos} mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) => falhar("ESTADO_DE_VIDA_DA_LOJA", e.stack || e.message));
