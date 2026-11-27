"use strict";

/**
 * PROVA VIVA da migration 20261630000000_a_loja_ja_suspensa_tambem_pausa.sql contra o Postgres EFEMERO (clone do rodar-isolado.cjs: a
 * arvore migrada, com a 1630 no ar). Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs; molde: a-loja-pausa-o-pedido-novo-viva.cjs.
 *
 *  (1) MARCA       pela PORTA REAL do app de gestao (definir_chave + gravar): a loja que segue suspensa SEM dia ganha o dia de hoje (com e sem a
 *                  linha da pausa); COM dia, mantem; entrar, sair e atrasada como na 1600; simulacao e gravacao mais velha nao mexem; nunca liga.
 *  (2) PONTA A PONTA a loja antiga (suspensa, pausa ligada, dia NULL) aceita pedido antes do reenvio; depois dele o motivo segue a regra com o dia
 *                  de hoje (segunda se hoje for sexta a domingo).
 *  (3) CONTROLE    o corpo da 1600 (o rollback) no MESMO roteiro deixa o dia NULL e a loja vendendo: o defeito que esta migration conserta.
 *  (4) MUTANTES    cada sabotagem da marca nova fica vermelha na expectativa certa.
 *  (5) FALHA       a marca sabotada nunca derruba a porta (WARNING); sem o EXCEPTION, derruba (controle).
 *  (6) ATRIBUTOS   gatilho intacto, SECURITY DEFINER, search_path fixo, EXECUTE de ninguem.
 *  (7) MIGRATION   reaplicar 2x (LF e CRLF) igual; os dados que ja estavam la nao mudam; so a marca muda (retrato); rollback 2x volta a 1600 byte
 *                  a byte e deixa o rollback da 1600 passar; pre-voo e rollback recusam estado desconhecido; pos-voo recusa cada estrago; a falha
 *                  no fim nao deixa nada (sem BEGIN no arquivo).
 *  (8) CONSULTAS   199a/199b e 196a nos dois estados, com o rol fechado do conferir-banco; cada estrago reprova so o item certo.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-ja-suspensa-tambem-pausa-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, sha256 } = P;

const NOME = "20261630000000_a_loja_ja_suspensa_tambem_pausa.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK_SQL = P.lerMigration(`rollback-manual-${NOME}`);
const NOME_1600 = "20261600000000_a_loja_pausa_o_pedido_novo.sql";
const ROLLBACK_1600 = P.lerMigration(`rollback-manual-${NOME_1600}`);
const H1600 = "162120d86a79c72a8b3622d2777dfa8d";
const H1630 = "974c4efadc6876427ffe740312c7619b";

const C = () => P.conexao();
const um = async (sql, params = []) => (await C().query(sql, params)).rows[0];

/** O texto inteiro do CREATE OR REPLACE FUNCTION public.<nome>(...) ... $function$; (para os mutantes). */
const textoDe = (sql, nome) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  assert.ok(i >= 0, `funcao ${nome} nao achada`);
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
const vermelhas = (r) =>
  Object.entries(r)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
    .sort();
const hashDaMarca = async () =>
  (
    await um(
      "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('public.marcar_suspensa_desde()')",
    )
  )?.h ?? null;

// ---------------------------------------------------------------------------------------------------------------------------
// A loja, pela porta real do app de gestao
// ---------------------------------------------------------------------------------------------------------------------------
const CHAVE = "chave-da-loja-suspensa-antiga-7b2e4d6f8a0c1e3b5d7f9a1c3e5b7d9f";
const HASH = sha256(CHAVE);
const CARTAO = {
  plano: "Pro",
  status: "ativa",
  ciclo: "mensal",
  valor_mensal: 250,
  inicio_em: "2026-10-03",
  teste_ate: null,
  proxima_cobranca_em: "2026-10-05",
  suporte_whatsapp: "5534999999999",
  gerenciar_url: "https://www.mercadopago.com.br/subscriptions/abc123",
  atualizado_em: "2026-11-20T10:00:00Z",
  pausa_em: "2026-10-20",
};
const carimbo = (n) => `2026-11-20T10:${String(n).padStart(2, "0")}:00Z`;
const hojeSP = async () =>
  (
    await um(
      "SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text AS d",
    )
  ).d;
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
/**
 * A loja que ja estava suspensa quando a 1600 chegou: o cartao suspensa e a pausa LIGADA pelo dono, mas sem o dia (a marca da 1600 so
 * grava ao ENTRAR em suspensa). Montada pela porta (carimbo 1) e depois a escrita direta do dono apaga o dia, como estava antes da 1600.
 */
