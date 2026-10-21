// @ts-nocheck
// Contrato de texto; a prova de comportamento fica em tests/banco/pdv-total-conferido-viva.cjs.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createHash } = require("node:crypto");
const {
  removerRuido,
  detectarTransacaoExplicita,
} = require("../scripts/db-prove-rollback.cjs");
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
const dir = new URL("../supabase/migrations/", import.meta.url);
const nome = "20261280000000_o_balcao_registra_so_o_total_conferido.sql";
const base =
  "20261249000000_o_motivo_do_desconto_do_balcao_nao_chega_a_cliente.sql";
const ler = (n) => Deno.readTextFileSync(new URL(n, dir)).replace(/\r/g, "");
const funcao = (s) =>
  s.match(
    /^CREATE OR REPLACE FUNCTION public\.registrar_venda_presencial\([\s\S]*?\n\$\$;/m,
  )?.[0];
const arquivos = [...Deno.readDirSync(dir)]
  .map((e) => e.name)
  .filter((n) => /^\d{14}_.*\.sql$/.test(n))
  .sort();
const vigente = arquivos
  .map((n) => ({ nome: n, funcao: funcao(ler(n)) }))
  .filter((f) => f.funcao)
  .at(-1);

Deno.test("balcão: assinatura vigente aceita total esperado opcional e recusa antes de qualquer escrita", () => {
  assert.match(vigente.funcao, /p_total_esperado numeric DEFAULT NULL/);
  const f = vigente.funcao;
  const guarda = f.indexOf("abs(v_total - p_total_esperado) > 0.01");
  assert(guarda > f.indexOf("v_total := v_subtotal - v_desconto"));
  assert(guarda > f.indexOf("v_ja_existia := true"));
  assert(guarda < f.indexOf("INSERT INTO public.marketplace_orders"));
  assert.match(f, /ERRCODE='PDV01'/);
  assert.match(
    f,
    /DETAIL=jsonb_build_object\('total', v_total, 'itens', v_itens_conferidos\)::text/,
  );
  assert.match(f, /FOR NO KEY UPDATE OF v;/);
  assert.doesNotMatch(f, /FOR NO KEY UPDATE OF v, p/);
  const segundo = f.slice(f.indexOf("-- (8) SEGUNDO LAÇO"));
  assert.match(
    segundo,
    /v_db_price := \(v_itens_conferidos->v_indice_item->>'price'\)::numeric/,
  );
  assert.match(segundo, /v_indice_item := v_indice_item \+ 1/);
  assert.doesNotMatch(
    segundo,
    /SELECT COALESCE\(v\.price_override|SELECT p\.preco_venda/,
  );
});

Deno.test("balcão: consultas ancestrais aceitam a assinatura nova só com seu hash exato", () => {
  const f = vigente.funcao;
  const corpo = f.slice(f.indexOf("AS $$") + 5, -3);
  const hash = createHash("md5").update(corpo).digest("hex");
  for (const consulta of [
    "36a-conferir-venda-repetida-do-balcao-aplicado.sql",
    "52a-conferir-motivo-do-balcao-privado-aplicado.sql",
  ]) {
    const sql = Deno.readTextFileSync(
      new URL(`../scripts/publicacao/consultas/${consulta}`, import.meta.url),
    );
    assert(
      sql.includes(
        "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid,numeric)",
      ),
      consulta,
    );
    assert(
      sql.includes(
        `p.pronargs = 9 AND md5(replace(p.prosrc, chr(13), '')) = '${hash}'`,
      ),
      consulta,
    );
  }
});

const A57 = "57a-conferir-total-do-balcao-aplicado";
const B57 = "57b-antes-total-do-balcao-base-vigente";
const lerRel = (rel) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );

Deno.test("balcão: lote da 280 existe, sem backfill, e o aplicador confere a guarda nova", () => {
  const canais = JSON.parse(lerRel("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261280000000"),
  );
  assert.equal(
    lotes.length,
    1,
    "a 280 precisa de prova própria antes do front",
  );
  assert.equal(lotes[0].consulta, A57);
  assert.equal(lotes[0].ausenciaConfirmadaPor, B57);
  assert.equal(lotes[0].backfillLedger, undefined);
  assert.equal(lotes[0].nuncaAplicar, undefined);
  assert.equal(lotes[0].soNosRefs, undefined);
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = Object.entries(VERIFICACOES).find(
    ([arquivo]) => arquivo === nome,
  )?.[1];
  assert(entrada, "a 280 não pode sair PULADA");
  const marcadores = entrada[0].esperado.map((m) => m.texto ?? m);
  assert(marcadores.some((m) => m.includes("ERRCODE='PDV01'")));
});

Deno.test("balcão: provas antes/depois têm hash exato, assinatura sem ambiguidade e rol fechado", async () => {
  const { ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado, contarStatements } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  for (const [consulta, arquivo, args, defaults] of [
    [A57, nome, 9, 7],
    [B57, base, 8, 6],
  ]) {
    const sql = lerRel(`scripts/publicacao/consultas/${consulta}.sql`);
    const corpo = funcao(ler(arquivo)).split("AS $$")[1].slice(0, -3);
    const hash = createHash("md5").update(corpo).digest("hex");
    assert(sql.includes(hash), consulta);
    assert(
      sql.includes(`p.pronargs = ${args} AND p.pronargdefaults = ${defaults}`),
      consulta,
    );
    assert(sql.includes("sobrecargas"), consulta);
    assert(
      sql.includes(
        args === 9
          ? "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid,numeric)"
          : "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)",
      ),
      consulta,
    );
    assert.equal(contarStatements(sql), 1);
    const itens = [...sql.matchAll(/\bSELECT '([^']+)'/g)].map((m) => m[1]);
    const rol = Object.entries(ROL_FECHADO_POR_CONSULTA).find(
      ([nome]) => nome === consulta,
    )?.[1];
    assert(rol, consulta);
    assert.equal(rol.length, 11);
    assert.deepEqual([...rol].sort(), [...itens].sort());
    assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    assert(
      lerRel(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${consulta}\n`,
      ),
    );
    const linhas = rol.map((item) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(estruturaDoRolFechado(linhas, rol), null);
    for (const invalida of [
      linhas.slice(1),
      [...linhas, linhas[0]],
      [...linhas, { ...linhas[0], item: "desconhecido" }],
    ]) {
      assert.notEqual(estruturaDoRolFechado(invalida, rol), null);
    }
  }
});

Deno.test("balcão: migration e rollback não encerram a transação do aplicador e devolvem o corpo anterior exato", () => {
  assert.equal(vigente.nome, nome);
  const m = ler(nome);
  const r = ler(`rollback-manual-${nome}`);
  assert.equal(
    avaliarFase0({ sqlMigration: m, sqlRollback: r, temRollback: true })
      .recusado,
    false,
  );
  for (const sql of [m, r]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  }
  assert.equal(funcao(r), funcao(ler(base)));
  const comentado = m
    .split("-- INICIO DO ROLLBACK\n")[1]
    .split("-- FIM DO ROLLBACK")[0]
    .split("\n")
    .filter((l) => l.startsWith("--"))
    .map((l) => (l === "--" ? "" : l.slice(3)))
    .join("\n");
  assert.equal(comentado, r.trimEnd());
  assert.match(
    m,
    /DROP FUNCTION IF EXISTS public\.registrar_venda_presencial\(jsonb,text,uuid,text,text,numeric,text,uuid\)/,
  );
  assert.match(
    m,
    /REVOKE ALL ON FUNCTION public\.registrar_venda_presencial\(jsonb,text,uuid,text,text,numeric,text,uuid,numeric\) FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    m,
    /GRANT EXECUTE ON FUNCTION public\.registrar_venda_presencial\(jsonb,text,uuid,text,text,numeric,text,uuid,numeric\) TO authenticated/,
  );
});
