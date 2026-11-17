"use strict";

/**
 * PROVA VIVA da migration 20261400000000_valores_negativos_nao_entram_no_banco.sql contra o Postgres EFEMERO (clone do
 * rodar-isolado.cjs: a arvore migrada). Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs.
 *
 * O defeito (caca estatica de 17/11/2026, reproduzido aqui no estado ANTES): quatro colunas de dinheiro aceitam NEGATIVO e o
 * pedido soma o que o banco guarda. Taxa de entrega local de -50 num pedido de R$100 cobra R$50 (upsert_store_config grava o
 * cast sem guarda); produto de -90 abate o total de outros produtos (salvar_produto_com_grade e a venda so olham preco nao
 * nulo); preco proprio de variacao negativo, idem; cupom `fixed` de -20 vira ACRESCIMO (validate_coupon_secure_v2 devolve
 * discount_value -20 com is_valid true). O conserto: um CHECK `col >= 0 AND col <> 'NaN'` em cada coluna, criado NOT VALID.
 *
 *  ANTES       controle: sem os CHECKs os quatro negativos e o NaN entram, e o cupom de -20 devolve "desconto" -20 (o defeito).
 *  DEPOIS      negativo (-0.01, -50), NaN e a edicao para negativo sao recusados com 23514 pela restricao CERTA, para a sessao
 *              direta, para o admin pela RLS e pelas RPCs reais (upsert_store_config, salvar_produto_com_grade); ZERO (brinde,
 *              retirada gratis), positivo e price_override NULL (herda o preco do produto) seguem aceitos; a sentinela legada
 *              `free_shipping_min = -1` (outro campo) segue aceita; a recusa nao muda nenhuma linha.
 *  LINHA ANTIGA  dado negativo que ja existia ANTES da migration NAO a impede (NOT VALID nao varre) e fica como estava; a
 *              recusa vale para o novo; a consequencia declarada: qualquer UPDATE da linha antiga recusa (23514) ate ela ser
 *              corrigida, e o VALIDATE so passa depois disso.
 *  SO NOVO     o apply cria so as 4 restricoes: nenhuma funcao (corpo/OID/ACL), tabela, politica, gatilho ou outra restricao muda.
 *  MUTANTES    sem a regra, sem o NaN e com `> 0` (zero recusado), em cada coluna: o roteiro fica VERMELHO nas chaves certas e so nelas.
 *  MIGRATION   reaplicar (2x, CRLF, ja validada) e no-op (mesmo OID); rollback sem tocar dado, 2x no-op; pre-voo recusa SEM
 *              escrever; conferencia final recusa cada estrago; pre-voo do rollback recusa o que nao e' dele.
 *  ATOMICIDADE conexao SEM BEGIN: a falha no meio (3a restricao) e a conferencia sabotada deixam NENHUMA das 4; gravacao em
 *              voo faz a migration FALHAR LIMPA no lock_timeout e depois aplicar.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/valores-negativos-prova.cjs
 * Mutante de ambiente (a prova inteira deve ficar vermelha): MUTANTE_VALORES_NEGATIVOS=sem-<alvo> tira a restricao do alvo
 * (taxa, preco, variacao, cupom) logo depois do preparo, antes do roteiro "DEPOIS".
 */

/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui (ALVOS[n], SQL[...], mexer[n], CHAVES[n]) vem das listas constantes do proprio arquivo
 * (NOMES, ALVOS), nunca de entrada de rede nem de terceiro. */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, sha256, emCRLF } = P;
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME = "20261400000000_valores_negativos_nao_entram_no_banco.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK = P.lerMigration(`rollback-manual-${NOME}`);

// Ordem de criacao na migration: a mesma ordem de trava da compra (store_config, variacoes, produtos, cupons).
const ALVOS = {
  taxa: {
    tabela: "store_config",
    coluna: "local_delivery_fee",
    ck: "store_config_local_delivery_fee_nao_negativo",
    def: "CHECK (((local_delivery_fee >= (0)::numeric) AND (local_delivery_fee <> 'NaN'::numeric)))",
  },
  variacao: {
    tabela: "product_variants",
    coluna: "price_override",
    ck: "product_variants_price_override_nao_negativo",
    def: "CHECK (((price_override IS NULL) OR ((price_override >= (0)::numeric) AND (price_override <> 'NaN'::numeric))))",
  },
  preco: {
    tabela: "produtos",
    coluna: "preco_venda",
    ck: "produtos_preco_venda_nao_negativo",
    def: "CHECK (((preco_venda >= (0)::numeric) AND (preco_venda <> 'NaN'::numeric)))",
  },
  cupom: {
    tabela: "coupons",
    coluna: "value",
    ck: "coupons_value_nao_negativo",
    def: "CHECK (((value >= (0)::numeric) AND (value <> 'NaN'::numeric)))",
  },
};
const NOMES = Object.keys(ALVOS);
const CKS = NOMES.map((n) => ALVOS[n].ck);
const NOVOS = { funcoes: [], gatilhos: [], restricoes: CKS };

