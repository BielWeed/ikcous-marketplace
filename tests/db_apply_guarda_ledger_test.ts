// @ts-nocheck
/**
 * GUARDA DO LEDGER no scripts/db-apply.cjs (23/10/2026).
 *
 * Mesma ideia que o aplicar-migrations.yml ganhou no commit 1b7e734a (ver
 * tests/ci_aplicar_migrations_guarda_ledger_test.ts): reaplicar por engano uma
 * migration ANTIGA troca em silêncio a função que uma mais nova recriou, e o
 * registro no ledger faz ON CONFLICT DO NOTHING, então o run termina "verde".
 *
 * Aqui o script recusa, ANTES de gerar rollback ou aplicar qualquer coisa, a
 * lista que traz versão já registrada em supabase_migrations.schema_migrations.
 * A consulta é só de leitura. Falha na consulta ou resposta que não se entende
 * também PARA ("não consegui ver o ledger" não é "ledger vazio").
 *
 * Tudo com um cliente de mentira: nenhum banco é tocado.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  guardaDoLedger,
  versaoDaMigration,
} = require("../scripts/db-apply.cjs");

type Consulta = { sql: string; params: unknown[] };

/** Cliente falso: guarda toda consulta e responde com o que o teste mandar. */
function clienteFalso(resposta: () => unknown) {
  const consultas: Consulta[] = [];
  return {
    consultas,
    async query(sql: string, params: unknown[] = []) {
      consultas.push({ sql, params });
      return resposta();
    },
  };
}

const ANTIGA = "20261270000000_funcao_antiga.sql";
const NOVA = "20261349000000_funcao_nova.sql";

Deno.test("versaoDaMigration: usa o mesmo corte que o INSERT do ledger", () => {
  assertEquals(versaoDaMigration(ANTIGA), "20261270000000");
  assertEquals(
    versaoDaMigration(`supabase/migrations/${NOVA}`),
    "20261349000000",
  );
  assertEquals(versaoDaMigration("sem_versao.sql"), null);
});

Deno.test("lista sem versão registrada passa, e a consulta é só SELECT", async () => {
  const c = clienteFalso(() => ({ rows: [] }));
  const r = await guardaDoLedger(c, [ANTIGA, NOVA], {
    permitirReaplicar: false,
  });
  assertEquals(r, []);
  assertEquals(c.consultas.length, 1);
  assert(/^\s*select\b/i.test(c.consultas[0].sql));
  assertStringIncludes(
    c.consultas[0].sql,
    "supabase_migrations.schema_migrations",
  );
  assertEquals(c.consultas[0].params, [["20261270000000", "20261349000000"]]);
});

Deno.test("versão já registrada RECUSA por padrão e nomeia o arquivo", async () => {
  const c = clienteFalso(() => ({ rows: [{ version: "20261270000000" }] }));
  const e = await assertRejects(() =>
    guardaDoLedger(c, [ANTIGA, NOVA], { permitirReaplicar: false }),
  );
  assertStringIncludes(e.message, "RECUSADO");
  assertStringIncludes(e.message, ANTIGA);
  assert(!e.message.includes(NOVA), "só a registrada deve ser nomeada");
});

Deno.test("sem opção nenhuma, o padrão também é recusar", async () => {
  const c = clienteFalso(() => ({ rows: [{ version: "20261270000000" }] }));
  await assertRejects(() => guardaDoLedger(c, [ANTIGA]), Error, "RECUSADO");
});

Deno.test("permitirReaplicar libera, devolve quais e avisa em voz alta", async () => {
  const c = clienteFalso(() => ({ rows: [{ version: "20261270000000" }] }));
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => avisos.push(a.join(" "));
  try {
    const r = await guardaDoLedger(c, [ANTIGA, NOVA], {
      permitirReaplicar: true,
    });
    assertEquals(r, [ANTIGA]);
  } finally {
    console.warn = original;
  }
  assertEquals(avisos.length, 1);
  assertStringIncludes(avisos[0], "REAPLICAÇÃO DELIBERADA");
  assertStringIncludes(avisos[0], ANTIGA);
});

Deno.test("consulta que falha PARA (não segue em silêncio)", async () => {
  const c = {
    consultas: [],
    async query() {
      throw new Error("relation does not exist");
    },
  };
  const e = await assertRejects(() =>
    guardaDoLedger(c, [ANTIGA], { permitirReaplicar: true }),
  );
  assertStringIncludes(e.message, "FALHOU a conferência do ledger");
  assertStringIncludes(e.message, "relation does not exist");
});

Deno.test("resposta que não se entende PARA, mesmo com permitirReaplicar", async () => {
  for (const ruim of [
    undefined,
    {},
    { rows: null },
    { rows: [{ version: 7 }] },
    { rows: [null] },
  ]) {
    const c = clienteFalso(() => ruim);
    await assertRejects(
      () => guardaDoLedger(c, [ANTIGA], { permitirReaplicar: true }),
      Error,
      "FALHOU a conferência do ledger",
    );
  }
});

Deno.test("a mesma versão duas vezes na lista é recusada antes da rede", async () => {
  const c = clienteFalso(() => ({ rows: [] }));
  await assertRejects(
    () => guardaDoLedger(c, [ANTIGA, ANTIGA], { permitirReaplicar: false }),
    Error,
    "versão repetida",
  );
  assertEquals(c.consultas.length, 0);
});

Deno.test("nome sem versão numérica PARA antes da rede", async () => {
  const c = clienteFalso(() => ({ rows: [] }));
  await assertRejects(
    () => guardaDoLedger(c, ["sem_versao.sql"], { permitirReaplicar: false }),
    Error,
    "não tem versão numérica",
  );
  assertEquals(c.consultas.length, 0);
});

Deno.test("lista vazia não consulta nada", async () => {
  const c = clienteFalso(() => ({ rows: [] }));
  assertEquals(await guardaDoLedger(c, [], { permitirReaplicar: false }), []);
  assertEquals(c.consultas.length, 0);
});

Deno.test("main chama a guarda antes de gravar rollback e antes do apply", () => {
  const fonte = Deno.readTextFileSync(
    new URL("../scripts/db-apply.cjs", import.meta.url),
  );
  const main = fonte.slice(fonte.indexOf("async function main()"));
  const guarda = main.indexOf("guardaDoLedger(client, arquivos");
  assert(guarda > 0, "main não chama a guarda");
  assert(guarda < main.indexOf("fs.writeFileSync(arquivoRollback"));
  assert(guarda < main.indexOf('client.query("BEGIN")'));
  assertStringIncludes(main, 'args.includes("--permitir-reaplicar")');
});
