"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 22 (as portas pequenas do banco) --
 * as migrations 20261218000000, 20261218000100 e 20261219000000 --, num Postgres EFEMERO local, nada
 * de rede, nada de loja:
 *   22a-conferir-portas-do-banco-aplicado.sql       (DEPOIS do apply: 15 linhas)
 *   22b-antes-portas-do-banco-estado-vigente.sql    (ANTES do apply: 11 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essas migrations novas. Esta prova diz
 * que cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois
 * (isso so o run da consulta contra o ref de cada loja diz). O COMPORTAMENTO e' de
 * tests/banco/portas-do-banco-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada: o lote
 * aplicado = o DEPOIS). Cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que
 * termina em ROLLBACK; as consultas rodam nela como um papel de LEITURA nao superusuario, com
 * `SET LOCAL ROLE` e a transacao ja somente leitura. O ANTES e' o DEPOIS com os tres rollback-manual
 * executados na transacao; neste clone as duas tabelas do servidor nascem abertas a anon/authenticated
 * (o estado medido na Savy), e o caso "loja ja fechada" (o estado medido na IKCOUS) e' montado a parte.
 *
 * CASOS:
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_22A e
 *             ROL_DA_22B), sem repetir nem faltar, em qualquer estado.
 *  ESTADOS    depois: 22a POSITIVA e 22b reprova SO as 6 linhas do que o lote muda; antes: 22b POSITIVA e
 *             22a reprova as 9 linhas previstas (7 numa loja que ja tinha as duas tabelas fechadas);
 *             aplicar DE NOVO, ida e volta, os arquivos em CRLF e o search_path pg_catalog: o mesmo
 *             veredito.
 *  NEGATIVOS  cada defeito reprova EXATAMENTE as linhas previstas; toda mutacao com guarda.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITES DECLARADOS: (1) o Postgres e' o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user) e a ACL real das lojas NAO foram medidos aqui. (2) Nao ha mutantes do TEXTO
 * do .sql: a prova cobre o comportamento da consulta em cada estado.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/portas-do-banco-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (a pasta de consultas e as migrations), nunca de entrada
 * de rede; as chaves de objeto vem de constantes e mapas fechados deste arquivo. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "22a-conferir-portas-do-banco-aplicado";
