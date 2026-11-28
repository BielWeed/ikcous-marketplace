"use strict";

/**
 * PROVA VIVA da migration 20261661000000_a_loja_que_saiu_pausa_o_pedido_novo.sql contra o Postgres EFEMERO (clone do rodar-isolado.cjs: a
 * arvore migrada, com a 1661 no ar). Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs; molde: a-loja-ja-suspensa-tambem-pausa-viva.cjs.
 *
 *  (1) MOTIVO      a matriz: cancelada com a pausa ligada e a chave da gestao = vendas_pausadas na hora (com ou sem datas, datas no futuro);
 *                  cancelada desligada, sem a linha da pausa ou sem a chave = aceita; manutencao vence; suspensa, atrasada, ativa, teste,
 *                  pendente e sem cartao exatamente como na 1600.
 *  (2) CONTROLE    o motivo da 1600 (o rollback) na MESMA matriz: so os casos da cancelada ligada ficam vermelhos (o defeito).
 *  (3) PEDIDOS     pela PORTA REAL do app de gestao (a saida grava cancelada): pedidos reais pela v23 e pela v24 recusam com a frase da 1600 sem
 *                  mexer em pedido, item, estoque nem cupom; o admin tambem; a retentativa devolve o mesmo pedido; o balcao vende; o pagamento
 *                  do pedido de antes grava; a leitura do painel diz pausada. Pausa desligada: a mesma loja cancelada vende. Suspensa: como hoje.
 *  (4) MUTANTES    cada sabotagem do motivo novo fica vermelha na expectativa certa.
 *  (5) ATRIBUTOS   STABLE SECURITY DEFINER, search_path fixo, uma so, EXECUTE de ninguem; a fechadura e o gatilho da 1600 intactos.
 *  (6) MIGRATION   reaplicar 2x (LF e CRLF) igual e SEM tocar os dados; so o motivo muda (retrato); rollback 2x volta a 1600 byte a byte e deixa o
 *                  rollback da 1600 passar; pre-voo e rollback recusam estado desconhecido; pos-voo recusa cada estrago; a falha no fim nao
 *                  deixa nada (sem BEGIN no arquivo).
 *  (7) CONSULTAS   217a/217b e 196a nos estados, com o rol fechado do conferir-banco; cada estrago reprova so o item certo.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-que-saiu-pausa-o-pedido-novo-viva.cjs
 */

/* eslint-disable security/detect-object-injection -- os indices sao os nomes fixos dos casos desta prova e dos atores, nunca entrada de rede. */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, sha256 } = P;

