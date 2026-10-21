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
  assert.match(f, /FOR NO KEY UPDATE OF v, p/);
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
