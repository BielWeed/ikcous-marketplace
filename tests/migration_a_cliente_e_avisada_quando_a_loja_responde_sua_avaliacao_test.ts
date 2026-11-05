// @ts-nocheck
// A CLIENTE É AVISADA QUANDO A LOJA RESPONDE A AVALIAÇÃO DELA — prova OFFLINE do par 20261399400000 + rollback
// (as duas sobrecargas de reply_review_atomic). O COMPORTAMENTO é provado em
// tests/banco/a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-viva.cjs (Postgres efêmero); aqui fica o que se
// prova só lendo o texto.
//
// Riscos: o corpo novo tem de ser o vigente (20261360000000) MAIS o passo 3, sem perder a linha do log de push (a
// consulta de medição 27m a usa como rastro) nem a guarda de admin; o rollback tem de devolver os corpos vigentes byte
// a byte e recusar corpo alheio; sem BEGIN/COMMIT de nível superior (AGENTS.md); a migration só entra com lote e fichas.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { removerRuido } = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261399400000_a_cliente_e_avisada_quando_a_loja_responde_sua_avaliacao.sql";
const STEM_A =
  "120a-conferir-a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-aplicado";
const STEM_B =
  "120b-antes-a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-base-vigente";
const ler = (caminho) =>
  Deno.readTextFileSync(new URL(caminho, DIR)).replace(/\r\n/g, "\n");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const migration1360 = ler(
  "supabase/migrations/20261360000000_ex_admin_perde_o_acesso_na_hora_nas_demais_tabelas.sql",
);
const fichaA = ler(`scripts/publicacao/consultas/${STEM_A}.sql`);
const fichaB = ler(`scripts/publicacao/consultas/${STEM_B}.sql`);
const ficha82a = ler(
  "scripts/publicacao/consultas/82a-conferir-ex-admin-sem-acesso-nas-demais-tabelas.sql",
);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

// Escritos por extenso: o teste nunca os lê do arquivo que está provando.
const F2 = "public.reply_review_atomic(uuid,text)";
const F3 = "public.reply_review_atomic(uuid,text,uuid)";
const ANTES_F2 = "0e58549366e4b4be17ae070a8fc622dc";
const ANTES_F3 = "64b337eb3ec5dd1431e0dbf9d12a49ac";
const DEPOIS_F2 = "f617966c37037537410c3c78d85b8785";
const DEPOIS_F3 = "08569f17f477dea9ff87709ca3edd218";

/** Os dois corpos (entre `$function$`) do arquivo, na ordem: 2 argumentos e 3 argumentos. */
function corpos(sql) {
  const partes = sql.split("$function$");
  assert.equal(partes.length, 5, "duas funcoes, quatro marcas $function$");
  return [partes[1], partes[3]];
}
/** Os corpos de reply_review_atomic de um arquivo que as define (a 1360 define quatro funcoes). */
function corposDeReply(sql) {
  return [
    ...sql.matchAll(
      /CREATE OR REPLACE FUNCTION public\.reply_review_atomic\(([^)]*)\)[\s\S]*?\$function\$([\s\S]*?)\$function\$;/g,
    ),
  ].map((m) => [m[1], m[2]]);
}
/** Tira o passo 3 de um corpo novo: sobra o corpo vigente. */
function semPasso3(corpo) {
  const ini = corpo.indexOf("\n        -- 3. Aviso no sino");
  const fim = corpo.indexOf("        END;\n", ini) + "        END;\n".length;
  assert.ok(ini > 0 && fim > ini, "passo 3 nao encontrado");
  return corpo.slice(0, ini) + corpo.slice(fim);
}

Deno.test("os corpos das duas funcoes seguem os de hash conhecido: a migration (depois) e o rollback (antes); so texto FORA do corpo mudou", () => {
  const [m2, m3] = corpos(migration);
  assert.equal(md5(m2), DEPOIS_F2);
  assert.equal(md5(m3), DEPOIS_F3);
  const [r2, r3] = corpos(rollback);
  assert.equal(md5(r2), ANTES_F2);
  assert.equal(md5(r3), ANTES_F3);
});

