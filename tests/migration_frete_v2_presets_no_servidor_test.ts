// @ts-nocheck
// A REGRA DO FRETE GRÁTIS MORA NO SERVIDOR — prova offline do par
// 20261081000000 + rollback (emenda FRETE V2, frente B do dossiê
// frete-v2-0309, decisão da orquestração 03/09).
//
// A RPC do pedido (v23/v24) continuava na regra ANTIGA (item marcado zera
// incondicional + trava de login no limite de valor) enquanto o front passou
// a obedecer os presets exclusivos. Esta migration porta o MESMO switch:
//   < 0 = por_produto (marcação do BANCO, produtos.frete_gratis)
//   = 0.01 = sempre | > 0 = acima_de_valor SEM login | 0/NULL = desligado.
//
// A prova mais forte daqui é a de CORPO VERBATIM (teste 3): a migration é
// byte a byte o corpo executável da 20261040000000 com SÓ a troca do bloco
// do limiar, repetida nas duas funções. Qualquer OUTRA mudança de corpo que
// entre por aqui quebra a comparação — porque CREATE OR REPLACE substitui o
// corpo INTEIRO, e uma redação descuidada desfaz guarda de dinheiro em
// silêncio (alerta do cabeçalho da 20260951).
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261081000000_a_regra_do_frete_gratis_mora_no_servidor.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;
const VIVA_PATH = `${DIR}../supabase/migrations/20261040000000_a_idempotencia_insere_a_chave.sql`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);
const viva = Deno.readTextFileSync(VIVA_PATH);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

// 🔴 Asserções BLOCO AMARRADO (padrão da casa): a condição E a consequência,
// na mesma string — e nas DUAS funções (v23 e v24), porque consertar uma só
// deixa metade do caminho do dinheiro aberto (lição da 20260951000000).
const norm = (s: string) => s.replace(/\s+/g, " ");
const migrationN = norm(migration);
const vezesNoCorpo = (agulha: string) =>
  migrationN.split(norm(agulha)).length - 1;

Deno.test("por_produto no servidor: so item marcado do BANCO zera o frete", () => {
  const bloco =
    "IF (v_free_shipping_min < 0 AND v_has_free_shipping_item = true) OR v_free_shipping_min = 0.01";
  assertEquals(vezesNoCorpo(bloco), 2, "bloco amarrado deve existir nas v23 e v24");
});

Deno.test("sempre no servidor: sentinela 0.01 zera o frete", () => {
  const bloco =
    "OR v_free_shipping_min = 0.01 OR (v_free_shipping_min > 0 AND v_calculated_subtotal >= v_free_shipping_min)";
  assertEquals(vezesNoCorpo(bloco), 2, "bloco amarrado deve existir nas v23 e v24");
});

Deno.test("a trava de login do limite de valor MORREU — e o NULL é desligado, não grátis", () => {
  // A regra antiga amarrava o limite ao login; nenhum ramo novo pode
  // reaparecer com ela (2 funções x 1 = 0 ocorrências no corpo novo).
  assertEquals(
    vezesNoCorpo(
      "v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min",
    ),
    0,
  );
  // NULL de free_shipping_min cai em 0 (desligado) — o 999999 do LIMIAR (que
  // tornava o NULL um "acima de valor inatingível") não volta. (Outros
  // "999999" legítimos existem no corpo — a formatação FM999999999990.00 do
  // mínimo do cupom —, por isso a agulha é a expressão inteira do limiar.)
  assertEquals(
    vezesNoCorpo(
      "v_free_shipping_min := COALESCE(v_store_config.free_shipping_min, 0)",
    ),
    2,
  );
  assertEquals(
    vezesNoCorpo(
      "COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999)",
    ),
    0,
  );
});

Deno.test("o rollback restaura a regra antiga verbatim (com a trava de login)", () => {
  const rollbackN = norm(rollback);
  const blocoAntigo =
    "IF v_has_free_shipping_item = true OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min) THEN v_shipping_validated := 0";
  assertEquals(
    rollbackN.split(norm(blocoAntigo)).length - 1,
    2,
    "o rollback deve ter o bloco antigo nas v23 e v24",
  );
});

Deno.test("o corpo da migration é o da 20261040000000 com SÓ a troca do limiar", () => {
  // Recomputa a transformação documentada e compara BYTE A BYTE.
  const linhas = viva.split("\n");
  const inicio = linhas.findIndex((l) =>
    l.startsWith("DROP FUNCTION IF EXISTS public.create_marketplace_order_v23"),
  );
  assert(inicio >= 0, "corpo executável da viva não achado");
  const executavel = linhas.slice(inicio).join("\n");

  const antigo = [
    "    v_free_shipping_min := COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999);",
    "",
    "    IF v_has_free_shipping_item = true",
    "       OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)",
    "    THEN",
    "        v_shipping_validated := 0;",
  ].join("\n");

  const novo = [
    "    -- FRETE V2 (20261081000000): a regra de frete grátis passa a ser a MESMA",
    "    -- dos presets do front (src/lib/presets-de-frete-gratis.ts) — modelo",
    "    -- EXCLUSIVO: a estratégia gravada em free_shipping_min é a única que",
    "    -- vale. A marcação de item grátis vem do BANCO (produtos.frete_gratis,",
    "    -- lida no loop de validação pelo product_id — nunca do payload).",
    "    -- Sentinelas (mesmas do front):",
    "    --   < 0    -> por_produto: só item marcado zera o frete",
    "    --   = 0.01 -> sempre: todo pedido é grátis",
    "    --   > 0    -> acima_de_valor: subtotal atinge o limiar (SEM trava de",
    "    --             login — a trava v_user_id IS NOT NULL morreu: convidado",
    "    --             tem o mesmo direito; a entrega dele é local e o portão",
    "    --             de CEP continua nos ELSIFs abaixo)",
    "    --   0/NULL -> desligado: nada é grátis aqui (cai nos ELSIFs)",
    "    v_free_shipping_min := COALESCE(v_store_config.free_shipping_min, 0);",
    "",
    "    IF (v_free_shipping_min < 0 AND v_has_free_shipping_item = true)",
    "       OR v_free_shipping_min = 0.01",
    "       OR (v_free_shipping_min > 0 AND v_calculated_subtotal >= v_free_shipping_min)",
    "    THEN",
    "        v_shipping_validated := 0;",
  ].join("\n");

  assertEquals(executavel.split(antigo).length - 1, 2);
  const esperado = executavel.split(antigo).join(novo);

  // O arquivo novo é o cabeçalho de comentários (linhas que começam com
  // "--", vazias) seguido do corpo esperado, sem NADA mais.
  const linhasNovas = migration.split("\n");
  const inicioCorpo = linhasNovas.findIndex((l) =>
    l.startsWith("DROP FUNCTION IF EXISTS public.create_marketplace_order_v23"),
  );
  assert(inicioCorpo > 0, "cabeçalho ausente");
  for (const l of linhasNovas.slice(0, inicioCorpo)) {
    assert(
      l.trim() === "" || l.trimStart().startsWith("--"),
      `linha inesperada no cabeçalho: ${l}`,
    );
  }
  assertEquals(linhasNovas.slice(inicioCorpo).join("\n"), esperado);
});
