import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0, detectarTransacaoExplicita, removerRuido } =
  require("../scripts/db-prove-rollback.cjs");
const nome = "20261290000000_online_sem_forma_nao_e_pix.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (arquivo: string) =>
  Deno.readTextFileSync(new URL(arquivo, dir)).replace(/\r/g, "");
const migration = ler(nome);
const anterior = ler("20261177000000_o_financeiro_da_loja_nasce.sql");
const assinatura =
  "CREATE OR REPLACE FUNCTION public.fin__forma_do_pedido(p_payment_method text, p_metodo_online text)";
const revoke =
  "REVOKE ALL ON FUNCTION public.fin__forma_do_pedido(text, text) FROM PUBLIC, anon, authenticated;";

function definicao(sql: string) {
  const inicio = sql.indexOf(assinatura);
  assert(inicio >= 0, "assinatura ausente");
  const fim = sql.indexOf("$$;", inicio);
  assert(fim > inicio, "corpo sem fechamento");
  return sql.slice(inicio, fim + 3);
}

Deno.test("20261290: rollback executável restaura a definição anterior byte a byte e a mesma ACL", () => {
  const rollback = ler(`rollback-manual-${nome}`);
  assertEquals(definicao(rollback), definicao(anterior));
  assertStringIncludes(anterior, revoke);
  assertStringIncludes(rollback, revoke);
  assertEquals(/\bGRANT\b/i.test(removerRuido(rollback)), false);
  assertStringIncludes(migration, `rollback-manual-${nome}`);
});

Deno.test("20261290: guarda do rollback só aceita o hash do corpo novo, antes de substituí-lo", () => {
  const rollback = ler(`rollback-manual-${nome}`);
  const corpo = definicao(migration).split("AS $$")[1].split("$$;")[0];
  const hash = createHash("md5").update(corpo).digest("hex");
  assertStringIncludes(rollback, "md5(replace(prosrc, E'\\r', ''))");
  assertStringIncludes(
    rollback,
    "to_regprocedure('public.fin__forma_do_pedido(text,text)')",
  );
  assertStringIncludes(rollback, `v_hash IS DISTINCT FROM '${hash}'`);
  assertStringIncludes(rollback, "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:");
  assert(
    rollback.indexOf("B1_BASELINE_DIVERGENT") < rollback.indexOf(assinatura),
  );
});

Deno.test("20261290: migration e rollback não controlam transação e passam a fase 0 do aplicador", () => {
  const rollback = ler(`rollback-manual-${nome}`);
  for (const sql of [migration, rollback]) {
    assertEquals(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  }
  const fase0 = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(fase0.recusado, false, JSON.stringify(fase0.motivos));
});

Deno.test("20261290: inventário automático inclui o companion pelo nome exato", async () => {
  const entradas = [...Deno.readDirSync(dir)].map((e) => e.name);
  assert(entradas.includes(nome));
  assert(entradas.includes(`rollback-manual-${nome}`));
  const rollbacks = entradas.filter(
    (n) => n.startsWith("rollback-manual-") && n.endsWith(".sql"),
  );
  const exatos = rollbacks.filter((n) =>
    entradas.includes(n.slice("rollback-manual-".length)),
  );
  const script = new URL(
    "../scripts/ci/banco/inventario-rollback.cjs",
    import.meta.url,
  );
  const { code, stdout } = await new Deno.Command("node", {
    args: [fileURLToPath(script), fileURLToPath(dir)],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(code, 0);
  assertStringIncludes(
    new TextDecoder().decode(stdout),
    `${rollbacks.length} rollbacks`,
  );
  assertStringIncludes(
    new TextDecoder().decode(stdout),
    `casamento exato: **${exatos.length}**`,
  );
});