const NOME = "20261661000000_a_loja_que_saiu_pausa_o_pedido_novo.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK_SQL = P.lerMigration(`rollback-manual-${NOME}`);
const NOME_1600 = "20261600000000_a_loja_pausa_o_pedido_novo.sql";
const ROLLBACK_1600 = P.lerMigration(`rollback-manual-${NOME_1600}`);
const H1600 = "bfe365fb64ad8d2bb9c06efca304375c";
const H1661 = "f2404f96cd8a589f2821eb5c20a85aa2";
const FN = "public.motivo_da_loja_nao_aceitar_pedido()";

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
const hashDoMotivo = async () =>
  (
    await um(
      `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
    )
  )?.h ?? null;
const MOTIVO_NOVO = textoDe(MIGRATION, "motivo_da_loja_nao_aceitar_pedido");

// ---------------------------------------------------------------------------------------------------------------------------
// A loja: cartao, pausa e chave da gestao, por escrita direta do dono (o motivo so le)
// ---------------------------------------------------------------------------------------------------------------------------
const CHAVE = "chave-da-loja-que-saiu-1661-4c8e2a6f0b3d5f7a9c1e3b5d7f9a2c4e";
const HASH = sha256(CHAVE);
/** Volta a sessao a ser o DONO sem JWT (o P.tentar deixa o JWT do ultimo papel na transacao). */
const comoDono = () =>
  C().query(
    "SELECT set_config('request.jwt.claims', '', true), set_config('app.rpc.user_id', '', true)",
  );
const motivo = async () =>
  (await um("SELECT public.motivo_da_loja_nao_aceitar_pedido() AS m")).m;
const datas = async () =>
  um(
    `WITH h AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje)
     SELECT hoje::text, (hoje - 60)::text AS longe, (hoje - 45)::text AS desde, (hoje - 40)::text AS pausa_passada,
            (hoje + 30)::text AS futuro
       FROM h`,
  );

/**
 * Monta a loja num estado: `status` (null = sem cartao), `vale` (null = sem a linha da pausa), `chave` (a chave da gestao definida),
 * `manutencao`, e as datas do cartao e da pausa.
 */
async function loja({
  status,
  vale = true,
  chave = true,
  manutencao = false,
  proxima = null,
  pausaEm = null,
  desde = null,
}) {
  await comoDono();
  await C().query(
    "INSERT INTO public.store_config (id, manutencao) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET manutencao = EXCLUDED.manutencao",
    [manutencao],
  );
  await C().query("DELETE FROM public.assinatura_da_loja");
  await C().query("DELETE FROM public.assinatura_da_loja_chave");
  await C().query("DELETE FROM public.pausa_de_vendas");
  if (chave)
    await C().query(
      "INSERT INTO public.assinatura_da_loja_chave (id, chave_hash) VALUES (1, $1)",
      [HASH],
    );
  if (status)
    await C().query(
      `INSERT INTO public.assinatura_da_loja (id, plano, status, ciclo, valor_mensal, proxima_cobranca_em, pausa_em, atualizado_em)
       VALUES (1, 'Pro', $1, 'mensal', 250, $2::date, $3::date, now())`,
      [status, proxima, pausaEm],
    );
  // depois do cartao: a marca da 1600/1630 grava/apaga suspensa_desde ao gravar o status; aqui o dia e' o que o caso pede
  await C().query("DELETE FROM public.pausa_de_vendas");
  if (vale !== null)
    await C().query(
      "INSERT INTO public.pausa_de_vendas (id, vale_pela_assinatura, ligada_em, suspensa_desde) VALUES (1, $1, CASE WHEN $1 THEN now() END, $2::date)",
      [vale, desde],
    );
}

/** A matriz: o motivo esperado em cada estado (o da 1661). */
async function motivos() {
  const d = await datas();
  const vencida = {
    proxima: d.longe,
    pausaEm: d.pausa_passada,
    desde: d.desde,
  };
  const CASOS = [
    // a loja que saiu
    ["canceladaLigada", { status: "cancelada" }, "vendas_pausadas"],
    [
      "canceladaComDatasNoFuturo",
      { status: "cancelada", proxima: d.futuro, pausaEm: d.futuro },
      "vendas_pausadas",
    ],
    [
      "canceladaComDatasVencidas",
      { status: "cancelada", ...vencida },
      "vendas_pausadas",
    ],
    ["canceladaDesligada", { status: "cancelada", vale: false }, null],
    ["canceladaSemLinhaDaPausa", { status: "cancelada", vale: null }, null],
    ["canceladaSemChaveDaGestao", { status: "cancelada", chave: false }, null],
    [
      "canceladaEmManutencao",
      { status: "cancelada", manutencao: true },
      "manutencao",
    ],
    // os outros status, como na 1600
    ["suspensaVencida", { status: "suspensa", ...vencida }, "vendas_pausadas"],
    [
      "suspensaNoPrazo",
      { status: "suspensa", ...vencida, pausaEm: d.futuro },
      null,
    ],
    [
      "suspensaDesligada",
      { status: "suspensa", ...vencida, vale: false },
      null,
    ],
    ["atrasadaLigada", { status: "atrasada", ...vencida }, null],
    ["ativaLigada", { status: "ativa", ...vencida }, null],
    ["testeLigada", { status: "teste" }, null],
    ["pendenteLigada", { status: "pendente", ...vencida }, null],
    ["semCartaoLigada", { status: null }, null],
    ["ativaEmManutencao", { status: "ativa", manutencao: true }, "manutencao"],
  ];
  const r = {};
  for (const [nome, estado, esperado] of CASOS) {
    await loja(estado);
    const m = await motivo();
    r[nome] = m === esperado || JSON.stringify({ esperado, veio: m });
  }
  return r;
}

const VERMELHO_COM_A_1600 = [
  "canceladaComDatasNoFuturo",
  "canceladaComDatasVencidas",
  "canceladaLigada",
];

prova(
  "(1) MOTIVO: cancelada com a pausa ligada e a chave = vendas_pausadas na hora (sem esperar data); desligada, sem linha ou sem chave aceita; manutencao vence; os outros status como na 1600",
  async () => {
    await P.emTransacao(async () => {
      assert.equal(await hashDoMotivo(), H1661, "a 1661 tem de estar no ar");
      const r = await motivos();
      assert.deepEqual(vermelhas(r), [], JSON.stringify(r, null, 1));
    });
  },
);

prova(
  "(2) CONTROLE: com o motivo da 1600 (o rollback) a MESMA matriz fica vermelha SO nos casos da cancelada ligada (o defeito)",
  async () => {
    await P.emTransacao(async () => {
      await C().query(ROLLBACK_SQL);
      assert.equal(await hashDoMotivo(), H1600);
      const r = await motivos();
      assert.deepEqual(vermelhas(r), VERMELHO_COM_A_1600, JSON.stringify(r));
    });
  },
);

// ---------------------------------------------------------------------------------------------------------------------------
// (3) pedidos reais: a saida pela porta do app de gestao, a vitrine, o balcao, o pedido de antes e o painel
// ---------------------------------------------------------------------------------------------------------------------------
const FRASE_PAUSADA = "Esta loja não está aceitando pedidos agora.";
const U_CLI = "16610000-0000-4000-8000-0000000000c1";
const U_ADM = "16610000-0000-4000-8000-0000000000a1";
const JWT = (papel) =>
  JSON.stringify({
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });
const QUEM = {
  cliente: { uid: U_CLI, claims: JWT("customer") },
  admin: { uid: U_ADM, claims: JWT("admin") },
};
const PRODUTO = "16610000-0000-4000-8000-000000000001";
const CUPOM = "P1661CUPOM";
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
  return `16610000-0000-4000-8000-${String(seqChave).padStart(12, "0")}`;
};
/** O corpo da gestao (as 10 chaves + pausa_em). */
const CARTAO = {
  plano: "Pro",
  status: "ativa",
  ciclo: "mensal",
  valor_mensal: 250,
  inicio_em: "2026-09-03",
  teste_ate: null,
  proxima_cobranca_em: "2026-12-05",
  suporte_whatsapp: "5534999999999",
  gerenciar_url: "https://cobranca.exemplo.com/loja-1661",
  atualizado_em: "2026-11-20T10:00:00Z",
  pausa_em: null,
};
const carimbo = (n) => `2026-11-20T10:${String(n).padStart(2, "0")}:00Z`;
/** A porta como o app de gestao a chama (anon, a chave da loja). */
const gravar = (mudar) =>
  P.tentar(
    "anon",
    "SELECT public.assinatura_da_loja_gravar($1::text, $2::jsonb, false) AS j",
    [CHAVE, JSON.stringify({ ...CARTAO, ...mudar })],
  );
const gravou = (x) => x.linhas?.[0]?.j?.gravado === true;

/** A loja que vende: atores, configuracao de compra, um produto com estoque, um cupom e a chave da gestao. */
async function semearLoja() {
  for (const [id, meta, papel] of [
    [U_CLI, "{}", "customer"],
    [U_ADM, '{"role":"admin"}', "admin"],
  ]) {
    await C().query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@1661.teste', $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data`,
      [id, meta],
    );
    await C().query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa 1661', $2)
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
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Produto 1661', 100, 50, true, 40, false)",
    [PRODUTO],
  );
  await C().query(
    `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active)
     VALUES ($1, 'fixed', 10, 0, 100, 0, NULL, true)`,
    [CUPOM],
  );
  await C().query("DELETE FROM public.assinatura_da_loja");
  await C().query("DELETE FROM public.assinatura_da_loja_chave");
  await C().query("DELETE FROM public.pausa_de_vendas");
  const d = await P.tentar(
    "service_role",
    "SELECT public.assinatura_da_loja_definir_chave($1, true)",
    [HASH],
  );
  assert.ok(!d.erro, `definir_chave: ${JSON.stringify(d)}`);
}
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
const venderNoBalcao = () =>
  P.tentar(
    "authenticated",
    "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL::uuid, NULL, NULL, 0::numeric, NULL, $2::uuid) AS r",
    [
      JSON.stringify([{ product_id: PRODUTO, variant_id: null, quantity: 1 }]),
      novaChave(),
    ],
    QUEM.admin,
  );