const lojaAntigaSuspensa = async ({ comLinha = true } = {}) => {
  const s = await gravar({ status: "suspensa", atualizado_em: carimbo(1) });
  assert.ok(gravou(s), JSON.stringify(s));
  if (comLinha)
    await C().query(
      "UPDATE public.pausa_de_vendas SET suspensa_desde = NULL, vale_pela_assinatura = true, ligada_em = '2026-11-01T12:00:00Z' WHERE id = 1",
    );
  else await C().query("DELETE FROM public.pausa_de_vendas");
};

async function marcaAntiga() {
  const r = {};
  const hoje = await hojeSP();
  // (a) suspensa sobre suspensa, SEM dia: o reenvio grava hoje e nao mexe na chave
  await lojaAntigaSuspensa();
  const s1 = await gravar({ status: "suspensa", atualizado_em: carimbo(2) });
  const p1 = await pausaDeVendas();
  r.semDiaGanhaHoje =
    (gravou(s1) && p1?.desde === hoje) || JSON.stringify({ s1, p1, hoje });
  r.semDiaNaoMexeNaChave =
    (p1?.vale === true && p1?.ligada !== null) || JSON.stringify(p1);
  // (b) suspensa sobre suspensa COM dia: mantem (o reenvio nao recomeca a contagem)
  await C().query(
    "UPDATE public.pausa_de_vendas SET suspensa_desde = DATE '2026-11-02' WHERE id = 1",
  );
  const s2 = await gravar({ status: "suspensa", atualizado_em: carimbo(3) });
  r.comDiaMantem =
    (gravou(s2) && (await pausaDeVendas())?.desde === "2026-11-02") ||
    JSON.stringify(s2);
  // (c) a simulacao e a gravacao mais velha nao chegam ao gatilho: o dia segue NULL
  await C().query(
    "UPDATE public.pausa_de_vendas SET suspensa_desde = NULL WHERE id = 1",
  );
  const s3 = await gravar(
    { status: "suspensa", atualizado_em: carimbo(9) },
    true,
  );
  r.simulacaoNaoMarca =
    (!s3.erro && (await pausaDeVendas())?.desde === null) || JSON.stringify(s3);
  const v = await gravar({ status: "suspensa", atualizado_em: carimbo(2) });
  r.maisVelhoNaoMarca =
    (v.linhas?.[0]?.j?.motivo === "mais_velho" &&
      (await pausaDeVendas())?.desde === null) ||
    JSON.stringify(v);
  // (d) sair (ativa) apaga o dia e mantem a chave; entrar de novo marca hoje; atrasada tambem apaga
  await C().query(
    "UPDATE public.pausa_de_vendas SET suspensa_desde = DATE '2026-11-02' WHERE id = 1",
  );
  const a1 = await gravar({ status: "ativa", atualizado_em: carimbo(4) });
  const p2 = await pausaDeVendas();
  r.saiApaga =
    (gravou(a1) && p2?.desde === null && p2?.vale === true) ||
    JSON.stringify({ a1, p2 });
  const s4 = await gravar({ status: "suspensa", atualizado_em: carimbo(5) });
  r.entrarMarcaHoje =
    (gravou(s4) && (await pausaDeVendas())?.desde === hoje) ||
    JSON.stringify(s4);
  const a2 = await gravar({ status: "atrasada", atualizado_em: carimbo(6) });
  r.atrasadaApaga =
    (gravou(a2) && (await pausaDeVendas())?.desde === null) ||
    JSON.stringify(a2);
  // (e) suspensa sobre suspensa SEM a linha da pausa (a tabela nasce vazia): cria a linha com hoje, sem ligar a pausa
  await C().query("DELETE FROM public.assinatura_da_loja");
  await C().query("DELETE FROM public.pausa_de_vendas");
  await lojaAntigaSuspensa({ comLinha: false });
  const s5 = await gravar({ status: "suspensa", atualizado_em: carimbo(7) });
  const p3 = await pausaDeVendas();
  r.semLinhaGanhaHoje =
    (gravou(s5) && p3?.desde === hoje) || JSON.stringify({ s5, p3 });
  // sem linha nenhuma tambem e' "nao ligou" (o caso do corpo da 1600, que nao cria a linha aqui)
  r.semLinhaNaoLiga =
    p3 === null ||
    (p3.vale === false && p3.ligada === null) ||
    JSON.stringify(p3);
  // (f) a primeira gravacao ja suspensa (sem cartao nem pausa): marca hoje, como na 1600
  await C().query("DELETE FROM public.assinatura_da_loja");
  await C().query("DELETE FROM public.pausa_de_vendas");
  const s6 = await gravar({ status: "suspensa", atualizado_em: carimbo(8) });
  r.primeiraJaSuspensa =
    (gravou(s6) && (await pausaDeVendas())?.desde === hoje) ||
    JSON.stringify(s6);
  return r;
}

