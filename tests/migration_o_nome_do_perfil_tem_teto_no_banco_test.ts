// @ts-nocheck
// O NOME DO PERFIL (E O WHATSAPP) TEM TETO NO BANCO — prova offline do par 20261399100000 + rollback (cacada de 02/11/2026).
// O COMPORTAMENTO (120 entra, 121 e 2 milhoes sao recusados para todos; perfil antigo acima do teto faz a migration se recusar;
// mutantes; reaplicar; rollback; pre-voo; consultas 118a/118b) e' provado em tests/banco/o-nome-do-perfil-tem-teto-no-banco-viva.cjs.
// Aqui fica o que se prova so lendo o texto.
//
// Riscos: a migration so CRIA tres restricoes NOT VALID (nenhum dado lido ou escrito, nenhum VALIDATE); o teto do nome tem de ser o
// da tela (maxLength 120 no cadastro e na conta) para nada legitimo ser recusado; handle_new_user copia o nome sem cortar.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME = "20261399100000_o_nome_do_perfil_tem_teto_no_banco.sql";
const A = "118a-conferir-o-nome-do-perfil-tem-teto-no-banco-aplicado";
const B = "118b-antes-o-nome-do-perfil-tem-teto-no-banco-ausente";
const CKS = [
  "profiles_full_name_ate_120_caracteres",
  "public_profiles_full_name_ate_120_caracteres",
  "profiles_whatsapp_ate_20_caracteres",
];
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");

Deno.test("1399100: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT; LF; lock_timeout antes do pre-voo", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
  for (const sql of [migration, rollback]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
    const iLock = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    assert.ok(iLock >= 0 && iLock < sql.indexOf("DO $preflight"));
  }
  for (const n of [NOME, `rollback-manual-${NOME}`])
    assert.ok(!lerBruto(n).includes("\r"), n);
});

Deno.test("1399100: a migration so CRIA tres restricoes NOT VALID — sem DROP, DML, GRANT/REVOKE, funcao, gatilho nem VALIDATE", () => {
  // sem os comentarios de linha, mas COM o corpo dos blocos DO (os ALTER moram dentro de um)
  const codigo = migration
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");
  assert.doesNotMatch(codigo, /\bDROP\b/i);
  assert.doesNotMatch(
    codigo,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b(?!\s*(ON|TO|OR)\b)/i,
  );
  assert.doesNotMatch(codigo, /\b(GRANT|REVOKE)\b/i);
  assert.doesNotMatch(codigo, /\bVALIDATE\b/i);
  assert.doesNotMatch(codigo, /\bCREATE\b/i);
  assert.equal((codigo.match(/\bALTER TABLE\b/g) ?? []).length, 3);
  for (const [tabela, ck, regra] of [
    ["profiles", CKS[0], "char_length(full_name) <= 120"],
    ["public_profiles", CKS[1], "char_length(full_name) <= 120"],
    ["profiles", CKS[2], "char_length(whatsapp) <= 20"],
  ])
    assert.ok(
      codigo.includes(
        `ALTER TABLE public.${tabela} ADD CONSTRAINT ${ck} CHECK (${regra}) NOT VALID;`,
      ),
      ck,
    );
  // so cria se ainda nao existe (reaplicar e' no-op)
  for (const ck of CKS)
    assert.ok(
      migration.includes(`c.conname = '${ck}') THEN\n    ALTER TABLE public.`),
      ck,
    );
});

