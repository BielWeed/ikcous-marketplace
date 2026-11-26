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

// ---------------------------------------------------------------------------------------------------------------------------
// (4) o motivo: manutencao, vendas_pausadas ou NULL, lido na hora (as 5 chaves da pausa por assinatura; a manutencao vence)
// ---------------------------------------------------------------------------------------------------------------------------
/**
 * As datas da loja PAUSADA, relativas a hoje (Sao Paulo), para o inicio cair numa SEGUNDA no passado (o fim de semana nunca
 * empurra para depois de hoje): segunda = a segunda da semana de (hoje - 14). Pagante: proxima = segunda - 11 (10 + 1 = a
 * segunda). Teste: teste_ate = proxima = segunda - 4 (3 + 1) e pausa_em = a segunda.
 */
const datasDaPausa = async () =>
  um(
    `WITH h AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje),
          s AS (SELECT hoje, date_trunc('week', hoje - 14)::date AS segunda FROM h)
     SELECT hoje::text, segunda::text, (segunda - 11)::text AS proxima_pagante, (segunda - 4)::text AS proxima_teste,
            (segunda - 1)::text AS desde, (hoje + 7)::text AS futuro FROM s`,
  );
/**
 * Poe a loja no estado pedido, por escrita direta do dono (sem a porta): o cartao, a chave e a pausa. `cartao` null = sem linha;
 * `pausa` null = sem linha. A marca do gatilho roda no INSERT do cartao; a linha da pausa e' escrita DEPOIS (ela manda).
 */
async function porLoja({ cartao, chave = true, pausa, manutencao = false }) {
  await C().query("DELETE FROM public.assinatura_da_loja");
  await C().query("DELETE FROM public.assinatura_da_loja_chave");
  await C().query("DELETE FROM public.pausa_de_vendas");
  await C().query(
    `INSERT INTO public.store_config (id, manutencao) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET manutencao = EXCLUDED.manutencao`,
    [manutencao],
  );
  if (chave)
    await C().query(
      "INSERT INTO public.assinatura_da_loja_chave (id, chave_hash) VALUES (1, $1)",
      [HASH],
    );
  if (cartao)
    await C().query(
      `INSERT INTO public.assinatura_da_loja (id, plano, status, ciclo, valor_mensal, teste_ate, proxima_cobranca_em, pausa_em, atualizado_em)
       VALUES (1, 'Pro', $1, 'mensal', 250, $2::date, $3::date, $4::date, now())`,
      [
        cartao.status,
        cartao.teste_ate ?? null,
        cartao.proxima ?? null,
        cartao.pausa_em ?? null,
      ],
    );
  // a marca do INSERT acima pode ter criado a linha: o estado pedido e' o desta funcao
  await C().query("DELETE FROM public.pausa_de_vendas");
  if (pausa)
    await C().query(
      "INSERT INTO public.pausa_de_vendas (id, vale_pela_assinatura, ligada_em, suspensa_desde) VALUES (1, $1, now(), $2::date)",
      [pausa.vale, pausa.desde ?? null],
    );
}
const motivo = async () => {
  const x = await P.tentar(
    null,
    "SELECT public.motivo_da_loja_nao_aceitar_pedido() AS m",
  );
  return x.erro ? `ERRO ${x.codigo} ${x.erro}` : x.linhas[0].m;
};
/** O estado PAUSADO de pagante (todas as chaves ligadas). `mudar` desliga uma. */
const pausadaPagante = (d, mudar = {}) => ({
  cartao: { status: "suspensa", proxima: d.proxima_pagante, ...mudar.cartao },
  pausa: { vale: true, desde: d.desde, ...mudar.pausa },
  ...mudar.loja,
});