const ESPERADO_PELA_1600_VERMELHO = ["semDiaGanhaHoje", "semLinhaGanhaHoje"];

prova(
  "(1) MARCA: suspensa sobre suspensa SEM dia ganha hoje (com e sem a linha), COM dia mantem; entrar/sair/atrasada como na 1600; simulacao e mais velha nao mexem; nunca liga",
  async () => {
    await P.emTransacao(async () => {
      assert.equal(await hashDaMarca(), H1630, "a 1630 tem de estar no ar");
      const r = await marcaAntiga();
      assert.deepEqual(vermelhas(r), [], JSON.stringify(r));
    }, montarLoja);
  },
);

prova(
  "(3) CONTROLE: com a marca da 1600 (o rollback) o MESMO roteiro deixa o dia NULL so nos dois casos da loja ja suspensa (o defeito)",
  async () => {
    await P.emTransacao(async () => {
      await C().query(ROLLBACK_SQL);
      assert.equal(await hashDaMarca(), H1600);
      const r = await marcaAntiga();
      assert.deepEqual(vermelhas(r), ESPERADO_PELA_1600_VERMELHO);
    }, montarLoja);
  },
);

// ---------------------------------------------------------------------------------------------------------------------------
// (2) de ponta a ponta: a regra e o motivo com o dia que a marca nova grava
// ---------------------------------------------------------------------------------------------------------------------------
/** proxima e pausa_em bem no passado: o inicio da pausa e' o dia em que a marca viu (hoje), segunda se hoje for sexta a domingo. */
const datas = async () =>
  um(
    `WITH h AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje)
     SELECT hoje::text, (hoje - 40)::text AS proxima, (hoje - 25)::text AS pausa_em,
            (hoje + CASE WHEN extract(isodow FROM hoje) IN (5, 6, 7) THEN 8 - extract(isodow FROM hoje)::integer ELSE 0 END)::text AS inicio
       FROM h`,
  );
const motivo = async () =>
  (await um("SELECT public.motivo_da_loja_nao_aceitar_pedido() AS m")).m;
const inicioDaPausa = async () =>
  (
    await um(
      `SELECT public.data_da_pausa_de_vendas(a.teste_ate, a.proxima_cobranca_em, p.suspensa_desde, a.pausa_em)::text AS d
         FROM public.assinatura_da_loja a CROSS JOIN public.pausa_de_vendas p WHERE a.id = 1 AND p.id = 1`,
    )
  )?.d ?? null;

async function pontaAPonta() {
  const d = await datas();
  const cartao = { proxima_cobranca_em: d.proxima, pausa_em: d.pausa_em };
  const s = await gravar({
    ...cartao,
    status: "suspensa",
    atualizado_em: carimbo(1),
  });
  assert.ok(gravou(s), JSON.stringify(s));
  await C().query(
    "INSERT INTO public.store_config (id, manutencao) VALUES (1, false) ON CONFLICT (id) DO UPDATE SET manutencao = false",
  );
  await C().query(
    "UPDATE public.pausa_de_vendas SET suspensa_desde = NULL, vale_pela_assinatura = true, ligada_em = now() WHERE id = 1",
  );
  const antes = { motivo: await motivo(), inicio: await inicioDaPausa() };
  const s2 = await gravar({
    ...cartao,
    status: "suspensa",
    atualizado_em: carimbo(2),
  });
  assert.ok(gravou(s2), JSON.stringify(s2));
  const depois = {
    desde: (await pausaDeVendas())?.desde ?? null,
    inicio: await inicioDaPausa(),
    motivo: await motivo(),
  };
  return { d, antes, depois };
}

