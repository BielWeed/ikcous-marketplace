// PEÇA 12 — Fase 2: prova offline do par 20261151000000 (mensagens de vaga
// presa) + 20261152000000 (varredura libera o pedido nunca-cobrado), no
// padrão de `migration_cupom_exclusivo_test.ts`.
//
// O que este teste trava (lição #53 — a mesma regra escrita em dois lugares
// diverge; aqui ela escrita em TRÊS): a frase canônica da vaga presa nas três
// funções (validate_coupon_secure_v2, v23, v24), o bloco de CÁLCULO de
// desconto INVOLUTO (caractere a caractere igual ao da 20261025000000 fora do
// bloco da recusa) e — no MESMO arquivo — os DOIS números da varredura: as
// 24h do ramo antigo e a carência de 15 minutos do ramo novo (B1).
//
// Roda no CI sem banco: a âncora é o ARQUIVO de migration em disco, nunca
// pg_get_functiondef.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME_A = "20261151000000_cupom_preso_diz_que_a_vaga_volta.sql";
const NOME_B =
  "20261152000000_varredura_libera_vaga_de_pedido_sem_cobranca.sql";
// 🔴 A FONTE das v23/v24 é o ÚLTIMO ESCRITOR VIVO delas — a
// 20261081000000 (assinatura de 13 argumentos com a chave de idempotência,
// portão de entrega e frete grátis no servidor). A 20261025000000 é fonte
// MORTA: a assinatura de 12 argumentos dela foi DROPADA do banco vivo
// (20261040000000/20261081000000) — recriar por ela nasceria como
// OVERLOAD-sombra sem as proteções vivas (achado BLOQUEANTE da revisão cara
// da peça 12). Nenhuma migration pode renascer por fonte morta.
const NOME_FONTE_A =
  "20261081000000_a_regra_do_frete_gratis_mora_no_servidor.sql";
const NOME_FONTE_B = "20260970000000_cancelamento_respeita_o_envio.sql";

const caminho = (nome: string) => `${DIR}../supabase/migrations/${nome}`;

const migrationA = Deno.readTextFileSync(caminho(NOME_A));
const migrationB = Deno.readTextFileSync(caminho(NOME_B));
const rollbackA = Deno.readTextFileSync(caminho(`rollback-manual-${NOME_A}`));
const rollbackB = Deno.readTextFileSync(caminho(`rollback-manual-${NOME_B}`));
const fonteA = Deno.readTextFileSync(caminho(NOME_FONTE_A));
const fonteB = Deno.readTextFileSync(caminho(NOME_FONTE_B));

/** O corpo de UMA função dentro do arquivo: da assinatura CREATE OR REPLACE
 * dela até a próxima `CREATE OR REPLACE FUNCTION`, `REVOKE`, `GRANT` ou
 * `COMMENT ON` (o que vier primeiro — as migrations da casa terminam com os
 * grants, e eles não fazem parte do corpo), ou o fim do arquivo. */
function corpoDaFuncao(sql: string, nome: string): string {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  assert(inicio >= 0, `função ${nome} não encontrada no arquivo`);
  const seguinte = sql
    .slice(inicio + 10)
    .search(/\n(CREATE OR REPLACE FUNCTION|REVOKE|GRANT|COMMENT ON)/);
  return seguinte === -1
    ? sql.slice(inicio)
    : sql.slice(inicio, inicio + 10 + seguinte);
}

/** A fatia do fim da FUNÇÃO: de um marcador até o rótulo dollar-quote que
 * fecha a própria função (`$function$`, `$devolver_cupons_mortos$`, …), para
 * o comentário separador entre funções não entrar na comparação de caractere
 * a caractere. O rótulo de ABERTURA fica antes do marcador — o primeiro
 * rótulo DEPOIS dele é o de fechamento. */
function ateFimDaFuncao(corpo: string, de: string): string {
  const i = corpo.indexOf(de);
  assert(i >= 0, `marcador de cauda não encontrado: ${de.slice(0, 40)}…`);
  const fechamento = /\$\w+\$/.exec(corpo.slice(i));
  assert(
    fechamento !== null,
    "rótulo dollar-quote de fechamento não encontrado após a cauda",
  );
  return corpo.slice(i, i + fechamento.index + fechamento[0].length);
}

/**
 * Prova de INVOLUTIVIDADE do cálculo (guarda-chuva da peça: a migration NÃO
 * muda regra de cálculo de desconto): fora do bloco da recusa, o corpo novo
 * é CARACTERE A CARACTERE o corpo da fonte. O corpo é fatiado em três —
 * cabeça (tudo antes do diagnóstico da recusa), cauda da recusa em diante
 * (cálculo, total, INSERT, estoque, usage_count) — e as fatias de fora têm de
 * ser IDÊNTICAS entre fonte e migration nova. O miolo (o diagnóstico FOR
 * SHARE + RAISEs) é a única fatia que pode diferir.
 */
