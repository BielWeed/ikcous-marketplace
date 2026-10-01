// @ts-nocheck
// A VENDA DO BALCÃO SE ANULA NO MESMO DIA — prova offline do par
// 20261185000000 + rollback (frente A, fase 5; defeito D2 da investigação de
// 28/09/2026). O comportamento é provado contra Postgres de verdade em
// tests/banco/pix-do-balcao-viva.cjs, prova (h).
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261185000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql";
const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../scripts/sql/pix-84-85-revert.sql`,
);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const corpo = norm(
  migration.slice(
    migration.indexOf("$function$") + 10,
    migration.lastIndexOf("$function$"),
  ),
);
const ASSINATURA = "public.anular_venda_presencial(uuid, text)";

Deno.test("par migration+rollback aceito e sem BEGIN/COMMIT", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("SECURITY DEFINER, search_path fechado, gate de admin primeiro", () => {
  assertStringIncludes(
    norm(migration),
    norm(`CREATE OR REPLACE FUNCTION ${ASSINATURA.replace("(uuid, text)", "(p_order_id uuid, p_motivo text)")}
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp`),
  );
  const cru = migration.slice(migration.indexOf("$function$"));
  const posBegin = cru.indexOf("\nBEGIN");
  assertEquals(
    norm(
      removerRuido(cru.slice(posBegin + 6, cru.indexOf("public.is_admin()"))),
    ),
    "IF",
  );
});

Deno.test("regras: motivo, trava, só balcão recebido na hora, mesmo dia, sem devolução", () => {
  for (const trecho of [
    "v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');",
    "FOR UPDATE;",
    "IF v_pedido.canal IS DISTINCT FROM 'presencial' THEN",
    "IF v_pedido.payment_method = 'online' THEN",
    "OR v_pedido.payment_method NOT IN ('cash', 'pix', 'card')",
    "(v_pedido.pagamento_recebido_em AT TIME ZONE 'America/Sao_Paulo')::date IS DISTINCT FROM (now() AT TIME ZONE 'America/Sao_Paulo')::date",
    "AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')",
  ]) {
    assertStringIncludes(corpo, norm(trecho));
  }
});

Deno.test("efeito: devolver_estoque, cancelled + estornado, dois históricos com o motivo", () => {
  assertStringIncludes(corpo, "PERFORM public.devolver_estoque(p_order_id);");
  assertStringIncludes(
    corpo,
    norm(
      "SET status = 'cancelled', payment_status = 'estornado', updated_at = now()",
    ),
  );
  assertStringIncludes(corpo, "'Venda do balcão anulada: ' || v_motivo");
  assertStringIncludes(corpo, "'desfeito', 'recebido_na_entrega', 'estornado'");
  const posEstoque = corpo.indexOf("devolver_estoque");
  const posUpdate = corpo.indexOf("SET status = 'cancelled'");
  assert(posEstoque < posUpdate, "estoque de volta antes de mudar o status");
});

Deno.test("não depende da migration do Financeiro nem recria vizinhas", () => {
  assert(!/fin__/.test(removerRuido(migration)), "sem fin__dia/fin__hoje");
  for (const vizinha of [
    "devolver_estoque",
    "registrar_estorno_manual",
    "update_order_status_atomic",
  ]) {
    assert(
      /* eslint-disable-next-line security/detect-non-literal-regexp --
       * nome de função desta mesma lista, nunca entrada externa. */
      !new RegExp(
        `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${vizinha}\\b`,
        "i",
      ).test(migration),
    );
  }
});

Deno.test("grants e rollback", () => {
  assertStringIncludes(
    norm(migration),
    `REVOKE ALL ON FUNCTION ${ASSINATURA} FROM PUBLIC, anon, authenticated, service_role;`,
  );
  assertStringIncludes(
    norm(migration),
    `GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO authenticated;`,
  );
  assertStringIncludes(
    norm(rollback),
    `DROP FUNCTION IF EXISTS ${ASSINATURA};`,
  );
});
