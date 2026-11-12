// @ts-nocheck
// O CADASTRO CRIA O PERFIL EM TODA LOJA — prova offline do par 20261399940000 + rollback (07/11/2026).
// O COMPORTAMENTO (o gatilho cria o perfil; o reparo de quem ja se cadastrou sem perfil; admin e cadastro acima do teto de fora; mutantes;
// reaplicar; rollback; pre-voo; consultas 129a/129b; lock_timeout em auth.users) e' provado em
// tests/banco/o-cadastro-cria-o-perfil-em-toda-loja-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: a migration cria UM gatilho em auth.users (so se ausente) e INSERE perfis de quem nao tem; o reparo tem de usar a MESMA
// expressao de handle_new_user (se a funcao mudar, o reparo diverge), os mesmos tetos da 20261399100000 e a tela tem de respeitar o teto.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME = "20261399940000_o_cadastro_cria_o_perfil_em_toda_loja.sql";
const A = "129a-conferir-o-cadastro-cria-o-perfil-em-toda-loja-aplicado";
const B = "129b-antes-o-cadastro-cria-o-perfil-em-toda-loja-ausente";
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const semComentario = (s) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");

Deno.test("1399940: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT; LF; SET LOCAL lock_timeout antes do pre-voo (nada a restaurar)", () => {
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
    assert.ok(sql.includes("SET LOCAL statement_timeout = '30s';"));
    // SET LOCAL vale so ate o fim da transacao do aplicador: um SET de sessao vazaria para o resto da conexao
    assert.doesNotMatch(semComentario(sql), /\bSET lock_timeout\b/i);
  }
  for (const n of [NOME, `rollback-manual-${NOME}`])
    assert.ok(!lerBruto(n).includes("\r"), n);
});

Deno.test("1399940: a migration so CRIA um gatilho e INSERE perfis ausentes — sem DROP, UPDATE, DELETE, GRANT/REVOKE, funcao nova", () => {
  const codigo = semComentario(migration);
  assert.doesNotMatch(codigo, /\bDROP\b/i);
  assert.doesNotMatch(
    codigo,
    /\b(UPDATE|DELETE|TRUNCATE)\b(?!\s*(ON|TO|OR)\b)/i,
  );
  assert.doesNotMatch(codigo, /\b(GRANT|REVOKE)\b/i);
  assert.doesNotMatch(codigo, /\bCREATE (OR REPLACE )?FUNCTION\b/i);
  assert.doesNotMatch(codigo, /\bALTER\b/i);
  assert.equal((codigo.match(/\bCREATE TRIGGER\b/g) ?? []).length, 1);
  assert.equal((codigo.match(/\bINSERT INTO\b/g) ?? []).length, 1);
  assert.ok(
    codigo.includes(
      "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();",
    ),
  );
  // o gatilho so nasce se ausente (reaplicar e' no-op; na IKCOUS ele ja existe)
  assert.ok(
    migration.includes(
      "AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal) THEN\n    CREATE TRIGGER on_auth_user_created",
    ),
  );
  assert.ok(migration.includes("IF NOT EXISTS (SELECT 1 FROM pg_trigger t"));
});

Deno.test("1399940: ordem pre-voo, gatilho, reparo, conferencia; o pre-voo recusa gatilho homonimo diferente e funcao sem SECURITY DEFINER", () => {
  const iPre = migration.indexOf("DO $preflight_20261399940000$");
  const iGat = migration.indexOf("DO $gatilho_20261399940000$");
  const iRep = migration.indexOf("DO $reparo_20261399940000$");
  const iConf = migration.indexOf("DO $conferencia_20261399940000$");
  assert.ok(iPre >= 0 && iPre < iGat && iGat < iRep && iRep < iConf);
  const pre = migration.slice(iPre, iGat);
  assert.ok(pre.includes("B1_BASELINE_DIVERGENT"));
  assert.ok(pre.includes("p.prosecdef"), "o pre-voo exige SECURITY DEFINER");
  assert.ok(pre.includes("v_gatilho.tgtype <> 5"), "gatilho homonimo: momento");
  assert.ok(
    pre.includes("v_gatilho.tgfoid IS DISTINCT FROM"),
    "gatilho homonimo: funcao",
  );
  assert.ok(
    pre.includes("v_gatilho.tem_quando"),
    "gatilho homonimo: condicao WHEN",
  );
  const conf = migration.slice(iConf);
  assert.ok(conf.includes("conferencia 20261399940000"));
  assert.ok(conf.includes("t.tgtype = 5"));
});

