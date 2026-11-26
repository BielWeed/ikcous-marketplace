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

/** O texto inteiro do CREATE OR REPLACE FUNCTION public.<nome>(...) ... $function$; da migration (para os mutantes). */
const textoDe = (sql, nome) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  assert.ok(i >= 0, `funcao ${nome} nao achada na migration`);
  const a = sql.indexOf("AS $function$", i);
  return sql.slice(i, sql.indexOf("$function$;", a) + "$function$;".length);
};
/** Troca um trecho que TEM de existir (mutante que nao muda nada seria vacuo). */
const trocar = (texto, de, para) => {
  assert.ok(
    texto.includes(de),
    `mutante sem efeito: "${de}" nao esta no texto`,
  );
  return texto.split(de).join(para);
};
/** Lista de nomes das expectativas que NAO valem (as vermelhas). */
const vermelhas = (r) =>
  Object.entries(r)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
    .sort();

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

// ---------------------------------------------------------------------------------------------------------------------------
// (2) a regra das datas: data_da_pausa_de_vendas(teste_ate, proxima, suspensa_desde, pausa_em), pura (IMMUTABLE, sem now())
// ---------------------------------------------------------------------------------------------------------------------------
/** [nome, teste_ate, proxima, suspensa_desde, pausa_em, esperado] */
const CASOS_DATA = [
  // teste ate 03/12 (quinta): vende 04 a 06/12, pausa 07/12 (segunda), com o dia que a gestao prometeu
  [
    "testeQuinta",
    "2026-12-03",
    "2026-12-03",
    "2026-12-04",
    "2026-12-07",
    "2026-12-07",
  ],
  // pausa_em antes do minimo: o minimo vence (o banco nunca pausa antes da tolerancia)
  [
    "pausaAntesDoMinimo",
    "2026-12-03",
    "2026-12-03",
    "2026-12-04",
    "2026-12-04",
    "2026-12-07",
  ],
  // teste ate 07/12 (segunda) com o dia da gestao ANTES do minimo: o minimo 11/12 cai na sexta e passa para 14/12 (mede a tolerancia de 3 sem o piso)
  [
    "testeSegunda",
    "2026-12-07",
    "2026-12-07",
    "2026-12-08",
    "2026-12-08",
    "2026-12-14",
  ],
  // teste ate 01/12 (terca): o minimo cai em 05/12 (sabado) e passa para a segunda 07/12
  [
    "testeTercaMinimoNoSabado",
    "2026-12-01",
    "2026-12-01",
    "2026-12-02",
    "2026-12-02",
    "2026-12-07",
  ],
  // pagante com vencimento 05/12: 10 dias de tolerancia, pausa 16/12 (quarta)
  ["pagante", null, "2026-12-05", "2026-12-06", null, "2026-12-16"],
  // teste_ate diferente de proxima (pagou o teste e atrasou depois): os 10 dias
  [
    "testeDiferenteDaProxima",
    "2026-11-01",
    "2026-12-05",
    "2026-12-06",
    null,
    "2026-12-16",
  ],
  // suspensa depois do minimo, numa sexta: passa para a segunda seguinte
  ["suspensaNaSexta", null, "2026-12-05", "2026-12-18", null, "2026-12-21"],
  // minimo 31/12 (quinta) com o dia da gestao 04/01 (feriado e fim de semana no meio): vale o dia da gestao
  [
    "minimoAntesDaPausaEm",
    "2026-12-27",
    "2026-12-27",
    "2026-12-28",
    "2027-01-04",
    "2027-01-04",
  ],
  // pagante com pausa_em DEPOIS do minimo: o piso vale sempre (nunca pausa antes de pausa_em)
  [
    "pagantePausaEmDepois",
    null,
    "2026-12-05",
    "2026-12-06",
    "2026-12-22",
    "2026-12-22",
  ],
  // pausa_em num sabado (sinal torto): passa para a segunda
  [
    "pausaEmNoSabado",
    "2026-12-03",
    "2026-12-03",
    "2026-12-04",
    "2026-12-12",
    "2026-12-14",
  ],
  // sinal de teste SEM o dia da gestao: nao pausa
  [
    "sinalDeTesteSemPausaEm",
    "2026-12-03",
    "2026-12-03",
    "2026-12-04",
    null,
    null,
  ],
  // falta dado: nao pausa
  ["semProxima", null, null, "2026-12-04", "2026-12-07", null],
  ["semSuspensaDesde", "2026-12-03", "2026-12-03", null, "2026-12-07", null],
  ["paganteSemSuspensaDesde", null, "2026-12-05", null, null, null],
];
async function regraDasDatas() {
  const r = {};
  for (const [nome, teste, proxima, desde, pausa, esperado] of CASOS_DATA) {
    const x = await P.tentar(
      null,
      "SELECT public.data_da_pausa_de_vendas($1::date, $2::date, $3::date, $4::date)::text AS d",
      [teste, proxima, desde, pausa],
    );
    r[nome] =
      x.linhas?.[0]?.d === esperado ||
      `${JSON.stringify(x)} esperado ${esperado}`;
  }
  return r;
}

