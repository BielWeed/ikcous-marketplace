// @ts-nocheck
// Texto e fiação do lote 51 (20261248000000); o comportamento (papéis reais, ACL, mutantes) fica na
// prova viva PG17: tests/banco/notes-do-pedido-fechada-viva.cjs.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const NOME =
  "20261248000000_a_coluna_notes_do_pedido_fecha_para_gravacao_do_painel.sql";
const ler = (n) =>
  Deno.readTextFileSync(
    new URL(`../supabase/migrations/${n}`, import.meta.url),
  ).replace(/\r/g, "");
const arquivo = (n) =>
  Deno.readTextFileSync(new URL(`../${n}`, import.meta.url)).replace(/\r/g, "");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
// Só tira as linhas de comentário (removerRuido também apaga o texto entre aspas, que aqui se confere).
const sql = (s) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
// As instruções de nível superior, sem os blocos DO (pré-voo e conferência), uma por `;`.
const fora = (s) =>
  sql(s)
    .replace(/DO \$(\w+)\$[\s\S]*?END \$\1\$;/g, "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);

Deno.test("248: sem controle de transação; trava de tempo; o aplicador abre a transação", () => {
  for (const s of [migration, rollback]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(s)).achados, []);
    assert(s.includes("SET LOCAL lock_timeout = '5s'"));
    assert(s.includes("SET LOCAL statement_timeout = '30s'"));
  }
  assert(!/^\s*(BEGIN|COMMIT)\s*;/im.test(sql(migration)));
});

Deno.test("248: fora dos blocos DO a migration só tira o UPDATE da coluna notes (nunca REVOKE de tabela)", () => {
  const stmts = fora(migration);
  assert.deepEqual(stmts, [
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL statement_timeout = '30s'",
    "REVOKE UPDATE (notes) ON TABLE public.marketplace_orders FROM authenticated",
    "REVOKE UPDATE (notes) ON TABLE public.marketplace_orders FROM anon",
    "REVOKE UPDATE (notes) ON TABLE public.marketplace_orders FROM PUBLIC",
  ]);
  const m = sql(migration);
  // Aditiva: não lê, copia, atualiza nem apaga linha; não cria nem troca objeto; não toca tracking_code.
  assert(!/\bUPDATE\s+public\./i.test(m));
  assert(
    !/\b(DELETE|INSERT|DROP|CREATE|ALTER|GRANT|TRUNCATE)\b/i.test(
      m.replace(/RAISE EXCEPTION '[^']*'/g, ""),
    ),
  );
  assert(
    !/REVOKE\s+UPDATE\s+ON/i.test(m),
    "REVOKE de tabela apagaria o grant de coluna do rastreio",
  );
  assert(!/REVOKE[^;]*tracking_code/i.test(m));
});

Deno.test("248: pré-voo antes de qualquer escrita; conferência final depois do REVOKE aborta nos três casos", () => {
  const antes = migration.slice(
    migration.indexOf("DO $preflight_20261248$"),
    migration.indexOf("REVOKE UPDATE (notes) ON TABLE"),
  );
  for (const trecho of [
    "B1_BASELINE_DIVERGENT",
    "has_table_privilege('anon'",
    "has_table_privilege('authenticated'",
    "TABELA inteira",
    "aclexplode",
    "g.grantee IN (0, v_anon)",
    "is_grantable",
    "'notes,tracking_code'",
    "service_role",
  ])
    assert(antes.includes(trecho), trecho);
  assert(
    !/^\s*(REVOKE|GRANT|INSERT|DELETE|CREATE|DROP|ALTER|TRUNCATE|UPDATE\s+\w)/im.test(
      sql(antes),
    ),
    "o pré-voo escreve",
  );
  const depois = migration.slice(
    migration.indexOf("DO $conferencia_20261248$"),
  );
  assert(
    migration.indexOf("DO $conferencia_20261248$") >
      migration.lastIndexOf("REVOKE UPDATE (notes) ON TABLE"),
  );
  for (const trecho of [
    "has_column_privilege('authenticated', v_t, 'notes', 'UPDATE')",
    "has_column_privilege('anon', v_t, 'notes', 'UPDATE')",
    "has_column_privilege('authenticated', v_t, 'tracking_code', 'UPDATE')",
    "has_column_privilege('service_role', v_t, 'notes', 'UPDATE')",
    "perdeu o UPDATE em marketplace_orders.tracking_code",
    "v_colunas IS DISTINCT FROM 'tracking_code'",
  ])
    assert(depois.includes(trecho), trecho);
  assert.equal((depois.match(/RAISE EXCEPTION/g) || []).length >= 6, true);
});

Deno.test("248: rollback só reabre a coluna notes (GRANT de coluna), com pré-voo e conferência", () => {
  assert.deepEqual(fora(rollback), [
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL statement_timeout = '30s'",
    "GRANT UPDATE (notes) ON TABLE public.marketplace_orders TO authenticated",
  ]);
  assert(rollback.includes("B1_BASELINE_DIVERGENT"));
  assert(rollback.includes("conferencia rollback 20261248"));
  assert(rollback.includes("REABRE A PORTA"));
  assert(
    !/\b(REVOKE|DROP|DELETE)\b/i.test(
      sql(rollback).replace(/RAISE EXCEPTION '[^']*'/g, ""),
    ),
  );
});