const situacaoDoPainel = async () =>
  (
    await P.tentar(
      "authenticated",
      "SELECT public.situacao_das_vendas_da_loja() AS j",
      [],
      QUEM.admin,
    )
  ).linhas?.[0]?.j ?? null;
/** O que uma recusa nao pode ter mexido: pedidos, itens, estoque e o uso do cupom. */
const livro = async () =>
  um(
    `SELECT (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos,
            (SELECT count(*)::int FROM public.marketplace_order_items) AS itens,
            (SELECT estoque FROM public.produtos WHERE id = $1) AS estoque,
            (SELECT usage_count FROM public.coupons WHERE code = $2) AS uso_do_cupom`,
    [PRODUTO, CUPOM],
  );
const recusou = (x) => x.codigo === "P0001" && x.erro === FRASE_PAUSADA;

async function pedidos() {
  const r = {};
  const anota = (nome, ok, x) => {
    r[nome] = ok || JSON.stringify(x);
  };
  // CONTROLE: a loja ativa vende; o pedido de ANTES da saida, para a retentativa e para o pagamento
  const a1 = await gravar({ status: "ativa", atualizado_em: carimbo(1) });
  anota("portaAtiva", gravou(a1), a1);
  const chaveAntiga = novaChave();
  const antigo = idDe(await comprar("cliente", { chave: chaveAntiga }));
  anota("ativaVende", antigo !== null, antigo);
  // a pausa LIGADA pelo dono (o interruptor); ainda ativa, vende
  await comoDono();
  await C().query(
    `INSERT INTO public.pausa_de_vendas (id, vale_pela_assinatura, ligada_em) VALUES (1, true, now())
     ON CONFLICT (id) DO UPDATE SET vale_pela_assinatura = true, ligada_em = now()`,
  );
  const x0 = await comprar("cliente");
  anota("ligadaAtivaVende", idDe(x0) !== null, x0);

  // A SAIDA: a gestao grava cancelada pela porta (sem proxima cobranca nem dia da pausa)
  const c1 = await gravar({
    status: "cancelada",
    proxima_cobranca_em: null,
    atualizado_em: carimbo(2),
  });
  anota("portaGravaASaida", gravou(c1), c1);
  for (const [rpc, cupom] of [
    ["create_marketplace_order_v23", null],
    ["create_marketplace_order_v24", null],
    ["create_marketplace_order_v24", CUPOM],
  ]) {
    const antes = await livro();
    const x = await comprar("cliente", { rpc, cupom });
    const depois = await livro();
    anota(
      `saida_${rpc.slice(-3)}${cupom ? "_cupom" : ""}`,
      recusou(x) && JSON.stringify(antes) === JSON.stringify(depois),
      { x, antes, depois },
    );
  }
  const xa = await comprar("admin");
  anota("saidaAdminRecusado", recusou(xa), xa);
  const antesRetry = await livro();
  const retry = await comprar("cliente", { chave: chaveAntiga });
  anota(
    "saidaRetentativaDevolveOMesmo",
    idDe(retry) === antigo &&
      JSON.stringify(antesRetry) === JSON.stringify(await livro()),
    { antigo, retry },
  );
  const b1 = await venderNoBalcao();
  anota("saidaBalcaoVende", !b1.erro, b1);
  // o pedido que ja existia segue: a cobranca e o pagamento gravam (o gatilho e' so de INSERT)
  await comoDono();
  const cobranca = await P.tentar(
    null,
    "UPDATE public.marketplace_orders SET gateway_payment_id = 'pagamento-1661' WHERE id = $1",
    [antigo],
  );
  const pago = await P.tentar(
    "service_role",
    "SELECT public.confirmar_pagamento($1::uuid, 'pagamento-1661', 'pago') AS r",
    [antigo],
  );
  const pagoNoBanco = await um(
    "SELECT payment_status FROM public.marketplace_orders WHERE id = $1",
    [antigo],
  );
  anota(
    "saidaPedidoDeAntesPaga",
    !cobranca.erro && !pago.erro && pagoNoBanco?.payment_status === "pago",
    { cobranca, pago, pagoNoBanco },
  );
  const s1 = await situacaoDoPainel();
  anota(
    "saidaPainelDizPausada",
    JSON.stringify(s1) ===
      JSON.stringify({
        aceita: false,
        motivo: "vendas_pausadas",
        pausada_desde: null,
      }),
    s1,
  );

  // a MESMA loja cancelada com a pausa DESLIGADA: vende (o que acontece hoje em toda loja)
  await comoDono();
  await C().query(
    "UPDATE public.pausa_de_vendas SET vale_pela_assinatura = false WHERE id = 1",
  );
  const xd = await comprar("cliente");
  anota("saidaDesligadaVende", idDe(xd) !== null, xd);
  const s2 = await situacaoDoPainel();
  anota("desligadaPainelAceita", s2?.aceita === true, s2);

  // ligada de novo e a gestao reabre (ativa): vende no proximo pedido
  await comoDono();
  await C().query(
    "UPDATE public.pausa_de_vendas SET vale_pela_assinatura = true WHERE id = 1",
  );
  const xl = await comprar("cliente");
  anota("religadaRecusa", recusou(xl), xl);
  const a2 = await gravar({ status: "ativa", atualizado_em: carimbo(3) });
  const xr = await comprar("cliente");
  anota("reabreNoProximoPedido", gravou(a2) && idDe(xr) !== null, {
    a2,
    xr,
  });
  return r;
}