const U = {
  admin: "b1400000-0000-4000-8000-0000000000ad",
};
const PROD = "b1400000-0000-4000-8000-0000000000f1";
const PROD2 = "b1400000-0000-4000-8000-0000000000f3";
const VARIACAO = "b1400000-0000-4000-8000-0000000000f2";
const CUPOM = "b1400000-0000-4000-8000-0000000000c1";
const JWT_ADMIN = JSON.stringify({
  sub: U.admin,
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const ADMIN = { uid: U.admin, claims: JWT_ADMIN };

const depois = () => P.conexao().query(MIGRATION);
const antes = () => P.conexao().query(ROLLBACK);

async function semear() {
  const c = P.conexao();
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1::uuid, 'admin@b1400000.teste', '{"role":"admin"}'::jsonb)`,
    [U.admin],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin 1400000', 'admin')",
    [U.admin],
  );
  await c.query(
    "INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Camiseta 1400000', 100, 10, true, 40)",
    [PROD],
  );
  await c.query(
    "INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active) VALUES ($1, $2, 'Cor', 'Azul', 5, true)",
    [VARIACAO, PROD],
  );
  await c.query(
    "INSERT INTO public.coupons (id, code, type, value, active) VALUES ($1, 'B1400000', 'fixed', 10, true)",
    [CUPOM],
  );
}

const direto = (sql, params = []) => P.tentar(null, sql, params, ADMIN);
const comoAdmin = (sql, params = []) =>
  P.tentar("authenticated", sql, params, ADMIN);
const recusada = (r, alvo) =>
  !r.linhas && r.codigo === "23514" && r.restricao === ALVOS[alvo].ck;
const aceita = (r) => Boolean(r.linhas) && r.linhas.length >= 1;
const unico = async (sql, params = []) =>
  (await P.conexao().query(sql, params)).rows[0];

// ---- SQL das tentativas por alvo (a mesma forma nos dois estados) --------------------------------------------------------------
const SQL = {
  taxaUpd:
    "UPDATE public.store_config SET local_delivery_fee = $1::numeric WHERE id = 1 RETURNING local_delivery_fee",
  precoUpd:
    "UPDATE public.produtos SET preco_venda = $1::numeric WHERE id = $2::uuid RETURNING preco_venda",
  precoIns:
    "INSERT INTO public.produtos (nome, preco_venda, custo, estoque, ativo) VALUES ('Novo 1400000', $1::numeric, 1, 1, true) RETURNING id",
  varUpd:
    "UPDATE public.product_variants SET price_override = $1::numeric WHERE id = $2::uuid RETURNING id",
  varIns:
    "INSERT INTO public.product_variants (product_id, name, value, price_override, active) VALUES ($2::uuid, 'Tam', $3, $1::numeric, true) RETURNING id",
  cupUpd:
    "UPDATE public.coupons SET value = $1::numeric WHERE id = $2::uuid RETURNING id",
  cupIns:
    "INSERT INTO public.coupons (code, type, value, active) VALUES ($2, $3, $1::numeric, true) RETURNING id",
  salvarProduto:
    "SELECT public.salvar_produto_com_grade($1::uuid, NULL::timestamptz, $2::jsonb, $3::jsonb, ARRAY[]::uuid[])",
  upsertConfig: "SELECT public.upsert_store_config($1::jsonb)",
};
const variacaoJson = (preco) =>
  JSON.stringify([
    {
      id: VARIACAO,
      name: "Cor",
      value: "Azul",
      sku: null,
      codigo_barras: null,
      price_override: preco,
      active: true,
      image_url: null,
    },
  ]);

async function estadoAtual() {
  return unico(
    `SELECT (SELECT local_delivery_fee::text FROM public.store_config WHERE id = 1) AS taxa,
            (SELECT preco_venda::text FROM public.produtos WHERE id = $1) AS preco,
            (SELECT price_override::text FROM public.product_variants WHERE id = $2) AS variacao,
            (SELECT value::text FROM public.coupons WHERE id = $3) AS cupom`,
    [PROD, VARIACAO, CUPOM],
  );
}

/** O roteiro inteiro; cada chave vale `true` quando o comportamento e' o desta migration. O prefixo da chave e' o alvo. */
async function roteiro() {
  const r = {};
  const nao = (v, esperado) => Number(v) === esperado;
  // ---------------- TAXA DE ENTREGA LOCAL (store_config.local_delivery_fee), semente 10.00 ----------------
  r.taxaMenosUmCentavo = recusada(await direto(SQL.taxaUpd, ["-0.01"]), "taxa");
  r.taxaMenos50 = recusada(await direto(SQL.taxaUpd, ["-50"]), "taxa");
  r.taxaNaN = recusada(await direto(SQL.taxaUpd, ["NaN"]), "taxa");
  // a porta real: a RPC do painel (cast sem guarda, o achado 1)
  r.taxaRpcNegativa = recusada(
    await comoAdmin(SQL.upsertConfig, [
      JSON.stringify({ local_delivery_fee: -50 }),
    ]),
    "taxa",
  );
  r.taxaRecusaNaoMudaLinha = nao((await estadoAtual()).taxa, 10);
  r.taxaZero = aceita(await direto(SQL.taxaUpd, ["0"]));
  r.taxaCentavo = aceita(await direto(SQL.taxaUpd, ["0.01"]));
  r.taxaPositiva = aceita(await direto(SQL.taxaUpd, ["12.50"]));
  r.taxaRpcPositiva =
    aceita(
      await comoAdmin(SQL.upsertConfig, [
        JSON.stringify({ local_delivery_fee: 15 }),
      ]),
    ) && nao((await estadoAtual()).taxa, 15);
  // linha de configuracao ainda nao criada: o caminho INSERT da RPC
  await P.conexao().query("DELETE FROM public.store_config WHERE id = 1");
  r.taxaRpcInsereNegativa = recusada(
    await comoAdmin(SQL.upsertConfig, [
      JSON.stringify({ local_delivery_fee: -50 }),
    ]),
    "taxa",
  );
  await P.conexao().query("DELETE FROM public.store_config WHERE id = 1");
  await P.conexao().query("INSERT INTO public.store_config (id) VALUES (1)");
  // a sentinela legada do frete gratis "por produto" (-1) e' OUTRO campo e segue valendo
  r.taxaSentinelaFreteGratisSegue = aceita(
    await direto(
      "UPDATE public.store_config SET free_shipping_min = -1 WHERE id = 1 RETURNING free_shipping_min",
    ),
  );

  // ---------------- PRECO DO PRODUTO (produtos.preco_venda), semente 100 ----------------
  r.precoUpdNegativo = recusada(
    await direto(SQL.precoUpd, ["-0.01", PROD]),
    "preco",
  );
  r.precoUpdMenos90 = recusada(
    await direto(SQL.precoUpd, ["-90", PROD]),
    "preco",
  );
  r.precoUpdNaN = recusada(await direto(SQL.precoUpd, ["NaN", PROD]), "preco");
  r.precoInsNegativo = recusada(await direto(SQL.precoIns, ["-90"]), "preco");
  r.precoInsNaoGravou =
    (
      await unico(
        "SELECT count(*)::int AS n FROM public.produtos WHERE nome = 'Novo 1400000'",
      )
    ).n === 0;
  // a porta do painel: RLS do admin e a RPC que salva produto e grade juntos (o achado 2)
  r.precoRlsNegativo = recusada(
    await comoAdmin(SQL.precoIns, ["-90"]),
    "preco",
  );
  r.precoRpcNegativo = recusada(
    await comoAdmin(SQL.salvarProduto, [
      PROD,
      JSON.stringify({ preco_venda: -90 }),
      "[]",
    ]),
    "preco",
  );
  r.precoRecusaNaoMudaLinha = nao((await estadoAtual()).preco, 100);
  r.precoZero = aceita(await direto(SQL.precoUpd, ["0", PROD]));
  r.precoInsZero = aceita(await direto(SQL.precoIns, ["0"])); // brinde: produto de R$0 nasce
  r.precoPositivo = aceita(await direto(SQL.precoUpd, ["129.90", PROD]));
  r.precoRpcPositivo =
    aceita(
      await comoAdmin(SQL.salvarProduto, [
        PROD,
        JSON.stringify({ preco_venda: 120 }),
        "[]",
      ]),
    ) && nao((await estadoAtual()).preco, 120);

  // ---------------- PRECO PROPRIO DA VARIACAO (product_variants.price_override), semente NULL ----------------
  r.variacaoUpdNegativo = recusada(
    await direto(SQL.varUpd, ["-0.01", VARIACAO]),
    "variacao",
  );
  r.variacaoUpdMenos5 = recusada(
    await direto(SQL.varUpd, ["-5", VARIACAO]),
    "variacao",
  );
  r.variacaoUpdNaN = recusada(
    await direto(SQL.varUpd, ["NaN", VARIACAO]),
    "variacao",
  );
  r.variacaoInsNegativo = recusada(
    await direto(SQL.varIns, ["-5", PROD, "Negativa"]),
    "variacao",
  );
  r.variacaoRpcNegativa = recusada(
    await comoAdmin(SQL.salvarProduto, [PROD, "{}", variacaoJson(-5)]),
    "variacao",
  );
  r.variacaoRecusaNaoMudaLinha = (await estadoAtual()).variacao === null;
  r.variacaoZero = aceita(await direto(SQL.varUpd, ["0", VARIACAO]));
  r.variacaoPositiva = aceita(await direto(SQL.varUpd, ["79.90", VARIACAO]));
  // NULL = herda o preco do produto: o caso comum, nunca recusado
  r.variacaoNulaUpd = aceita(await direto(SQL.varUpd, [null, VARIACAO]));
  r.variacaoNulaIns = aceita(
    await direto(SQL.varIns, [null, PROD, "Sem preco"]),
  );
  r.variacaoRpcPositiva =
    aceita(
      await comoAdmin(SQL.salvarProduto, [PROD, "{}", variacaoJson(55)]),
    ) && nao((await estadoAtual()).variacao, 55);
  r.variacaoRpcNula =
    aceita(
      await comoAdmin(SQL.salvarProduto, [PROD, "{}", variacaoJson(null)]),
    ) && (await estadoAtual()).variacao === null;

  // ---------------- VALOR DO CUPOM (coupons.value), semente 10 ----------------
  r.cupomInsFixoNegativo = recusada(
    await direto(SQL.cupIns, ["-20", "B14NEG1", "fixed"]),
    "cupom",
  );
  r.cupomInsPercentNegativo = recusada(
    await direto(SQL.cupIns, ["-10", "B14NEG2", "percentage"]),
    "cupom",
  );
  r.cupomInsNaN = recusada(
    await direto(SQL.cupIns, ["NaN", "B14NAN", "fixed"]),
    "cupom",
  );
  r.cupomUpdNegativo = recusada(
    await direto(SQL.cupUpd, ["-0.01", CUPOM]),
    "cupom",
  );
  r.cupomUpdNaN = recusada(await direto(SQL.cupUpd, ["NaN", CUPOM]), "cupom");
  r.cupomRlsNegativo = recusada(
    await comoAdmin(SQL.cupIns, ["-20", "B14NEG3", "fixed"]),
    "cupom",
  );
  r.cupomRlsUpdNegativo = recusada(
    await comoAdmin(SQL.cupUpd, ["-20", CUPOM]),
    "cupom",
  );
  r.cupomNaoGravou =
    (
      await unico(
        "SELECT count(*)::int AS n FROM public.coupons WHERE code LIKE 'B14NEG%' OR code = 'B14NAN'",
      )
    ).n === 0;
  r.cupomRecusaNaoMudaLinha = nao((await estadoAtual()).cupom, 10);
  r.cupomZero = aceita(await direto(SQL.cupUpd, ["0", CUPOM]));
  r.cupomPositivo = aceita(await direto(SQL.cupUpd, ["10", CUPOM]));
  r.cupomRlsPositivo = aceita(
    await comoAdmin(SQL.cupIns, ["15", "B14OK1", "fixed"]),
  );
  r.cupomPercentualPositivo = aceita(
    await direto(SQL.cupIns, ["10", "B14OK2", "percentage"]),
  );
  // o desconto legitimo segue funcionando de ponta a ponta (a regra do checkout)
  const validar = (
    await direto(
      "SELECT public.validate_coupon_secure_v2('B1400000', 100) AS v",
    )
  ).linhas?.[0]?.v;
  r.cupomDescontoLegitimoSegue =
    Boolean(validar) &&
    validar.is_valid === true &&
    Number(validar.discount_value) === 10;
  return r;
}
const falhou = (r) =>
  Object.entries(r)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
    .sort();

const restricoes = async (c = P.conexao()) =>
  (
    await c.query(
      `SELECT conrelid::regclass::text AS t, conname, oid::text AS oid, pg_get_constraintdef(oid) AS def, convalidated, contype
         FROM pg_constraint WHERE conname = ANY ($1::text[]) ORDER BY conname`,
      [CKS],
    )
  ).rows;
/** true = as 4 existem; false = nenhuma; "parcial" = qualquer outra coisa (nunca deve acontecer). */
const aplicado = async (c = P.conexao()) => {
  const n = (await restricoes(c)).length;
  return n === 4 ? true : n === 0 ? false : "parcial";
};
const dados = async () =>
  unico(
    `SELECT (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.store_config x) AS sc,
            (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.produtos x) AS p,
            (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.product_variants x) AS v,
            (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.coupons x) AS c`,
  );
const trocarRegra = (alvo, regra) => {
  const { tabela, ck } = ALVOS[alvo];
  return `ALTER TABLE public.${tabela} DROP CONSTRAINT ${ck};
          ALTER TABLE public.${tabela} ADD CONSTRAINT ${ck} CHECK (${regra}) NOT VALID`;
};
const tirar = (alvo) =>
  `ALTER TABLE public.${ALVOS[alvo].tabela} DROP CONSTRAINT ${ALVOS[alvo].ck}`;

/** Prova de ambiente: MUTANTE_VALORES_NEGATIVOS=sem-<alvo> tira a restricao do alvo antes do roteiro "DEPOIS". */
const mutanteDeAmbiente = () => {
  const m = /^sem-(taxa|preco|variacao|cupom)$/.exec(
    process.env.MUTANTE_VALORES_NEGATIVOS ?? "",
  );
  return m ? tirar(m[1]) : null;
};

// ---------------------------------------------------------------------------------------------------------------------------
prova(
  "ANTES (controle): sem os CHECKs negativo e NaN entram nas 4 colunas e o cupom de -20 vira acrescimo (o defeito)",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), false, "o estado ANTES nao montou");
        const f = falhou(await roteiro());
        for (const k of [
          "taxaMenosUmCentavo",
          "taxaMenos50",
          "taxaNaN",
          "taxaRpcNegativa",
          "taxaRpcInsereNegativa",
          "precoUpdNegativo",
          "precoUpdMenos90",
          "precoUpdNaN",
          "precoInsNegativo",
          "precoRlsNegativo",
          "precoRpcNegativo",
          "variacaoUpdNegativo",
          "variacaoUpdNaN",
          "variacaoInsNegativo",
          "variacaoRpcNegativa",
          "cupomInsFixoNegativo",
          "cupomInsPercentNegativo",
          "cupomInsNaN",
          "cupomUpdNegativo",
          "cupomRlsNegativo",
        ])
          assert.ok(f.includes(k), `controle: ${k} devia falhar sem os CHECKs`);
        // o que ja era certo antes continua certo (zero, positivo, NULL, sentinela do frete gratis)
        for (const k of [
          "taxaZero",
          "taxaPositiva",
          "taxaSentinelaFreteGratisSegue",
          "precoZero",
          "precoPositivo",
          "precoRpcPositivo",
          "variacaoZero",
          "variacaoNulaUpd",
          "variacaoNulaIns",
          "cupomZero",
          "cupomPositivo",
          "cupomDescontoLegitimoSegue",
        ])
          assert.ok(!f.includes(k), `controle: ${k} ja funcionava antes`);
        // o efeito: o cupom `fixed` de -20 entra e o servidor o trata como desconto -20 (acrescimo de R$20)
        await P.conexao().query(
          "INSERT INTO public.coupons (code, type, value, active) VALUES ('B14DEF', 'fixed', -20, true)",
        );
        const v = (
          await direto(
            "SELECT public.validate_coupon_secure_v2('B14DEF', 100) AS v",
          )
        ).linhas[0].v;
        assert.equal(v.is_valid, true);
        assert.equal(Number(v.discount_value), -20, "o defeito nao reproduziu");
      },
      async () => {
        await semear();
        await antes();
      },
    );
  },
);

prova(
  "DEPOIS: negativo e NaN recusados (23514, restricao certa) em todas as portas; zero, positivo e NULL de variacao seguem aceitos",
  async () => {
    await P.emTransacao(
      async () => {
        // o roteiro vem ANTES da precondicao: sem uma restricao a prova reprova pelo COMPORTAMENTO (qual chave), nao so pela ausencia
        const r = await roteiro();
        assert.deepEqual(falhou(r), [], JSON.stringify(r));
        assert.equal(await aplicado(), true, "o estado DEPOIS nao montou");
        const x = await estadoAtual();
        assert.ok(
          Object.values(x).every((v) => v === null || Number(v) >= 0),
          `ficou valor negativo no banco: ${JSON.stringify(x)}`,
        );
      },
      async () => {
        await semear();
        await depois();
        const sabotagem = mutanteDeAmbiente();
        if (sabotagem) await P.conexao().query(sabotagem);
      },
    );
  },
);

prova(
  "As 4 restricoes nascem NOT VALID, uma por coluna, com a regra exata, e nada mais e criado",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      assert.equal(await aplicado(), false);
      await depois();
      const linhas = await restricoes();
      assert.equal(linhas.length, 4);
      for (const n of NOMES) {
        const l = linhas.find((x) => x.conname === ALVOS[n].ck);
        assert.ok(l, `falta ${ALVOS[n].ck}`);
        assert.equal(l.t, ALVOS[n].tabela);
        assert.equal(l.def, `${ALVOS[n].def} NOT VALID`);
        assert.equal(l.convalidated, false);
        assert.equal(l.contype, "c");
      }
    });
  },
);

// ---- (d) LINHA ANTIGA ------------------------------------------------------------------------------------------------------
prova(
  "LINHA ANTIGA: dado negativo que ja existia NAO impede a migration (NOT VALID nao varre); fica como estava; o novo e recusado; a linha antiga trava UPDATE ate ser corrigida",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      const c = P.conexao();
      await c.query(
        "UPDATE public.store_config SET local_delivery_fee = -50 WHERE id = 1",
      );
      await c.query(
        "UPDATE public.produtos SET preco_venda = -90 WHERE id = $1",
        [PROD],
      );
      await c.query(
        "UPDATE public.product_variants SET price_override = -5 WHERE id = $1",
        [VARIACAO],
      );
      await c.query("UPDATE public.coupons SET value = -20 WHERE id = $1", [
        CUPOM,
      ]);
      // um produto sem defeito para receber variacao nova (o gatilho da variacao atualiza o produto-pai, que aqui e' o antigo)
      await c.query(
        "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Limpo 1400000', 30, 1, true, 10)",
        [PROD2],
      );
      const d0 = await dados();
      const r0 = await P.retrato(NOVOS);
      // 1. a migration aplica por cima de dado ruim (nao falha por dado existente)
      assert.equal(
        await P.aplicar(MIGRATION),
        null,
        "a migration devia aplicar sobre dado antigo negativo",
      );
      assert.equal(await aplicado(), true);
      for (const l of await restricoes())
        assert.equal(l.convalidated, false, `${l.conname} varreu a tabela`);
      // 2. nenhuma linha foi lida/reescrita: o dado antigo e' o mesmo, byte a byte
      assert.deepEqual(await dados(), d0, "a migration mexeu em dado antigo");
      assert.deepEqual(await estadoAtual(), {
        taxa: "-50",
        preco: "-90.00",
        variacao: "-5",
        cupom: "-20",
      });
      // 3. o novo valor negativo e' recusado, o valido entra, mesmo com a linha antiga ao lado
      assert.ok(recusada(await direto(SQL.precoIns, ["-1"]), "preco"));
      assert.ok(aceita(await direto(SQL.precoIns, ["5"])));
      assert.ok(
        recusada(await direto(SQL.cupIns, ["-1", "B14L1", "fixed"]), "cupom"),
      );
      assert.ok(aceita(await direto(SQL.cupIns, ["5", "B14L2", "fixed"])));
      assert.ok(
        recusada(await direto(SQL.varIns, ["-1", PROD2, "L1"]), "variacao"),
      );
      assert.ok(aceita(await direto(SQL.varIns, ["5", PROD2, "L2"])));
      // 4. A CONSEQUENCIA DECLARADA: o CHECK e' reavaliado em todo UPDATE da linha, mesmo de outra coluna
      const mexer = {
        taxa: "UPDATE public.store_config SET store_name = store_name WHERE id = 1 RETURNING id",
        preco:
          "UPDATE public.produtos SET estoque = estoque WHERE id = $1::uuid RETURNING id",
        variacao:
          "UPDATE public.product_variants SET stock_increment = stock_increment WHERE id = $1::uuid RETURNING id",
        cupom:
          "UPDATE public.coupons SET usage_count = usage_count WHERE id = $1::uuid RETURNING id",
      };
      const ids = {
        taxa: [],
        preco: [PROD],
        variacao: [VARIACAO],
        cupom: [CUPOM],
      };
      for (const n of NOMES)
        assert.ok(
          recusada(await direto(mexer[n], ids[n]), n),
          `UPDATE de outra coluna na linha antiga (${n}) devia recusar ate ela ser corrigida`,
        );
      // 5. o VALIDATE so passa depois da correcao (e' o que NOT VALID adiou)
      for (const n of NOMES) {
        await c.query("SAVEPOINT validar");
        await assert.rejects(
          () =>
            c.query(
              `ALTER TABLE public.${ALVOS[n].tabela} VALIDATE CONSTRAINT ${ALVOS[n].ck}`,
            ),
          (e) => e.code === "23514",
          `VALIDATE de ${n} devia falhar com a linha antiga`,
        );
        await c.query("ROLLBACK TO SAVEPOINT validar");
      }
      // 6. corrigida a linha (decisao da lojista), o UPDATE volta e o VALIDATE passa
      assert.ok(aceita(await direto(SQL.taxaUpd, ["10"])));
      assert.ok(aceita(await direto(SQL.precoUpd, ["100", PROD])));
      assert.ok(aceita(await direto(SQL.varUpd, ["50", VARIACAO])));
      assert.ok(aceita(await direto(SQL.cupUpd, ["10", CUPOM])));
      for (const n of NOMES)
        await c.query(
          `ALTER TABLE public.${ALVOS[n].tabela} VALIDATE CONSTRAINT ${ALVOS[n].ck}`,
        );
      assert.ok((await restricoes()).every((l) => l.convalidated === true));
      // 7. a migration nao deixou nada alem das 4 restricoes
      assert.deepEqual(
        await P.retrato(NOVOS),
        r0,
        "o apply mexeu em objeto que nao era dele",
      );
    });
  },
);

// ---- (e) reaplicar --------------------------------------------------------------------------------------------------------------
prova(
  "reaplicar 2x, em CRLF e sobre restricao ja validada = no-op (mesma restricao, mesmo OID, dado intacto)",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await depois();
      const e1 = await restricoes();
      const d1 = await dados();
      await depois();
      await depois();
      assert.deepEqual(await restricoes(), e1, "reaplicar 2x mudou o estado");
      await P.conexao().query(emCRLF(MIGRATION));
      assert.deepEqual(await restricoes(), e1, "em CRLF o estado mudou");
      assert.deepEqual(await dados(), d1, "reaplicar mexeu em dado");
      // ja validada (VALIDATE rodado a mao): o pre-voo aceita e a migration nao recria
      for (const n of NOMES)
        await P.conexao().query(
          `ALTER TABLE public.${ALVOS[n].tabela} VALIDATE CONSTRAINT ${ALVOS[n].ck}`,
        );
      const validadas = await restricoes();
      assert.ok(validadas.every((l) => l.convalidated === true));
      await depois();
      assert.deepEqual(
        await restricoes(),
        validadas,
        "reaplicar sobre a validada mudou algo",
      );
      await antes();
      assert.equal(await aplicado(), false, "o rollback aceita as validadas");
    });
  },
);

prova(
  "SO NOVO: o apply cria so as 4 restricoes; nenhuma funcao (corpo, OID, ACL), tabela, politica, gatilho ou outra restricao muda",
  async () => {
    await P.emTransacao(async () => {
      await antes();
      const r0 = await P.retrato(NOVOS);
      assert.equal(await aplicado(), false);
      await depois();
      assert.equal(await aplicado(), true);
      assert.deepEqual(
        await P.retrato(NOVOS),
        r0,
        "o apply mexeu em objeto que nao era dele",
      );
      // as restricoes que ja existiam nas 4 tabelas seguem (inclusive as vizinhas de >= 0)
      const vizinhas = (
        await P.conexao().query(
          `SELECT conname FROM pg_constraint WHERE contype = 'c' AND NOT (conname = ANY ($1::text[]))
            AND conrelid IN ('public.produtos'::regclass, 'public.coupons'::regclass,
                             'public.product_variants'::regclass, 'public.store_config'::regclass)
            AND conname IN ('check_estoque_positivo', 'coupons_type_check', 'check_stock_increment_positivo',
                            'store_config_national_shipping_min_check')`,
          [CKS],
        )
      ).rows.map((x) => x.conname);
      assert.deepEqual(vizinhas.sort(), [
        "check_estoque_positivo",
        "check_stock_increment_positivo",
        "coupons_type_check",
        "store_config_national_shipping_min_check",
      ]);
    });
  },
);

// ---- MUTANTES: o roteiro sobre restricoes sabotadas fica vermelho nas chaves certas e so nelas -----------------------------------
const CHAVES = {
  taxa: {
    sem: [
      "taxaMenosUmCentavo",
      "taxaMenos50",
      "taxaNaN",
      "taxaRpcNegativa",
      "taxaRpcInsereNegativa",
      "taxaRecusaNaoMudaLinha",
    ],
    nan: ["taxaNaN"],
    zero: ["taxaZero"],
  },
  preco: {
    sem: [
      "precoUpdNegativo",
      "precoUpdMenos90",
      "precoUpdNaN",
      "precoInsNegativo",
      "precoInsNaoGravou",
      "precoRlsNegativo",
      "precoRpcNegativo",
      "precoRecusaNaoMudaLinha",
    ],
    nan: ["precoUpdNaN"],
    zero: ["precoZero", "precoInsZero"],
  },
  variacao: {
    sem: [
      "variacaoUpdNegativo",
      "variacaoUpdMenos5",
      "variacaoUpdNaN",
      "variacaoInsNegativo",
      "variacaoRpcNegativa",
      "variacaoRecusaNaoMudaLinha",
    ],
    nan: ["variacaoUpdNaN"],
    zero: ["variacaoZero"],
  },
  cupom: {
    sem: [
      "cupomInsFixoNegativo",
      "cupomInsPercentNegativo",
      "cupomInsNaN",
      "cupomUpdNegativo",
      "cupomUpdNaN",
      "cupomRlsNegativo",
      "cupomRlsUpdNegativo",
      "cupomNaoGravou",
      "cupomRecusaNaoMudaLinha",
    ],
    nan: ["cupomInsNaN", "cupomUpdNaN"],
    zero: ["cupomZero"],
  },
};
const COLUNA = (n) => ALVOS[n].coluna;
for (const n of NOMES) {
  const variantes = [
    ["sem a regra", tirar(n), CHAVES[n].sem],
    ["sem o NaN", trocarRegra(n, `${COLUNA(n)} >= 0`), CHAVES[n].nan],
    ["zero recusado (> 0)", trocarRegra(n, `${COLUNA(n)} > 0`), CHAVES[n].zero],
  ];
  for (const [nome, sabotagem, esperado] of variantes) {
    prova(
      `MUTANTE ${n} ${nome}: o roteiro fica vermelho nas chaves certas e so nelas`,
      async () => {
        await P.emTransacao(
          async () => {
            const f = falhou(await roteiro());
            for (const k of esperado)
              assert.ok(
                f.includes(k),
                `o mutante '${n} ${nome}' devia reprovar ${k}, reprovou ${JSON.stringify(f)}`,
              );
            // isolamento: sabotar uma coluna nao pode reprovar as chaves de outro alvo
            const fora = f.filter((k) => !k.startsWith(n));
            assert.deepEqual(
              fora,
              [],
              `o mutante '${n} ${nome}' reprovou chaves de outra coluna`,
            );
          },
          async () => {
            await semear();
            await depois();
            await P.conexao().query(sabotagem);
          },
        );
      },
    );
  }
}

// ---- rollback --------------------------------------------------------------------------------------------------------------------
prova(
  "rollback: tira so as 4 restricoes sem tocar dado; 2x e' no-op; ida e volta termina igual",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await depois();
      const d0 = await dados();
      const e0 = await restricoes();
      await antes();
      assert.equal(await aplicado(), false);
      assert.deepEqual(await dados(), d0, "o rollback mexeu em dado");
      await antes();
      assert.equal(await aplicado(), false, "o segundo rollback nao foi no-op");
      await depois();
      const e1 = await restricoes();
      assert.deepEqual(
        e1.map(({ oid, ...resto }) => resto),
        e0.map(({ oid, ...resto }) => resto),
      );
      assert.deepEqual(await dados(), d0);
      assert.equal(sha256(ROLLBACK).length, 64);
    });
  },
);

prova(
  "pre-voo recusa SEM escrever: restricao do mesmo nome com outra regra e coluna que sumiu",
  async () => {
    // Partida: o estado ANTES (nenhuma das 4) com UMA sabotagem no alvo; a migration tem de recusar antes de criar qualquer uma.
    const sabotagens = [];
    for (const n of NOMES) {
      const { tabela, ck, coluna } = ALVOS[n];
      sabotagens.push([
        `${n}: CHECK do mesmo nome com outra regra`,
        `ALTER TABLE public.${tabela} ADD CONSTRAINT ${ck} CHECK (${coluna} >= -100)`,
      ]);
      sabotagens.push([
        `${n}: coluna renomeada`,
        `ALTER TABLE public.${tabela} RENAME COLUMN ${coluna} TO ${coluna}_x`,
      ]);
    }
    for (const [nome, sabotar] of sabotagens) {
      await P.emTransacao(
        async () => {
          const r0 = await P.retrato(NOVOS);
          const antesDeTentar = await restricoes();
          await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            await P.retrato(NOVOS),
            r0,
            `pre-voo (${nome}) escreveu antes de recusar`,
          );
          assert.deepEqual(
            await restricoes(),
            antesDeTentar,
            `pre-voo (${nome}) criou restricao antes de recusar`,
          );
        },
        async () => {
          await semear();
          await antes();
          await P.conexao().query(sabotar);
        },
      );
    }
  },
);

prova(
  "a conferencia final recusa cada estrago (restricao ausente, regra trocada) e aceita o desenho",
  async () => {
    const bloco = P.blocoDe(MIGRATION, "conferencia_20261400000000");
    for (const n of NOMES) {
      for (const estrago of [tirar(n), trocarRegra(n, `${COLUNA(n)} >= -1`)]) {
        await P.emTransacao(
          async () => {
            await P.conexao().query(estrago);
            await P.recusa(bloco, /conferencia 20261400000000/);
          },
          async () => {
            await semear();
            await depois();
          },
        );
      }
    }
    await P.emTransacao(
      async () => {
        assert.equal(await P.aplicar(bloco), null);
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "pre-voo do rollback recusa o que nao e' dele (restricao redefinida) sem apagar NENHUMA das 4",
  async () => {
    for (const n of NOMES) {
      await P.emTransacao(
        async () => {
          const antesDeTentar = await restricoes();
          await P.recusa(ROLLBACK, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            await restricoes(),
            antesDeTentar,
            `o pre-voo do rollback (${n}) apagou antes de recusar`,
          );
        },
        async () => {
          await semear();
          await depois();
          await P.conexao().query(trocarRegra(n, `${COLUNA(n)} >= -100`));
        },
      );
    }
  },
);

// ---- ATOMICIDADE e TRAVA (conexoes proprias; deixam o clone no estado ANTES — ficam por ULTIMO) --------------------------------
prova(
  "ATOMICIDADE: sem BEGIN, falha no MEIO (3a restricao) ou conferencia sabotada deixam NENHUMA das 4; a migration inteira ainda aplica depois",
  async () => {
    const c3 = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await c3.connect();
    try {
      await c3.query(ROLLBACK);
      assert.equal(await aplicado(c3), false);
      // (1) a 3a ALTER (produtos) falha: as 2 primeiras (store_config e product_variants) ja tinham rodado no mesmo arquivo
      const noMeio = MIGRATION.replace(
        /(ADD CONSTRAINT produtos_preco_venda_nao_negativo CHECK \()preco_venda >= 0/,
        "$1preco_venda >= 'nao-e-numero'",
      );
      assert.notEqual(noMeio, MIGRATION, "a sabotagem do meio nao pegou");
      await assert.rejects(
        () => c3.query(noMeio),
        /invalid input syntax for type numeric/,
      );
      assert.equal(
        await aplicado(c3),
        false,
        "ficou restricao pela metade depois da falha no meio",
      );
      // (2) a conferencia final reprova (regra sabotada no texto dela): as 4 ja tinham sido criadas e todas voltam
      const i = MIGRATION.indexOf("DO $conferencia_20261400000000$");
      const quebrada =
        MIGRATION.slice(0, i) +
        MIGRATION.slice(i).replace("(0)::numeric", "(1)::numeric");
      assert.notEqual(
        quebrada,
        MIGRATION,
        "a sabotagem da conferencia nao pegou",
      );
      await assert.rejects(
        () => c3.query(quebrada),
        /conferencia 20261400000000/,
      );
      assert.equal(
        await aplicado(c3),
        false,
        "ficaram restricoes depois da conferencia reprovar",
      );
      // (3) sem sabotagem, a mesma conexao aplica as 4 de uma vez
      await c3.query(MIGRATION);
      assert.equal(await aplicado(c3), true);
      await c3.query(ROLLBACK);
      assert.equal(await aplicado(c3), false);
    } finally {
      await c3.end();
    }
  },
);

for (const [tabela, gravar] of [
  [
    "produtos",
    "INSERT INTO public.produtos (nome, preco_venda, custo) VALUES ('em voo', 1, 1)",
  ],
  [
    "product_variants",
    "UPDATE public.product_variants SET stock_increment = stock_increment WHERE false",
  ],
  [
    "coupons",
    "INSERT INTO public.coupons (code, type, value) VALUES ('EMVOO1400', 'fixed', 1)",
  ],
  [
    "store_config",
    "UPDATE public.store_config SET store_name = store_name WHERE false",
  ],
]) {
  prova(
    `TRAVA (${tabela}): gravacao em voo faz a migration falhar limpa no lock_timeout, sem nenhuma restricao pela metade, e depois aplicar`,
    async () => {
      await P.travaAberta({
        sqlMigracao: MIGRATION,
        gravar: async (c2) => {
          await c2.query(gravar);
        },
        aplicado: (c) => aplicado(c),
      });
    },
  );
}

(async () => {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("valores-negativos-nao-entram-no-banco");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