Deno.test("o rollback devolve BYTE A BYTE os corpos vigentes da 20261360000000 (2 e 3 argumentos)", () => {
  const vigentes = corposDeReply(migration1360);
  assert.equal(vigentes.length, 2);
  const [r2, r3] = corpos(rollback);
  assert.equal(vigentes[0][0], "p_review_id uuid, p_reply text");
  assert.equal(vigentes[0][1], r2);
  assert.equal(
    vigentes[1][0],
    "p_review_id uuid, p_reply text, p_admin_id uuid",
  );
  assert.equal(vigentes[1][1], r3);
});

Deno.test("o corpo novo e o vigente MAIS o passo 3: tirado o passo 3, sobra o corpo da 1360 caractere a caractere", () => {
  const [m2, m3] = corpos(migration);
  const [r2, r3] = corpos(rollback);
  assert.equal(semPasso3(m2), r2);
  assert.equal(semPasso3(m3), r3);
});

Deno.test("a linha do push_notifications_log CONTINUA no corpo novo (a consulta 27m e o painel de campanhas dependem dela) e a guarda de admin tambem", () => {
  const [m2, m3] = corpos(migration);
  for (const c of [m2, m3]) {
    assert.match(c, /INSERT INTO (public\.)?push_notifications_log/);
    assert.ok(c.includes("A10: log honesto"));
    assert.ok(c.includes("IF NOT public.is_admin_atual() THEN"));
    assert.ok(c.includes("Unauthorized: Only admins can reply to reviews."));
  }
  assert.ok(m2.includes("'Sua avaliação foi respondida!'"));
  assert.ok(m3.includes("'Sua avaliacao foi respondida!'"));
  // a 27m procura exatamente estes dois titulos no log
  const q27m = ler(
    "scripts/publicacao/consultas/27m-medir-avaliacao-forjada.sql",
  );
  assert.ok(
    q27m.includes(
      "l.title IN ('Sua avaliação foi respondida!', 'Sua avaliacao foi respondida!')",
    ),
  );
});

Deno.test("o passo 3 e um aviso so por avaliacao, best-effort, para quem avaliou, abrindo o produto", () => {
  for (const c of corpos(migration)) {
    const p3 = c.slice(c.indexOf("-- 3. Aviso no sino"));
    const sql = p3.replace(/\s+/g, " ");
    for (const trecho of [
      "BEGIN INSERT INTO",
      "SELECT v_user_id, 'info', 'Sua avaliação foi respondida',",
      "'A loja respondeu sua avaliação sobre ' || COALESCE(v_product_name, 'um produto') || '.'",
      "jsonb_build_object('review_id', p_review_id, 'product_id', v_product_id)",
      "jsonb_build_object('url', '/product-detail?id=' || v_product_id)",
      "WHERE v_user_id IS NOT NULL",
      "AND NOT EXISTS (SELECT 1 FROM",
      "WHERE n.usuario_id = v_user_id",
      "AND n.dados ->> 'review_id' = p_review_id::text);",
      "EXCEPTION WHEN OTHERS THEN RAISE WARNING",
    ])
      assert.ok(sql.includes(trecho), trecho);
  }
});