async function motivos() {
  const d = await datasDaPausa();
  const r = {};
  const caso = async (nome, estado, esperado) => {
    await porLoja(estado);
    const m = await motivo();
    r[nome] = m === esperado || `${m} (esperado ${esperado})`;
  };
  await caso(
    "normal",
    { cartao: { status: "ativa", proxima: d.proxima_pagante } },
    null,
  );
  await caso("todasLigadasPagante", pausadaPagante(d), "vendas_pausadas");
  await caso(
    "todasLigadasTeste",
    pausadaPagante(d, {
      cartao: {
        teste_ate: d.proxima_teste,
        proxima: d.proxima_teste,
        pausa_em: d.segunda,
      },
    }),
    "vendas_pausadas",
  );
  // cada chave sozinha desligada: NULL
  await caso(
    "semCartao",
    pausadaPagante(d, { cartao: null, loja: { cartao: null } }),
    null,
  );
  await caso("semChave", pausadaPagante(d, { loja: { chave: false } }), null);
  await caso("naoLigada", pausadaPagante(d, { pausa: { vale: false } }), null);
  await caso(
    "semLinhaDePausa",
    pausadaPagante(d, { loja: { pausa: null } }),
    null,
  );
  await caso(
    "atrasada",
    pausadaPagante(d, { cartao: { status: "atrasada" } }),
    null,
  );
  await caso("ativa", pausadaPagante(d, { cartao: { status: "ativa" } }), null);
  await caso(
    "semProxima",
    pausadaPagante(d, { cartao: { proxima: null } }),
    null,
  );
  await caso(
    "semSuspensaDesde",
    pausadaPagante(d, { pausa: { desde: null } }),
    null,
  );
  await caso(
    "antesDoInicioPausaEm",
    pausadaPagante(d, { cartao: { pausa_em: d.futuro } }),
    null,
  );
  await caso(
    "antesDoInicioSuspensa",
    pausadaPagante(d, { pausa: { desde: d.futuro } }),
    null,
  );
  await caso(
    "sinalDeTesteSemPausaEm",
    pausadaPagante(d, {
      cartao: {
        teste_ate: d.proxima_teste,
        proxima: d.proxima_teste,
        pausa_em: null,
      },
    }),
    null,
  );
  // manutencao: vence a pausa e vale sozinha
  await caso(
    "manutencao",
    {
      cartao: { status: "ativa", proxima: d.proxima_pagante },
      manutencao: true,
    },
    "manutencao",
  );
  await caso(
    "manutencaoVenceAPausa",
    pausadaPagante(d, { loja: { manutencao: true } }),
    "manutencao",
  );
  await caso(
    "manutencaoSemCartao",
    { cartao: null, chave: false, manutencao: true },
    "manutencao",
  );
  return r;
}

prova(
  "(4) MOTIVO: cada chave sozinha desligada devolve NULL (sem cartao, sem chave, nao ligada, atrasada, sem proxima, sem suspensa_desde, antes do inicio, sinal de teste sem pausa_em); todas ligadas = vendas_pausadas; manutencao vence",
  async () => {
    await P.emTransacao(async () => {
      const r = await motivos();
      assert.deepEqual(vermelhas(r), [], JSON.stringify(r));
    });
  },
);

prova(
  "(4) MOTIVO: as tabelas da porta AUSENTES (rollback simulado na transacao) devolvem NULL sem erro; a manutencao continua valendo",
  async () => {
    for (const [rotulo, estrago] of [
      ["sem a tabela da chave", "DROP TABLE public.assinatura_da_loja_chave"],
      ["sem o cartao", "DROP TABLE public.assinatura_da_loja CASCADE"],
      ["sem pausa_de_vendas", "DROP TABLE public.pausa_de_vendas"],
    ]) {
      await P.emTransacao(async () => {
        const d = await datasDaPausa();
        await porLoja(pausadaPagante(d));
        assert.equal(await motivo(), "vendas_pausadas", `${rotulo}: controle`);
        await C().query(estrago);
        assert.equal(await motivo(), null, rotulo);
        await C().query(
          "UPDATE public.store_config SET manutencao = true WHERE id = 1",
        );
        assert.equal(await motivo(), "manutencao", `${rotulo}: manutencao`);
      });
    }
  },
);

