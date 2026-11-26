"use strict";
/* eslint-disable security/detect-object-injection --
 * Os indices vem de contadores e de listas fechadas deste arquivo (nomes de casos e de papeis), nunca de entrada de rede. */

/**
 * PROVA VIVA da migration 20261600000000_a_loja_pausa_o_pedido_novo.sql contra o Postgres EFEMERO (clone do rodar-isolado.cjs: a arvore migrada).
 * Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs; molde: a-loja-guarda-o-dia-da-pausa-do-teste-viva.cjs.
 *
 *  (1) TABELA     pausa_de_vendas existe VAZIA; anon, authenticated e service_role levam 42501 em SELECT e INSERT; o pre-voo recusa sem store_config.manutencao
 *                 e sem a coluna pausa_em do cartao, sem escrever nada.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-pausa-o-pedido-novo-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const NOME = "20261600000000_a_loja_pausa_o_pedido_novo.sql";
const MIGRATION = P.lerMigration(NOME);

const C = () => P.conexao();
const um = async (sql, params = []) => (await C().query(sql, params)).rows[0];

// ---------------------------------------------------------------------------------------------------------------------------
// (1) a tabela: vazia, fechada para todo papel de aplicacao; o pre-voo recusa a base sem as premissas
// ---------------------------------------------------------------------------------------------------------------------------
prova(
  "(1) TABELA: pausa_de_vendas existe VAZIA, com RLS e sem politica; anon, authenticated e service_role levam 42501 em SELECT e INSERT",
  async () => {
    await P.emTransacao(async () => {
      const t = await um(
        `SELECT c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas,
                (SELECT count(*)::int FROM public.pausa_de_vendas) AS linhas
           FROM pg_class c WHERE c.oid = to_regclass('public.pausa_de_vendas')`,
      );
      assert.deepEqual(t, { rls: true, politicas: 0, linhas: 0 });
      for (const papel of ["anon", "authenticated", "service_role"]) {
        for (const sql of [
          "SELECT * FROM public.pausa_de_vendas",
          "INSERT INTO public.pausa_de_vendas (id, vale_pela_assinatura) VALUES (1, true)",
        ]) {
          const r = await P.tentar(papel, sql, []);
          assert.equal(
            r.codigo,
            "42501",
            `${papel}: ${sql} -> ${JSON.stringify(r)}`,
          );
        }
      }
      // a linha unica: id diferente de 1 e' recusado ate para o dono
      const outra = await P.tentar(
        null,
        "INSERT INTO public.pausa_de_vendas (id, vale_pela_assinatura) VALUES (2, true)",
      );
      assert.equal(outra.codigo, "23514");
      assert.equal(outra.restricao, "pausa_de_vendas_linha_unica");
    });
  },
);

prova(
  "(1) PRE-VOO: sem store_config.manutencao, sem assinatura_da_loja.pausa_em ou com pausa_de_vendas torta, recusa com B1 sem escrever nada",
  async () => {
    const casos = [
      [
        "sem manutencao",
        "ALTER TABLE public.store_config RENAME COLUMN manutencao TO manutencao_x",
        /B1_BASELINE_DIVERGENT: public\.store_config sem manutencao/,
      ],
      [
        "sem pausa_em",
        "ALTER TABLE public.assinatura_da_loja RENAME COLUMN pausa_em TO pausa_x",
        /B1_BASELINE_DIVERGENT: public\.assinatura_da_loja nao tem a forma de 14 colunas/,
      ],
      [
        "pausa_de_vendas torta",
        "ALTER TABLE public.pausa_de_vendas ADD COLUMN extra text",
        /B1_BASELINE_DIVERGENT: public\.pausa_de_vendas ja existe com outra forma/,
      ],
      [
        "sem idempotency_key",
        "ALTER TABLE public.marketplace_orders RENAME COLUMN idempotency_key TO chave_x",
        /B1_BASELINE_DIVERGENT: public\.marketplace_orders sem canal/,
      ],
    ];
    for (const [rotulo, estrago, padrao] of casos) {
      await P.emTransacao(async () => {
        await C().query(estrago);
        const antes = await um(
          "SELECT to_regclass('public.pausa_de_vendas') IS NOT NULL AS existe, (SELECT count(*)::int FROM pg_class WHERE relname = 'pausa_de_vendas') AS n",
        );
        const r = await P.recusa(MIGRATION, padrao);
        assert.ok(r, rotulo);
        const depois = await um(
          "SELECT to_regclass('public.pausa_de_vendas') IS NOT NULL AS existe, (SELECT count(*)::int FROM pg_class WHERE relname = 'pausa_de_vendas') AS n",
        );
        assert.deepEqual(depois, antes, `${rotulo}: escreveu`);
      });
    }
  },
);

(async () => {
  await P.conectar();
  try {
    await P.executar("a-loja-pausa-o-pedido-novo");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
