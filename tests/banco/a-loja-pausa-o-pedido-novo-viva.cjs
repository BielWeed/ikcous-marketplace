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
const { assert, prova, sha256 } = P;

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

// ---------------------------------------------------------------------------------------------------------------------------
// (3) a marca suspensa_desde: gatilho em assinatura_da_loja, pela PORTA REAL do app de gestao (definir_chave + gravar)
// ---------------------------------------------------------------------------------------------------------------------------
const CHAVE = "chave-da-loja-pausa-de-vendas-3f1a9c7e5b2d4f6a8c0e1b3d5f7a9c2e";
const HASH = sha256(CHAVE);
/** O corpo da gestao (as 10 chaves + pausa_em). */
const CARTAO = {
  plano: "Pro",
  status: "ativa",
  ciclo: "mensal",
  valor_mensal: 250,
  inicio_em: "2026-11-03",
  teste_ate: null,
  proxima_cobranca_em: "2026-12-05",
  suporte_whatsapp: "5534999999999",
  gerenciar_url: "https://www.mercadopago.com.br/subscriptions/abc123",
  atualizado_em: "2026-11-20T10:00:00Z",
  pausa_em: null,
};
const carimbo = (n) => `2026-11-20T10:${String(n).padStart(2, "0")}:00Z`;
const hojeSP = async () =>
  (
    await um(
      "SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text AS d",
    )
  ).d;
/** A porta como o hub a chama (anon, a chave da loja). */
const gravar = (mudar, simular = false) =>
  P.tentar(
    "anon",
    "SELECT public.assinatura_da_loja_gravar($1::text, $2::jsonb, $3::boolean) AS j",
    [CHAVE, JSON.stringify({ ...CARTAO, ...mudar }), simular],
  );
const gravou = (x) => x.linhas?.[0]?.j?.gravado === true;
const pausaDeVendas = async () =>
  (await um(
    "SELECT vale_pela_assinatura AS vale, ligada_em::text AS ligada, suspensa_desde::text AS desde FROM public.pausa_de_vendas WHERE id = 1",
  )) || null;
/** Loja limpa: sem cartao, sem pausa, com a chave definida pela porta do service_role. */
const montarLoja = async () => {
  await C().query("DELETE FROM public.assinatura_da_loja");
  await C().query("DELETE FROM public.assinatura_da_loja_chave");
  await C().query("DELETE FROM public.pausa_de_vendas");
  const d = await P.tentar(
    "service_role",
    "SELECT public.assinatura_da_loja_definir_chave($1, true)",
    [HASH],
  );
  assert.ok(!d.erro, `definir_chave: ${JSON.stringify(d)}`);
};