prova(
  "(4) MOTIVO: STABLE, SECURITY DEFINER, search_path fixo, e EXECUTE de ninguem de aplicacao (anon, authenticated e service_role levam 42501)",
  async () => {
    await P.emTransacao(async () => {
      const f = await um(
        "SELECT p.provolatile AS vol, p.prosecdef AS secdef, p.proconfig AS cfg FROM pg_proc p WHERE p.oid = to_regprocedure('public.motivo_da_loja_nao_aceitar_pedido()')",
      );
      assert.deepEqual(f, {
        vol: "s",
        secdef: true,
        cfg: ["search_path=public, pg_temp"],
      });
      for (const papel of ["anon", "authenticated", "service_role"]) {
        const x = await P.tentar(
          papel,
          "SELECT public.motivo_da_loja_nao_aceitar_pedido()",
        );
        assert.equal(x.codigo, "42501", `${papel}: ${JSON.stringify(x)}`);
      }
    });
  },
);

/** [nome, trocas, expectativa que TEM de ficar vermelha] */
const MUTANTES_MOTIVO = [
  [
    "atrasada pausa",
    [
      [
        "v_status IS DISTINCT FROM 'suspensa'",
        "v_status NOT IN ('suspensa', 'atrasada')",
      ],
    ],
    "atrasada",
  ],
  [
    "sem exigir a chave",
    [
      [
        "IF NOT EXISTS (SELECT 1 FROM public.assinatura_da_loja_chave)",
        "IF false AND NOT EXISTS (SELECT 1 FROM public.assinatura_da_loja_chave)",
      ],
    ],
    "semChave",
  ],
  [
    "sem exigir a pausa ligada",
    [["IF v_vale IS NOT TRUE THEN", "IF false THEN"]],
    "naoLigada",
  ],
  [
    "ignora o dia de inicio",
    [["OR v_hoje < v_inicio", "OR false"]],
    "antesDoInicioPausaEm",
  ],
  [
    "sem pausa_em na conta (pausa antes do dia prometido)",
    [["v_suspensa_desde, v_pausa_em)", "v_suspensa_desde, NULL)"]],
    "antesDoInicioPausaEm",
  ],
  [
    "manutencao ignorada",
    [["IF v_manutencao IS TRUE THEN", "IF false THEN"]],
    "manutencaoVenceAPausa",
  ],
  [
    "manutencao de outra linha",
    [
      [
        "FROM public.store_config s WHERE s.id = 1",
        "FROM public.store_config s WHERE s.id = 2",
      ],
    ],
    "manutencao",
  ],
];
prova(
  "(4) MUTANTES DO MOTIVO: cada sabotagem fica vermelha na expectativa certa",
  async () => {
    const original = textoDe(MIGRATION, "motivo_da_loja_nao_aceitar_pedido");
    for (const [nome, trocas, alvo] of MUTANTES_MOTIVO) {
      const texto = trocas.reduce(
        (t, [de, para]) => trocar(t, de, para),
        original,
      );
      await P.emTransacao(async () => {
        await C().query(texto);
        const r = await motivos();
        assert.ok(
          vermelhas(r).includes(alvo),
          `mutante "${nome}" nao ficou vermelho em ${alvo}: ${vermelhas(r).join(",")}`,
        );
      });
    }
  },
);

// ---------------------------------------------------------------------------------------------------------------------------
// (5) o gatilho que recusa o pedido NOVO pela vitrine: pedidos reais pela v23 e pela v24, como cliente logado
// ---------------------------------------------------------------------------------------------------------------------------
const FRASE_PAUSADA = "Esta loja não está aceitando pedidos agora.";
const FRASE_MANUTENCAO = "A loja está em manutenção. Tente de novo mais tarde.";
const U_CLI = "16000000-0000-4000-8000-0000000000c1";
const U_ADM = "16000000-0000-4000-8000-0000000000a1";
const U_EX = "16000000-0000-4000-8000-0000000000e1";
const JWT = (papel) =>
  JSON.stringify({
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });
const QUEM = {
  cliente: { uid: U_CLI, claims: JWT("customer") },
  admin: { uid: U_ADM, claims: JWT("admin") },
  // rebaixado: o JWT ainda diz admin (vale ate expirar), mas auth.users e profiles ja dizem cliente
  exAdmin: { uid: U_EX, claims: JWT("admin") },
};
const PRODUTO = "16000000-0000-4000-8000-000000000001";
const CUPOM = "P1600CUPOM";
const CEP_LOCAL = "38500-100";
const DIGITADO = {
  street: "Rua Digitada",
  number: "5",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
  cep: CEP_LOCAL,
};
let seqChave = 0;
const novaChave = () => {
  seqChave += 1;
  return `16000000-0000-4000-8000-${String(seqChave).padStart(12, "0")}`;
};

