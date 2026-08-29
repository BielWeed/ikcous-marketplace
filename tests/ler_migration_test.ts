// @ts-nocheck
/**
 * O RESOLVEDOR ÚNICO de migrations — scripts/ler-migration.cjs
 *
 * O QUE ESTE ARQUIVO PROTEGE: o repositório tem DOIS andares de migration
 * desde o passo 0 (PR #320) — `supabase/migrations/` (vivas) e
 * `supabase/migrations/_arquivadas/` (anteriores à baseline). O arquivamento
 * de 28/08/2026 quebrou em silêncio a família de scripts que montava o
 * caminho só da raiz: as ferramentas de PROVA de migration, justamente as que
 * existem para rodar antes de aplicar. O resolvedor único existe para a
 * família inteira não voltar a quebrar por andar — e este teste prende o
 * contrato nos DOIS andares usando o próprio repositório como fixture: a
 * 20260951 vive na raiz, a 20260804 vive só em _arquivadas. Se uma delas
 * mudar de andar, aqui reprova NOMENANDO.
 *
 * Mora em tests/ e usa createRequire pelo mesmo motivo dos arquivos irmãos
 * (db_apply_*.test.ts): ler-migration.cjs é CommonJS e a suíte roda em Deno.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  lerMigration,
  resolverCaminhoMigration,
} = require("../scripts/ler-migration.cjs");

const NA_RAIZ = "20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql";
const SO_NA_ARQUIVADAS =
  "20260804000000_add_is_admin_guard_to_category_analytics.sql";

Deno.test("acha migration VIVA na raiz, sem passar por _arquivadas", () => {
  const caminho = resolverCaminhoMigration(NA_RAIZ);
  assert(caminho);
  assertStringIncludes(caminho, NA_RAIZ);
  assertEquals(caminho.includes("_arquivadas"), false);
});

Deno.test("acha migration ARQUIVADA quando a raiz nao a tem", () => {
  const caminho = resolverCaminhoMigration(SO_NA_ARQUIVADAS);
  assert(caminho);
  assertStringIncludes(caminho, "_arquivadas");
});

Deno.test("inexistente devolve null, nunca um palpite", () => {
  assertEquals(resolverCaminhoMigration("20990101000000_nao_existe.sql"), null);
});

Deno.test("lerMigration devolve o conteudo da arquivada, nao so o caminho", () => {
  const conteudo = lerMigration(SO_NA_ARQUIVADAS);
  assertEquals(typeof conteudo, "string");
  assert(conteudo.length > 0);
});

Deno.test("lerMigration lanca FALHA ALTA nomeando os dois andares", () => {
  assertThrows(
    () => lerMigration("20990101000000_nao_existe.sql"),
    Error,
    "_arquivadas",
  );
});
