// @ts-nocheck
// O FINANCEIRO DA LOJA NASCE — prova offline do par 20261177000000 + rollback
// (plano docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md,
// tarefa 3). A prova VIVA mora em tests/banco/financeiro-viva.cjs.
//
// Riscos amarrados: tabela de dinheiro sem RLS (qualquer cliente leria o
// caixa da loja); escrita direta liberada (pula as regras de baixa,
// cancelamento e caixa fechado); gatilho no caminho do dinheiro (o Financeiro
// lê as fontes — nunca escreve em pedido/estorno); o app ganhando escrita na
// assinatura (cobrança é de outro projeto); tabela temporária na DRE (quebra
// em transação só-leitura).
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
const NOME = "20261177000000_o_financeiro_da_loja_nasce.sql";
const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const m = norm(migration);
const r = norm(rollback);
const TABELAS = [
  "fin_contas",
  "fin_categorias",
  "fin_caixa_sessoes",
  "fin_lancamentos",
  "assinatura_da_loja",
];

Deno.test("avaliarFase0 não recusa o par e nenhum dos dois controla transação", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("toda tabela liga RLS, só admin lê e ninguém escreve direto", () => {
  for (const t of TABELAS) {
    assertStringIncludes(
      m,
      `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`,
    );
    assertStringIncludes(
      m,
      `CREATE POLICY ${t}_admin_select_policy ON public.${t} FOR SELECT TO authenticated USING ((SELECT public.is_admin()));`,
    );
    for (const acao of ["INSERT", "UPDATE", "DELETE", "ALL"]) {
      assertEquals(
        m.includes(`ON public.${t} FOR ${acao}`),
        false,
        `${t} ${acao}`,
      );
    }
  }
  assertStringIncludes(
    m,
    "public.fin_lancamentos, public.assinatura_da_loja FROM PUBLIC, anon, authenticated;",
  );
});

Deno.test("o Financeiro não põe gatilho em pedido, estorno nem devolução", () => {
  assertEquals(/CREATE TRIGGER/i.test(removerRuido(migration)), false);
  for (const t of ["marketplace_orders", "order_refunds", "devolucoes"]) {
    const limpo = norm(removerRuido(migration));
    assertEquals(limpo.includes(`INSERT INTO public.${t} `), false, t);
    assertEquals(limpo.includes(`UPDATE public.${t} `), false, t);
  }
});

Deno.test("a DRE não cria tabela temporária (roda em transação só-leitura)", () => {
  assertEquals(/CREATE TEMP/i.test(removerRuido(migration)), false);
});

Deno.test("toda RPC pública faz o gate de admin dentro e tem search_path fixo", () => {
  const rpcs = [
    ...m.matchAll(
      /CREATE OR REPLACE FUNCTION public\.(fin_(?!_)[a-z_]+|assinatura_da_loja_ler)\(/g,
    ),
  ].map((x) => x[1]);
  assert(rpcs.length >= 17, `achei ${rpcs.length}`);
  for (const f of rpcs) {
    const ini = m.indexOf(`CREATE OR REPLACE FUNCTION public.${f}(`);
    const corpo = m.slice(ini, m.indexOf("$$;", m.indexOf("AS $$", ini)));
    assertStringIncludes(corpo, "SECURITY DEFINER SET search_path = public", f);
    assertStringIncludes(corpo, "IF NOT public.is_admin() THEN", f);
  }
});

Deno.test("o rollback derruba RPCs, ajudantes e tabelas sem tocar nas fontes", () => {
  for (const t of TABELAS)
    assertStringIncludes(r, `DROP TABLE IF EXISTS public.${t};`);
  assertStringIncludes(
    r,
    "DROP FUNCTION IF EXISTS public.fin__movimentos(date, date);",
  );
  assertEquals(
    /marketplace_orders|order_refunds/.test(removerRuido(rollback)),
    false,
  );
});