/** A loja que vende: atores, configuracao de compra, um produto com estoque e um cupom. Escrita direta do dono, na transacao. */
async function semearLoja() {
  for (const [id, meta, papel] of [
    [U_CLI, "{}", "customer"],
    [U_ADM, '{"role":"admin"}', "admin"],
    [U_EX, "{}", "customer"],
  ]) {
    await C().query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@1600.teste', $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data`,
      [id, meta],
    );
    await C().query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa 1600', $2)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [id, papel],
    );
  }
  await C().query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons,
        pagamento_online, formas_pagamento_entrega, store_address, enabled_shipping_methods, manutencao)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true,
        true, ARRAY['pix', 'card', 'cash'], 'Rua da Loja, 100 - Centro', ARRAY['local-delivery', 'store-pickup'], false)
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons, pagamento_online = EXCLUDED.pagamento_online,
           formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega, store_address = EXCLUDED.store_address,
           enabled_shipping_methods = EXCLUDED.enabled_shipping_methods, manutencao = false`,
  );
  await C().query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Produto 1600', 100, 50, true, 40, false)",
    [PRODUTO],
  );
  await C().query(
    `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active)
     VALUES ($1, 'fixed', 10, 0, 100, 0, NULL, true)`,
    [CUPOM],
  );
}
/**
 * Volta a sessao a ser o DONO sem JWT: o P.tentar deixa o JWT e o auth.uid() do ultimo papel na transacao (set_config local), e a trava
 * dominio_publico_so_muda_pela_frota de store_config olha o claim role.
 */
const comoDono = () =>
  C().query(
    "SELECT set_config('request.jwt.claims', '', true), set_config('app.rpc.user_id', '', true)",
  );
/** A loja com as vendas PAUSADAS por assinatura (todas as 5 chaves). */
const pausar = async () => {
  await comoDono();
  const d = await datasDaPausa();
  await C().query("DELETE FROM public.assinatura_da_loja");
  await C().query("DELETE FROM public.assinatura_da_loja_chave");
  await C().query(
    "INSERT INTO public.assinatura_da_loja_chave (id, chave_hash) VALUES (1, $1)",
    [HASH],
  );
  await C().query(
    `INSERT INTO public.assinatura_da_loja (id, plano, status, ciclo, valor_mensal, proxima_cobranca_em, atualizado_em)
     VALUES (1, 'Pro', 'suspensa', 'mensal', 250, $1::date, now())`,
    [d.proxima_pagante],
  );
  await C().query(
    `INSERT INTO public.pausa_de_vendas (id, vale_pela_assinatura, ligada_em, suspensa_desde) VALUES (1, true, now(), $1::date)
     ON CONFLICT (id) DO UPDATE SET vale_pela_assinatura = true, ligada_em = now(), suspensa_desde = EXCLUDED.suspensa_desde`,
    [d.desde],
  );
  assert.equal(
    await motivo(),
    "vendas_pausadas",
    "a semente da pausa nao pausou",
  );
};
const manutencao = async (ligada) => {
  await comoDono();
  await C().query(
    "UPDATE public.store_config SET manutencao = $1 WHERE id = 1",
    [ligada],
  );
};

const SQL_PEDIDO = (rpc) =>
  `SELECT public.${rpc}($1::jsonb, $2::numeric, 0::numeric, $3::text, NULL::uuid, $4::text,
     'Comprador Prova', '5534999990000', NULL::text, $5::jsonb, $6::text, 'local-delivery', $7::uuid) AS id`;
/** Um pedido pela vitrine: v23 (na entrega, 'cash') ou v24 (pelo app, 'online'); com cupom o total e' 90. */
const comprar = (
  quem,
  {
    rpc = "create_marketplace_order_v24",
    chave = novaChave(),
    cupom = null,
  } = {},
) =>
  P.tentar(
    "authenticated",
    SQL_PEDIDO(rpc),
    [
      JSON.stringify([{ product_id: PRODUTO, variant_id: null, quantity: 1 }]),
      cupom ? 90 : 100,
      rpc === "create_marketplace_order_v24" ? "online" : "cash",
      cupom,
      JSON.stringify(DIGITADO),
      CEP_LOCAL,
      chave,
    ],
    QUEM[quem],
  );
const idDe = (x) => x.linhas?.[0]?.id ?? null;
const SQL_BALCAO =
  "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL::uuid, NULL, NULL, 0::numeric, NULL, $2::uuid) AS r";
const venderNoBalcao = (quem = "admin") =>
  P.tentar(
    "authenticated",
    SQL_BALCAO,
    [
      JSON.stringify([{ product_id: PRODUTO, variant_id: null, quantity: 1 }]),
      novaChave(),
    ],
    QUEM[quem],
  );
/** O que uma recusa nao pode ter mexido: pedidos, itens, estoque e o uso do cupom. */
const livro = async () =>
  um(
    `SELECT (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos,
            (SELECT count(*)::int FROM public.marketplace_order_items) AS itens,
            (SELECT estoque FROM public.produtos WHERE id = $1) AS estoque,
            (SELECT usage_count FROM public.coupons WHERE code = $2) AS uso_do_cupom`,
    [PRODUTO, CUPOM],
  );
const recusou = (x, frase) => x.codigo === "P0001" && x.erro === frase;

async function pedidos() {
  const r = {};
  const anota = (nome, ok, x) => {
    r[nome] = ok || JSON.stringify(x);
  };
  // CONTROLE: loja normal cria pelas duas
  for (const rpc of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    const x = await comprar("cliente", { rpc });
    anota(`normal_${rpc.slice(-3)}`, idDe(x) !== null, x);
  }
  const xc = await comprar("cliente", { cupom: CUPOM });
  anota("normalComCupom", idDe(xc) !== null, xc);
  // o pedido de ANTES da pausa, para a retentativa e para o que ja existe
  const chaveAntiga = novaChave();
  const antigo = idDe(await comprar("cliente", { chave: chaveAntiga }));
  const antigoV23 = idDe(
    await comprar("cliente", { rpc: "create_marketplace_order_v23" }),
  );

  // PAUSADA: as duas recusam com a frase exata, e nada muda (pedido, item, estoque, uso do cupom)
  await pausar();
  for (const [rpc, cupom] of [
    ["create_marketplace_order_v23", null],
    ["create_marketplace_order_v24", null],
    ["create_marketplace_order_v24", CUPOM],
  ]) {
    const antes = await livro();
    const x = await comprar("cliente", { rpc, cupom });
    const depois = await livro();
    anota(
      `pausada_${rpc.slice(-3)}${cupom ? "_cupom" : ""}`,
      recusou(x, FRASE_PAUSADA) &&
        JSON.stringify(antes) === JSON.stringify(depois),
      { x, antes, depois },
    );
  }
  // pausada: o admin atual TAMBEM e' recusado pela vitrine (sem isencao) e o visitante tambem
  const xa = await comprar("admin");
  anota("pausadaAdminRecusado", recusou(xa, FRASE_PAUSADA), xa);
  // a RETENTATIVA do pedido de antes (mesma chave) devolve o MESMO pedido, sem gemeo
  const antesRetry = await livro();
  const retry = await comprar("cliente", { chave: chaveAntiga });
  anota(
    "retentativaDevolveOMesmo",
    antigo !== null &&
      idDe(retry) === antigo &&
      JSON.stringify(antesRetry) === JSON.stringify(await livro()),
    { antigo, retry },
  );
  // o BALCAO vende com a vitrine pausada
  const b1 = await venderNoBalcao();
  anota("balcaoPausada", !b1.erro, b1);
  // o que JA EXISTE segue: pagamento confirmado, cancelamento e estorno no pedido de antes
  // (a cobranca do pedido de antes e' criada agora, depois da pausa: o criar-pagamento so ATUALIZA o pedido, e o gatilho e' so de INSERT)
  await comoDono();
  const cobranca = await P.tentar(
    null,
    "UPDATE public.marketplace_orders SET gateway_payment_id = 'pagamento-1600' WHERE id = $1",
    [antigo],
  );
  anota("cobrancaDePedidoDeAntes", !cobranca.erro, cobranca);
  const pago = await P.tentar(
    "service_role",
    "SELECT public.confirmar_pagamento($1::uuid, 'pagamento-1600', 'pago') AS r",
    [antigo],
  );
  const pagoNoBanco = await um(
    "SELECT payment_status FROM public.marketplace_orders WHERE id = $1",
    [antigo],
  );
  anota(
    "pagamentoDeAntesGrava",
    !pago.erro && pagoNoBanco?.payment_status === "pago",
    { pago, pagoNoBanco },
  );
  const cancelado = await P.tentar(
    null,
    "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
    [antigoV23],
  );
  const estornado = await P.tentar(
    null,
    "UPDATE public.marketplace_orders SET payment_status = 'estornado' WHERE id = $1",
    [antigo],
  );
  anota("cancelarEEstornarSeguem", !cancelado.erro && !estornado.erro, {
    cancelado,
    estornado,
  });

  // MANUTENCAO (sem a pausa): cliente recusado; admin atual cria; ex-admin recusado; balcao vende
  await C().query(
    "UPDATE public.pausa_de_vendas SET vale_pela_assinatura = false WHERE id = 1",
  );
  await manutencao(true);
  for (const rpc of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    const antes = await livro();
    const x = await comprar("cliente", { rpc });
    anota(
      `manutencaoCliente_${rpc.slice(-3)}`,
      recusou(x, FRASE_MANUTENCAO) &&
        JSON.stringify(antes) === JSON.stringify(await livro()),
      x,
    );
  }
  const ma = await comprar("admin");
  anota("manutencaoAdminCria", idDe(ma) !== null, ma);
  const mx = await comprar("exAdmin");
  anota("manutencaoExAdminRecusado", recusou(mx, FRASE_MANUTENCAO), mx);
  const b2 = await venderNoBalcao();
  anota("balcaoManutencao", !b2.erro, b2);
  // manutencao vence a pausa: com as duas, a frase e' a da manutencao
  await C().query(
    "UPDATE public.pausa_de_vendas SET vale_pela_assinatura = true WHERE id = 1",
  );
  const mp = await comprar("cliente");
  anota("manutencaoVenceAPausa", recusou(mp, FRASE_MANUTENCAO), mp);
  // e de volta ao normal: a loja vende de novo no PROXIMO pedido (o "pagou, reabre")
  await manutencao(false);
  await C().query(
    "UPDATE public.assinatura_da_loja SET status = 'ativa' WHERE id = 1",
  );
  const reaberta = await comprar("cliente");
  anota("reabreNoProximoPedido", idDe(reaberta) !== null, reaberta);
  return r;
}

prova(
  "(5) PEDIDO: loja normal cria pela v23 e v24; pausada recusa as duas com a frase exata sem mexer em pedido, item, estoque nem cupom; manutencao recusa cliente e ex-admin e deixa o admin atual; balcao, retentativa, pagamento, cancelamento e estorno seguem",
  async () => {
    await P.emTransacao(async () => {
      const r = await pedidos();
      assert.deepEqual(vermelhas(r), [], JSON.stringify(r, null, 1));
    }, semearLoja);
  },
);

/** INSERT direto (o dono, canal online) com a chave de um pedido que ja existe: o indice unico age (23505), nao a pausa. */
async function insertGemeo() {
  const chave = novaChave();
  const antigo = idDe(await comprar("cliente", { chave }));
  await pausar();
  const gemeo = await P.tentar(
    null,
    "INSERT INTO public.marketplace_orders (user_id, customer_name, customer_data, subtotal, total, status, idempotency_key) VALUES ($1, 'Direto', '{}'::jsonb, 100, 100, 'pending', $2::uuid)",
    [U_CLI, chave],
  );
  const novo = await P.tentar(
    null,
    "INSERT INTO public.marketplace_orders (user_id, customer_name, customer_data, subtotal, total, status, idempotency_key) VALUES ($1, 'Direto', '{}'::jsonb, 100, 100, 'pending', $2::uuid)",
    [U_CLI, novaChave()],
  );
  const balcaoDireto = await P.tentar(
    null,
    "INSERT INTO public.marketplace_orders (user_id, customer_name, customer_data, subtotal, total, status, canal) VALUES ($1, 'Balcao direto', '{}'::jsonb, 100, 100, 'pending', 'presencial') RETURNING id",
    [U_ADM],
  );
  return {
    atalhoGemeo:
      (antigo !== null && gemeo.codigo === "23505") || JSON.stringify(gemeo),
    insertNovoRecusado: recusou(novo, FRASE_PAUSADA) || JSON.stringify(novo),
    insertPresencialPassa: !balcaoDireto.erro || JSON.stringify(balcaoDireto),
  };
}

prova(
  "(5) ATALHO GEMEO E WHEN DO BALCAO: INSERT com a chave de pedido que ja existe deixa o indice unico agir (23505, o tratamento da v23/v24 devolve o pedido); chave nova e' recusada; canal presencial nem chama o gatilho",
  async () => {
    await P.emTransacao(async () => {
      const r = await insertGemeo();
      assert.deepEqual(vermelhas(r), [], JSON.stringify(r));
    }, semearLoja);
  },
);

prova(
  "(5) GATILHO: BEFORE INSERT por linha com o WHEN do balcao, o PRIMEIRO dos BEFORE INSERT de marketplace_orders (antes dos do cupom), SECURITY DEFINER e EXECUTE de ninguem",
  async () => {
    await P.emTransacao(async () => {
      assert.deepEqual(
        await definicaoDoGatilho(
          "public.marketplace_orders",
          "tr_a_loja_aceita_pedido_novo",
        ),
        {
          def: "CREATE TRIGGER tr_a_loja_aceita_pedido_novo BEFORE INSERT ON public.marketplace_orders FOR EACH ROW WHEN ((new.canal IS DISTINCT FROM 'presencial'::text)) EXECUTE FUNCTION public.a_loja_aceita_pedido_novo()",
          ligado: "O",
        },
      );
      // tgtype: ROW (1) + BEFORE (2) + INSERT (4) = 7. A ordem dos gatilhos do mesmo evento e' a do nome (bytes).
      const ordem = (
        await C().query(
          `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.marketplace_orders'::regclass AND NOT tgisinternal
              AND (tgtype & 2) = 2 AND (tgtype & 4) = 4 ORDER BY tgname COLLATE "C"`,
        )
      ).rows.map((x) => x.tgname);
      assert.equal(
        ordem[0],
        "tr_a_loja_aceita_pedido_novo",
        JSON.stringify(ordem),
      );
      const f = await um(
        "SELECT p.prosecdef AS secdef, p.proconfig AS cfg, p.provolatile AS vol FROM pg_proc p WHERE p.oid = to_regprocedure('public.a_loja_aceita_pedido_novo()')",
      );
      assert.deepEqual(f, {
        secdef: true,
        cfg: ["search_path=public, pg_temp"],
        vol: "v",
      });
      for (const papel of ["anon", "authenticated", "service_role"]) {
        const x = await um(
          "SELECT has_function_privilege($1, to_regprocedure('public.a_loja_aceita_pedido_novo()'), 'EXECUTE') AS pode",
          [papel],
        );
        assert.equal(x.pode, false, papel);
      }
    });
  },
);

prova(
  "(5) DEFEITO NA LEITURA = VENDE: com o motivo quebrado (erro), a loja pausada CRIA o pedido e sai WARNING; sem o EXCEPTION o defeito derruba (controle)",
  async () => {
    const quebrado = `CREATE OR REPLACE FUNCTION public.motivo_da_loja_nao_aceitar_pedido() RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
      SET search_path = public, pg_temp AS $q$ BEGIN RAISE EXCEPTION 'motivo quebrado de proposito'; END; $q$`;
    await P.emTransacao(async () => {
      await pausar();
      await C().query(quebrado);
      const avisos = [];
      const ouvir = (m) => avisos.push(m.message);
      C().on("notice", ouvir);
      try {
        const x = await comprar("cliente");
        assert.ok(idDe(x) !== null, JSON.stringify(x));
        assert.ok(
          avisos.some(
            (m) =>
              /a_loja_aceita_pedido_novo/.test(m) &&
              /motivo quebrado de proposito/.test(m),
          ),
          JSON.stringify(avisos),
        );
      } finally {
        C().removeListener("notice", ouvir);
      }
    }, semearLoja);
    await P.emTransacao(async () => {
      await pausar();
      await C().query(quebrado);
      const semGuarda = trocar(
        textoDe(MIGRATION, "a_loja_aceita_pedido_novo"),
        "  EXCEPTION WHEN OTHERS THEN\n",
        "  EXCEPTION WHEN division_by_zero THEN\n",
      );
      await C().query(semGuarda);
      const x = await comprar("cliente");
      assert.equal(x.erro, "motivo quebrado de proposito", JSON.stringify(x));
    }, semearLoja);
  },
);

/** [nome, trocas, roteiro ('pedidos' | 'gemeo'), expectativa que TEM de ficar vermelha] */
const MUTANTES_GATILHO = [
  [
    "sem o atalho gemeo",
    [
      [
        "IF NEW.idempotency_key IS NOT NULL\n     AND EXISTS",
        "IF false\n     AND EXISTS",
      ],
    ],
    "gemeo",
    "atalhoGemeo",
  ],
  [
    "manutencao sem isencao do admin atual",
    [["IF v_admin_atual THEN", "IF false THEN"]],
    "pedidos",
    "manutencaoAdminCria",
  ],
  [
    "isencao so pelo JWT (ex-admin passa)",
    [
      [
        "COALESCE(public.is_admin() AND public.is_admin_atual(), false)",
        "COALESCE(public.is_admin(), false)",
      ],
    ],
    "pedidos",
    "manutencaoExAdminRecusado",
  ],
  [
    "pausa com isencao do admin",
    [
      [
        "ELSIF v_motivo = 'vendas_pausadas' THEN",
        "ELSIF v_motivo = 'vendas_pausadas' AND NOT COALESCE(public.is_admin() AND public.is_admin_atual(), false) THEN",
      ],
    ],
    "pedidos",
    "pausadaAdminRecusado",
  ],
  [
    "pausada nao recusa",
    [["ELSIF v_motivo = 'vendas_pausadas' THEN", "ELSIF false THEN"]],
    "pedidos",
    "pausada_v24",
  ],
];
prova(
  "(5) MUTANTES DO GATILHO: cada sabotagem fica vermelha na expectativa certa",
  async () => {
    const original = textoDe(MIGRATION, "a_loja_aceita_pedido_novo");
    for (const [nome, trocas, roteiro, alvo] of MUTANTES_GATILHO) {
      const texto = trocas.reduce(
        (t, [de, para]) => trocar(t, de, para),
        original,
      );
      await P.emTransacao(async () => {
        await C().query(texto);
        const r = roteiro === "gemeo" ? await insertGemeo() : await pedidos();
        assert.ok(
          vermelhas(r).includes(alvo),
          `mutante "${nome}" nao ficou vermelho em ${alvo}: ${vermelhas(r).join(",")}`,
        );
      }, semearLoja);
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