prova(
  "(3) PEDIDOS: a saida pela porta da gestao com a pausa ligada recusa a v23 e a v24 (frase da 1600, nada mexido), o admin tambem; retentativa, balcao, pagamento do pedido de antes e o painel seguem; desligada vende; ativa reabre",
  async () => {
    await P.emTransacao(async () => {
      const r = await pedidos();
      assert.deepEqual(vermelhas(r), [], JSON.stringify(r, null, 1));
    }, semearLoja);
  },
);

prova(
  "(3) CONTROLE DOS PEDIDOS: com o motivo da 1600 a loja que saiu, com a pausa ligada, segue vendendo pela vitrine (o defeito)",
  async () => {
    await P.emTransacao(async () => {
      await C().query(ROLLBACK_SQL);
      const r = await pedidos();
      for (const k of [
        "saida_v23",
        "saida_v24",
        "saida_v24_cupom",
        "saidaAdminRecusado",
        "saidaPainelDizPausada",
        "religadaRecusa",
      ])
        assert.ok(vermelhas(r).includes(k), `${k} devia ficar vermelho`);
    }, semearLoja);
  },
);

// ---------------------------------------------------------------------------------------------------------------------------
// (4) mutantes do motivo novo
// ---------------------------------------------------------------------------------------------------------------------------
const RAMO =
  "  IF v_status = 'cancelada' THEN\n    RETURN 'vendas_pausadas';\n  END IF;\n";