prova(
  "(2) PONTA A PONTA: a loja antiga (suspensa, pausa ligada, dia NULL) vende antes do reenvio; depois dele o inicio e' o dia que a marca viu e o motivo segue a regra",
  async () => {
    await P.emTransacao(async () => {
      const { d, antes, depois } = await pontaAPonta();
      assert.deepEqual(antes, { motivo: null, inicio: null }, "antes");
      assert.equal(depois.desde, d.hoje);
      assert.equal(depois.inicio, d.inicio);
      assert.equal(
        depois.motivo,
        d.inicio <= d.hoje ? "vendas_pausadas" : null,
        JSON.stringify({ d, depois }),
      );
    }, montarLoja);
    // controle: com a marca da 1600 a mesma loja segue vendendo para sempre
    await P.emTransacao(async () => {
      await C().query(ROLLBACK_SQL);
      const { depois } = await pontaAPonta();
      assert.deepEqual(depois, { desde: null, inicio: null, motivo: null });
    }, montarLoja);
  },
);

// ---------------------------------------------------------------------------------------------------------------------------
// (4) mutantes da marca nova
// ---------------------------------------------------------------------------------------------------------------------------
const MUTANTES = [
  [
    "o ramo novo regrava o dia",
    [["\n        WHERE p.suspensa_desde IS NULL;", ";"]],
    "comDiaMantem",
  ],
  [
    "o ramo novo nunca grava",
    [["WHERE p.suspensa_desde IS NULL;", "WHERE false;"]],
    "semDiaGanhaHoje",
  ],
  [
    "a marca liga a pausa",
    [
      [
        "AS p (id, suspensa_desde)",
        "AS p (id, vale_pela_assinatura, suspensa_desde)",
      ],
      ["VALUES (1, (now()", "VALUES (1, true, (now()"],
    ],
    "semLinhaNaoLiga",
  ],
  [
    "dia errado (um antes do de Sao Paulo)",
    [
      [
        "(now() AT TIME ZONE 'America/Sao_Paulo')::date",
        "(now() AT TIME ZONE 'America/Sao_Paulo')::date - 1",
      ],
    ],
    "semDiaGanhaHoje",
  ],
  [
    "sair nao apaga (a parte da 1600 que ficou)",
    [["SET suspensa_desde = NULL", "SET suspensa_desde = suspensa_desde"]],
    "saiApaga",
  ],
];
prova(
  "(4) MUTANTES DA MARCA: cada sabotagem fica vermelha na expectativa certa",
  async () => {
    const original = textoDe(MIGRATION, "marcar_suspensa_desde");
    for (const [nome, trocas, alvo] of MUTANTES) {
      const texto = trocas.reduce(
        (t, [de, para]) => trocar(t, de, para),
        original,
      );
      await P.emTransacao(async () => {
        await C().query(texto);
        const r = await marcaAntiga();
        assert.ok(
          vermelhas(r).includes(alvo),
          `mutante "${nome}" nao ficou vermelho em ${alvo}: ${vermelhas(r).join(",")}`,
        );
      }, montarLoja);
    }
  },
);

// ---------------------------------------------------------------------------------------------------------------------------
// (5) a marca que falha nunca derruba a porta
// ---------------------------------------------------------------------------------------------------------------------------
prova(
  "(5) FALHA: com a marca nova sabotada a porta grava suspensa sobre suspensa (WARNING) e depois ativa; sem o EXCEPTION a mesma sabotagem derruba (controle)",
  async () => {
    const quebrada = trocar(
      textoDe(MIGRATION, "marcar_suspensa_desde"),
      "INSERT INTO public.pausa_de_vendas AS p",
      "INSERT INTO public.pausa_de_vendas_que_nao_existe AS p",
    );
    await P.emTransacao(async () => {
      await lojaAntigaSuspensa();
      await C().query(quebrada);
      const avisos = [];
      const ouvir = (m) => avisos.push(m.message);
      C().on("notice", ouvir);
      try {
        const s = await gravar({
          status: "suspensa",
          atualizado_em: carimbo(2),
        });
        assert.ok(gravou(s), JSON.stringify(s));
        assert.equal((await pausaDeVendas())?.desde, null);
        assert.ok(
          avisos.some((m) => /marcar_suspensa_desde/.test(m)),
          `sem WARNING: ${JSON.stringify(avisos)}`,
        );
        const a = await gravar({ status: "ativa", atualizado_em: carimbo(3) });
        assert.ok(gravou(a), JSON.stringify(a));
      } finally {
        C().removeListener("notice", ouvir);
      }
    }, montarLoja);
    await P.emTransacao(async () => {
      await lojaAntigaSuspensa();
      const semGuarda = trocar(
        trocar(quebrada, "  EXCEPTION WHEN OTHERS THEN\n", "  -- sem guarda\n"),
        "    RAISE WARNING 'marcar_suspensa_desde",
        "    -- RAISE WARNING 'marcar_suspensa_desde",
      );
      await C().query(semGuarda);
      const s = await gravar({ status: "suspensa", atualizado_em: carimbo(2) });
      assert.equal(s.codigo, "42P01", JSON.stringify(s));
    }, montarLoja);
  },
);