async function marca() {
  const r = {};
  const hoje = await hojeSP();
  // ativa: nao cria linha de pausa
  const a1 = await gravar({ status: "ativa", atualizado_em: carimbo(1) });
  r.ativaNaoMarca =
    (gravou(a1) && (await pausaDeVendas()) === null) || JSON.stringify(a1);
  // a simulacao de suspensa nao grava nada
  const s0 = await gravar(
    { status: "suspensa", atualizado_em: carimbo(2) },
    true,
  );
  r.simulacaoNaoMarca =
    (!s0.erro && (await pausaDeVendas()) === null) || JSON.stringify(s0);
  // ativa -> suspensa grava o dia de Sao Paulo, sem ligar a pausa
  const s1 = await gravar({ status: "suspensa", atualizado_em: carimbo(3) });
  const p1 = await pausaDeVendas();
  r.suspensaMarcaHoje =
    (gravou(s1) && p1?.desde === hoje) || JSON.stringify({ s1, p1, hoje });
  r.marcaNaoLiga =
    (p1?.vale === false && p1?.ligada === null) || JSON.stringify(p1);
  // suspensa -> suspensa (o reenvio das 03:00) MANTEM o dia (o dia antigo e a chave ligada postos por escrita direta do dono)
  await C().query(
    "UPDATE public.pausa_de_vendas SET suspensa_desde = DATE '2026-12-01', vale_pela_assinatura = true, ligada_em = '2026-11-30T12:00:00Z' WHERE id = 1",
  );
  const s2 = await gravar({ status: "suspensa", atualizado_em: carimbo(4) });
  const p2 = await pausaDeVendas();
  r.reenvioMantem =
    (gravou(s2) && p2?.desde === "2026-12-01") || JSON.stringify({ s2, p2 });
  r.reenvioNaoMexeNaChave =
    (p2?.vale === true && p2?.ligada !== null) || JSON.stringify(p2);
  // gravacao mais velha (ignorada pela porta) nao mexe na marca
  const v = await gravar({ status: "ativa", atualizado_em: carimbo(1) });
  r.maisVelhoNaoApaga =
    (v.linhas?.[0]?.j?.motivo === "mais_velho" &&
      (await pausaDeVendas())?.desde === "2026-12-01") ||
    JSON.stringify(v);
  // suspensa -> ativa APAGA o dia e mantem a chave ligada
  const a2 = await gravar({ status: "ativa", atualizado_em: carimbo(5) });
  const p3 = await pausaDeVendas();
  r.saiApaga =
    (gravou(a2) && p3?.desde === null && p3?.vale === true) ||
    JSON.stringify({ a2, p3 });
  // de novo suspensa: o dia de hoje (recomeca)
  const s3 = await gravar({ status: "suspensa", atualizado_em: carimbo(6) });
  r.voltaRecomeca =
    (gravou(s3) && (await pausaDeVendas())?.desde === hoje) ||
    JSON.stringify(s3);
  // atrasada tambem e' "saiu"
  const a3 = await gravar({ status: "atrasada", atualizado_em: carimbo(7) });
  r.atrasadaApaga =
    (gravou(a3) && (await pausaDeVendas())?.desde === null) ||
    JSON.stringify(a3);
  // primeira gravacao ja suspensa (sem cartao nem pausa antes): marca hoje
  await C().query("DELETE FROM public.assinatura_da_loja");
  await C().query("DELETE FROM public.pausa_de_vendas");
  const s4 = await gravar({ status: "suspensa", atualizado_em: carimbo(8) });
  r.primeiraJaSuspensa =
    (gravou(s4) && (await pausaDeVendas())?.desde === hoje) ||
    JSON.stringify(s4);
  return r;
}

prova(
  "(3) MARCA: ativa->suspensa grava o dia de Sao Paulo; reenvio mantem; sair (ativa ou atrasada) apaga; simulacao e gravacao mais velha nao mexem; nunca liga a pausa",
  async () => {
    await P.emTransacao(async () => {
      const r = await marca();
      assert.deepEqual(vermelhas(r), [], JSON.stringify(r));
    }, montarLoja);
  },
);

/** O pg_get_triggerdef com search_path = pg_catalog (nomes sempre qualificados). */
const definicaoDoGatilho = async (tabela, nome) => {
  const caminho = (await um("SELECT current_setting('search_path') AS s")).s;
  await C().query("SELECT set_config('search_path', 'pg_catalog', true)");
  try {
    return await um(
      `SELECT pg_get_triggerdef(t.oid) AS def, t.tgenabled AS ligado FROM pg_trigger t
        WHERE t.tgrelid = to_regclass($1) AND t.tgname = $2`,
      [tabela, nome],
    );
  } finally {
    await C().query("SELECT set_config('search_path', $1, true)", [caminho]);
  }
};

prova(
  "(3) MARCA: gatilho AFTER INSERT OR UPDATE OF status, por linha, SECURITY DEFINER com search_path fixo e EXECUTE de ninguem",
  async () => {
    await P.emTransacao(async () => {
      assert.deepEqual(
        await definicaoDoGatilho(
          "public.assinatura_da_loja",
          "tr_assinatura_marca_suspensa_desde",
        ),
        {
          def: "CREATE TRIGGER tr_assinatura_marca_suspensa_desde AFTER INSERT OR UPDATE OF status ON public.assinatura_da_loja FOR EACH ROW EXECUTE FUNCTION public.marcar_suspensa_desde()",
          ligado: "O",
        },
      );
      const f = await um(
        "SELECT p.prosecdef AS secdef, p.proconfig AS cfg, p.provolatile AS vol FROM pg_proc p WHERE p.oid = to_regprocedure('public.marcar_suspensa_desde()')",
      );
      assert.deepEqual(f, {
        secdef: true,
        cfg: ["search_path=public, pg_temp"],
        vol: "v",
      });
      for (const papel of ["anon", "authenticated", "service_role"]) {
        const x = await um(
          "SELECT has_function_privilege($1, to_regprocedure('public.marcar_suspensa_desde()'), 'EXECUTE') AS pode",
          [papel],
        );
        assert.equal(x.pode, false, papel);
      }
    });
  },
);