const MUTANTES = [
  ["sem o ramo da saida", [[RAMO, ""]], "canceladaLigada"],
  [
    "a saida devolve outro motivo (a fechadura nao o conhece)",
    [
      [
        "IF v_status = 'cancelada' THEN\n    RETURN 'vendas_pausadas';",
        "IF v_status = 'cancelada' THEN\n    RETURN 'loja_encerrada';",
      ],
    ],
    "canceladaLigada",
  ],
  [
    "a saida antes da pausa ligada (ignora o interruptor)",
    [
      [RAMO, ""],
      [
        "  -- 1. ligada nesta loja",
        `  SELECT a.status INTO v_status FROM public.assinatura_da_loja a WHERE a.id = 1;\n${RAMO}  -- 1. ligada nesta loja`,
      ],
    ],
    "canceladaDesligada",
  ],
  [
    "a saida antes da chave da gestao",
    [
      [RAMO, ""],
      [
        "  -- 2. a gestao esta ligada",
        `  SELECT a.status INTO v_status FROM public.assinatura_da_loja a WHERE a.id = 1;\n${RAMO}  -- 2. a gestao esta ligada`,
      ],
    ],
    "canceladaSemChaveDaGestao",
  ],
  [
    "a saida antes da manutencao",
    [
      [RAMO, ""],
      [
        "  -- (a) Manutencao",
        `  SELECT a.status INTO v_status FROM public.assinatura_da_loja a WHERE a.id = 1;\n  IF v_status = 'cancelada' THEN\n    RETURN 'vendas_pausadas';\n  END IF;\n  -- (a) Manutencao`,
      ],
    ],
    "canceladaEmManutencao",
  ],
  [
    "a saida pega a atrasada junto",
    [
      [
        "IF v_status = 'cancelada' THEN",
        "IF v_status IN ('cancelada', 'atrasada') THEN",
      ],
    ],
    "atrasadaLigada",
  ],
  [
    "a saida espera a regra das datas",
    [
      [RAMO, ""],
      [
        "  IF v_status IS DISTINCT FROM 'suspensa' THEN",
        "  IF v_status IS DISTINCT FROM 'suspensa' AND v_status IS DISTINCT FROM 'cancelada' THEN",
      ],
    ],
    "canceladaLigada",
  ],
];
prova(
  "(4) MUTANTES DO MOTIVO: cada sabotagem fica vermelha na expectativa certa",
  async () => {
    for (const [nome, trocas, alvo] of MUTANTES) {
      const texto = trocas.reduce(
        (t, [de, para]) => trocar(t, de, para),
        MOTIVO_NOVO,
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
// (5) atributos
// ---------------------------------------------------------------------------------------------------------------------------
const DEF_GATILHO =
  "CREATE TRIGGER tr_a_loja_aceita_pedido_novo BEFORE INSERT ON public.marketplace_orders FOR EACH ROW WHEN ((new.canal IS DISTINCT FROM 'presencial'::text)) EXECUTE FUNCTION public.a_loja_aceita_pedido_novo()";
const definicaoDoGatilho = async () => {
  const caminho = (await um("SELECT current_setting('search_path') AS s")).s;
  await C().query("SELECT set_config('search_path', 'pg_catalog', true)");
  try {
    return await um(
      `SELECT pg_get_triggerdef(t.oid) AS def, t.tgenabled AS ligado FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.marketplace_orders') AND t.tgname = 'tr_a_loja_aceita_pedido_novo'`,
    );
  } finally {
    await C().query("SELECT set_config('search_path', $1, true)", [caminho]);
  }
};
const H_FECHADURA = "b53378b9838954977af9bad3af6ccbc0";
const hashDaFechadura = async () =>
  (
    await um(
      "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('public.a_loja_aceita_pedido_novo()')",
    )
  )?.h ?? null;
prova(
  "(5) ATRIBUTOS: o motivo STABLE SECURITY DEFINER, search_path fixo, uma so, EXECUTE de ninguem; a fechadura e o gatilho da 1600 intactos",
  async () => {
    await P.emTransacao(async () => {
      assert.deepEqual(await definicaoDoGatilho(), {
        def: DEF_GATILHO,
        ligado: "O",
      });
      assert.equal(await hashDaFechadura(), H_FECHADURA);
      assert.deepEqual(
        await um(
          `SELECT p.prosecdef AS secdef, p.proconfig AS cfg, p.provolatile AS vol, pg_get_function_result(p.oid) AS ret,
                  (SELECT count(*)::int FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'motivo_da_loja_nao_aceitar_pedido') AS n
             FROM pg_proc p WHERE p.oid = to_regprocedure('${FN}')`,
        ),
        {
          secdef: true,
          cfg: ["search_path=public, pg_temp"],
          vol: "s",
          ret: "text",
          n: 1,
        },
      );
      for (const papel of ["anon", "authenticated", "service_role"]) {
        const x = await um(
          `SELECT has_function_privilege($1, to_regprocedure('${FN}'), 'EXECUTE') AS pode`,
          [papel],
        );
        assert.equal(x.pode, false, papel);
      }
    });
  },
);

// ---------------------------------------------------------------------------------------------------------------------------
// (6) a migration: reaplicar, dados de antes, retrato, rollback, pre-voo, pos-voo e atomicidade
// ---------------------------------------------------------------------------------------------------------------------------
const aplicarOk = async (sql, rotulo) => {
  const r = await P.aplicar(sql);
  assert.equal(r, null, `${rotulo}: ${JSON.stringify(r)}`);
};
const estadoDoMotivo = async () =>
  um(
    `SELECT p.oid::text AS oid, p.proacl::text AS acl, md5(replace(p.prosrc, chr(13), '')) AS h, p.proowner::regrole::text AS dono,
            obj_description(p.oid, 'pg_proc') LIKE '%20261661000000%' AS comentario
       FROM pg_proc p WHERE p.oid = to_regprocedure('${FN}')`,
  );
/** Os dados que ja estavam la: o cartao, a pausa, a chave e a configuracao, inteiros. */
const dados = async () =>
  um(
    `SELECT (SELECT json_agg(a ORDER BY a.id) FROM public.assinatura_da_loja a) AS cartao,
            (SELECT json_agg(p ORDER BY p.id) FROM public.pausa_de_vendas p) AS pausa,
            (SELECT json_agg(k ORDER BY k.id) FROM public.assinatura_da_loja_chave k) AS chave,
            (SELECT md5(json_agg(s ORDER BY s.id)::text) FROM public.store_config s) AS config,
            (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos`,
  );

prova(
  "(6) REAPLICAR: 2x (LF e CRLF) deixa o motivo igual (OID, ACL, dono, corpo) e NAO toca os dados (a loja cancelada com a pausa ligada continua como estava); o apply sobre a 1600 tambem nao",
  async () => {
    await P.emTransacao(async () => {
      await loja({ status: "cancelada" });
      const m0 = await estadoDoMotivo();
      const d0 = await dados();
      assert.equal(m0.h, H1661);
      assert.equal(m0.comentario, true);
      await aplicarOk(MIGRATION, "reaplicar LF");
      await aplicarOk(P.emCRLF(MIGRATION), "reaplicar CRLF");
      assert.deepEqual(await estadoDoMotivo(), m0);
      assert.deepEqual(await dados(), d0);
      await aplicarOk(ROLLBACK_SQL, "rollback");
      assert.deepEqual(await dados(), d0, "o rollback tocou os dados");
      await aplicarOk(MIGRATION, "apply sobre a 1600");
      assert.deepEqual(await dados(), d0);
      assert.deepEqual(await estadoDoMotivo(), m0);
    });
  },
);

prova(
  "(6) SO O MOTIVO MUDA: o retrato de public (funcoes, ACL, politicas, gatilhos, restricoes) e' o mesmo antes e depois do apply e do rollback",
  async () => {
    await P.emTransacao(async () => {
      const sem = { funcoes: ["motivo_da_loja_nao_aceitar_pedido"] };
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
  "(6) ROLLBACK: 2x devolve o motivo da 1600 byte a byte (mesmo OID, ACL e comentario da 1600) e o rollback da 1600 passa depois dele; sem ele o da 1600 recusa",
  async () => {
    await P.emTransacao(async () => {
      // a 1630 (marca) sai antes: so assim o rollback da 1600 mede SO o motivo
      await require("./a-loja-ja-suspensa-tambem-pausa-posterior.cjs").desfazerASuspensaAntigaNaTransacao(
        C(),
      );
      const antes = await estadoDoMotivo();
      assert.ok(
        await P.recusa(ROLLBACK_1600, /B1_BASELINE_DIVERGENT/),
        "o rollback da 1600 devia recusar com a 1661 no ar",
      );
      await aplicarOk(ROLLBACK_SQL, "rollback 1");
      await aplicarOk(ROLLBACK_SQL, "rollback 2");
      const depois = await estadoDoMotivo();
      assert.equal(depois.h, H1600);
      assert.equal(depois.oid, antes.oid);
      assert.equal(depois.acl, antes.acl);
      assert.equal(depois.comentario, false);
      await aplicarOk(ROLLBACK_1600, "rollback da 1600 depois");
      assert.equal(await hashDoMotivo(), null);
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
    "motivo com corpo alheio",
    trocar(
      MOTIVO_NOVO,
      "RETURN 'manutencao';",
      "RETURN 'manutencao'; -- alheio",
    ),
    /B1_BASELINE_DIVERGENT: public\.motivo_da_loja_nao_aceitar_pedido\(\) tem corpo desconhecido/,
  ],
  [
    "motivo com sobrecarga",
    "CREATE FUNCTION public.motivo_da_loja_nao_aceitar_pedido(x integer) RETURNS text LANGUAGE sql AS 'SELECT NULL::text'",
    /B1_BASELINE_DIVERGENT: public\.motivo_da_loja_nao_aceitar_pedido\(\) ausente, com sobrecarga/,
  ],
  [
    "fechadura com outro corpo",
    trocar(
      textoDe(P.lerMigration(NOME_1600), "a_loja_aceita_pedido_novo"),
      "RETURN NEW;\nEND;",
      "RETURN NEW; -- outra\nEND;",
    ),
    /B1_BASELINE_DIVERGENT: public\.a_loja_aceita_pedido_novo\(\) ausente ou com corpo desconhecido/,
  ],
  [
    "gatilho desligado",
    "ALTER TABLE public.marketplace_orders DISABLE TRIGGER tr_a_loja_aceita_pedido_novo",
    /B1_BASELINE_DIVERGENT: o gatilho tr_a_loja_aceita_pedido_novo/,
  ],
  [
    "gatilho ausente",
    "DROP TRIGGER tr_a_loja_aceita_pedido_novo ON public.marketplace_orders",
    /B1_BASELINE_DIVERGENT: o gatilho tr_a_loja_aceita_pedido_novo/,
  ],
];
prova(
  "(6) PRE-VOO: tabela torta, corpo alheio, sobrecarga, fechadura de outro corpo, gatilho desligado ou ausente recusam com B1 sem trocar o motivo (a partir da 1600)",
  async () => {
    for (const [rotulo, estrago, padrao] of PRE_VOO) {
      await P.emTransacao(async () => {
        await C().query(ROLLBACK_SQL);
        await C().query(estrago);
        const h0 = await hashDoMotivo();
        assert.ok(await P.recusa(MIGRATION, padrao), rotulo);
        assert.equal(await hashDoMotivo(), h0, `${rotulo}: trocou o motivo`);
      });
    }
  },
);

prova(
  "(6) ROLLBACK RECUSA: motivo com corpo alheio ou com sobrecarga recusa com B1 sem trocar nada",
  async () => {
    for (const [rotulo, estrago] of [PRE_VOO[1], PRE_VOO[2]]) {
      await P.emTransacao(async () => {
        await C().query(estrago);
        const h0 = await hashDoMotivo();
        assert.ok(
          await P.recusa(ROLLBACK_SQL, /B1_BASELINE_DIVERGENT/),
          rotulo,
        );
        assert.equal(await hashDoMotivo(), h0, rotulo);
      });
    }
  },
);

const POS_VOO = [
  ["SECURITY INVOKER", `ALTER FUNCTION ${FN} SECURITY INVOKER`],
  ["sem search_path", `ALTER FUNCTION ${FN} RESET search_path`],
  ["VOLATILE", `ALTER FUNCTION ${FN} VOLATILE`],
  ["EXECUTE ao anon", `GRANT EXECUTE ON FUNCTION ${FN} TO anon`],
  [
    "EXECUTE ao authenticated",
    `GRANT EXECUTE ON FUNCTION ${FN} TO authenticated`,
  ],
  [
    "EXECUTE ao service_role",
    `GRANT EXECUTE ON FUNCTION ${FN} TO service_role`,
  ],
  ["EXECUTE ao PUBLIC", `GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`],
  [
    "corpo trocado",
    trocar(
      MOTIVO_NOVO,
      "RETURN 'manutencao';",
      "RETURN 'manutencao'; -- trocado",
    ),
  ],
  [
    "gatilho desligado",
    "ALTER TABLE public.marketplace_orders DISABLE TRIGGER tr_a_loja_aceita_pedido_novo",
  ],
  [
    "gatilho sem o WHEN do balcao",
    "DROP TRIGGER tr_a_loja_aceita_pedido_novo ON public.marketplace_orders; CREATE TRIGGER tr_a_loja_aceita_pedido_novo BEFORE INSERT ON public.marketplace_orders FOR EACH ROW EXECUTE FUNCTION public.a_loja_aceita_pedido_novo()",
  ],
];
prova(
  "(6) POS-VOO: cada estrago (atributo, EXECUTE, corpo, gatilho) faz o bloco de conferencia recusar com B2",
  async () => {
    const conferencia = P.blocoDe(MIGRATION, "conferencia_20261661000000");
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
  "(6) ATOMICIDADE: sem BEGIN no arquivo, um pos-voo que falha no FIM desfaz o motivo novo (o da 1600 fica) na transacao de quem aplica",
  async () => {
    assert.ok(!/^\s*(BEGIN|COMMIT)\s*;/im.test(MIGRATION), "BEGIN/COMMIT");
    const falhaNoFim = trocar(
      MIGRATION,
      `IS DISTINCT FROM '${H1661}' THEN\n    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o corpo vivo`,
      `IS DISTINCT FROM 'x${H1661}' THEN\n    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o corpo vivo`,
    );
    await P.emTransacao(async () => {
      await C().query(ROLLBACK_SQL);
      assert.ok(await P.recusa(falhaNoFim, /B2_POSVOO_DIVERGENTE/));
      assert.equal(await hashDoMotivo(), H1600);
    });
  },
);

// ---------------------------------------------------------------------------------------------------------------------------
// (7) as conferencias: 217a, 217b e a 196a (que aceita o motivo desta como sucessor)
// ---------------------------------------------------------------------------------------------------------------------------
const A217 = "217a-conferir-a-loja-que-saiu-pausa-o-pedido-novo-aplicado";
const B217 = "217b-antes-a-loja-que-saiu-pausa-o-pedido-novo-base-vigente";
const A196 = "196a-conferir-a-loja-pausa-o-pedido-novo-aplicado";
const ITEM_CORPO = "motivo_da_loja_nao_aceitar_pedido: corpo exato (md5)";
const ITEM_ATRIBUTOS =
  "motivo_da_loja_nao_aceitar_pedido: uma so, plpgsql SECURITY DEFINER STABLE, retorno text, search_path fixo e EXECUTE de ninguem";
const ITEM_FECHADURA =
  "a_loja_aceita_pedido_novo: a fechadura da 20261600000000 (md5), que recusa vendas_pausadas";
const ITEM_GATILHO =
  "tr_a_loja_aceita_pedido_novo: BEFORE INSERT por linha em marketplace_orders com o WHEN do balcao, chama a fechadura, ligado";
const ITEM_TABELA =
  "pausa_de_vendas: a tabela de linha unica da 20261600000000 (4 colunas)";
prova(
  "(7) CONSULTAS: com a 1661 a 217a, a 217b e a 196a fecham; com o motivo da 1600 so o corpo da 217a reprova (a 217b e a 196a fecham); sem a 1600 a 217b reprova",
  async () => {
    await P.emTransacao(async () => {
      assert.deepEqual(await P.consulta(A217), []);
      assert.deepEqual(await P.consulta(B217), []);
      assert.deepEqual(await P.consulta(A196), []);
      await C().query(ROLLBACK_SQL);
      assert.deepEqual(await P.consulta(A217), [ITEM_CORPO]);
      assert.deepEqual(await P.consulta(B217), []);
      assert.deepEqual(await P.consulta(A196), []);
      await require("./a-loja-ja-suspensa-tambem-pausa-posterior.cjs").desfazerASuspensaAntigaNaTransacao(
        C(),
      );
      await C().query(ROLLBACK_1600);
      assert.deepEqual(
        await P.consulta(B217),
        [ITEM_ATRIBUTOS, ITEM_CORPO, ITEM_FECHADURA, ITEM_GATILHO].sort(),
      );
    });
  },
);

const ESTRAGOS_217 = [
  [
    "SECURITY INVOKER",
    `ALTER FUNCTION ${FN} SECURITY INVOKER`,
    [ITEM_ATRIBUTOS],
  ],
  ["VOLATILE", `ALTER FUNCTION ${FN} VOLATILE`, [ITEM_ATRIBUTOS]],
  [
    "EXECUTE ao anon",
    `GRANT EXECUTE ON FUNCTION ${FN} TO anon`,
    [ITEM_ATRIBUTOS],
  ],
  [
    "EXECUTE ao PUBLIC",
    `GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`,
    [ITEM_ATRIBUTOS],
  ],
  [
    "sobrecarga",
    "CREATE FUNCTION public.motivo_da_loja_nao_aceitar_pedido(x integer) RETURNS text LANGUAGE sql AS 'SELECT NULL::text'",
    [ITEM_ATRIBUTOS],
  ],
  [
    "corpo trocado",
    trocar(
      MOTIVO_NOVO,
      "RETURN 'manutencao';",
      "RETURN 'manutencao'; -- trocado",
    ),
    [ITEM_CORPO],
  ],
  [
    "fechadura trocada",
    trocar(
      textoDe(P.lerMigration(NOME_1600), "a_loja_aceita_pedido_novo"),
      "RETURN NEW;\nEND;",
      "RETURN NEW; -- outra\nEND;",
    ),
    [ITEM_FECHADURA],
  ],
  [
    "gatilho desligado",
    "ALTER TABLE public.marketplace_orders DISABLE TRIGGER tr_a_loja_aceita_pedido_novo",
    [ITEM_GATILHO],
  ],
  [
    "gatilho sem o WHEN do balcao",
    "DROP TRIGGER tr_a_loja_aceita_pedido_novo ON public.marketplace_orders; CREATE TRIGGER tr_a_loja_aceita_pedido_novo BEFORE INSERT ON public.marketplace_orders FOR EACH ROW EXECUTE FUNCTION public.a_loja_aceita_pedido_novo()",
    [ITEM_GATILHO],
  ],
  [
    "pausa_de_vendas torta",
    "ALTER TABLE public.pausa_de_vendas ADD COLUMN extra text",
    [ITEM_TABELA],
  ],
];
prova(
  "(7) ESTRAGOS: cada um reprova SO o item certo, na 217a e na 217b",
  async () => {
    for (const [rotulo, estrago, itens] of ESTRAGOS_217) {
      for (const consulta of [A217, B217]) {
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
    await P.executar("a-loja-que-saiu-pausa-o-pedido-novo");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