Deno.test("248: o cabeçalho diz o que quebra, o que acontece com os dados e a ordem", () => {
  for (const trecho of [
    "QUEM QUEBRA",
    "painel ANTIGO",
    "DADOS EXISTENTES",
    "nenhuma linha é lida, copiada, reescrita ou apagada",
    "IDEMPOTÊNCIA",
    "sem BEGIN/COMMIT de nível superior",
    "ORDEM: depois do front novo",
    "ROLLBACK",
  ])
    assert(migration.replace(/\s+/g, " ").includes(trecho), trecho);
});

Deno.test("248: ninguém mais usa o número e nenhuma outra migration tira o UPDATE de notes", () => {
  for (const e of Deno.readDirSync(
    new URL("../supabase/migrations/", import.meta.url),
  )) {
    if (!/^\d{14}_.*\.sql$/.test(e.name) || e.name === NOME) continue;
    assert(!e.name.startsWith("20261248"), e.name);
    assert(
      !/REVOKE\s+UPDATE\s*\(\s*notes\s*\)/i.test(sql(ler(e.name))),
      `${e.name} já tira o UPDATE de notes`,
    );
  }
});

Deno.test("248: a prova viva roda no CI e nenhuma outra prova do banco depende do authenticated gravar notes", () => {
  assert(
    arquivo(".github/workflows/rpc-ci.yml").includes(
      "node tests/banco/rodar-isolado.cjs tests/banco/notes-do-pedido-fechada-viva.cjs",
    ),
  );
  // O painel antigo gravava notes; as provas que simulam o authenticated não podem mais usar notes como
  // "uma coluna qualquer" para o UPDATE (usam tracking_code, que segue aberta).
  for (const e of Deno.readDirSync(new URL("./banco/", import.meta.url))) {
    if (
      !e.name.endsWith(".cjs") ||
      e.name === "notes-do-pedido-fechada-viva.cjs"
    )
      continue;
    const t = arquivo(`tests/banco/${e.name}`);
    assert(
      !/UPDATE public\.marketplace_orders SET notes = notes WHERE user_id IS DISTINCT FROM auth\.uid\(\)/.test(
        t,
      ),
      `${e.name} ainda atualiza notes como authenticated`,
    );
  }
});

Deno.test("248: lote 51 tem rols fechados, itens iguais ao SQL, menu e veredito sem linha faltante", async () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO, lerCanais, decidirLote } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const a = "51a-conferir-notes-do-pedido-fechada-aplicado";
  const b = "51b-antes-notes-do-pedido-base-vigente";
  const lote = lerCanais().provasDeObjetos.find((p) => p.consulta === a);
  assert.deepEqual(lote.versoes, ["20261248000000"]);
  assert.equal(lote.ausenciaConfirmadaPor, b);
  assert.equal(lote.backfillLedger, undefined);
  assert.equal(lote.nuncaAplicar, undefined);
  for (const [nome, rol] of [
    [a, conf.ROL_DA_51A],
    [b, conf.ROL_DA_51B],
  ]) {
    const sqlDaConsulta = arquivo(`scripts/publicacao/consultas/${nome}.sql`);
    assert(CONSULTAS_DE_ROL_FECHADO.has(nome));
    assert.equal(
      new Map(Object.entries(conf.ROL_FECHADO_POR_CONSULTA)).get(nome),
      rol,
    );
    assert.equal(rol.length, 6);
    assert.equal(conf.contarStatements(sqlDaConsulta), 1);
    const itens = [...sqlDaConsulta.matchAll(/SELECT '([^']+)', 'sim'/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(itens, rol);
    const rows = rol.map((item) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(conf.estruturaDoRolFechado(rows, rol), null);
    assert.notEqual(conf.estruturaDoRolFechado(rows.slice(1), rol), null);
    assert(
      arquivo(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nome}`,
      ),
    );
    assert(
      arquivo(".github/workflows/rpc-ci.yml").includes(
        `"scripts/publicacao/consultas/${nome}.sql"`,
      ),
    );
    // só catálogo: nenhum pedido é lido
    assert(!/FROM\s+public\.marketplace_orders\b/i.test(sqlDaConsulta));
    assert(
      !/\b(INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/.test(
        sql(sqlDaConsulta).replace(/'[^']*'/g, ""),
      ),
    );
  }
  assert(
    arquivo(
      "scripts/publicacao/consultas/51b-antes-notes-do-pedido-base-vigente.sql",
    ).includes("NAO prova"),
  );
  const prova = (estado) => ({
    estado,
    motivo: "fixture",
    run: { createdAt: "2026-10-17T18:00:00Z" },
  });
  const decidir = (faltam, p, d = new Map()) =>
    decidirLote({
      lote,
      faltam,
      exigeProva: true,
      prova: prova(p),
      diagnostico: d,
    });
  assert.equal(decidir(lote.versoes, "SEM_EVIDENCIA").acao, "CONFERIR");
  assert.equal(decidir(lote.versoes, "POSITIVA").acao, "PARAR");
  assert.equal(decidir(lote.versoes, "NEGATIVA").acao, "CONFERIR");
  assert.equal(
    decidir(lote.versoes, "NEGATIVA", new Map([[b, prova("POSITIVA")]])).acao,
    "APLICAR",
  );
  assert.equal(
    decidir(lote.versoes, "NEGATIVA", new Map([[b, prova("NEGATIVA")]])).acao,
    "PARAR",
  );
  assert.equal(decidir([], "POSITIVA").acao, "NADA");
});