prova(
  "(3) MARCA QUE FALHA NUNCA DERRUBA A PORTA: com a marca sabotada a porta grava suspensa e depois ativa (o 'pagou, reabre'); sem o EXCEPTION a mesma sabotagem derruba (controle)",
  async () => {
    const original = textoDe(MIGRATION, "marcar_suspensa_desde");
    const quebrada = trocar(
      original,
      "INSERT INTO public.pausa_de_vendas AS p",
      "INSERT INTO public.pausa_de_vendas_que_nao_existe AS p",
    );
    await P.emTransacao(async () => {
      await C().query(quebrada);
      const avisos = [];
      const ouvir = (m) => avisos.push(m.message);
      C().on("notice", ouvir);
      try {
        const s = await gravar({
          status: "suspensa",
          atualizado_em: carimbo(3),
        });
        assert.ok(gravou(s), JSON.stringify(s));
        assert.equal(
          (
            await um(
              "SELECT status FROM public.assinatura_da_loja WHERE id = 1",
            )
          ).status,
          "suspensa",
        );
        assert.equal(await pausaDeVendas(), null);
        assert.ok(
          avisos.some((m) => /marcar_suspensa_desde/.test(m)),
          `sem WARNING: ${JSON.stringify(avisos)}`,
        );
        const a = await gravar({ status: "ativa", atualizado_em: carimbo(4) });
        assert.ok(gravou(a), JSON.stringify(a));
      } finally {
        C().removeListener("notice", ouvir);
      }
    }, montarLoja);
    // controle: sem a guarda a sabotagem derruba a porta (e' a guarda que segura, nao a sorte)
    await P.emTransacao(async () => {
      const semGuarda = trocar(
        trocar(quebrada, "  EXCEPTION WHEN OTHERS THEN\n", "  -- sem guarda\n"),
        "    RAISE WARNING 'marcar_suspensa_desde",
        "    -- RAISE WARNING 'marcar_suspensa_desde",
      );
      await C().query(semGuarda);
      const s = await gravar({ status: "suspensa", atualizado_em: carimbo(3) });
      assert.equal(s.codigo, "42P01", JSON.stringify(s));
    }, montarLoja);
  },
);

/** [nome, trocas [[de, para]...], expectativa que TEM de ficar vermelha] */
const MUTANTES_MARCA = [
  [
    "reenvio regrava o dia",
    [
      [
        "IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'suspensa' THEN",
        "IF true THEN",
      ],
    ],
    "reenvioMantem",
  ],
  [
    "sair nao apaga",
    [["SET suspensa_desde = NULL", "SET suspensa_desde = suspensa_desde"]],
    "saiApaga",
  ],
  [
    "dia errado (um antes do de Sao Paulo)",
    [
      [
        "(now() AT TIME ZONE 'America/Sao_Paulo')::date",
        "(now() AT TIME ZONE 'America/Sao_Paulo')::date - 1",
      ],
    ],
    "suspensaMarcaHoje",
  ],
  [
    "marca liga a pausa",
    [
      [
        "AS p (id, suspensa_desde)",
        "AS p (id, vale_pela_assinatura, suspensa_desde)",
      ],
      ["VALUES (1, (now()", "VALUES (1, true, (now()"],
    ],
    "marcaNaoLiga",
  ],
];
prova(
  "(3) MUTANTES DA MARCA: cada sabotagem fica vermelha na expectativa certa",
  async () => {
    const original = textoDe(MIGRATION, "marcar_suspensa_desde");
    for (const [nome, trocas, alvo] of MUTANTES_MARCA) {
      const texto = trocas.reduce(
        (t, [de, para]) => trocar(t, de, para),
        original,
      );
      await P.emTransacao(async () => {
        await C().query(texto);
        const r = await marca();
        assert.ok(
          vermelhas(r).includes(alvo),
          `mutante "${nome}" nao ficou vermelho em ${alvo}: ${vermelhas(r).join(",")}`,
        );
      }, montarLoja);
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
