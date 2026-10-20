// @ts-nocheck
// Texto e hashes; comportamento e concorrência ficam na prova viva PG17.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const NOME = "20261246000000_o_lancamento_repetido_nao_duplica.sql";
const ler = (n) =>
  Deno.readTextFileSync(
    new URL(`../supabase/migrations/${n}`, import.meta.url),
  ).replace(/\r/g, "");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const destrutivo = ler(`rollback-manual-destrutivo-${NOME}`);
const anterior = ler("20261199000000_portas_do_painel_exigem_admin_atual.sql");
const funcao = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.fin_lancamento_salvar\(p jsonb\)[\s\S]*?\n\$\$;/,
  )[0];
const corpo = (sql) => funcao(sql).split("AS $$")[1].slice(0, -3);
const md5 = (s) => createHash("md5").update(s).digest("hex");

Deno.test("246: hashes reais e rollback byte a byte; sem redefinição intermediária esquecida", () => {
  assert.equal(md5(corpo(anterior)), "559a13a9d69e02e5048623685cd07514");
  assert.equal(funcao(rollback), funcao(anterior));
  assert(
    migration.includes(
      `('public.fin_lancamento_salvar(jsonb)', '${md5(corpo(anterior))}', '${md5(corpo(migration))}')`,
    ),
  );
  assert(rollback.includes(md5(corpo(migration))));
  for (const e of Deno.readDirSync(
    new URL("../supabase/migrations/", import.meta.url),
  )) {
    if (
      !/^\d{14}_.*\.sql$/.test(e.name) ||
      e.name <= "20261199999999" ||
      e.name >= NOME
    )
      continue;
    assert(
      !/create (or replace )?function public\.fin_lancamento_salvar ?\(/i.test(
        ler(e.name).replace(/\s+/g, " "),
      ),
      e.name,
    );
  }
});

Deno.test("246: só os três acréscimos necessários; edição e caminho sem chave preservados", () => {
  const novo = corpo(migration)
    .replace(
      / {2}-- Tentativa de criação \(20261246000000\)\.[\s\S]*? {2}v_ids_gravados uuid\[\];\n/,
      "",
    )
    .replace(
      / {2}-- Reserva a tentativa ANTES[\s\S]*? {2}-- Fim da reserva da tentativa\.\n\n/,
      "",
    )
    .replace(
      / {2}-- Guarda o resultado na MESMA transação[\s\S]*? {2}-- Fim do resultado da tentativa\.\n/,
      "",
    );
  assert.equal(novo, corpo(anterior));
  const b = corpo(migration);
  assert(b.indexOf("public.is_admin()") < b.indexOf("public.is_admin_atual()"));
  assert(
    b.indexOf("public.is_admin_atual()") <
      b.indexOf("INSERT INTO public.fin_lancamento_tentativas"),
  );
  assert(
    b.indexOf("RETURN jsonb_build_object('ids', jsonb_build_array(v_id))") <
      b.indexOf("v_chave :="),
  );
  assert(b.includes("md5((p - 'chave_idempotencia')::text)"));
  assert(b.includes("ON CONFLICT (chave) DO NOTHING"));
  assert(b.includes("IF v_hash_gravado IS DISTINCT FROM v_conteudo_hash THEN"));
  assert(
    b.indexOf("INSERT INTO public.fin_lancamento_tentativas") <
      b.indexOf("FOR i IN 1..v_parcelas LOOP"),
  );
});

Deno.test("246: pré-voo, tabela privada e transação do aplicador", () => {
  for (const sql of [migration, rollback, destrutivo]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
    assert(sql.includes("SET LOCAL lock_timeout"));
  }
  for (const trecho of [
    "B1_BASELINE_DIVERGENT",
    "pg_get_function_arguments",
    "p.prosecdef",
    "p.proconfig",
    "aclexplode",
    "pg_policy",
    "pg_constraint",
  ])
    assert(migration.includes(trecho), trecho);
  assert(
    migration.includes(
      "CREATE TABLE IF NOT EXISTS public.fin_lancamento_tentativas",
    ),
  );
  assert(
    migration.includes(
      "ALTER TABLE public.fin_lancamento_tentativas ENABLE ROW LEVEL SECURITY",
    ),
  );
  assert(
    migration.includes(
      "REVOKE ALL ON TABLE public.fin_lancamento_tentativas FROM PUBLIC, anon, authenticated, service_role",
    ),
  );
  assert(!/CREATE POLICY/i.test(migration));
  assert(!/DROP TABLE/i.test(rollback));
  assert(destrutivo.includes("app.confirmo_apagar_tentativas_financeiras"));
  assert(destrutivo.includes("p.prosrc LIKE '%fin_lancamento_tentativas%'"));
});

Deno.test("246: CI, cadeia da 99 e portão aceitam somente o hash sucessor conhecido", () => {
  const arquivo = (n) =>
    Deno.readTextFileSync(new URL(`../${n}`, import.meta.url));
  assert(
    arquivo(".github/workflows/rpc-ci.yml").includes(
      "node tests/banco/rodar-isolado.cjs tests/banco/lancamento-idempotente-viva.cjs",
    ),
  );
  assert(arquivo("tests/banco/sucessoras-da-99.cjs").includes(NOME));
  assert(
    arquivo(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
    ).includes(
      `('fin_lancamento_salvar', '${md5(corpo(migration))}', '20261246000000')`,
    ),
  );
});

Deno.test("246: lote 49 tem rols fechados, hashes reais, menu e veredito sem linha faltante", async () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO, lerCanais, decidirLote } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const a = "49a-conferir-lancamento-idempotente-aplicado";
  const b = "49b-antes-lancamento-idempotente-base-vigente";
  const arquivo = (n) =>
    Deno.readTextFileSync(new URL(`../${n}`, import.meta.url));
  const lote = lerCanais().provasDeObjetos.find((p) => p.consulta === a);
  assert.deepEqual(lote.versoes, ["20261246000000"]);
  assert.equal(lote.ausenciaConfirmadaPor, b);
  assert.equal(lote.backfillLedger, undefined);
  assert.equal(lote.nuncaAplicar, undefined);
  const depois = arquivo(`scripts/publicacao/consultas/${a}.sql`);
  const antes = arquivo(`scripts/publicacao/consultas/${b}.sql`);
  assert(depois.includes(md5(corpo(migration))));
  assert(antes.includes(md5(corpo(anterior))));
  for (const [nome, sql] of [
    [a, depois],
    [b, antes],
  ]) {
    assert(CONSULTAS_DE_ROL_FECHADO.has(nome));
    const rol = new Map(Object.entries(conf.ROL_FECHADO_POR_CONSULTA)).get(
      nome,
    );
    assert.equal(rol.length, 6);
    assert.equal(conf.contarStatements(sql), 1);
    const itens = [...sql.matchAll(/SELECT '([^']+)', 'sim'/g)].map(
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
  }
  const aplicar = arquivo("scripts/db-apply.cjs");
  assert(aplicar.includes(`"${NOME}": [`));
  assert(
    aplicar.includes('texto: "ON CONFLICT (chave) DO NOTHING;", vezes: 1'),
  );
  const prova = (estado) => ({
    estado,
    motivo: "fixture",
    run: { createdAt: "2026-10-16T18:00:00Z" },
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
  assert.equal(decidir(lote.versoes, "POSITIVA").acao, "PARAR"); // ledger não é backfill automático
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
