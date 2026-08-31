// O CUPOM EXCLUSIVO VIRA EXCLUSIVO DE VERDADE — prova offline do par
// 20261052000000 + rollback (laudo ofensiva 3108, achado N3).
//
// O DEFEITO PROVADO AO VIVO: com a chave anônima, GET /rest/v1/coupons
// devolvia HTTP 200 com código/valor/mínimo de TODO cupom ativo — a policy
// de SELECT entregava a anon. A cura é a policy nova: SÓ `authenticated`
// com `is_admin()`. O rollback restaura a policy anterior verbatim
// (reabre o N3 de propósito — e o teste fixa isso para a volta ser
// consciente).
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261052000000_o_cupom_exclusivo_vira_exclusivo.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const norm = (s: string) => s.replace(/\s+/g, " ");
const migrationN = norm(migration);
const rollbackN = norm(rollback);

Deno.test("a policy nova entrega cupom SO ao admin", () => {
  // 🔴 BLOCO AMARRADO: TO authenticated + USING is_admin() juntos. Só o
  // `TO authenticated` sem o is_admin() entregaria cupom a qualquer cliente
  // logado (o furo continuaria aberto para quem tem conta); só o is_admin()
  // sem o TO deixaria a policy nascer para public. O par É a regra.
  assertStringIncludes(
    migrationN,
    norm("DROP POLICY IF EXISTS coupons_select_policy ON public.coupons"),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "CREATE POLICY coupons_select_policy ON public.coupons FOR SELECT TO authenticated USING ((SELECT is_admin()))",
    ),
  );
});

Deno.test("a policy nova nao deixa anon ver cupom ativo", () => {
  // A policy antiga tinha o ramo `active = true` que entregava a anon.
  // Na policy nova esse ramo NAO pode existir (o `active` só aparece se a
  // policy voltar a ser pública — o que é o trabalho do rollback).
  assert(!/USING \(\(SELECT is_admin\(\)\)\).*active = true/.test(migrationN));
  assert(!migrationN.includes("TO public"));
});

Deno.test("o rollback restaura a policy publica verbatim", () => {
  // A volta consciente: o rollback reconstrói o ramo `active = true` de
  // anon — provando que quem aplicar o rollback sabe o que está reabrindo.
  assertStringIncludes(
    rollbackN,
    norm(
      "(active = true) OR ((( SELECT auth.role() AS role) = 'authenticated'::text) AND ( SELECT is_admin() AS is_admin))",
    ),
  );
});
