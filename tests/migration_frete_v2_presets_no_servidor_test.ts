// @ts-nocheck
// A REGRA DO FRETE GRÁTIS MORA NO SERVIDOR — prova offline do par
// 20261081000000 + rollback (emenda FRETE V2, frente B do dossiê
// frete-v2-0309, decisão da orquestração 03/09; EMENDA do mesmo dia,
// ordem do dono: "entrega fixa não faz sentido existir").
//
// A RPC do pedido (v23/v24) continuava na regra ANTIGA (item marcado zera
// incondicional + trava de login no limite de valor) enquanto o front passou
// a obedecer os presets exclusivos. Esta migration porta o MESMO switch:
//   < 0 = por_produto (marcação do BANCO, produtos.frete_gratis)
//   = 0.01 = sempre | > 0 = acima_de_valor SEM login | 0/NULL = desligado.
//
// A EMENDA 03/09 matou na MESMA migration os dois resquícios da taxa fixa
// que os corpos verbatim ainda carregavam (portados da 20261040000000):
//   a) o ramo `flat-fee-%`, que ACEITAVA o id e cobrava o shipping_fee da
//      loja — agora o id é recusado com exception;
//   b) o pedido sem opção de entrega escolhida (IS NULL/'') e o ELSE final
//      (id não reconhecido sem CEP), que caíam em COALESCE(shipping_fee, 0)
//      — preço inventado ou zero; agora falha fechada.
//
// A prova mais forte daqui é a de CORPO VERBATIM (teste 5): a migration é
// byte a byte o corpo executável da 20261040000000 com SÓ a troca de DOIS
// blocos, repetida nas duas funções:
//   BLOCO 1 — limiar: regra antiga -> switch dos presets;
//   BLOCO 2 — frete: ELSIF sem-opção + ELSIF flat-fee + ELSE final com
//             COALESCE -> RAISE EXCEPTION fechado nos três.
// Qualquer OUTRA mudança de corpo que entre por aqui quebra a comparação —
// porque CREATE OR REPLACE substitui o corpo INTEIRO, e uma redação
// descuidada desfaz guarda de dinheiro em silêncio (alerta do cabeçalho da
// 20260951). Entrega local e cotação de transportadora ficam INTACTAS por
// construção: o que não foi trocado é byte a byte o da viva.
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

Deno.test("EMENDA: flat-fee-% recebido é EXCEPTION, nunca preço da taxa da loja", () => {
  // O ramo do id continua reconhecível PARA RECUSAR (mensagem clara pedindo
  // entrega válida) — o que morreu é o ACEITE com COALESCE(shipping_fee, 0).
  assertEquals(
    vezesNoCorpo(
      "ELSIF p_shipping_option_id LIKE 'flat-fee-%' THEN RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'",
    ),
    2,
    "flat-fee-% deve falhar fechado nas v23 e v24",
  );
});

Deno.test("EMENDA: pedido sem opção de entrega escolhida é EXCEPTION, nunca COALESCE(shipping_fee,0)", () => {
  assertEquals(
    vezesNoCorpo(
      "ELSIF p_shipping_option_id IS NULL OR p_shipping_option_id = '' THEN RAISE EXCEPTION 'Escolha uma opção de entrega antes de finalizar o pedido.'",
    ),
    2,
    "sem opção escolhida deve falhar fechado nas v23 e v24",
  );
  // E o ELSE final (id não reconhecido sem CEP para reconciliar) também não
  // cobra mais nada da loja.
  assertEquals(
    vezesNoCorpo(
      "RAISE EXCEPTION 'Opção de entrega não reconhecida. Volte ao carrinho, calcule o frete e finalize de novo.'",
    ),
    2,
  );
});

Deno.test("EMENDA: COALESCE(shipping_fee, 0) morreu INTEIRO do caminho do frete", () => {
  // As 6 ocorrências da viva (2 por função: ELSIF sem-opção, ELSIF flat-fee,
  // ELSE final) saíram todas. O `v_shipping_validated :=` amarra ao bloco do
  // frete — shipping_fee pode reaparecer em outro contexto de leitura, mas
  // NUNCA virando preço validado.
  assertEquals(
    vezesNoCorpo(
      "v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0)",
    ),
    0,
  );
});