Deno.test("1399940: o reparo usa a MESMA expressao de handle_new_user, so de quem nao tem perfil, so papel customer, so dentro dos tetos, sem sobrescrever", () => {
  const baseline = ler("20260806000000_baseline_do_schema_vivo.sql");
  const corpo = baseline.slice(
    baseline.indexOf("CREATE FUNCTION public.handle_new_user()"),
    baseline.indexOf("CREATE FUNCTION public.handle_order_item_stock()"),
  );
  const exprNome =
    "COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Usuário')";
  assert.ok(
    corpo.includes(exprNome),
    "a funcao do baseline mudou a expressao do nome",
  );
  assert.ok(corpo.includes("new.raw_user_meta_data->>'phone'"));
  assert.ok(corpo.includes("new.raw_user_meta_data->>'cpf'"));
  assert.ok(corpo.includes("'customer'"));
  const i = migration.indexOf("INSERT INTO public.profiles");
  const fim = "ON CONFLICT (id) DO NOTHING;";
  const insert = migration.slice(i, migration.indexOf(fim, i) + fim.length);
  assert.ok(insert.includes(exprNome.replaceAll("new.", "u.")));
  assert.ok(insert.includes("u.raw_user_meta_data->>'phone'"));
  assert.ok(insert.includes("u.raw_user_meta_data->>'cpf'"));
  assert.ok(insert.includes("'customer'\n    FROM auth.users u"));
  assert.ok(
    insert.includes(
      "WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)",
    ),
  );
  assert.ok(
    insert.includes(
      "COALESCE(u.raw_app_meta_data->>'role', 'customer') = 'customer'",
    ),
    "nunca rebaixar admin/gerente/vendedor sem perfil",
  );
  assert.ok(insert.includes("<= 120") && insert.includes("<= 20"));
  assert.ok(insert.endsWith("ON CONFLICT (id) DO NOTHING;"));
  // os tetos sao os da 20261399100000 (o banco recusaria o INSERT acima deles e abortaria a migration inteira)
  const teto = ler("20261399100000_o_nome_do_perfil_tem_teto_no_banco.sql");
  assert.ok(teto.includes("CHECK (char_length(full_name) <= 120)"));
  assert.ok(teto.includes("CHECK (char_length(whatsapp) <= 20)"));
  // nenhuma migration redefine handle_new_user depois do baseline: se uma redefinir, o reparo tem de ser revisto junto
  const redefinicoes = [];
  for (const e of Deno.readDirSync(new URL("supabase/migrations/", DIR))) {
    if (!e.isFile || !e.name.endsWith(".sql") || e.name.startsWith("rollback-"))
      continue;
    // "OR REPLACE" sai antes do teste: a opcao dentro de um grupo repetivel e' regex insegura
    const sql = ler(e.name).replace(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION/gi,
      "CREATE FUNCTION",
    );
    if (/CREATE\s+FUNCTION\s+(public\.)?"?handle_new_user"?\s*\(/i.test(sql))
      redefinicoes.push(e.name);
  }
  assert.deepEqual(redefinicoes, [
    "20260806000000_baseline_do_schema_vivo.sql",
  ]);
});

Deno.test("1399940: o teto do banco e' o da tela (a tela impede o que o gatilho passaria a recusar no cadastro)", () => {
  assert.ok(/maxLength=\{120\}/.test(lerRepo("src/views/shared/AuthView.tsx")));
  assert.ok(
    lerRepo("src/lib/telefone-br.ts").includes("return novo.slice(0, 15);"),
    "a mascara do cadastro deixou de limitar o telefone a 15 (o banco recusa mais de 20)",
  );
  assert.ok(
    lerRepo("src/views/shared/AuthView.tsx").includes(
      "mascaraTelefoneDoCadastro",
    ),
  );
});

Deno.test("1399940: o rollback tira so o gatilho, com pre-voo antes de apagar, conferencia final e os avisos (perfis ficam; nunca na IKCOUS)", () => {
  assert.ok(
    rollback.includes(
      "DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;",
    ),
  );
  assert.equal((limpo(rollback).match(/\bDROP\b/g) ?? []).length, 1);
  assert.doesNotMatch(
    limpo(rollback),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|CREATE)\b(?!\s*(ON|TO)\b)/i,
  );
  const iPre = rollback.indexOf("DO $preflight_rollback_20261399940000$");
  const iApaga = rollback.indexOf("\nDROP TRIGGER");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261399940000$");
  assert.ok(iPre >= 0 && iPre < iApaga && iApaga < iConf);
  assert.ok(rollback.slice(iPre, iApaga).includes("B1_BASELINE_DIVERGENT"));
  // o cabecalho do rollback avisa o que NAO desfaz e onde nao rodar
  const cab = rollback.slice(0, iPre);
  assert.ok(cab.includes("profiles"));
  assert.ok(cab.includes("raw_app_meta_data"));
  assert.ok(cab.includes("NUNCA RODAR NA IKCOUS"));
});