Deno.test("1399100: o pre-voo e a conferencia final aceitam so as restricoes como desenhadas (NOT VALID ou validadas)", () => {
  const iPre = migration.indexOf("DO $preflight_20261399100000$");
  const iCria = migration.indexOf("DO $teto_do_perfil_20261399100000$");
  const iConf = migration.indexOf("DO $conferencia_20261399100000$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, iCria);
  const conf = migration.slice(iConf);
  assert.ok(pre.includes("B1_BASELINE_DIVERGENT"));
  for (const ck of CKS) {
    assert.ok(pre.includes(`'${ck}'`), `pre-voo sem ${ck}`);
    assert.ok(conf.includes(`'${ck}'`), `conferencia sem ${ck}`);
  }
  assert.ok(conf.includes("conferencia 20261399100000"));
  // o cabecalho avisa do risco do perfil antigo e traz as TRES consultas de medicao
  for (const consulta of [
    "FROM public.profiles WHERE char_length(full_name) > 120;",
    "FROM public.public_profiles WHERE char_length(full_name) > 120;",
    "FROM public.profiles WHERE char_length(whatsapp) > 20;",
  ])
    assert.ok(migration.includes(consulta), consulta);
});

Deno.test("1399100: a GUARDA — logo depois dos ADD CONSTRAINT, recusa com B1_BASELINE_DIVERGENT se houver perfil acima do teto (o CHECK travaria foto, CPF e cargo)", () => {
  const iUltimoAdd = migration.lastIndexOf("ADD CONSTRAINT");
  const iGuarda = migration.indexOf("IF v_achados <> '' THEN");
  const iFim = migration.indexOf("END $teto_do_perfil_20261399100000$;");
  assert.ok(iUltimoAdd >= 0 && iUltimoAdd < iGuarda && iGuarda < iFim);
  const bloco = migration.slice(iUltimoAdd, iFim);
  assert.ok(
    bloco.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: há perfil"),
  );
  assert.ok(bloco.includes("a migration NÃO foi aplicada"));
  // format() usa %s (o % puro e' do RAISE): foi o defeito da primeira versao
  assert.doesNotMatch(bloco, /format\([^)]*[^%]%[^s%]/);
  // so varre a coluna cujo CHECK nasceu agora
  for (const v of ["v_criou_nome", "v_criou_nome_publico", "v_criou_whatsapp"])
    assert.ok(bloco.includes(`IF ${v} THEN`), v);
  // nenhum gatilho de pedido escreve em profiles (por isso o pagamento nao entra na guarda)
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const c = canais.provasDeObjetos.find((p) => p.consulta === A)._comentario;
  assert.ok(c.includes("SE RECUSA"));
  assert.ok(c.includes("set_my_cpf"));
});

Deno.test("1399100: o teto do banco e' o da tela e so a conta grava o nome (cadastro e Salvar da conta)", () => {
  for (const rel of [
    "src/views/shared/AuthView.tsx",
    "src/views/customer/AccountSettingsView.tsx",
  ])
    assert.ok(
      /maxLength=\{120\}/.test(lerRepo(rel)),
      `${rel}: a tela mudou o limite do nome: revise os CHECKs (o banco nao pode recusar o que a tela aceita)`,
    );
  // o unico escritor de profiles.full_name no app e' update_my_profile_secure (pela tela de conta) e o cadastro (metadado)
  const escritores = [];
  const visitar = (dir) => {
    for (const e of Deno.readDirSync(new URL(dir, DIR))) {
      const rel = `${dir}${e.name}`;
      if (e.isDirectory) visitar(`${rel}/`);
      else if (/\.tsx?$/.test(e.name) && /p_full_name\s*:/.test(lerRepo(rel)))
        escritores.push(rel);
    }
  };
  visitar("src/");
  assert.deepEqual(escritores.sort(), [
    "src/contexts/AuthContext.tsx",
    "src/views/customer/AccountSettingsView.tsx",
  ]);
});

Deno.test("1399100: o rollback tira so as tres restricoes NOVAS, com pre-voo antes de apagar, e a conferencia final", () => {
  for (const [tabela, ck] of [
    ["profiles", CKS[0]],
    ["public_profiles", CKS[1]],
    ["profiles", CKS[2]],
  ])
    assert.ok(
      rollback.includes(
        `ALTER TABLE public.${tabela} DROP CONSTRAINT IF EXISTS ${ck};`,
      ),
      ck,
    );
  assert.equal((limpo(rollback).match(/\bDROP\b/g) ?? []).length, 3);
  assert.doesNotMatch(
    limpo(rollback),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|CREATE)\b(?!\s*(ON|TO)\b)/i,
  );
  const iPre = rollback.indexOf("DO $preflight_rollback_20261399100000$");
  const iApaga = rollback.indexOf("\nALTER TABLE public.profiles DROP");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261399100000$");
  assert.ok(iPre >= 0 && iPre < iApaga && iApaga < iConf);
  assert.ok(rollback.slice(iPre, iApaga).includes("B1_BASELINE_DIVERGENT"));
});

Deno.test("1399100: publicacao — lote unico (118a/118b), rol fechado de 5 e 3 linhas, consultas so de catalogo, workflows, release e prova viva; sem entrada no db-apply (nao ha funcao)", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261399100000"),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, ["20261399100000"]);
  assert.equal(lote[0].consulta, A);
  assert.equal(lote[0].ausenciaConfirmadaPor, B);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(campo in lote[0]), campo);
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const [nome, linhas] of [
    [A, 5],
    [B, 3],
  ]) {
    const sql = lerRepo(`scripts/publicacao/consultas/${nome}.sql`);
    assert.doesNotMatch(
      limpo(sql),
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      limpo(sql),
      /\bFROM\s+public\.(profiles|public_profiles)\b/i,
      "nao le perfil de cliente",
    );
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(nome);
    assert.equal(rol.length, linhas, nome);
    assert.equal(new Set(rol).size, rol.length, `${nome}: rotulo repetido`);
    for (const item of rol) assert.ok(sql.includes(`'${item}'`), item);
    const rotulos = [...sql.matchAll(/SELECT '([^']+)', '(?:sim|nao)'/g)].map(
      (m) => m[1],
    );
    assert.deepEqual([...rotulos].sort(), [...rol].sort(), `${nome}: rotulos`);
    assert.ok(
      lerRepo("scripts/frota/publicar-release.mjs").includes(`"${nome}"`),
    );
    assert.ok(
      lerRepo(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nome}\n`,
      ),
    );
    assert.equal(
      lerRepo(".github/workflows/rpc-ci.yml").split(`consultas/${nome}.sql`)
        .length - 1,
      2,
    );
  }
  assert.ok(
    lerRepo(".github/workflows/rpc-ci.yml").includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/o-nome-do-perfil-tem-teto-no-banco-viva.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "o-nome-do-perfil-tem-teto-no-banco-viva.cjs",
    ),
  );
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  assert.equal(new Map(Object.entries(VERIFICACOES)).get(NOME), undefined);
});
