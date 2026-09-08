// @ts-nocheck
/**
 * classificarNome — scripts/db-prove-passo0-migration-list.cjs
 *
 * Medido em 07/09/2026: duas migrations reais do repositório nasceram com
 * versão de 13 dígitos, não 14 (`2026110000000_o_estorno_nasce_no_ledger.sql`
 * e `2026110000100_concluir_estorno.sql`) e já estão registradas no ledger da
 * loja principal. A antiga `versao(nome)` só reconhecia `^\d{14}_`; para as
 * duas ela devolvia `null`, o arquivo virava invisível para o script, e o
 * ledger de produção reprovava com REMOTA_SEM_ARQUIVO_POS — falso positivo,
 * o arquivo existe.
 *
 * Renomear os arquivos não é opção (órfão no ledger de produção); editar o
 * ledger não é opção. A saída é uma exceção por LISTA FECHADA de nome exato
 * — nunca abrir a regex para "qualquer coisa de 13 dígitos", porque aí um
 * nome futuro fora do padrão voltaria a ser ignorado em silêncio, que é
 * exatamente o defeito que este arquivo fecha.
 *
 * `classificarNome` é a fronteira pura extraída do script principal — ele
 * decide, sem tocar disco nem banco, se um nome de arquivo é uma versão de
 * 14 dígitos, a exceção declarada de 13, ou nome fora do padrão. O script
 * principal usa esta mesma função (não duplica a regex).
 *
 * Mora em tests/ pelo mesmo motivo dos irmãos db_apply_*_test.ts, e usa
 * createRequire porque o script é CommonJS.
 */
import { createRequire } from "node:module";
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  classificarNome,
} = require("../scripts/db-prove-passo0-migration-list.cjs");

Deno.test("nome de 14 dígitos → versão de 14 dígitos, sem exceção", () => {
  const r = classificarNome("20260940000000_home_sections_em_store_config.sql");
  assertEquals(r, { versao: "20260940000000" });
});

Deno.test("2026110000000_o_estorno_nasce_no_ledger.sql (13 dígitos, ledger desde 07/09) → versão de 13 dígitos, exceção", () => {
  const r = classificarNome("2026110000000_o_estorno_nasce_no_ledger.sql");
  assertEquals(r.versao, "2026110000000");
  assertEquals(r.excecao, true);
});

Deno.test("2026110000100_concluir_estorno.sql (13 dígitos, ledger desde 07/09) → versão de 13 dígitos, exceção", () => {
  const r = classificarNome("2026110000100_concluir_estorno.sql");
  assertEquals(r.versao, "2026110000100");
  assertEquals(r.excecao, true);
});

Deno.test("nome inventado de 13 dígitos que NÃO está na lista fechada → fora do padrão, nunca vira exceção por acaso", () => {
  const r = classificarNome("2026110099999_migration_inventada.sql");
  assertEquals(r.foraDoPadrao, true);
  assertEquals(r.versao, undefined);
  assertEquals(r.excecao, undefined);
});

Deno.test("nome sem dígitos no começo (zzz_teste.sql) → fora do padrão", () => {
  const r = classificarNome("zzz_teste.sql");
  assertEquals(r.foraDoPadrao, true);
});

Deno.test("rollback-manual- continua fora da classificação de conteúdo (o script principal filtra ANTES de chamar classificarNome, não é classificarNome quem decide isso)", () => {
  // Este teste documenta a fronteira: classificarNome não sabe nada sobre
  // rollback-manual — se chamado diretamente com um nome desses, ele
  // classifica como fora do padrão, como qualquer outro nome não numérico.
  // Quem garante que rollback-manual-*.sql nunca chega aqui é o filtro em
  // main(), testado indiretamente pela saída do script (ver relatório).
  const r = classificarNome(
    "rollback-manual-2026110000000_o_estorno_nasce_no_ledger.sql",
  );
  assertEquals(r.foraDoPadrao, true);
});