Deno.test("entrega local e cotação de transportadora continuam resolvendo preço", () => {
  // Os dois caminhos VÁLIDOS de frete cobrado permanecem — a prova de que não
  // foram tocados é a comparação byte-a-byte do teste 5 (o que não entrou nas
  // trocas é o corpo da viva); aqui fica explícito o que "intacto" cobre.
  assertEquals(
    vezesNoCorpo(
      "ELSIF p_shipping_option_id = 'local-delivery' THEN",
    ),
    2,
  );
  assertEquals(
    vezesNoCorpo(
      "v_shipping_validated := COALESCE(v_store_config.local_delivery_fee, 0)",
    ),
    2,
  );
  assertEquals(
    vezesNoCorpo(
      "FROM public.shipping_quotes_cache q, LATERAL jsonb_array_elements(q.options) AS opt",
    ),
    2,
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

Deno.test("o rollback é byte a byte a 20261040000000 (espelha a emenda)", () => {
  // A migration emendada troca DOIS blocos da viva; o estado anterior EXATO
  // dela continua sendo a viva INTEGRAL — inclusive os ramos flat-fee e os
  // COALESCE que a emenda matou. Por isso o rollback (corpo executável) tem
  // de ser byte a byte a 20261040000000: é ele que os reabre conscientemente.
  const corpoDe = (texto: string) => {
    const linhas = texto.split("\n");
    const inicio = linhas.findIndex((l) =>
      l.startsWith("DROP FUNCTION IF EXISTS public.create_marketplace_order_v23"),
    );
    assert(inicio >= 0, "corpo executável não achado");
    return linhas.slice(inicio).join("\n");
  };
  assertEquals(corpoDe(rollback), corpoDe(viva));
});

Deno.test("o corpo da migration é o da 20261040000000 com SÓ os dois blocos trocados", () => {
  // Recomputa a transformação documentada e compara BYTE A BYTE.
  const linhas = viva.split("\n");
  const inicio = linhas.findIndex((l) =>
    l.startsWith("DROP FUNCTION IF EXISTS public.create_marketplace_order_v23"),
  );
  assert(inicio >= 0, "corpo executável da viva não achado");
  const executavel = linhas.slice(inicio).join("\n");

  // BLOCO 1 — LIMIAR: regra antiga -> switch dos presets.
  const limiarAntigo = [
    "    v_free_shipping_min := COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999);",
    "",
    "    IF v_has_free_shipping_item = true",
    "       OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)",
    "    THEN",
    "        v_shipping_validated := 0;",
  ].join("\n");

  const limiarNovo = [
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

  // BLOCO 2 — FRETE (emenda 03/09): os três resquícios da taxa fixa — ELSIF
  // sem opção escolhida, ELSIF flat-fee-% e ELSE final — viram FALHA FECHADA.
  const freteAntigo = [
    "    ELSIF p_shipping_option_id IS NULL OR p_shipping_option_id = '' THEN",
    "        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);",
    "",
    "    -- ATENÇÃO: a edge function RETORNA ANTES de gravar no cache quando o provider",
    "    -- é 'flat_fee' ou quando a entrega é local. Essas opções nunca aparecem em",
    "    -- shipping_quotes_cache, então precisam ser resolvidas direto pela config —",
    "    -- que é valor de servidor de qualquer forma, sem risco de manipulação.",
    "    ELSIF p_shipping_option_id LIKE 'flat-fee-%' THEN",
    "        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);",
  ].join("\n");

  const freteNovo = [
    "    -- FRETE V2 EMENDA (03/09, ordem do dono \"entrega fixa não faz sentido",
    "    -- existir\"): pedido SEM opção de entrega escolhida NÃO NASCE — o",
    "    -- COALESCE(shipping_fee, 0) daqui cobrava preço inventado ou zero.",
    "    ELSIF p_shipping_option_id IS NULL OR p_shipping_option_id = '' THEN",
    "        RAISE EXCEPTION 'Escolha uma opção de entrega antes de finalizar o pedido.'",
    "            USING DETAIL = 'Pedido sem opção de entrega: o servidor não inventa frete nem cobra taxa da loja.';",
    "",
    "    -- FRETE V2 EMENDA (03/09): o id `flat-fee-%` deixou de ser escolha válida",
    "    -- — a taxa fixa morreu na edge (calculate-shipping) e aqui no servidor.",
    "    -- Recebê-lo é payload velho ou forjado: falha fechada, NUNCA o",
    "    -- shipping_fee da loja.",
    "    ELSIF p_shipping_option_id LIKE 'flat-fee-%' THEN",
    "        RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'",
    "            USING DETAIL = format('O id %s é de taxa fixa, que não existe mais; o servidor não cobra shipping_fee da loja.', p_shipping_option_id);",
  ].join("\n");

  const elseAntigo = [
    "    ELSE",
    "        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);",
    "    END IF;",
  ].join("\n");

  const elseNovo = [
    "    ELSE",
    "        -- FRETE V2 EMENDA (03/09): id não reconhecido — não é entrega local,",
    "        -- não é cotação de transportadora, e sem CEP não há onde reconciliar.",
    "        -- Antes caía em COALESCE(shipping_fee, 0): preço inventado ou zero.",
    "        -- Falha fechada, como o resto do caminho do dinheiro.",
    "        RAISE EXCEPTION 'Opção de entrega não reconhecida. Volte ao carrinho, calcule o frete e finalize de novo.'",
    "            USING DETAIL = format('O id %s não é entrega local nem cotação gravada, e não há CEP de cotação para reconciliar.', p_shipping_option_id);",
    "    END IF;",
  ].join("\n");

  // Cada bloco trocado aparece EXATAMENTE nas duas funções.
  assertEquals(executavel.split(limiarAntigo).length - 1, 2, "bloco do limiar");
  assertEquals(executavel.split(freteAntigo).length - 1, 2, "bloco do frete (ELSIFs)");
  assertEquals(executavel.split(elseAntigo).length - 1, 2, "bloco do frete (ELSE final)");

  const esperado = executavel
    .split(limiarAntigo).join(limiarNovo)
    .split(freteAntigo).join(freteNovo)
    .split(elseAntigo).join(elseNovo);

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