function fatiasForaDaRecusa(corpoFonte: string, corpoNovo: string) {
  const CABECA = "IF v_coupon_id IS NULL THEN";
  const CAUDA = "IF v_coupon_type = 'percentage' THEN";
  const fatia = (corpo: string, de: string, ate: string) => {
    const i = corpo.indexOf(de);
    const j = corpo.indexOf(ate);
    assert(
      i >= 0 && j > i,
      `marcadores ${de.slice(0, 30)}… / ${ate.slice(0, 30)}… não encontrados na ordem esperada`,
    );
    return corpo.slice(i, j);
  };
  return {
    cabecaFonte: corpoFonte.slice(0, corpoFonte.indexOf(CABECA)),
    cabecaNova: corpoNovo.slice(0, corpoNovo.indexOf(CABECA)),
    meioFonte: fatia(corpoFonte, CABECA, CAUDA),
    meioNovo: fatia(corpoNovo, CABECA, CAUDA),
    caudaFonte: corpoFonte.slice(corpoFonte.indexOf(CAUDA)),
    caudaNova: corpoNovo.slice(corpoNovo.indexOf(CAUDA)),
  };
}

// A frase canônica, EXATAMENTE como nas v23/v24 (o `%` é o placeholder do
// RAISE). O miolo do validate_coupon_secure_v2 a escreve concatenada
// ('O cupom ' || p_code || ' está no limite…') — a cauda é idêntica e é
// cravada separadamente abaixo.
const FRASE_V23_V24 =
  "RAISE EXCEPTION 'O cupom % está no limite de usos. A vaga dele volta sozinha quando o pagamento de um pedido cancelado deixar de ser possível (em até 24 horas).', p_coupon_code;";
const CAUDA_FRASE_VALIDATE =
  "está no limite de usos. A vaga dele volta sozinha quando o pagamento de um pedido cancelado deixar de ser possível (em até 24 horas).';";
const SUBCONSULTA_VAGA_PRESA = `IF EXISTS (
                    SELECT 1
                    FROM public.marketplace_orders o
                    WHERE o.coupon_id = v_cupom_recusado.id
                      AND o.status = 'cancelled'
                      AND o.coupon_usage_returned = FALSE
                ) THEN`;

// B1: a cláusula nova da varredura, AMARRADA (com a carência de 15 minutos
// DENTRO do mesmo parêntese das 24h — não basta a cláusula existir solta).
const CLAUSULA_NOVA_B = `AND (expires_at IS NULL OR expires_at < now() - interval '24 hours'
               OR (gateway_payment_id IS NULL AND expires_at < now() - interval '15 minutes'))`;

Deno.test("avaliarFase0 não recusa os pares migration+rollback das duas migrations novas", () => {
  for (const [sql, rollback] of [
    [migrationA, rollbackA],
    [migrationB, rollbackB],
  ] as const) {
    const r = avaliarFase0({
      sqlMigration: sql,
      sqlRollback: rollback,
      temRollback: true,
    });
    assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  }
});

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

Deno.test("a frase canônica de vaga presa existe AMARRADA à subconsulta nas v23 e v24", () => {
  for (const funcao of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    const corpo = corpoDaFuncao(migrationA, funcao);
    // Amarrado: a subconsulta de vaga presa seguida do RAISE novo — um não
    // sobrevive sem o outro. (Marcador solto casaria contra comentário — a
    // falha da Rodada 5.)
    assertStringIncludes(corpo, SUBCONSULTA_VAGA_PRESA);
    const depoisDaSubconsulta = corpo.slice(
      corpo.indexOf(SUBCONSULTA_VAGA_PRESA),
    );
    assertStringIncludes(depoisDaSubconsulta, FRASE_V23_V24);
  }
});

Deno.test("a frase canônica existe no validate_coupon_secure_v2, com o código concatenado", () => {
  const corpo = corpoDaFuncao(migrationA, "validate_coupon_secure_v2");
  // Fonte única (lição #53): a MESMA cauda de frase nas três funções.
  assertStringIncludes(
    corpo,
    `'O cupom ' || p_code || ' ${CAUDA_FRASE_VALIDATE}`,
  );
  // A subconsulta de vaga presa do validate usa v_coupon (o RECORD dele).
  assertStringIncludes(corpo, "WHERE o.coupon_id = v_coupon.id");
  assertStringIncludes(corpo, "AND o.coupon_usage_returned = FALSE");
});