Deno.test("o PRE-VOO da migration vem antes da troca: exatamente 2 assinaturas, corpo vigente OU o desta migration, atributos, is_admin_atual e colunas; qualquer outro recusa", () => {
  const iPre = migration.indexOf("DO $preflight_20261399400$");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  assert.ok(iPre >= 0, "a migration tem pre-voo");
  assert.ok(iPre < iCria, "o pre-voo vem ANTES do primeiro CREATE OR REPLACE");
  const pre = migration.slice(iPre, iCria).replace(/\s+/g, " ");
  assert.ok(pre.includes("END $preflight_20261399400$;"));
  for (const trecho of [
    "p.proname = 'reply_review_atomic') <> 2",
    `('${F2}', '${ANTES_F2}', '${DEPOIS_F2}')`,
    `('${F3}', '${ANTES_F3}', '${DEPOIS_F3}')`,
    "md5(replace(p.prosrc, E'\\r', ''))",
    "to_regprocedure(r.assinatura)",
    "v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "to_regprocedure('public.is_admin_atual()') IS NULL",
    "('reviews', 'merchant_reply_at')",
    "('notificacoes', 'acao')",
    "('push_notifications_log', 'created_by')",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
});

Deno.test("o PRE-VOO do rollback vem antes da troca: exatamente 2 assinaturas e corpo vivo = o desta migration OU o de antes (idempotente); qualquer outro recusa", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261399400$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  assert.ok(iPre >= 0, "o rollback tem pre-voo");
  assert.ok(iPre < iCria, "o pre-voo vem ANTES do primeiro CREATE OR REPLACE");
  const pre = rollback.slice(iPre, iCria).replace(/\s+/g, " ");
  assert.ok(pre.includes("END $preflight_rollback_20261399400$;"));
  for (const trecho of [
    "p.proname = 'reply_review_atomic') <> 2",
    `('${F2}', '${DEPOIS_F2}', '${ANTES_F2}')`,
    `('${F3}', '${DEPOIS_F3}', '${ANTES_F3}')`,
    "md5(replace(p.prosrc, E'\\r', ''))",
    "to_regprocedure(r.assinatura)",
    "v_hash IS NULL OR v_hash NOT IN (r.hash_desta, r.hash_antes)",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
});

Deno.test("o rollback tem CONFERENCIA FINAL depois da troca: exatamente 2 assinaturas e os dois corpos de volta ao md5 de antes", () => {
  const iUltimaFuncao = rollback.lastIndexOf("$function$;");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261399400$");
  assert.ok(iConf >= 0, "o rollback tem conferencia final");
  assert.ok(iConf > iUltimaFuncao, "a conferencia vem DEPOIS dos dois CREATE");
  const conf = rollback.slice(iConf).replace(/\s+/g, " ");
  assert.ok(conf.includes("END $conferencia_rollback_20261399400$;"));
  for (const trecho of [
    "p.proname = 'reply_review_atomic') <> 2",
    `('${F2}', '${ANTES_F2}')`,
    `('${F3}', '${ANTES_F3}')`,
    "md5(replace(p.prosrc, E'\\r', ''))",
    "v_hash IS DISTINCT FROM r.hash_antes",
    "RAISE EXCEPTION 'conferencia rollback 20261399400:",
  ])
    assert.ok(conf.includes(trecho), trecho);
  // a conferencia nao aceita o corpo desta migration como valido
  assert.ok(!conf.includes(DEPOIS_F2) && !conf.includes(DEPOIS_F3));
});

Deno.test("a migration tem POS-VOO que confere so o hash dos dois corpos e nada de ACL", () => {
  const iPos = migration.indexOf("DO $posvoo_20261399400$");
  assert.ok(iPos > migration.lastIndexOf("$function$;"));
  const bloco = migration.slice(iPos);
  assert.ok(bloco.includes("md5(replace(p.prosrc, E'\\r', ''))"));
  assert.ok(bloco.includes(DEPOIS_F2) && bloco.includes(DEPOIS_F3));
  assert.ok(!/proacl|aclexplode|has_function_privilege|prosecdef/.test(bloco));
});

Deno.test("a migration e o rollback sao ADITIVOS e seguem sem BEGIN/COMMIT de nivel superior, sem GRANT/REVOKE e sem tocar tabela", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    const semCorpos = limpo(
      sql
        .split("$function$")
        .filter((_, i) => i % 2 === 0)
        .join(" "),
    );
    assert.doesNotMatch(semCorpos, /\b(BEGIN|COMMIT)\s*;/i, nome);
    assert.doesNotMatch(semCorpos, /\b(GRANT|REVOKE)\b/i, nome);
    assert.doesNotMatch(
      semCorpos,
      /\b(DROP|TRUNCATE|ALTER\s+TABLE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i,
      nome,
    );
    assert.equal(
      (sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length,
      2,
      nome,
    );
  }
});

Deno.test("as fichas 120a/120b: mesmo rol de 8 linhas, so catalogo, 120a espera os corpos novos e 120b os vigentes", () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  for (const stem of [STEM_A, STEM_B]) {
    assert.equal(conf.ROL_FECHADO_POR_CONSULTA[stem].length, 8, stem);
    assert.equal(new Set(conf.ROL_FECHADO_POR_CONSULTA[stem]).size, 8, stem);
  }
  assert.deepEqual(
    conf.ROL_FECHADO_POR_CONSULTA[STEM_A],
    conf.ROL_FECHADO_POR_CONSULTA[STEM_B],
  );
  for (const [ficha, f2, f3, outro] of [
    [fichaA, DEPOIS_F2, DEPOIS_F3, [ANTES_F2, ANTES_F3]],
    [fichaB, ANTES_F2, ANTES_F3, [DEPOIS_F2, DEPOIS_F3]],
  ]) {
    assert.ok(ficha.includes(`'${f2}'`) && ficha.includes(`'${f3}'`));
    for (const h of outro)
      assert.ok(
        !ficha.includes(`'${h}'`),
        "a ficha aceita o corpo do outro lado",
      );
    const sql = ficha
      .split("\n")
      .filter((l) => !l.startsWith("--"))
      .join("\n");
    assert.doesNotMatch(
      sql,
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/i,
      "a ficha so le",
    );
    assert.ok(
      !/FROM\s+(public\.)?(reviews|notificacoes|produtos|profiles)\b/i.test(
        sql,
      ),
    );
    for (const item of conf.ROL_FECHADO_POR_CONSULTA[STEM_A])
      assert.ok(sql.includes(`'${item}'`), item);
  }
});

Deno.test("a 82a aceita os dois corpos desta migration como sucessores de reply_review_atomic e nenhum outro (e os de answer_question_atomic seguem exatos)", () => {
  const sql = ficha82a;
  assert.ok(sql.includes(`'${ANTES_F2}', '${DEPOIS_F2}'`));
  assert.ok(sql.includes(`'${ANTES_F3}', '${DEPOIS_F3}'`));
  assert.ok(
    sql.includes("md5(replace(p.prosrc,chr(13),'')) IN (a.hash, a.sucessora)"),
  );
  // answer_question_atomic nao ganha sucessora
  assert.ok(sql.includes("'4766b4ce828e0f7761bcb5c29e4c617a', NULL::text"));
  assert.ok(sql.includes("'a4d977922837f6ecf3e3df71930b0785', NULL::text"));
});

Deno.test("o lote 120 esta registrado em exatamente um lugar de cada registro (canais, rol fechado da release, menus dos workflows, mapa do aplicador)", () => {
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter((x) =>
    x.versoes.includes("20261399400000"),
  );
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].consulta, STEM_A);
  assert.equal(lotes[0].ausenciaConfirmadaPor, STEM_B);
  assert.deepEqual(lotes[0].versoes, ["20261399400000"]);
  assert.ok(lotes[0]._comentario.includes("ROLLBACK:"));
  assert.ok(lotes[0]._comentario.includes("27m"));
  const release = ler("scripts/frota/publicar-release.mjs");
  for (const stem of [STEM_A, STEM_B]) {
    assert.equal(release.split(`"${stem}"`).length - 1, 1, stem);
    assert.equal(
      ler(".github/workflows/conferir-banco-da-loja.yml").split(`- ${stem}\n`)
        .length - 1,
      1,
      stem,
    );
    assert.equal(
      ler(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${stem}.sql"`,
      ).length - 1,
      2,
      `${stem}: as duas listas de caminhos do rpc-ci`,
    );
  }
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "node tests/banco/rodar-isolado.cjs tests/banco/a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-viva.cjs",
    ),
  );
  const mapa = require("../scripts/db-apply.cjs");
  assert.deepEqual(mapa.VERIFICACOES[NOME].funcao, "reply_review_atomic");
  // o marcador "A10: log honesto" da 1064/1065 segue valendo nos dois corpos (reaplicar a 1064/1065 e' recusado pelo aplicador)
  const [m2, m3] = corpos(migration);
  for (const c of [m2, m3])
    assert.equal(c.split("A10: log honesto").length - 1, 1);
});
