// @ts-nocheck
// O CLIENTE APAGA A FOTO DE DEVOLUÇÃO QUE NÃO USOU — prova offline do par
// 20261216000000 + rollback.
//
// O DEFEITO QUE ESTE TESTE FIXA: o cliente subia a foto no bucket privado
// `devolucoes` e não podia apagá-la; a foto tirada da lista ou a que sobrava de
// uma solicitação recusada ficava guardada para sempre. A política de DELETE
// resolve isso, mas só é segura com as quatro peças juntas: papel
// `authenticated`, bucket `devolucoes`, pasta do próprio cliente e foto fora de
// qualquer devolução. Tirar qualquer uma delas deixa o cliente apagar a evidência
// da loja (ou a foto de outra pessoa).
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
const NOME =
  "20261216000000_o_cliente_apaga_a_foto_de_devolucao_que_nao_usou.sql";
const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);
const norm = (s) => s.replace(/\s+/g, " ").trim();
// removerRuido apaga o conteudo dos literais; aqui interessam os literais, entao so saem os comentarios.
const semComentarios = (s) =>
  norm(
    s
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n"),
  );
const sqlMigration = semComentarios(migration);
const sqlRollback = semComentarios(rollback);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa)", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("a politica de DELETE tem as quatro pecas: authenticated, bucket, pasta do cliente e foto fora de uso", () => {
  assertStringIncludes(
    sqlMigration,
    "CREATE POLICY devolucoes_cliente_delete_policy ON storage.objects FOR DELETE TO authenticated",
  );
  for (const peca of [
    "bucket_id = 'devolucoes'",
    "split_part(name, '/', 1) = (SELECT auth.uid())::text",
    "NOT EXISTS ( SELECT 1 FROM public.devolucoes d WHERE storage.objects.name = ANY (d.fotos) )",
  ])
    assertStringIncludes(sqlMigration, peca);
});

Deno.test("a migration so cria a politica de DELETE: nada de GRANT, nada de admin, nada em outro bucket", () => {
  assert(
    !/\b(GRANT|REVOKE|ALTER|INSERT|UPDATE|TRUNCATE)\b/i.test(sqlMigration),
  );
  assert(!/\bis_admin\b|service_role|\banon\b|\bPUBLIC\b/.test(sqlMigration));
  assertEquals(sqlMigration.match(/CREATE POLICY/g)?.length, 1);
  assertEquals(
    sqlMigration
      .match(/'[a-z_-]+'/g)
      ?.filter((x) => x !== "'devolucoes'" && x !== "'/'") ?? [],
    [],
  );
});

Deno.test("o DROP POLICY IF EXISTS vem antes do CREATE (idempotente)", () => {
  const drop = sqlMigration.indexOf(
    "DROP POLICY IF EXISTS devolucoes_cliente_delete_policy ON storage.objects;",
  );
  const create = sqlMigration.indexOf(
    "CREATE POLICY devolucoes_cliente_delete_policy",
  );
  assert(drop >= 0 && create > drop);
});

Deno.test("o rollback so apaga essa politica, com IF EXISTS", () => {
  assertEquals(
    sqlRollback,
    "DROP POLICY IF EXISTS devolucoes_cliente_delete_policy ON storage.objects;",
  );
});
