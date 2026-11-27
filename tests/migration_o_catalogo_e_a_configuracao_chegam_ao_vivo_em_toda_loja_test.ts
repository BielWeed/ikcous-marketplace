// @ts-nocheck
// O CATALOGO E A CONFIGURACAO CHEGAM AO VIVO EM TODA LOJA — prova offline do par 20261610000000 + rollback. O COMPORTAMENTO (as 11
// entram na loja nova, a IKCOUS fica identica, pre-voo, rollback com confirmacao, politicas de SELECT, trava, consultas 197a/197b) e'
// provado no Postgres efemero por tests/banco/o-catalogo-chega-ao-vivo-em-toda-loja-viva.cjs. Aqui fica o que se prova so lendo o texto:
// so ADD TABLE das 11 (nenhuma outra tabela, nenhum DROP, replica identity intocada), o rollback so com confirmacao e so as 11, e a
// fiacao de publicacao (lote, menu, rpc-ci, release).
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const VERSAO = "20261610000000";
const NOME = `${VERSAO}_o_catalogo_e_a_configuracao_chegam_ao_vivo_em_toda_loja.sql`;
const A = "197a-conferir-o-catalogo-chega-ao-vivo-aplicado";
const B = "197b-antes-o-catalogo-chega-ao-vivo-ausente";
const PROVA_VIVA = "tests/banco/o-catalogo-chega-ao-vivo-em-toda-loja-viva.cjs";
const ONZE = [
  "answers",
  "banners",
  "cart_items",
  "categorias",
  "coupons",
  "favorites",
  "product_variants",
  "produtos",
  "questions",
  "reviews",
  "store_config",
];
const lerBruto = (rel) => Deno.readTextFileSync(new URL(rel, DIR));
const migration = lerBruto(`supabase/migrations/${NOME}`);
const rollback = lerBruto(`supabase/migrations/rollback-manual-${NOME}`);
/** O SQL sem comentarios de linha, mas COM o corpo dos blocos DO (os ALTER moram dentro de um). */
const codigo = (s) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");
const arrayDas11 = (s) => {
  const m = codigo(s).match(/v_onze CONSTANT text\[\] := ARRAY\[([^\]]+)\]/);
  assert.ok(m, "o array das 11 sumiu");
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

Deno.test("1610: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT; LF; lock_timeout antes do bloco", () => {
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
  for (const [sql, bloco] of [
    [migration, "DO $publicacao_20261610000000$"],
    [rollback, "DO $rollback_20261610000000$"],
  ]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
    assert.ok(!sql.includes("\r"), "texto LF");
    const iLock = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    assert.ok(iLock >= 0 && iLock < sql.indexOf(bloco));
    assert.equal(sql.split(bloco).length - 1, 1);
  }
});

Deno.test("1610: so ADD TABLE das 11, so se a publicacao existir e a tabela nao estiver nela; nada de DROP, replica identity ou outra tabela", () => {
  assert.deepEqual(arrayDas11(migration), ONZE);
  const c = codigo(migration);
  assert.equal(
    [...c.matchAll(/ALTER PUBLICATION/g)].length,
    1,
    "um ALTER PUBLICATION so",
  );
  assert.ok(
    c.includes(
      "EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tabela);",
    ),
  );
  for (const proibido of [
    /\bDROP\b/i,
    /REPLICA IDENTITY/i,
    /\bALTER TABLE\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bPOLICY\b/i,
    /\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|public\.)/i,
    /devolucoes|fornecedores|internal_notes|livro_de_registro|item_custo|tentativas/,
  ])
    assert.ok(!proibido.test(c), `a migration nao pode ter ${proibido}`);
  // so se a publicacao existir; o IF NOT EXISTS em pg_publication_tables antes do ADD
  const iPub = c.indexOf(
    "IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN",
  );
  const iSe = c.indexOf(
    "IF NOT EXISTS ( SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_tabela ) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE",
  );
  assert.ok(iPub >= 0 && iSe > iPub, "guardas fora de ordem ou ausentes");
  // o pre-voo inteiro (as 3 recusas) vem ANTES de qualquer ADD, e o pos-voo depois
  const iAdd = c.indexOf("ADD TABLE");
  for (const recusa of [
    "nao existe (ou nao e tabela comum)",
    "esta sem RLS",
    "sem identidade de replicacao utilizavel",
  ]) {
    const i = c.indexOf(recusa);
    assert.ok(i > iPub && i < iAdd, `pre-voo depois do ADD: ${recusa}`);
  }
  assert.ok(c.indexOf("B2_POSVOO_DIVERGENTE") > iAdd);
});