Deno.test("fora do bloco da recusa, v23 e v24 são CARACTERE A CARACTERE a 20261081000000 (cálculo involuto)", () => {
  for (const funcao of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    const { cabecaFonte, cabecaNova, meioFonte, meioNovo } = fatiasForaDaRecusa(
      corpoDaFuncao(fonteA, funcao),
      corpoDaFuncao(migrationA, funcao),
    );
    assertEquals(
      cabecaNova.trimEnd(),
      cabecaFonte.trimEnd(),
      `cabeça de ${funcao} divergiu da fonte`,
    );
    const CAUDA = "IF v_coupon_type = 'percentage' THEN";
    const caudaFonte = ateFimDaFuncao(corpoDaFuncao(fonteA, funcao), CAUDA);
    const caudaNova = ateFimDaFuncao(corpoDaFuncao(migrationA, funcao), CAUDA);
    assertEquals(
      caudaNova.trimEnd(),
      caudaFonte.trimEnd(),
      `cauda (cálculo/INSERT) de ${funcao} divergiu da fonte`,
    );
    // O miolo NOVO traz a frase nova E preserva a frase antiga de limite
    // (caso sem vaga presa) e a residual da corrida.
    assertStringIncludes(meioNovo, FRASE_V23_V24);
    assertStringIncludes(meioNovo, "O cupom % já atingiu o limite de usos.");
    assertStringIncludes(meioNovo, "Cupom % inválido ou expirado.");
    // O miolo da FONTE, para conferência de que a fatia é o bloco certo.
    assert(!meioFonte.includes("está no limite de usos"));
  }
});

Deno.test("o SELECT do diagnóstico ganhou o id da coupon (a subconsulta casa por coupon_id)", () => {
  for (const funcao of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    const meio = fatiasForaDaRecusa(
      corpoDaFuncao(fonteA, funcao),
      corpoDaFuncao(migrationA, funcao),
    ).meioNovo;
    assertStringIncludes(
      meio,
      "SELECT id, active, valid_until, usage_limit, usage_count, min_purchase",
    );
  }
});

Deno.test("a varredura traz as 24h antigas E a carência de 15 minutos AMARRADAS no mesmo parêntese", () => {
  // Os DOIS números no MESMO teste (lição #53): a mensagem promete "em até 24
  // horas" — o ramo antigo é o que garante o teto; a carência é o que fecha a
  // corrida B1 com a criar-pagamento. Mudar um sem o outro reprova aqui.
  const corpo = corpoDaFuncao(migrationB, "devolver_cupons_de_pedidos_mortos");
  assertStringIncludes(corpo, CLAUSULA_NOVA_B);
  // A 7ª cláusula, amarrada à âncora do FIM (formato Rodada 7: cláusula nova
  // inserida antes do anchor não move o anchor nem o que vem depois).
  assertStringIncludes(
    corpo,
    `AND (cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL)
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_uso_cupom(v_pedido.id);`,
  );
  assertStringIncludes(corpo, "SET coupon_usage_returned = TRUE");
});

Deno.test("fora da cláusula do prazo, o CÓDIGO da varredura é CARACTERE A CARACTERE a 20260970000000", () => {
  const fonte = corpoDaFuncao(fonteB, "devolver_cupons_de_pedidos_mortos");
  const novo = corpoDaFuncao(migrationB, "devolver_cupons_de_pedidos_mortos");
  assertEquals(
    novo.slice(novo.indexOf("DECLARE"), novo.indexOf("BEGIN")).trimEnd(),
    fonte.slice(fonte.indexOf("DECLARE"), fonte.indexOf("BEGIN")).trimEnd(),
    "DECLARE da varredura divergiu da fonte",
  );
  // \n + 8 espaços: o SKIP LOCKED EXECUTÁVEL (o do comentário tem 4).
  const DO_ANCHOR = "\n        FOR UPDATE SKIP LOCKED";
  assertEquals(
    ateFimDaFuncao(novo, DO_ANCHOR).trimEnd(),
    ateFimDaFuncao(fonte, DO_ANCHOR).trimEnd(),
    "laço/cauda da varredura divergiu da fonte",
  );
});

Deno.test("o rollback A restaura as frases ANTERIORES (sem a frase nova) e aponta a 20261081000000", () => {
  assertStringIncludes(
    rollbackA,
    "20261081000000_a_regra_do_frete_gratis_mora_no_servidor.sql",
  );
  // O corpo anterior do validate_coupon_secure_v2 volta embutido (a fonte
  // dele é o baseline — reprocessar o baseline inteiro NÃO é caminho).
  assertStringIncludes(rollbackA, "Cupom atingiu o limite de uso.");
  assert(!rollbackA.includes("está no limite de usos"));
});

Deno.test("o rollback B restaura o WHERE de sete cláusulas SEM a carência", () => {
  // Inline (reaplicar a 20260970000000 inteira recriaria também
  // update_order_status_atomic e confirmar_retorno_do_produto de uma era
  // antiga — desfazendo a 2026110000000).
  assertStringIncludes(
    rollbackB,
    `AND (expires_at IS NULL OR expires_at < now() - interval '24 hours')
          AND (cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL)`,
  );
  assert(!rollbackB.includes("interval '15 minutes'"));
});