Deno.test("1399940: o efemero das outras provas deixa o gatilho DESLIGADO e tem raw_user_meta_data; so a prova do gatilho o liga", () => {
  const aplicar = lerRepo("tests/banco/aplicar-migrations.cjs");
  assert.ok(
    aplicar.includes(
      "ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created",
    ),
  );
  // o desligamento vem DEPOIS de aplicar a raiz inteira (a migration cria o gatilho ligado) e depois da sentinela
  assert.ok(
    aplicar.indexOf("DISABLE TRIGGER on_auth_user_created") >
      aplicar.indexOf("sentinela de objetos pós-apply: OK"),
  );
  for (const rel of [
    "tests/banco/provisionar.cjs",
    "scripts/ci/banco/provisionar-efemero.cjs",
  ])
    assert.ok(
      /raw_app_meta_data jsonb NOT NULL DEFAULT '\{\}'::jsonb,\s*raw_user_meta_data jsonb\b/.test(
        lerRepo(rel),
      ),
      `${rel}: o auth.users emulado precisa de raw_user_meta_data`,
    );
  // a prova viva parte de "gatilho ausente" (rollback) e o cria pela propria migration: nao depende do estado do clone
  const viva = lerRepo(
    "tests/banco/o-cadastro-cria-o-perfil-em-toda-loja-viva.cjs",
  );
  assert.ok(
    viva.includes(
      "await q(ROLLBACK); // o clone pode ter nascido com o gatilho",
    ),
  );
});

Deno.test("1399940: publicacao — lote unico (129a/129b), rol fechado de 6 e 3 linhas, consultas so de leitura e sem dado pessoal, workflows, release e prova viva; sem entrada no db-apply (nao ha funcao)", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261399940000"),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, ["20261399940000"]);
  assert.equal(lote[0].consulta, A);
  assert.equal(lote[0].ausenciaConfirmadaPor, B);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(campo in lote[0]), campo);
  const c = lote[0]._comentario;
  for (const frase of [
    "EFEITO PARA QUEM USA",
    "IKCOUS",
    "Savy",
    "revisao Opus",
    "GRANTS",
    "NUNCA rodar na IKCOUS",
    "ATENCAO IKCOUS",
    "FUTURAS",
    "esperado 0 nas duas lojas",
  ])
    assert.ok(c.includes(frase), frase);
  // a Savy ganhou o gatilho a mao em 07/11/2026: nenhum texto pode mais dizer que a 129a sai negativa la
  assert.doesNotMatch(c, /na Savy esperado 1|esperado na Savy/);
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const [nome, linhas] of [
    [A, 6],
    [B, 3],
  ]) {
    const sql = lerRepo(`scripts/publicacao/consultas/${nome}.sql`);
    assert.doesNotMatch(
      limpo(sql),
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    // nenhuma coluna pessoal sai da consulta: so as quatro colunas do rol fechado
    assert.ok(
      sql.includes(
        "SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;",
      ),
    );
    assert.doesNotMatch(limpo(sql), /\b(email|cpf|whatsapp|phone)\b(?!['"])/i);
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
      "run: node tests/banco/rodar-isolado.cjs tests/banco/o-cadastro-cria-o-perfil-em-toda-loja-viva.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "o-cadastro-cria-o-perfil-em-toda-loja-viva.cjs",
    ),
  );
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  assert.equal(new Map(Object.entries(VERIFICACOES)).get(NOME), undefined);
});