Deno.test("1610: o cabecalho cita a politica de SELECT de cada uma das 11, o DELETE que so leva a chave e a IKCOUS no-op", () => {
  const cab = migration.slice(0, migration.indexOf("SET LOCAL lock_timeout"));
  // a linha de cada tabela na tabela de RLS: "-- <tabela> <politica>_(select|all)_policy ..."
  const linhas = cab.split("\n").map((l) => l.replace(/\s+/g, " "));
  for (const t of ONZE)
    assert.ok(
      linhas.some(
        (l) =>
          l.startsWith(`-- ${t} `) &&
          /^-- [a-z_]+ [a-z_]+_(select|all)_policy /.test(l),
      ),
      `a linha de ${t} na tabela de RLS`,
    );
  for (const trecho of [
    "ninguem passa a receber uma linha que nao poderia ler por SELECT",
    "o DELETE nao passa pela",
    "SO a chave primaria",
    "IKCOUS (as 14 ja la): NO-OP",
    "cupom exclusivo NAO vaza",
    "SEM a coluna custo",
    "SEM BEGIN/COMMIT",
  ])
    assert.ok(cab.includes(trecho), trecho);
});

Deno.test("1610: o rollback exige a confirmacao SET LOCAL antes de tirar, tira so as 11 e nunca as 3 da 20261061", () => {
  assert.deepEqual(arrayDas11(rollback), ONZE);
  const c = codigo(rollback);
  const iConfirma = c.indexOf(
    "IF COALESCE(current_setting('app.confirmo_tirar_do_realtime_20261610', true), '') <> 'TIRAR' THEN RAISE EXCEPTION 'REALTIME_SO_LOJA_QUE_NAO_TINHA:",
  );
  const iDrop = c.indexOf(
    "EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', v_tabela);",
  );
  assert.ok(
    iConfirma >= 0 && iDrop > iConfirma,
    "a confirmacao vem antes do DROP",
  );
  assert.ok(c.indexOf("puballtables") < iDrop, "FOR ALL TABLES recusa antes");
  assert.equal([...c.matchAll(/ALTER PUBLICATION/g)].length, 1);
  for (const tres of [
    "notificacoes",
    "marketplace_orders",
    "marketplace_order_items",
  ])
    assert.ok(!c.includes(tres), `o rollback nao toca ${tres}`);
  assert.ok(
    !/REPLICA IDENTITY|\bALTER TABLE\b|DROP TABLE public\.(?!%I)/.test(c),
  );
  assert.ok(rollback.includes("NUNCA NA IKCOUS"));
});

Deno.test("1610: publicacao — lote unico (197a/197b) de apply normal por ultimo, rol fechado, workflows, release e prova viva", async () => {
  const canais = JSON.parse(lerBruto("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    (p.versoes ?? []).includes(VERSAO),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, [VERSAO]);
  assert.equal(lote[0].consulta, A);
  assert.equal(lote[0].ausenciaConfirmadaPor, B);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(campo in lote[0]), campo);
  for (const trecho of [
    "aditiva pela carta branca",
    "revisao Opus",
    "ATENCAO IKCOUS",
    "DECISAO DO DONO",
    "NUNCA na IKCOUS",
    PROVA_VIVA,
  ])
    assert.ok(lote[0]._comentario.includes(trecho), trecho);
  assert.equal(canais.provasDeObjetos.at(-1).consulta, A, "o lote vai no fim");

  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA));
  assert.equal(rol.get(A).length, 6);
  assert.equal(rol.get(B).length, 6);
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    new URL("scripts/frota/publicar-release.mjs", DIR).href
  );
  const menu = lerBruto(".github/workflows/conferir-banco-da-loja.yml").replace(
    /\r/g,
    "",
  );
  const rpc = lerBruto(".github/workflows/rpc-ci.yml").replace(/\r/g, "");
  for (const nome of [A, B]) {
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(nome), nome);
    assert.ok(menu.includes(`          - ${nome}\n`), nome);
    assert.equal(
      rpc.split(`"scripts/publicacao/consultas/${nome}.sql"`).length - 1,
      2,
      `${nome}: nas duas listas de caminhos do rpc-ci`,
    );
    const sql = lerBruto(`scripts/publicacao/consultas/${nome}.sql`);
    const estrutura = removerRuido(sql).replace(/'[^']*'/g, "''");
    assert.ok(/^\s*WITH\b/i.test(estrutura), `${nome} comeca por WITH`);
    assert.ok(
      !/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT|INTO|LOCK|EXECUTE)\b/i.test(
        estrutura,
      ),
      `${nome}: palavra de escrita fora de comentario/literal`,
    );
    // so catalogo: nenhuma tabela de public e' lida
    assert.ok(
      !/\b(FROM|JOIN)\s+public\./i.test(estrutura),
      `${nome} le tabela`,
    );
    for (const t of ONZE) assert.ok(sql.includes(`('${t}')`), `${nome}: ${t}`);
  }
  assert.ok(
    rpc.includes(
      `        run: node tests/banco/rodar-isolado.cjs ${PROVA_VIVA}\n`,
    ),
    "a prova viva roda num clone proprio no rpc-ci",
  );
});