prova(
  "(2) DATAS: os casos da regra (teste 3 dias + 1, pagante 10 + 1, sexta a domingo para a segunda, piso pausa_em, sinal de teste sem pausa_em nao pausa, falta dado = NULL)",
  async () => {
    await P.emTransacao(async () => {
      const r = await regraDasDatas();
      assert.deepEqual(vermelhas(r), [], JSON.stringify(r));
    });
  },
);

prova(
  "(2) DATAS: IMMUTABLE, sem now(), search_path fixo e EXECUTE de ninguem de aplicacao (anon, authenticated e service_role levam 42501)",
  async () => {
    await P.emTransacao(async () => {
      const f = await um(
        `SELECT p.provolatile AS vol, p.prosecdef AS secdef, p.proconfig AS cfg, p.prosrc ~* 'now\\(|current_date|clock_timestamp|localtimestamp' AS relogio
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.data_da_pausa_de_vendas(date, date, date, date)')`,
      );
      assert.deepEqual(f, {
        vol: "i",
        secdef: false,
        cfg: ["search_path=public, pg_temp"],
        relogio: false,
      });
      for (const papel of ["anon", "authenticated", "service_role"]) {
        const x = await P.tentar(
          papel,
          "SELECT public.data_da_pausa_de_vendas('2026-12-03', '2026-12-03', '2026-12-04', '2026-12-07')",
        );
        assert.equal(x.codigo, "42501", `${papel}: ${JSON.stringify(x)}`);
      }
    });
  },
);

/** [nome, de, para, expectativa que TEM de ficar vermelha] */
const MUTANTES_DATA = [
  [
    "teste com 2 dias",
    "THEN 3 ELSE 10 END",
    "THEN 2 ELSE 10 END",
    "testeSegunda",
  ],
  ["pagante com 9 dias", "THEN 3 ELSE 10 END", "THEN 3 ELSE 9 END", "pagante"],
  ["sem o +1", "ELSE 10 END + 1,", "ELSE 10 END + 0,", "pagante"],
  [
    "sem o piso pausa_em",
    "p_suspensa_desde, p_pausa_em)",
    "p_suspensa_desde)",
    "minimoAntesDaPausaEm",
  ],
  ["sexta nao pula", "IN (5, 6, 7)", "IN (6, 7)", "suspensaNaSexta"],
  [
    "sem pular o fim de semana",
    "IN (5, 6, 7)",
    "IN (0)",
    "testeTercaMinimoNoSabado",
  ],
  [
    "suspensa_desde nulo pausa",
    "WHEN p_proxima IS NULL OR p_suspensa_desde IS NULL THEN NULL",
    "WHEN p_proxima IS NULL THEN NULL",
    "semSuspensaDesde",
  ],
  [
    "sinal de teste sem pausa_em pausa",
    "AND p_pausa_em IS NULL THEN NULL",
    "AND false THEN NULL",
    "sinalDeTesteSemPausaEm",
  ],
];
prova(
  "(2) MUTANTES DA DATA: cada sabotagem da regra fica vermelha na expectativa certa",
  async () => {
    const original = textoDe(MIGRATION, "data_da_pausa_de_vendas");
    for (const [nome, de, para, alvo] of MUTANTES_DATA) {
      await P.emTransacao(async () => {
        await C().query(trocar(original, de, para));
        const r = await regraDasDatas();
        assert.ok(
          vermelhas(r).includes(alvo),
          `mutante "${nome}" nao ficou vermelho em ${alvo}: ${vermelhas(r).join(",")}`,
        );
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