const B = "22b-antes-portas-do-banco-estado-vigente";
const LOTE = [
  "20261218000000_a_foto_do_perfil_tem_teto_e_o_painel_fecha_ao_visitante.sql",
  "20261218000100_configuracoes_e_codigos_so_do_servidor.sql",
  "20261219000000_perfil_publico_so_de_quem_escreveu.sql",
];
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_22A, [B]: CONF.ROL_DA_22B };
const MIGRATION = LOTE.map((n) => fs.readFileSync(path.join(MIGRATIONS, n), "utf8"));
const ROLLBACK = LOTE.map((n) =>
  fs.readFileSync(path.join(MIGRATIONS, `rollback-manual-${n}`), "utf8"),
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

/** O ANTES: os tres rollback-manual, na ordem inversa. */
async function antes(c, { crlf = false } = {}) {
  for (const i of [2, 1, 0]) await c.query(crlf ? emCRLF(ROLLBACK[i]) : ROLLBACK[i]);
}
/** O ANTES de uma loja que ja tinha as duas tabelas do servidor fechadas (a IKCOUS). */
async function antesLojaFechada(c) {
  await antes(c);
  for (const t of ["public.app_settings", "public.otp_verifications"])
    await c.query(`REVOKE ALL ON TABLE ${t} FROM PUBLIC, anon, authenticated`);
}
async function aplicar(c, { crlf = false } = {}) {
  for (const i of [0, 1, 2]) await c.query(crlf ? emCRLF(MIGRATION[i]) : MIGRATION[i]);
}

// O que o lote muda e a 22b mede (reprova no DEPOIS).
const MUDA_22B = [
  "get_segmented_push_count: EXECUTE",
  "perfil_recusa_imagem_grande: funcao",
  "profiles: gatilho do teto da imagem",
  "public_profiles: condicao da politica e a do baseline",
  "public_profiles: politicas",
  "vw_produtos_admin: anon le",
].sort();
// O que a 22a reprova no ANTES numa loja que ja estava fechada (sem as duas tabelas do servidor).
const MUDA_22A_FECHADA = [
  "get_segmented_push_count: EXECUTE",
  "perfil_recusa_imagem_grande: EXECUTE fechado e sem SECURITY DEFINER",
  "perfil_recusa_imagem_grande: corpo e o da 20261218000000 (sha256)",
  "profiles: gatilho do teto da imagem ligado e com a definicao da 20261218000000",
  "public_profiles: condicao da politica e a da 20261219000000 (md5)",
  "public_profiles: politicas",
  "vw_produtos_admin: nada para PUBLIC/anon",
].sort();
const MUDA_22A = [
  ...MUDA_22A_FECHADA,
  "app_settings: RLS ligada e nada para PUBLIC/anon/authenticated",
  "otp_verifications: RLS ligada e nada para PUBLIC/anon/authenticated",
].sort();

const PAPEL_RO = `portao22_ro_${process.pid}`;
let C;

/** Monta o estado dentro de uma transacao, roda as consultas como o papel de leitura e desfaz tudo. */
async function noEstado(montar, consultas, { comoDono = false, caminho = null } = {}) {
  await C.query("BEGIN");
  try {
    if (montar) await montar(C);
    if (!comoDono) {
      await C.query(`SET LOCAL ROLE ${PAPEL_RO}`);
      await C.query("SET LOCAL transaction_read_only = on");
      assert.equal(
        (await C.query("SHOW transaction_read_only")).rows[0].transaction_read_only,
        "on",
      );
    }
    if (caminho) await C.query(`SET LOCAL search_path = ${caminho}`);
    const saidas = {};
    for (const nome of consultas) {
      const r = await C.query(SQL[nome]);
      assert.deepEqual(
        r.fields.map((x) => x.name),
        ["item", "esperado", "vivo", "ok"],
        "colunas item/esperado/vivo/ok",
      );
      saidas[nome] = r.rows;
    }
    return saidas;
  } finally {
    await C.query("ROLLBACK");
  }
}

const reprovadas = (linhas) =>
  linhas
    .filter((l) => l.ok !== true)
    .map((l) => l.item)
    .sort();

/** O rol da consulta: as linhas sao exatamente o contrato, cada uma UMA vez, sem quebra de linha. */
function confereRol(nome, linhas) {
  assert.deepEqual(
    linhas.map((l) => l.item).sort(),
    [...ROL[nome]].sort(),
    `${nome}: as linhas nao sao exatamente o rol`,
  );
  assert.equal(new Set(linhas.map((l) => l.item)).size, linhas.length);
  for (const l of linhas) {
    assert.equal(typeof l.ok, "boolean", `${nome}: ok nao booleano em ${l.item}`);
    assert.ok(!/[\r\n]/.test(String(l.vivo)), `${nome}: vivo com quebra de linha em ${l.item}`);
  }
}

/** Guarda: a mutacao tem de ter aplicado; sem ela um mutante que nao faz nada vira falso verde. */
async function guarda(sql) {
  const r = await C.query(sql);
  assert.equal(r.rows[0].aplicou, true, `a mutacao nao aplicou: ${sql}`);
}

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova("ROL: as 15 linhas da 22a e as 11 da 22b sao exatamente o rol, nos tres estados", async () => {
  for (const montar of [null, antes, antesLojaFechada]) {
    const s = await noEstado(montar, [A, B]);
    confereRol(A, s[A]);
    confereRol(B, s[B]);
  }
  assert.equal(ROL[A].length, 15);
  assert.equal(ROL[B].length, 11);
});

prova("DEPOIS (a arvore): 22a POSITIVA; 22b reprova SO as 6 linhas do que o lote muda", async () => {
  const s = await noEstado(null, [A, B]);
  assert.deepEqual(reprovadas(s[A]), [], "22a toda ok no depois");
  assert.deepEqual(reprovadas(s[B]), MUDA_22B);
});

prova("ANTES (os rollback-manual na transacao): 22b POSITIVA; 22a reprova as 9 linhas previstas", async () => {
  const s = await noEstado(antes, [A, B]);
  assert.deepEqual(reprovadas(s[B]), [], "22b toda ok no antes");
  assert.deepEqual(reprovadas(s[A]), MUDA_22A);
});

prova("ANTES numa loja que ja tinha as duas tabelas fechadas: 22b POSITIVA; 22a reprova so as 7 do resto", async () => {
  const s = await noEstado(antesLojaFechada, [A, B]);
  assert.deepEqual(reprovadas(s[B]), []);
  assert.deepEqual(reprovadas(s[A]), MUDA_22A_FECHADA);
  // e o lote aplicado por cima dela: 22a POSITIVA
  const d = await noEstado(async (c) => {
    await antesLojaFechada(c);
    await aplicar(c);
  }, [A]);
  assert.deepEqual(reprovadas(d[A]), []);
});

prova("IDEMPOTENCIA, IDA E VOLTA, CRLF e search_path pg_catalog: o mesmo veredito", async () => {
  const dobro = await noEstado(aplicar, [A, B]);
  assert.deepEqual(reprovadas(dobro[A]), []);
  assert.deepEqual(reprovadas(dobro[B]), MUDA_22B);
  const idaEVolta = await noEstado(async (c) => {
    await antes(c);
    await aplicar(c);
  }, [A]);
  assert.deepEqual(reprovadas(idaEVolta[A]), []);
  const crlfAntes = await noEstado((c) => antes(c, { crlf: true }), [B]);
  assert.deepEqual(reprovadas(crlfAntes[B]), []);
  const crlfDepois = await noEstado(async (c) => {
    await antes(c);
    await aplicar(c, { crlf: true });
    await guarda(
      "SELECT position(chr(13) in prosrc) > 0 AS aplicou FROM pg_proc WHERE oid = 'public.perfil_recusa_imagem_grande()'::regprocedure",
    );
  }, [A]);
  assert.deepEqual(reprovadas(crlfDepois[A]), []);
  for (const caminho of ["pg_catalog", "public, auth"]) {
    const d = await noEstado(null, [A, B], { caminho });
    assert.deepEqual(reprovadas(d[A]), [], `22a com search_path ${caminho}`);
    assert.deepEqual(reprovadas(d[B]), MUDA_22B, `22b com search_path ${caminho}`);
    const a = await noEstado(antes, [B], { caminho });
    assert.deepEqual(reprovadas(a[B]), [], `22b antes com search_path ${caminho}`);
  }
});

prova("PAPEL: o dono da conexao e o papel minimo de leitura veem o MESMO resultado", async () => {
  for (const montar of [null, antes]) {
    const comoDono = await noEstado(montar, [A, B], { comoDono: true });
    const comoLeitura = await noEstado(montar, [A, B]);
    assert.deepEqual(comoLeitura[A], comoDono[A]);
    assert.deepEqual(comoLeitura[B], comoDono[B]);
  }
});

/** Um negativo: a mutacao (com guarda) reprova EXATAMENTE `esperadas` na consulta. */
async function negativo(consulta, { antesDe = false, mutar, guardaSql }, esperadas) {
  const s = await noEstado(async (c) => {
    if (antesDe) await antes(c);
    await c.query(mutar);
    await guarda(guardaSql);
  }, [consulta]);
  assert.deepEqual(reprovadas(s[consulta]), [...esperadas].sort(), mutar);
}

const PUSH = "public.get_segmented_push_count(text,numeric,integer)";
const GAT = "public.perfil_recusa_imagem_grande()";
const outroCorpo = (assinatura) =>
  `DO $m$ BEGIN EXECUTE replace(pg_get_functiondef('${assinatura}'::regprocedure), 'AS $function$', 'AS $function$-- outro corpo' || chr(10)); END $m$`;
const guardaOutroCorpo = (assinatura) =>
  `SELECT prosrc LIKE '-- outro corpo%' AS aplicou FROM pg_proc WHERE oid = '${assinatura}'::regprocedure`;
const temPriv = (papel, rel, priv) =>
  `SELECT has_table_privilege('${papel}', '${rel}', '${priv}') AS aplicou`;

prova("NEGATIVO 22a: a politica de public_profiles (outra politica, outra condicao, RLS desligada) reprova SO a sua linha", async () => {
  await negativo(
    A,
    {
      mutar: "CREATE POLICY outra_prova ON public.public_profiles FOR SELECT TO anon USING (false)",
      guardaSql:
        "SELECT count(*) = 2 AS aplicou FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass",
    },
    ["public_profiles: politicas"],
  );
  await negativo(
    A,
    {
      mutar: "ALTER POLICY public_profiles_select_policy ON public.public_profiles USING (true)",
      guardaSql:
        "SELECT pg_get_expr(polqual, polrelid) = 'true' AS aplicou FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass",
    },
    ["public_profiles: condicao da politica e a da 20261219000000 (md5)"],
  );
  await negativo(
    A,
    {
      mutar: "ALTER POLICY public_profiles_select_policy ON public.public_profiles TO authenticated, anon",
      guardaSql:
        "SELECT to_regrole('anon') = ANY (polroles) AS aplicou FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass",
    },
    ["public_profiles: politicas"],
  );
  await negativo(
    A,
    {
      mutar: "ALTER TABLE public.public_profiles DISABLE ROW LEVEL SECURITY",
      guardaSql:
        "SELECT NOT relrowsecurity AS aplicou FROM pg_class WHERE oid = 'public.public_profiles'::regclass",
    },
    ["public_profiles: RLS ligada"],
  );
});

prova("NEGATIVO 22a: o gatilho (desligado, corpo diferente, EXECUTE aberto, ausente) reprova SO as suas linhas", async () => {
  await negativo(
    A,
    {
      mutar: "ALTER TABLE public.profiles DISABLE TRIGGER tr_perfil_recusa_imagem_grande",
      guardaSql:
        "SELECT tgenabled = 'D' AS aplicou FROM pg_trigger WHERE tgname = 'tr_perfil_recusa_imagem_grande'",
    },
    ["profiles: gatilho do teto da imagem ligado e com a definicao da 20261218000000"],
  );
  await negativo(
    A,
    { mutar: outroCorpo(GAT), guardaSql: guardaOutroCorpo(GAT) },
    ["perfil_recusa_imagem_grande: corpo e o da 20261218000000 (sha256)"],
  );
  await negativo(
    A,
    {
      mutar: `GRANT EXECUTE ON FUNCTION ${GAT} TO authenticated`,
      guardaSql: `SELECT has_function_privilege('authenticated', '${GAT}'::regprocedure, 'EXECUTE') AS aplicou`,
    },
    ["perfil_recusa_imagem_grande: EXECUTE fechado e sem SECURITY DEFINER"],
  );
  await negativo(
    A,
    {
      mutar: "DROP TRIGGER tr_perfil_recusa_imagem_grande ON public.profiles",
      guardaSql:
        "SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_perfil_recusa_imagem_grande') AS aplicou",
    },
    ["profiles: gatilho do teto da imagem ligado e com a definicao da 20261218000000"],
  );
});

prova("NEGATIVO 22a: a contagem do push e a view do painel reprovam SO a sua linha", async () => {
  await negativo(
    A,
    {
      mutar: `GRANT EXECUTE ON FUNCTION ${PUSH} TO anon`,
      guardaSql: `SELECT has_function_privilege('anon', '${PUSH}'::regprocedure, 'EXECUTE') AS aplicou`,
    },
    ["get_segmented_push_count: EXECUTE"],
  );
  await negativo(
    A,
    { mutar: outroCorpo(PUSH), guardaSql: guardaOutroCorpo(PUSH) },
    ["get_segmented_push_count: corpo e o vigente (md5)"],
  );
  await negativo(
    A,
    {
      mutar: "GRANT SELECT ON public.vw_produtos_admin TO anon",
      guardaSql: temPriv("anon", "public.vw_produtos_admin", "SELECT"),
    },
    ["vw_produtos_admin: nada para PUBLIC/anon"],
  );
  await negativo(
    A,
    {
      mutar: "REVOKE DELETE ON public.vw_produtos_admin FROM authenticated",
      guardaSql: "SELECT NOT has_table_privilege('authenticated', 'public.vw_produtos_admin', 'DELETE') AS aplicou",
    },
    ["vw_produtos_admin: authenticated le e grava"],
  );
});

prova("NEGATIVO 22a: as duas tabelas do servidor (coluna, PUBLIC, RLS, service_role, papel predefinido) reprovam as linhas previstas", async () => {
  await negativo(
    A,
    {
      mutar: "GRANT SELECT (key) ON public.app_settings TO authenticated",
      guardaSql: "SELECT has_any_column_privilege('authenticated', 'public.app_settings', 'SELECT') AS aplicou",
    },
    ["app_settings: RLS ligada e nada para PUBLIC/anon/authenticated"],
  );
  await negativo(
    A,
    {
      mutar: "GRANT SELECT ON public.app_settings TO PUBLIC",
      guardaSql:
        "SELECT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.app_settings'::regclass AND a.grantee = 0) AS aplicou",
    },
    ["app_settings: RLS ligada e nada para PUBLIC/anon/authenticated"],
  );
  await negativo(
    A,
    {
      mutar: "ALTER TABLE public.otp_verifications DISABLE ROW LEVEL SECURITY",
      guardaSql:
        "SELECT NOT relrowsecurity AS aplicou FROM pg_class WHERE oid = 'public.otp_verifications'::regclass",
    },
    ["otp_verifications: RLS ligada e nada para PUBLIC/anon/authenticated"],
  );
  await negativo(
    A,
    {
      mutar: "GRANT INSERT ON public.otp_verifications TO anon",
      guardaSql: temPriv("anon", "public.otp_verifications", "INSERT"),
    },
    ["otp_verifications: RLS ligada e nada para PUBLIC/anon/authenticated"],
  );
  await negativo(
    A,
    {
      mutar: "REVOKE UPDATE ON public.app_settings FROM service_role",
      guardaSql: "SELECT NOT has_table_privilege('service_role', 'public.app_settings', 'UPDATE') AS aplicou",
    },
    ["app_settings e otp_verifications: service_role le e grava"],
  );
  // a rota que nao aparece na ACL: o papel predefinido da leitura de TUDO (tambem reabre as tabelas)
  await negativo(
    A,
    {
      mutar: "GRANT pg_read_all_data TO authenticated",
      guardaSql: "SELECT pg_has_role('authenticated', 'pg_read_all_data', 'MEMBER') AS aplicou",
    },
    [
      "anon e authenticated: fora de pg_read_all_data e pg_write_all_data",
      "app_settings: RLS ligada e nada para PUBLIC/anon/authenticated",
      "otp_verifications: RLS ligada e nada para PUBLIC/anon/authenticated",
    ],
  );
});

prova("NEGATIVO 22b: cada desvio do estado vigente reprova SO a sua linha", async () => {
  const casos = [
    [
      "CREATE POLICY outra_prova ON public.public_profiles FOR SELECT TO authenticated USING (false)",
      "SELECT count(*) = 2 AS aplicou FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass",
      ["public_profiles: politicas"],
    ],
    [
      "ALTER POLICY public_profiles_select_policy ON public.public_profiles USING (id IS NOT NULL)",
      "SELECT pg_get_expr(polqual, polrelid) <> 'true' AS aplicou FROM pg_policy WHERE polrelid = 'public.public_profiles'::regclass",
      ["public_profiles: condicao da politica e a do baseline"],
    ],
    [
      "ALTER TABLE public.public_profiles DISABLE ROW LEVEL SECURITY",
      "SELECT NOT relrowsecurity AS aplicou FROM pg_class WHERE oid = 'public.public_profiles'::regclass",
      ["public_profiles: RLS ligada"],
    ],
    [
      "CREATE TRIGGER tr_perfil_recusa_imagem_grande BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.ensure_role_protection()",
      "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_perfil_recusa_imagem_grande') AS aplicou",
      ["profiles: gatilho do teto da imagem"],
    ],
    [
      "CREATE FUNCTION public.perfil_recusa_imagem_grande() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$",
      `SELECT to_regprocedure('${GAT}') IS NOT NULL AS aplicou`,
      ["perfil_recusa_imagem_grande: funcao"],
    ],
    [
      `REVOKE EXECUTE ON FUNCTION ${PUSH} FROM PUBLIC`,
      `SELECT NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '${PUSH}'::regprocedure AND a.grantee = 0) AS aplicou`,
      ["get_segmented_push_count: EXECUTE"],
    ],
    [outroCorpo(PUSH), guardaOutroCorpo(PUSH), ["get_segmented_push_count: corpo e o da 20261199000000 (md5)"]],
    [
      "REVOKE SELECT ON public.vw_produtos_admin FROM anon",
      "SELECT NOT has_table_privilege('anon', 'public.vw_produtos_admin', 'SELECT') AS aplicou",
      ["vw_produtos_admin: anon le"],
    ],
    [
      "REVOKE EXECUTE ON FUNCTION public.rls_admin_atual() FROM authenticated",
      "SELECT NOT has_function_privilege('authenticated', 'public.rls_admin_atual()'::regprocedure, 'EXECUTE') AS aplicou",
      ["rls_admin_atual: corpo da 20261197000000 (md5) e EXECUTE"],
    ],
    [
      "ALTER TABLE public.reviews RENAME COLUMN status TO situacao_prova",
      "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.reviews'::regclass AND attname = 'situacao_prova') AS aplicou",
      ["perfis, avaliacoes e perguntas: colunas que o lote le"],
    ],
  ];
  for (const [mutar, guardaSql, esperadas] of casos)
    await negativo(B, { antesDe: true, mutar, guardaSql }, esperadas);
});

prova("PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false certo)", async () => {
  const ref = "abcdefghijklmnopqrst";
  const sha = "0".repeat(40);
  const v = (consulta, linhas) => CONF.veredictoDaConsulta({ consulta, ref, sha, linhas });
  const depois = await noEstado(null, [A, B]);
  assert.match(v(A, depois[A]), / linhas=15 ok_false=0 ok_nao_booleano=0 rol=ok$/);
  assert.match(v(B, depois[B]), / linhas=11 ok_false=6 ok_nao_booleano=0 rol=ok$/);
  const a = await noEstado(antes, [A, B]);
  assert.match(v(A, a[A]), / linhas=15 ok_false=9 ok_nao_booleano=0 rol=ok$/);
  assert.match(v(B, a[B]), / linhas=11 ok_false=0 ok_nao_booleano=0 rol=ok$/);
  // Uma linha a menos nao e' o rol: o portao nunca a le como positiva.
  assert.match(v(A, depois[A].slice(1)), / rol=invalido$/);
  assert.match(v(B, a[B].slice(1)), / rol=invalido$/);
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  C.on("error", () => {});
  await C.connect();
  const falhas = [];
  try {
    await C.query(`CREATE ROLE ${PAPEL_RO} NOLOGIN NOSUPERUSER BYPASSRLS`);
    await C.query(`GRANT pg_read_all_data TO ${PAPEL_RO}`);
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(`  FALHOU  ${nome}\n    ${e.message.split("\n").join("\n    ")}`);
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.query(`DROP OWNED BY ${PAPEL_RO}`).catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${PAPEL_RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar("FALHOU", `${falhas.length} de ${PROVAS.length} provas do portao 22 falharam.`);
  }
  console.log(`\n[portas-do-banco-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