// ---------------------------------------------------------------------------------------------------------------------------
// (6) atributos
// ---------------------------------------------------------------------------------------------------------------------------
const DEF_GATILHO =
  "CREATE TRIGGER tr_assinatura_marca_suspensa_desde AFTER INSERT OR UPDATE OF status ON public.assinatura_da_loja FOR EACH ROW EXECUTE FUNCTION public.marcar_suspensa_desde()";
const definicaoDoGatilho = async () => {
  const caminho = (await um("SELECT current_setting('search_path') AS s")).s;
  await C().query("SELECT set_config('search_path', 'pg_catalog', true)");
  try {
    return await um(
      `SELECT pg_get_triggerdef(t.oid) AS def, t.tgenabled AS ligado FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.assinatura_da_loja') AND t.tgname = 'tr_assinatura_marca_suspensa_desde'`,
    );
  } finally {
    await C().query("SELECT set_config('search_path', $1, true)", [caminho]);
  }
};
prova(
  "(6) ATRIBUTOS: o gatilho da 1600 intacto e ligado; a marca SECURITY DEFINER, VOLATILE, search_path fixo, uma so, EXECUTE de ninguem",
  async () => {
    await P.emTransacao(async () => {
      assert.deepEqual(await definicaoDoGatilho(), {
        def: DEF_GATILHO,
        ligado: "O",
      });
      assert.deepEqual(
        await um(
          `SELECT p.prosecdef AS secdef, p.proconfig AS cfg, p.provolatile AS vol,
                  (SELECT count(*)::int FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'marcar_suspensa_desde') AS n
             FROM pg_proc p WHERE p.oid = to_regprocedure('public.marcar_suspensa_desde()')`,
        ),
        {
          secdef: true,
          cfg: ["search_path=public, pg_temp"],
          vol: "v",
          n: 1,
        },
      );
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

// ---------------------------------------------------------------------------------------------------------------------------
// (7) a migration: reaplicar, dados de antes, retrato, rollback, pre-voo, pos-voo e atomicidade
// ---------------------------------------------------------------------------------------------------------------------------
const aplicarOk = async (sql, rotulo) => {
  const r = await P.aplicar(sql);
  assert.equal(r, null, `${rotulo}: ${JSON.stringify(r)}`);
};
const estadoDaMarca = async () =>
  um(
    `SELECT p.oid::text AS oid, p.proacl::text AS acl, md5(replace(p.prosrc, chr(13), '')) AS h, p.proowner::regrole::text AS dono,
            obj_description(p.oid, 'pg_proc') LIKE '%20261630000000%' AS comentario
       FROM pg_proc p WHERE p.oid = to_regprocedure('public.marcar_suspensa_desde()')`,
  );
/** Os dados que ja estavam la: o cartao e a linha da pausa, inteiros. */
const dados = async () =>
  um(
    `SELECT (SELECT json_agg(a ORDER BY a.id) FROM public.assinatura_da_loja a) AS cartao,
            (SELECT json_agg(p ORDER BY p.id) FROM public.pausa_de_vendas p) AS pausa`,
  );

prova(
  "(7) REAPLICAR: 2x (LF e CRLF) deixa a marca igual (OID, ACL, dono, corpo) e NAO toca os dados que ja estavam la (a loja suspensa sem dia continua sem dia: nada de backfill)",
  async () => {
    await P.emTransacao(async () => {
      await lojaAntigaSuspensa();
      const marca0 = await estadoDaMarca();
      const dados0 = await dados();
      assert.equal(marca0.h, H1630);
      assert.equal(marca0.comentario, true);
      await aplicarOk(MIGRATION, "reaplicar LF");
      await aplicarOk(P.emCRLF(MIGRATION), "reaplicar CRLF");
      assert.deepEqual(await estadoDaMarca(), marca0);
      assert.deepEqual(await dados(), dados0);
      assert.equal(dados0.pausa[0].suspensa_desde, null);
      // o apply sobre a 1600 (o caso das lojas) tambem nao toca os dados
      await aplicarOk(ROLLBACK_SQL, "rollback");
      await aplicarOk(MIGRATION, "apply sobre a 1600");
      assert.deepEqual(await dados(), dados0);
      assert.deepEqual(await estadoDaMarca(), marca0);
    }, montarLoja);
  },
);

prova(
  "(7) SO A MARCA MUDA: o retrato de public (funcoes, ACL, politicas, gatilhos, restricoes) e' o mesmo antes e depois do apply e do rollback",
  async () => {
    await P.emTransacao(async () => {
      const sem = { funcoes: ["marcar_suspensa_desde"] };
      await aplicarOk(ROLLBACK_SQL, "rollback");
      const r0 = await P.retrato(sem);
      await aplicarOk(MIGRATION, "apply");
      assert.deepEqual(await P.retrato(sem), r0);
      await aplicarOk(ROLLBACK_SQL, "rollback de novo");
      assert.deepEqual(await P.retrato(sem), r0);
    });
  },
);

prova(
  "(7) ROLLBACK: 2x devolve a marca da 1600 byte a byte (mesmo OID, ACL e comentario da 1600) e o rollback da 1600 passa depois dele; sem ele o da 1600 recusa",
  async () => {
    await P.emTransacao(async () => {
      const antes = await estadoDaMarca();
      assert.ok(
        await P.recusa(ROLLBACK_1600, /B1_BASELINE_DIVERGENT/),
        "o rollback da 1600 devia recusar com a 1630 no ar",
      );
      await aplicarOk(ROLLBACK_SQL, "rollback 1");
      await aplicarOk(ROLLBACK_SQL, "rollback 2");
      const depois = await estadoDaMarca();
      assert.equal(depois.h, H1600);
      assert.equal(depois.oid, antes.oid);
      assert.equal(depois.acl, antes.acl);
      assert.equal(depois.comentario, false);
      assert.deepEqual(await definicaoDoGatilho(), {
        def: DEF_GATILHO,
        ligado: "O",
      });
      await aplicarOk(ROLLBACK_1600, "rollback da 1600 depois");
      assert.equal(await hashDaMarca(), null);
    });
  },
);

const PRE_VOO = [
  [
    "pausa_de_vendas torta",
    "ALTER TABLE public.pausa_de_vendas ADD COLUMN extra text",
    /B1_BASELINE_DIVERGENT: public\.pausa_de_vendas ausente ou com outra forma/,
  ],
  [
    "marca com corpo alheio",
    trocar(
      textoDe(MIGRATION, "marcar_suspensa_desde"),
      "RETURN NULL;",
      "RETURN NULL; -- alheio",
    ),
    /B1_BASELINE_DIVERGENT: public\.marcar_suspensa_desde\(\) tem corpo desconhecido/,
  ],
  [
    "marca com sobrecarga",
    "CREATE FUNCTION public.marcar_suspensa_desde(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    /B1_BASELINE_DIVERGENT: public\.marcar_suspensa_desde\(\) ausente, com sobrecarga/,
  ],
  [
    "gatilho desligado",
    "ALTER TABLE public.assinatura_da_loja DISABLE TRIGGER tr_assinatura_marca_suspensa_desde",
    /B1_BASELINE_DIVERGENT: o gatilho tr_assinatura_marca_suspensa_desde/,
  ],
  [
    "gatilho ausente",
    "DROP TRIGGER tr_assinatura_marca_suspensa_desde ON public.assinatura_da_loja",
    /B1_BASELINE_DIVERGENT: o gatilho tr_assinatura_marca_suspensa_desde/,
  ],
];
prova(
  "(7) PRE-VOO: tabela torta, corpo alheio, sobrecarga, gatilho desligado ou ausente recusam com B1 sem trocar a marca (a partir da 1600)",
  async () => {
    for (const [rotulo, estrago, padrao] of PRE_VOO) {
      await P.emTransacao(async () => {
        await C().query(ROLLBACK_SQL);
        await C().query(estrago);
        const h0 = await hashDaMarca();
        assert.ok(await P.recusa(MIGRATION, padrao), rotulo);
        assert.equal(await hashDaMarca(), h0, `${rotulo}: trocou a marca`);
      });
    }
  },
);

prova(
  "(7) ROLLBACK RECUSA: marca com corpo alheio ou com sobrecarga recusa com B1 sem trocar nada",
  async () => {
    for (const [rotulo, estrago] of [PRE_VOO[1], PRE_VOO[2]]) {
      await P.emTransacao(async () => {
        await C().query(estrago);
        const h0 = await hashDaMarca();
        assert.ok(
          await P.recusa(ROLLBACK_SQL, /B1_BASELINE_DIVERGENT/),
          rotulo,
        );
        assert.equal(await hashDaMarca(), h0, rotulo);
      });
    }
  },
);

const POS_VOO = [
  [
    "SECURITY INVOKER",
    "ALTER FUNCTION public.marcar_suspensa_desde() SECURITY INVOKER",
  ],
  [
    "sem search_path",
    "ALTER FUNCTION public.marcar_suspensa_desde() RESET search_path",
  ],
  ["STABLE", "ALTER FUNCTION public.marcar_suspensa_desde() STABLE"],
  [
    "EXECUTE ao anon",
    "GRANT EXECUTE ON FUNCTION public.marcar_suspensa_desde() TO anon",
  ],
  [
    "EXECUTE ao authenticated",
    "GRANT EXECUTE ON FUNCTION public.marcar_suspensa_desde() TO authenticated",
  ],
  [
    "EXECUTE ao service_role",
    "GRANT EXECUTE ON FUNCTION public.marcar_suspensa_desde() TO service_role",
  ],
  [
    "EXECUTE ao PUBLIC",
    "GRANT EXECUTE ON FUNCTION public.marcar_suspensa_desde() TO PUBLIC",
  ],
  [
    "corpo trocado",
    trocar(
      textoDe(MIGRATION, "marcar_suspensa_desde"),
      "RETURN NULL;",
      "RETURN NULL; -- trocado",
    ),
  ],
  [
    "gatilho desligado",
    "ALTER TABLE public.assinatura_da_loja DISABLE TRIGGER tr_assinatura_marca_suspensa_desde",
  ],
  [
    "gatilho so no INSERT",
    "DROP TRIGGER tr_assinatura_marca_suspensa_desde ON public.assinatura_da_loja; CREATE TRIGGER tr_assinatura_marca_suspensa_desde AFTER INSERT ON public.assinatura_da_loja FOR EACH ROW EXECUTE FUNCTION public.marcar_suspensa_desde()",
  ],
];
prova(
  "(7) POS-VOO: cada estrago (atributo, EXECUTE, corpo, gatilho) faz o bloco de conferencia recusar com B2",
  async () => {
    const conferencia = P.blocoDe(MIGRATION, "conferencia_20261630000000");
    await P.emTransacao(async () => {
      await aplicarOk(conferencia, "conferencia no estado certo");
    });
    for (const [rotulo, estrago] of POS_VOO) {
      await P.emTransacao(async () => {
        await C().query(estrago);
        assert.ok(await P.recusa(conferencia, /B2_POSVOO_DIVERGENTE/), rotulo);
      });
    }
  },
);

prova(
  "(7) ATOMICIDADE: sem BEGIN no arquivo, um pos-voo que falha no FIM desfaz a marca nova (a da 1600 fica) na transacao de quem aplica",
  async () => {
    assert.ok(!/^\s*(BEGIN|COMMIT)\s*;/im.test(MIGRATION), "BEGIN/COMMIT");
    const falhaNoFim = trocar(
      MIGRATION,
      `IS DISTINCT FROM '${H1630}' THEN\n    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o corpo vivo`,
      `IS DISTINCT FROM 'x${H1630}' THEN\n    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o corpo vivo`,
    );
    await P.emTransacao(async () => {
      await C().query(ROLLBACK_SQL);
      assert.ok(await P.recusa(falhaNoFim, /B2_POSVOO_DIVERGENTE/));
      assert.equal(await hashDaMarca(), H1600);
    });
  },
);

// ---------------------------------------------------------------------------------------------------------------------------
// (8) as conferencias: 199a, 199b e a 196a (que aceita a marca desta como sucessora)
// ---------------------------------------------------------------------------------------------------------------------------
const A199 = "199a-conferir-a-loja-ja-suspensa-tambem-pausa-aplicado";
const B199 = "199b-antes-a-loja-ja-suspensa-tambem-pausa-base-vigente";
const A196 = "196a-conferir-a-loja-pausa-o-pedido-novo-aplicado";
const ITEM_CORPO = "marcar_suspensa_desde: corpo exato (md5)";
const ITEM_ATRIBUTOS =
  "marcar_suspensa_desde: uma so, plpgsql SECURITY DEFINER VOLATILE, retorno trigger, search_path fixo e EXECUTE de ninguem";
const ITEM_GATILHO =
  "tr_assinatura_marca_suspensa_desde: AFTER INSERT OR UPDATE OF status por linha em assinatura_da_loja, chama a marca, ligado";
const ITEM_TABELA =
  "pausa_de_vendas: a tabela de linha unica da 20261600000000 (4 colunas)";
prova(
  "(8) CONSULTAS: com a 1630 a 199a, a 199b e a 196a fecham; com a marca da 1600 so o corpo da 199a reprova (a 199b e a 196a fecham); sem a 1600 a 199b reprova",
  async () => {
    await P.emTransacao(async () => {
      assert.deepEqual(await P.consulta(A199), []);
      assert.deepEqual(await P.consulta(B199), []);
      assert.deepEqual(await P.consulta(A196), []);
      await C().query(ROLLBACK_SQL);
      assert.deepEqual(await P.consulta(A199), [ITEM_CORPO]);
      assert.deepEqual(await P.consulta(B199), []);
      assert.deepEqual(await P.consulta(A196), []);
      await C().query(ROLLBACK_1600);
      assert.deepEqual(
        await P.consulta(B199),
        [ITEM_ATRIBUTOS, ITEM_CORPO, ITEM_GATILHO].sort(),
      );
    });
  },
);

const ESTRAGOS_199 = [
  [
    "SECURITY INVOKER",
    "ALTER FUNCTION public.marcar_suspensa_desde() SECURITY INVOKER",
    [ITEM_ATRIBUTOS],
  ],
  [
    "EXECUTE ao anon",
    "GRANT EXECUTE ON FUNCTION public.marcar_suspensa_desde() TO anon",
    [ITEM_ATRIBUTOS],
  ],
  [
    "EXECUTE ao PUBLIC",
    "GRANT EXECUTE ON FUNCTION public.marcar_suspensa_desde() TO PUBLIC",
    [ITEM_ATRIBUTOS],
  ],
  [
    "sobrecarga",
    "CREATE FUNCTION public.marcar_suspensa_desde(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    [ITEM_ATRIBUTOS],
  ],
  [
    "corpo trocado",
    trocar(
      textoDe(MIGRATION, "marcar_suspensa_desde"),
      "RETURN NULL;",
      "RETURN NULL; -- trocado",
    ),
    [ITEM_CORPO],
  ],
  [
    "gatilho desligado",
    "ALTER TABLE public.assinatura_da_loja DISABLE TRIGGER tr_assinatura_marca_suspensa_desde",
    [ITEM_GATILHO],
  ],
  [
    "gatilho so no INSERT",
    "DROP TRIGGER tr_assinatura_marca_suspensa_desde ON public.assinatura_da_loja; CREATE TRIGGER tr_assinatura_marca_suspensa_desde AFTER INSERT ON public.assinatura_da_loja FOR EACH ROW EXECUTE FUNCTION public.marcar_suspensa_desde()",
    [ITEM_GATILHO],
  ],
  [
    "pausa_de_vendas torta",
    "ALTER TABLE public.pausa_de_vendas ADD COLUMN extra text",
    [ITEM_TABELA],
  ],
];
prova(
  "(8) ESTRAGOS: cada um reprova SO o item certo, na 199a e na 199b",
  async () => {
    for (const [rotulo, estrago, itens] of ESTRAGOS_199) {
      for (const consulta of [A199, B199]) {
        await P.emTransacao(async () => {
          await C().query(estrago);
          assert.deepEqual(
            await P.consulta(consulta),
            itens,
            `${consulta} ${rotulo}`,
          );
        });
      }
    }
  },
);

(async () => {
  await P.conectar();
  try {
    await P.executar("a-loja-ja-suspensa-tambem-pausa");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
