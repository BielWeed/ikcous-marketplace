"use strict";

/**
 * PROVA VIVA da migration 20261560000000_o_infinito_nao_entra_no_banco.sql contra o Postgres EFEMERO (clone do rodar-isolado.cjs:
 * a arvore migrada, com a 20261400000000 aplicada). Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs.
 *
 * O defeito: numeric SEM precisao aceita 'Infinity', e as restricoes da 400 (`col >= 0 AND col <> 'NaN'`) deixam o +Infinity
 * passar. Taxa de entrega local infinita (por upsert_store_config ou direto) faz o total de todo pedido com entrega local nunca
 * bater; preco proprio de variacao infinito tira a variacao de venda; cupom de valor infinito entra na conta do desconto. O
 * conserto: um CHECK NOVO e separado por coluna, `col <> 'Infinity' AND col <> '-Infinity'`, criado JA VALIDADO.
 *
 *  ANTES       controle: sem os CHECKs novos o +Infinity entra nas 3 colunas (direto e pelas RPCs reais); preco_venda (numeric(10,2))
 *              ja recusa infinito pelo TIPO (22003) e NaN ja e' recusado pela 400 - os dois seguem iguais depois.
 *  DEPOIS      Infinity, -Infinity e as outras grafias (inf, +INFINITY) recusados com 23514 pela restricao NOVA, para a sessao direta,
 *              para o admin pela RLS e pelas RPCs reais (upsert_store_config, salvar_produto_com_grade); zero, centavo, positivo, um
 *              finito ENORME e price_override NULL seguem aceitos; NaN segue recusado (pela restricao da 400); a recusa nao muda linha.
 *  SEM A 400   com as restricoes da 400 desfeitas, as novas SOZINHAS recusam Infinity e -Infinity (a regra nao depende da 400).
 *  LINHA ANTIGA  valor infinito que ja existia faz a migration se RECUSAR (B1_BASELINE_DIVERGENT, com a coluna e a contagem), em cada
 *              coluna e nos dois sinais, sem deixar restricao nem mudar dado; corrigida a linha, aplica. NaN, NULL e finito enorme NAO
 *              contam. Mutantes da guarda (removida, cega a uma coluna) ainda recusam pelo ADD validado, mas sem a mensagem B1.
 *  CORRIDA     foto REPEATABLE READ leu antes, outra sessao grava cupom infinito e confirma: o ADD validado RECUSA (23514). Mutante
 *              "NOT VALID" aplica por cima e o UPDATE de outra coluna do cupom passa a recusar (o estrago que a guarda evita).
 *  SO NOVO     o apply cria so as 3 restricoes; nenhuma funcao, tabela, politica, gatilho ou outra restricao (as 4 da 400 inclusive) muda.
 *  MUTANTES    sem a regra, sem o -Infinity e "recusa finito enorme", em cada coluna: vermelho nas chaves certas e so nelas.
 *  MIGRATION   reaplicar (2x, CRLF, ja validada) e' no-op (mesmo OID); rollback tira so as 3 novas, 2x no-op; pre-voo recusa SEM
 *              escrever (homonima, coluna renomeada, preco_venda sem precisao); conferencia final recusa cada estrago; pre-voo do
 *              rollback recusa o que nao e' dele; consultas 193a/193b EXECUTADAS nos dois estados e com defeito plantado.
 *  ATOMICIDADE conexao SEM BEGIN: falha no meio (3a restricao), guarda recusando e conferencia sabotada deixam NENHUMA das 3; gravacao
 *              em voo faz a migration FALHAR LIMPA no lock_timeout e depois aplicar.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-infinito-nao-entra-no-banco-viva.cjs
 * Mutante de ambiente (a prova inteira deve ficar vermelha): MUTANTE_O_INFINITO=sem-<alvo> tira a restricao nova do alvo (taxa,
 * variacao, cupom) logo depois do preparo, antes do roteiro "DEPOIS".
 */

/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui (ALVOS[n], CK_400[n], RUIM[n], MEXER[n], CHAVES[n]) vem das listas constantes do proprio arquivo
 * (NOMES, ALVOS), nunca de entrada de rede nem de terceiro. */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, emCRLF } = P;
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME = "20261560000000_o_infinito_nao_entra_no_banco.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK = P.lerMigration(`rollback-manual-${NOME}`);
const NOME_400 = "20261400000000_valores_negativos_nao_entram_no_banco.sql";
const ROLLBACK_400 = P.lerMigration(`rollback-manual-${NOME_400}`);
const A193 = "193a-conferir-o-infinito-nao-entra-no-banco-aplicado";
const B193 = "193b-antes-o-infinito-nao-entra-no-banco-ausente";

// Ordem de criacao na migration: a mesma ordem de trava da compra (store_config, variacoes, cupons).
const ALVOS = {
  taxa: {
    tabela: "store_config",
    coluna: "local_delivery_fee",
    ck: "store_config_local_delivery_fee_finito",
    def: "CHECK (((local_delivery_fee <> 'Infinity'::numeric) AND (local_delivery_fee <> '-Infinity'::numeric)))",
  },
  variacao: {
    tabela: "product_variants",
    coluna: "price_override",
    ck: "product_variants_price_override_finito",
    def: "CHECK (((price_override IS NULL) OR ((price_override <> 'Infinity'::numeric) AND (price_override <> '-Infinity'::numeric))))",
  },
  cupom: {
    tabela: "coupons",
    coluna: "value",
    ck: "coupons_value_finito",
    def: "CHECK (((value <> 'Infinity'::numeric) AND (value <> '-Infinity'::numeric)))",
  },
};
// As restricoes da 400 nas mesmas colunas: sao elas que recusam NaN (e -Infinity, por ser negativo) - nunca tocadas aqui.
const CK_400 = {
  taxa: "store_config_local_delivery_fee_nao_negativo",
  variacao: "product_variants_price_override_nao_negativo",
  cupom: "coupons_value_nao_negativo",
};
const NOMES = Object.keys(ALVOS);
const CKS = NOMES.map((n) => ALVOS[n].ck);
const NOVOS = { funcoes: [], gatilhos: [], restricoes: CKS };

const U = { admin: "b1560000-0000-4000-8000-0000000000ad" };
const PROD = "b1560000-0000-4000-8000-0000000000f1";
const VARIACAO = "b1560000-0000-4000-8000-0000000000f2";
const CUPOM = "b1560000-0000-4000-8000-0000000000c1";
const ADMIN = {
  uid: U.admin,
  claims: JSON.stringify({
    sub: U.admin,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};

const depois = () => P.conexao().query(MIGRATION);
const antes = () => P.conexao().query(ROLLBACK);
const sem400 = () => P.conexao().query(ROLLBACK_400);

async function semear() {
  const c = P.conexao();
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1::uuid, 'admin@b1560000.teste', '{"role":"admin"}'::jsonb)`,
    [U.admin],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin 1560000', 'admin')",
    [U.admin],
  );
  await c.query(
    "INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );
  await c.query(
    "UPDATE public.store_config SET local_delivery_fee = 10 WHERE id = 1",
  );
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Camiseta 1560000', 100, 10, true, 40)",
    [PROD],
  );
  await c.query(
    "INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active) VALUES ($1, $2, 'Cor', 'Azul', 5, true)",
    [VARIACAO, PROD],
  );
  await c.query(
    "INSERT INTO public.coupons (id, code, type, value, active) VALUES ($1, 'B1560000', 'fixed', 10, true)",
    [CUPOM],
  );
}

const direto = (sql, params = []) => P.tentar(null, sql, params, ADMIN);
const comoAdmin = (sql, params = []) =>
  P.tentar("authenticated", sql, params, ADMIN);
const recusada = (r, alvo) =>
  !r.linhas && r.codigo === "23514" && r.restricao === ALVOS[alvo].ck;
const recusadaPela400 = (r, alvo) =>
  !r.linhas && r.codigo === "23514" && r.restricao === CK_400[alvo];
const aceita = (r) => Boolean(r.linhas) && r.linhas.length >= 1;
const unico = async (sql, params = []) =>
  (await P.conexao().query(sql, params)).rows[0];

// ---- SQL das tentativas por alvo (a mesma forma nos dois estados) --------------------------------------------------------------
const SQL = {
  taxaUpd:
    "UPDATE public.store_config SET local_delivery_fee = $1::numeric WHERE id = 1 RETURNING local_delivery_fee",
  precoUpd:
    "UPDATE public.produtos SET preco_venda = $1::numeric WHERE id = $2::uuid RETURNING preco_venda",
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
const ENORME = "99999999999999999999.99"; // finito: nao e' infinito e tem de continuar entrando

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
  const igual = (v, esperado) => Number(v) === esperado;
  // ---------------- TAXA DE ENTREGA LOCAL (store_config.local_delivery_fee), semente 10 ----------------
  r.taxaInfinity = recusada(await direto(SQL.taxaUpd, ["Infinity"]), "taxa");
  r.taxaMenosInfinity = recusada(
    await direto(SQL.taxaUpd, ["-Infinity"]),
    "taxa",
  );
  r.taxaGrafiaInf = recusada(await direto(SQL.taxaUpd, ["inf"]), "taxa");
  r.taxaGrafiaMaisInfinity = recusada(
    await direto(SQL.taxaUpd, ["+INFINITY"]),
    "taxa",
  );
  // a porta real do painel: o cast sem guarda de upsert_store_config, com a STRING "Infinity" no JSON
  r.taxaRpcInfinity = recusada(
    await comoAdmin(SQL.upsertConfig, [
      JSON.stringify({ local_delivery_fee: "Infinity" }),
    ]),
    "taxa",
  );
  r.taxaRecusaNaoMudaLinha = igual((await estadoAtual()).taxa, 10);
  r.taxaZero = aceita(await direto(SQL.taxaUpd, ["0"]));
  r.taxaCentavo = aceita(await direto(SQL.taxaUpd, ["0.01"]));
  r.taxaEnorme = aceita(await direto(SQL.taxaUpd, [ENORME]));
  r.taxaPositiva = aceita(await direto(SQL.taxaUpd, ["12.50"]));
  r.taxaRpcPositiva =
    aceita(
      await comoAdmin(SQL.upsertConfig, [
        JSON.stringify({ local_delivery_fee: 15 }),
      ]),
    ) && igual((await estadoAtual()).taxa, 15);
  // linha de configuracao ainda nao criada: o caminho INSERT da RPC
  await P.conexao().query("DELETE FROM public.store_config WHERE id = 1");
  r.taxaRpcInsereInfinity = recusada(
    await comoAdmin(SQL.upsertConfig, [
      JSON.stringify({ local_delivery_fee: "Infinity" }),
    ]),
    "taxa",
  );
  await P.conexao().query("DELETE FROM public.store_config WHERE id = 1");
  await P.conexao().query(
    "INSERT INTO public.store_config (id, local_delivery_fee) VALUES (1, 15)",
  );
  r.taxaNaNSegueRecusadoPela400 = recusadaPela400(
    await direto(SQL.taxaUpd, ["NaN"]),
    "taxa",
  );

  // ---------------- PRECO PROPRIO DA VARIACAO (product_variants.price_override), semente NULL ----------------
  r.variacaoInfinity = recusada(
    await direto(SQL.varUpd, ["Infinity", VARIACAO]),
    "variacao",
  );
  r.variacaoMenosInfinity = recusada(
    await direto(SQL.varUpd, ["-Infinity", VARIACAO]),
    "variacao",
  );
  r.variacaoGrafiaInf = recusada(
    await direto(SQL.varUpd, ["inf", VARIACAO]),
    "variacao",
  );
  r.variacaoInsInfinity = recusada(
    await direto(SQL.varIns, ["Infinity", PROD, "Infinita"]),
    "variacao",
  );
  r.variacaoRpcInfinity = recusada(
    await comoAdmin(SQL.salvarProduto, [PROD, "{}", variacaoJson("Infinity")]),
    "variacao",
  );
  r.variacaoRecusaNaoMudaLinha = (await estadoAtual()).variacao === null;
  r.variacaoZero = aceita(await direto(SQL.varUpd, ["0", VARIACAO]));
  r.variacaoEnorme = aceita(await direto(SQL.varUpd, [ENORME, VARIACAO]));
  r.variacaoPositiva = aceita(await direto(SQL.varUpd, ["79.90", VARIACAO]));
  // NULL = herda o preco do produto: o caso comum, nunca recusado
  r.variacaoNulaUpd = aceita(await direto(SQL.varUpd, [null, VARIACAO]));
  r.variacaoNulaIns = aceita(
    await direto(SQL.varIns, [null, PROD, "Sem preco"]),
  );
  r.variacaoRpcPositiva =
    aceita(
      await comoAdmin(SQL.salvarProduto, [PROD, "{}", variacaoJson(55)]),
    ) && igual((await estadoAtual()).variacao, 55);
  r.variacaoNaNSegueRecusadoPela400 = recusadaPela400(
    await direto(SQL.varUpd, ["NaN", VARIACAO]),
    "variacao",
  );

  // ---------------- VALOR DO CUPOM (coupons.value), semente 10 ----------------
  r.cupomInfinity = recusada(
    await direto(SQL.cupUpd, ["Infinity", CUPOM]),
    "cupom",
  );
  r.cupomMenosInfinity = recusada(
    await direto(SQL.cupUpd, ["-Infinity", CUPOM]),
    "cupom",
  );
  r.cupomInsInfinity = recusada(
    await direto(SQL.cupIns, ["Infinity", "B156INF1", "fixed"]),
    "cupom",
  );
  r.cupomInsPercentInfinity = recusada(
    await direto(SQL.cupIns, ["inf", "B156INF2", "percentage"]),
    "cupom",
  );
  r.cupomRlsInfinity = recusada(
    await comoAdmin(SQL.cupIns, ["Infinity", "B156INF3", "fixed"]),
    "cupom",
  );
  r.cupomRlsUpdInfinity = recusada(
    await comoAdmin(SQL.cupUpd, ["Infinity", CUPOM]),
    "cupom",
  );
  r.cupomNaoGravou =
    (
      await unico(
        "SELECT count(*)::int AS n FROM public.coupons WHERE code LIKE 'B156INF%'",
      )
    ).n === 0;
  r.cupomRecusaNaoMudaLinha = igual((await estadoAtual()).cupom, 10);
  r.cupomZero = aceita(await direto(SQL.cupUpd, ["0", CUPOM]));
  r.cupomEnorme = aceita(await direto(SQL.cupUpd, [ENORME, CUPOM]));
  r.cupomPositivo = aceita(await direto(SQL.cupUpd, ["10", CUPOM]));
  r.cupomRlsPositivo = aceita(
    await comoAdmin(SQL.cupIns, ["15", "B156OK1", "fixed"]),
  );
  r.cupomNaNSegueRecusadoPela400 = recusadaPela400(
    await direto(SQL.cupUpd, ["NaN", CUPOM]),
    "cupom",
  );
  // o desconto legitimo segue funcionando de ponta a ponta (a regra do checkout)
  const validar = (
    await direto(
      "SELECT public.validate_coupon_secure_v2('B1560000', 100) AS v",
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

/** preco_venda e' numeric(10,2): o TIPO recusa infinito (22003), com e sem esta migration - e' por isso que ela fica de fora. */
async function precoRecusaPeloTipo() {
  for (const v of ["Infinity", "-Infinity"]) {
    const r = await direto(SQL.precoUpd, [v, PROD]);
    if (r.linhas || r.codigo !== "22003") return false;
  }
  const rpc = await comoAdmin(SQL.salvarProduto, [
    PROD,
    JSON.stringify({ preco_venda: "Infinity" }),
    "[]",
  ]);
  return !rpc.linhas && rpc.codigo === "22003";
}

const restricoes = async (c = P.conexao()) =>
  (
    await c.query(
      `SELECT conrelid::regclass::text AS t, conname, oid::text AS oid, pg_get_constraintdef(oid) AS def, convalidated, contype
         FROM pg_constraint WHERE conname = ANY ($1::text[]) ORDER BY conname`,
      [CKS],
    )
  ).rows;
const restricoesDa400 = async () =>
  (
    await P.conexao().query(
      `SELECT conname, oid::text AS oid, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
        WHERE conname = ANY ($1::text[]) ORDER BY conname`,
      [[...Object.values(CK_400), "produtos_preco_venda_nao_negativo"]],
    )
  ).rows;
/** true = as 3 existem; false = nenhuma; "parcial" = qualquer outra coisa (nunca deve acontecer). */
const aplicado = async (c = P.conexao()) => {
  const n = (await restricoes(c)).length;
  return n === 3 ? true : n === 0 ? false : "parcial";
};
const dados = async () =>
  unico(
    `SELECT (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.store_config x) AS sc,
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

/** Prova de ambiente: MUTANTE_O_INFINITO=sem-<alvo> tira a restricao nova do alvo antes do roteiro "DEPOIS". */
const mutanteDeAmbiente = () => {
  const m = /^sem-(taxa|variacao|cupom)$/.exec(
    process.env.MUTANTE_O_INFINITO ?? "",
  );
  return m ? tirar(m[1]) : null;
};

// ---------------------------------------------------------------------------------------------------------------------------
prova(
  "ANTES (controle): sem os CHECKs novos o +Infinity entra nas 3 colunas (direto e pelas RPCs); preco_venda ja recusa pelo tipo e NaN ja e' da 400",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), false, "o estado ANTES nao montou");
        const f = falhou(await roteiro());
        for (const k of [
          "taxaInfinity",
          "taxaGrafiaInf",
          "taxaGrafiaMaisInfinity",
          "taxaRpcInfinity",
          "taxaRpcInsereInfinity",
          "variacaoInfinity",
          "variacaoGrafiaInf",
          "variacaoInsInfinity",
          "variacaoRpcInfinity",
          "cupomInfinity",
          "cupomInsInfinity",
          "cupomInsPercentInfinity",
          "cupomRlsInfinity",
          "cupomRlsUpdInfinity",
        ])
          assert.ok(f.includes(k), `controle: ${k} devia falhar sem os CHECKs`);
        // o que ja era certo antes continua certo (finitos, NULL, NaN recusado pela 400)
        for (const k of [
          "taxaZero",
          "taxaEnorme",
          "taxaPositiva",
          "taxaRpcPositiva",
          "taxaNaNSegueRecusadoPela400",
          "variacaoZero",
          "variacaoEnorme",
          "variacaoNulaUpd",
          "variacaoNulaIns",
          "variacaoNaNSegueRecusadoPela400",
          "cupomZero",
          "cupomEnorme",
          "cupomPositivo",
          "cupomNaNSegueRecusadoPela400",
          "cupomDescontoLegitimoSegue",
        ])
          assert.ok(!f.includes(k), `controle: ${k} ja funcionava antes`);
        // o efeito: a taxa infinita fica gravada no banco (o pedido com entrega local nunca mais fecha)
        await P.conexao().query(
          "UPDATE public.store_config SET local_delivery_fee = 'Infinity' WHERE id = 1",
        );
        assert.equal((await estadoAtual()).taxa, "Infinity");
        assert.equal(
          await precoRecusaPeloTipo(),
          true,
          "preco_venda aceitou infinito",
        );
      },
      async () => {
        await semear();
        await antes();
      },
    );
  },
);

prova(
  "DEPOIS: Infinity e -Infinity (em qualquer grafia) recusados (23514, restricao nova) em todas as portas; finitos, enorme e NULL seguem; NaN segue recusado pela 400",
  async () => {
    await P.emTransacao(
      async () => {
        // o roteiro vem ANTES da precondicao: sem uma restricao a prova reprova pelo COMPORTAMENTO (qual chave), nao so pela ausencia
        const r = await roteiro();
        assert.deepEqual(falhou(r), [], JSON.stringify(r));
        assert.equal(await aplicado(), true, "o estado DEPOIS nao montou");
        const x = await estadoAtual();
        assert.ok(
          Object.values(x).every(
            (v) => v === null || !/infinity/i.test(String(v)),
          ),
          `ficou valor infinito no banco: ${JSON.stringify(x)}`,
        );
        assert.equal(await precoRecusaPeloTipo(), true);
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
  "SEM A 400: com as restricoes da 400 desfeitas, as 3 novas SOZINHAS recusam Infinity e -Infinity (a regra nao depende da 400)",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), true);
        assert.deepEqual(await restricoesDa400(), [], "a 400 nao foi desfeita");
        for (const v of ["Infinity", "-Infinity"]) {
          assert.ok(
            recusada(await direto(SQL.taxaUpd, [v]), "taxa"),
            `taxa ${v}`,
          );
          assert.ok(
            recusada(await direto(SQL.varUpd, [v, VARIACAO]), "variacao"),
            `variacao ${v}`,
          );
          assert.ok(
            recusada(await direto(SQL.cupUpd, [v, CUPOM]), "cupom"),
            `cupom ${v}`,
          );
        }
        // e um finito negativo nao e' assunto desta: sem a 400 ele entra (prova que a regra nova nao faz o papel da 400)
        assert.ok(aceita(await direto(SQL.cupUpd, ["-1", CUPOM])));
      },
      async () => {
        await semear();
        await depois();
        await sem400();
      },
    );
  },
);

prova(
  "As 3 restricoes nascem VALIDADAS (varreram a tabela no ADD), uma por coluna, com a regra exata; as 4 da 400 ficam identicas",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      assert.equal(await aplicado(), false);
      const da400 = await restricoesDa400();
      assert.equal(da400.length, 4, "a 400 devia estar aplicada no clone");
      await depois();
      const linhas = await restricoes();
      assert.equal(linhas.length, 3);
      for (const n of NOMES) {
        const l = linhas.find((x) => x.conname === ALVOS[n].ck);
        assert.ok(l, `falta ${ALVOS[n].ck}`);
        assert.equal(l.t, ALVOS[n].tabela);
        assert.equal(l.def, ALVOS[n].def);
        assert.equal(l.convalidated, true);
        assert.equal(l.contype, "c");
      }
      assert.deepEqual(await restricoesDa400(), da400, "o apply mexeu na 400");
    });
  },
);

// ---- LINHA ANTIGA ------------------------------------------------------------------------------------------------------------
// Dado infinito que ja existia ANTES da migration: com o CHECK ativo (mesmo NOT VALID) ele travaria todo UPDATE da linha, e a
// varredura de pedidos vencidos (uma transacao so) desfaria a cada rodada. Por isso a migration se RECUSA e nada fica gravado.
// Para plantar -Infinity a 400 tem de estar fora (o `>= 0` dela o recusaria) - o que tambem prova que a guarda nao depende dela.
const RUIM = {
  taxa: "UPDATE public.store_config SET local_delivery_fee = $1::numeric WHERE id = 1",
  variacao:
    "UPDATE public.product_variants SET price_override = $1::numeric WHERE id = $2::uuid",
  cupom: "UPDATE public.coupons SET value = $1::numeric WHERE id = $2::uuid",
};
const IDS_RUIM = { taxa: null, variacao: VARIACAO, cupom: CUPOM };
/** Grava, no estado sem restricao, o valor na linha do alvo. */
const plantar = (n, valor) =>
  P.conexao().query(
    RUIM[n],
    IDS_RUIM[n] === null ? [valor] : [valor, IDS_RUIM[n]],
  );
const rotulo = (n) => `${ALVOS[n].tabela}.${ALVOS[n].coluna}`;
const BLOCO_GUARDA = "guarda_20261560000000";
// UPDATE de uma coluna que NAO e' a do CHECK, na linha ruim: o que a devolucao de estoque e o uso do cupom fazem
const MEXER = {
  taxa: "UPDATE public.store_config SET store_name = store_name WHERE id = 1 RETURNING id",
  variacao:
    "UPDATE public.product_variants SET stock_increment = stock_increment WHERE id = $1::uuid RETURNING id",
  cupom:
    "UPDATE public.coupons SET usage_count = usage_count WHERE id = $1::uuid RETURNING id",
};
const semNada = async () => {
  await semear();
  await antes();
  await sem400();
};

for (const n of NOMES) {
  for (const valor of ["Infinity", "-Infinity"]) {
    prova(
      `LINHA ANTIGA (${n}, ${valor}): a migration se RECUSA com B1_BASELINE_DIVERGENT dizendo a coluna; nenhuma das 3 restricoes fica e o dado nao muda; corrigida a linha, aplica`,
      async () => {
        await P.emTransacao(async () => {
          await semNada();
          await plantar(n, valor);
          const d0 = await dados();
          const r0 = await P.retrato(NOVOS);
          const r = await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
          assert.ok(r.erro.includes(`${rotulo(n)} (1 linha`), r.erro);
          for (const outro of NOMES.filter((x) => x !== n))
            assert.ok(
              !r.erro.includes(rotulo(outro)),
              `a mensagem acusou ${outro}, que esta limpo: ${r.erro}`,
            );
          assert.equal(
            await aplicado(),
            false,
            "ficou restricao depois da recusa",
          );
          assert.deepEqual(await dados(), d0, "a recusa mexeu em dado");
          assert.deepEqual(await P.retrato(NOVOS), r0, "a recusa escreveu");
          // a lojista corrige o valor (decisao dela) e a migration aplica
          await plantar(n, "10");
          assert.equal(await P.aplicar(MIGRATION), null);
          assert.equal(await aplicado(), true);
        });
      },
    );
  }
}

prova(
  "LINHA ANTIGA (varias): a mensagem conta as linhas de CADA coluna infinita e so delas; NaN, NULL de variacao, negativo e finito enorme NAO contam",
  async () => {
    await P.emTransacao(async () => {
      await semNada();
      const c = P.conexao();
      await plantar("taxa", "Infinity");
      await plantar("cupom", "-Infinity");
      await c.query(
        "INSERT INTO public.coupons (code, type, value, active) VALUES ('B156RUIM2', 'fixed', 'inf', true)",
      );
      // o que NAO e' infinito nao e' assunto desta migration (NaN e negativo sao da 400)
      await c.query(
        "INSERT INTO public.coupons (code, type, value, active) VALUES ('B156NAN', 'fixed', 'NaN', true), ('B156NEG', 'fixed', -5, true), ('B156ENORME', 'fixed', $1::numeric, true)",
        [ENORME],
      );
      await c.query(
        "UPDATE public.product_variants SET price_override = NULL WHERE id = $1",
        [VARIACAO],
      );
      const r = await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
      assert.ok(r.erro.includes(`${rotulo("taxa")} (1 linha`), r.erro);
      assert.ok(r.erro.includes(`${rotulo("cupom")} (2 linha`), r.erro);
      assert.ok(!r.erro.includes(rotulo("variacao")), r.erro);
      assert.equal(await aplicado(), false);
      // corrigidas so as infinitas, aplica: NaN, negativo e enorme nao a impedem
      await plantar("taxa", "10");
      await c.query(
        "UPDATE public.coupons SET value = 10 WHERE id = $1 OR code = 'B156RUIM2'",
        [CUPOM],
      );
      assert.equal(await P.aplicar(MIGRATION), null);
      assert.equal(await aplicado(), true);
    });
  },
);

prova(
  "LINHA ANTIGA (restricao ja existia): reaplicar com uma restricao faltando e valor infinito na tabela dela tambem se RECUSA e nao deixa a restricao",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await depois();
      assert.equal(await aplicado(), true);
      // alguem tirou a restricao dos cupons a mao e entrou valor infinito: reaplicar nao pode "consertar" criando-a por cima
      await P.conexao().query(tirar("cupom"));
      await plantar("cupom", "Infinity");
      await P.recusa(
        MIGRATION,
        /B1_BASELINE_DIVERGENT.*coupons\.value \(1 linha/s,
      );
      assert.equal(
        (await restricoes()).some((l) => l.conname === ALVOS.cupom.ck),
        false,
        "a restricao dos cupons ficou depois da recusa",
      );
    });
  },
);

prova(
  "LOJA LIMPA com finitos (zero, enorme, NULL de variacao): aplica, e reaplicar e' no-op sem recusar nem mexer em dado",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await plantar("taxa", "0");
      await plantar("cupom", ENORME);
      await P.conexao().query(
        "UPDATE public.product_variants SET price_override = NULL WHERE id = $1",
        [VARIACAO],
      );
      const d0 = await dados();
      assert.equal(await P.aplicar(MIGRATION), null);
      assert.equal(await aplicado(), true);
      const e1 = await restricoes();
      assert.equal(await P.aplicar(MIGRATION), null);
      assert.deepEqual(await restricoes(), e1, "reaplicar mudou o estado");
      assert.deepEqual(await dados(), d0, "a migration mexeu em dado");
    });
  },
);

// MUTANTES DA GUARDA: a guarda (antes dos ADD) da a MENSAGEM clara; a rede de seguranca e' o proprio ADD CONSTRAINT validado.
const MUTANTES_DA_GUARDA = [
  {
    nome: "sem a contagem (guarda removida)",
    alvos: NOMES,
    sabotar: (m, guarda) => m.replace(guarda, ""),
  },
  ...NOMES.map((n) => ({
    nome: `cega a ${n} (WHERE false)`,
    alvos: [n],
    sabotar: (m, guarda) =>
      m.replace(
        guarda,
        guarda.replace(
          `FROM public.${ALVOS[n].tabela} WHERE NOT (`,
          `FROM public.${ALVOS[n].tabela} WHERE false AND (`,
        ),
      ),
  })),
];
for (const { nome, alvos, sabotar } of MUTANTES_DA_GUARDA) {
  prova(
    `MUTANTE da guarda - ${nome}: sem ela a migration ainda RECUSA (o ADD validado e' a rede), mas sem a mensagem B1_BASELINE_DIVERGENT`,
    async () => {
      const guarda = P.blocoDe(MIGRATION, BLOCO_GUARDA);
      const sql = sabotar(MIGRATION, guarda);
      assert.notEqual(sql, MIGRATION, "a sabotagem da guarda nao pegou");
      for (const n of alvos)
        await P.emTransacao(async () => {
          await semear();
          await antes();
          await plantar(n, "Infinity");
          const r = await P.aplicar(sql);
          assert.ok(
            r,
            `o mutante '${nome}' devia ser recusado pelo ADD validado`,
          );
          assert.equal(r.codigo, "23514", r.erro);
          assert.ok(
            !r.erro.includes("B1_BASELINE_DIVERGENT"),
            `o mutante '${nome}' ainda deu a mensagem da guarda: ${r.erro}`,
          );
          assert.equal(await aplicado(), false, "ficou restricao");
        });
    },
  );
}

// MUTANTE "NOT VALID": sem a varredura do ADD a restricao nasceria por cima da linha ruim e travaria o UPDATE dela.
const comNotValid = (m) => {
  const sabotada = m.replace(
    /(ADD CONSTRAINT \w+ CHECK \([^\n]*\));/g,
    "$1 NOT VALID;",
  );
  assert.equal(
    (sabotada.match(/ NOT VALID;/g) ?? []).length,
    3,
    "a sabotagem NOT VALID nao pegou as 3 restricoes",
  );
  return sabotada;
};
prova(
  "MUTANTE NOT VALID + sem a guarda: a migration APLICA sobre a linha antiga e o UPDATE de OUTRA coluna dela passa a recusar (23514) - o estrago que a guarda evita",
  async () => {
    const sql = comNotValid(
      MIGRATION.replace(P.blocoDe(MIGRATION, BLOCO_GUARDA), ""),
    );
    for (const n of NOMES)
      await P.emTransacao(async () => {
        await semear();
        await antes();
        await plantar(n, "Infinity");
        assert.equal(
          await P.aplicar(sql),
          null,
          `o mutante devia deixar passar ${n}=Infinity`,
        );
        assert.equal(await aplicado(), true);
        assert.ok(
          recusada(await direto(MEXER[n], IDS_RUIM[n] ? [IDS_RUIM[n]] : []), n),
          `o UPDATE de outra coluna da linha antiga (${n}) devia recusar`,
        );
      });
  },
);

// ---- reaplicar ----------------------------------------------------------------------------------------------------------------
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
      // criada NOT VALID a mao e depois validada: o pre-voo aceita as duas e a migration nao recria
      await P.conexao().query(
        trocarRegra("cupom", ALVOS.cupom.def.slice(7, -1)),
      );
      assert.equal(
        (await restricoes()).find((l) => l.conname === ALVOS.cupom.ck)
          .convalidated,
        false,
      );
      assert.equal(
        await P.aplicar(MIGRATION),
        null,
        "o pre-voo recusou a NOT VALID",
      );
      await P.conexao().query(
        `ALTER TABLE public.coupons VALIDATE CONSTRAINT ${ALVOS.cupom.ck}`,
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
  "SO NOVO: o apply cria so as 3 restricoes; nenhuma funcao (corpo, OID, ACL), tabela, politica, gatilho ou outra restricao (as da 400 inclusive) muda",
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
    });
  },
);

// ---- MUTANTES: o roteiro sobre restricoes sabotadas fica vermelho nas chaves certas e so nelas -----------------------------------
const CHAVES = {
  taxa: {
    sem: [
      "taxaInfinity",
      "taxaGrafiaInf",
      "taxaGrafiaMaisInfinity",
      "taxaRpcInfinity",
      "taxaRpcInsereInfinity",
      "taxaRecusaNaoMudaLinha",
      // -Infinity ainda cai, mas pela restricao da 400 (outro nome): a prova exige a NOVA
      "taxaMenosInfinity",
    ],
    soMais: ["taxaMenosInfinity"],
    enorme: ["taxaEnorme"],
  },
  variacao: {
    sem: [
      "variacaoInfinity",
      "variacaoMenosInfinity",
      "variacaoGrafiaInf",
      "variacaoInsInfinity",
      "variacaoRpcInfinity",
      "variacaoRecusaNaoMudaLinha",
    ],
    soMais: ["variacaoMenosInfinity"],
    enorme: ["variacaoEnorme"],
  },
  cupom: {
    sem: [
      "cupomInfinity",
      "cupomMenosInfinity",
      "cupomInsInfinity",
      "cupomInsPercentInfinity",
      "cupomRlsInfinity",
      "cupomRlsUpdInfinity",
      "cupomNaoGravou",
      "cupomRecusaNaoMudaLinha",
    ],
    soMais: ["cupomMenosInfinity"],
    enorme: ["cupomEnorme"],
  },
};
const COLUNA = (n) => ALVOS[n].coluna;
for (const n of NOMES) {
  const variantes = [
    ["sem a regra", tirar(n), CHAVES[n].sem],
    [
      "sem o -Infinity",
      trocarRegra(n, `${COLUNA(n)} <> 'Infinity'::numeric`),
      CHAVES[n].soMais,
    ],
    [
      "recusa finito enorme (< 1e15)",
      trocarRegra(
        n,
        `${COLUNA(n)} < 1e15 AND ${COLUNA(n)} <> '-Infinity'::numeric`,
      ),
      CHAVES[n].enorme,
    ],
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
  "rollback: tira so as 3 restricoes novas sem tocar dado nem as da 400; 2x e' no-op; ida e volta termina igual",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await depois();
      const d0 = await dados();
      const e0 = await restricoes();
      const da400 = await restricoesDa400();
      await antes();
      assert.equal(await aplicado(), false);
      assert.deepEqual(await dados(), d0, "o rollback mexeu em dado");
      assert.deepEqual(
        await restricoesDa400(),
        da400,
        "o rollback mexeu na 400",
      );
      await antes();
      assert.equal(await aplicado(), false, "o segundo rollback nao foi no-op");
      await depois();
      const e1 = await restricoes();
      assert.deepEqual(
        e1.map(({ oid, ...resto }) => resto),
        e0.map(({ oid, ...resto }) => resto),
      );
      assert.deepEqual(await dados(), d0);
    });
  },
);

// Sabotagem do pre-voo "preco_venda sem precisao": as vistas de produto dependem da coluna e impedem ALTER TYPE; no clone
// descartavel (superusuario, transacao desfeita) o atttypmod do catalogo e' zerado so para o pre-voo LER o estado divergente.
const PRECO_SEM_PRECISAO =
  "UPDATE pg_catalog.pg_attribute SET atttypmod = -1 WHERE attrelid = 'public.produtos'::regclass AND attname = 'preco_venda'";

prova(
  "pre-voo recusa SEM escrever: restricao do mesmo nome com outra regra, coluna que sumiu e preco_venda sem precisao",
  async () => {
    // Partida: o estado ANTES (nenhuma das 3) com UMA sabotagem; a migration tem de recusar antes de criar qualquer uma.
    const sabotagens = [];
    for (const n of NOMES) {
      const { tabela, ck, coluna } = ALVOS[n];
      sabotagens.push([
        `${n}: CHECK do mesmo nome com outra regra`,
        `ALTER TABLE public.${tabela} ADD CONSTRAINT ${ck} CHECK (${coluna} <> 'Infinity'::numeric)`,
        /B1_BASELINE_DIVERGENT: \w+_finito ja existe/,
      ]);
      sabotagens.push([
        `${n}: coluna renomeada`,
        `ALTER TABLE public.${tabela} RENAME COLUMN ${coluna} TO ${coluna}_x`,
        /B1_BASELINE_DIVERGENT: public\.\w+\.\w+ \(numeric\) nao existe/,
      ]);
    }
    sabotagens.push([
      "preco_venda renomeada",
      "ALTER TABLE public.produtos RENAME COLUMN preco_venda TO preco_venda_x",
      /B1_BASELINE_DIVERGENT: public\.produtos\.preco_venda nao e numeric com precisao/,
    ]);
    sabotagens.push([
      "preco_venda sem precisao",
      PRECO_SEM_PRECISAO,
      /B1_BASELINE_DIVERGENT: public\.produtos\.preco_venda nao e numeric com precisao/,
    ]);
    for (const [nome, sabotar, padrao] of sabotagens) {
      await P.emTransacao(
        async () => {
          const r0 = await P.retrato(NOVOS);
          const antesDeTentar = await restricoes();
          await P.recusa(MIGRATION, padrao);
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
    const bloco = P.blocoDe(MIGRATION, "conferencia_20261560000000");
    for (const n of NOMES) {
      for (const estrago of [
        tirar(n),
        trocarRegra(n, `${COLUNA(n)} <> 'Infinity'::numeric`),
      ]) {
        await P.emTransacao(
          async () => {
            await P.conexao().query(estrago);
            await P.recusa(bloco, /conferencia 20261560000000/);
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
  "pre-voo do rollback recusa o que nao e' dele (restricao redefinida) sem apagar NENHUMA das 3",
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
          await P.conexao().query(
            trocarRegra(n, `${COLUNA(n)} <> 'Infinity'::numeric`),
          );
        },
      );
    }
  },
);

// ---- consultas de publicacao 193a/193b, EXECUTADAS ---------------------------------------------------------------------------------
const ITENS_DOS_CKS_193A = [
  "store_config: CHECK store_config_local_delivery_fee_finito (sem Infinity nem -Infinity na taxa de entrega local) existe",
  "product_variants: CHECK product_variants_price_override_finito (sem Infinity nem -Infinity no preco proprio da variacao; NULL segue valendo) existe",
  "coupons: CHECK coupons_value_finito (sem Infinity nem -Infinity no valor do cupom) existe",
].sort();
const ITENS_DOS_CKS_193B = [
  "store_config.local_delivery_fee: e numeric e o CHECK store_config_local_delivery_fee_finito ainda NAO existe",
  "product_variants.price_override: e numeric e o CHECK product_variants_price_override_finito ainda NAO existe",
  "coupons.value: e numeric e o CHECK coupons_value_finito ainda NAO existe",
].sort();
prova(
  "consultas 193a/193b: DEPOIS a 193a e' toda ok e a 193b reprova so os 3 CHECKs; ANTES o contrario; defeitos plantados reprovam o item certo",
  async () => {
    await P.emTransacao(
      async () => {
        assert.deepEqual(await P.consulta(A193), [], "193a no estado DEPOIS");
        assert.deepEqual(await P.consulta(B193), ITENS_DOS_CKS_193B);
      },
      async () => {
        await semear();
        await depois();
      },
    );
    await P.emTransacao(
      async () => {
        assert.deepEqual(await P.consulta(B193), [], "193b no estado ANTES");
        assert.deepEqual(await P.consulta(A193), ITENS_DOS_CKS_193A);
      },
      async () => {
        await semear();
        await antes();
      },
    );
    // regra trocada: a 193a reprova so o item daquela restricao
    for (const n of NOMES)
      await P.emTransacao(
        async () => {
          const reprovadas = await P.consulta(A193);
          assert.equal(reprovadas.length, 1, JSON.stringify(reprovadas));
          assert.ok(reprovadas[0].includes(ALVOS[n].ck), reprovadas[0]);
        },
        async () => {
          await semear();
          await depois();
          await P.conexao().query(
            trocarRegra(n, `${COLUNA(n)} <> 'Infinity'::numeric`),
          );
        },
      );
    // a base do pre-voo: preco_venda sem precisao reprova a 193b (e a migration se recusa, prova acima)
    await P.emTransacao(
      async () => {
        assert.deepEqual(await P.consulta(B193), [
          "produtos.preco_venda: e numeric COM precisao (o tipo ja recusa infinito; a base do pre-voo)",
        ]);
      },
      async () => {
        await semear();
        await antes();
        await P.conexao().query(PRECO_SEM_PRECISAO);
      },
    );
    // criada NOT VALID a mao: a 193a aceita (o mesmo que a conferencia da migration aceita)
    await P.emTransacao(
      async () => {
        assert.deepEqual(await P.consulta(A193), []);
      },
      async () => {
        await semear();
        await depois();
        await P.conexao().query(
          trocarRegra("taxa", ALVOS.taxa.def.slice(7, -1)),
        );
      },
    );
  },
);

// ---- ATOMICIDADE e TRAVA (conexoes proprias; deixam o clone no estado ANTES — ficam por ULTIMO) --------------------------------
prova(
  "ATOMICIDADE: sem BEGIN, falha no MEIO (3a restricao), guarda recusando ou conferencia sabotada deixam NENHUMA das 3; a migration inteira ainda aplica depois",
  async () => {
    const c3 = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await c3.connect();
    try {
      await c3.query(ROLLBACK);
      assert.equal(await aplicado(c3), false);
      // (1) a 3a ALTER (coupons) falha: as 2 primeiras (store_config e product_variants) ja tinham rodado no mesmo arquivo
      const noMeio = MIGRATION.replace(
        /(ADD CONSTRAINT coupons_value_finito CHECK \()value <> 'Infinity'::numeric/,
        "$1value <> 'nao-e-numero'::numeric",
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
      // (2) a conferencia final reprova (regra sabotada no texto dela): as 3 ja tinham sido criadas e todas voltam
      const i = MIGRATION.indexOf("DO $conferencia_20261560000000$");
      const quebrada =
        MIGRATION.slice(0, i) +
        MIGRATION.slice(i).replace("''-Infinity''::numeric", "''-1''::numeric");
      assert.notEqual(
        quebrada,
        MIGRATION,
        "a sabotagem da conferencia nao pegou",
      );
      await assert.rejects(
        () => c3.query(quebrada),
        /conferencia 20261560000000/,
      );
      assert.equal(
        await aplicado(c3),
        false,
        "ficaram restricoes depois da conferencia reprovar",
      );
      // (2b) a GUARDA recusa (cupom antigo infinito): nao fica nenhuma, e o dado ruim segue como estava
      await c3.query(
        "INSERT INTO public.coupons (code, type, value, active) VALUES ('B156ATOM', 'fixed', 'Infinity', true)",
      );
      try {
        await assert.rejects(
          () => c3.query(MIGRATION),
          /B1_BASELINE_DIVERGENT.*coupons\.value \(1 linha/s,
        );
        assert.equal(
          await aplicado(c3),
          false,
          "ficaram restricoes depois da guarda recusar",
        );
        assert.equal(
          (
            await c3.query(
              "SELECT value::text AS v FROM public.coupons WHERE code = 'B156ATOM'",
            )
          ).rows[0].v,
          "Infinity",
        );
      } finally {
        await c3.query("DELETE FROM public.coupons WHERE code = 'B156ATOM'");
      }
      // (3) sem sabotagem, a mesma conexao aplica as 3 de uma vez
      await c3.query(MIGRATION);
      assert.equal(await aplicado(c3), true);
      await c3.query(ROLLBACK);
      assert.equal(await aplicado(c3), false);
    } finally {
      await c3.end();
    }
  },
);

// ---- CORRIDA (conexoes proprias; deixam o clone no estado ANTES) -----------------------------------------------------------------
// A foto REPEATABLE READ do aplicador nao ve o cupom infinito gravado depois dela; o ADD validado varre o estado mais recente e recusa.
async function corrida(sql) {
  const url = lerDatabaseUrlEfemera();
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  await a.connect();
  await b.connect();
  const limpar = async () => {
    await b.query("DELETE FROM public.coupons WHERE code = 'B156CORRIDA'");
    await b.query(ROLLBACK);
  };
  let erro = null;
  let ficou = null;
  let estrago = null;
  try {
    await limpar();
    await a.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await a.query("SELECT count(*) FROM public.coupons"); // a foto do aplicador
    await b.query(
      "INSERT INTO public.coupons (code, type, value, active) VALUES ('B156CORRIDA', 'fixed', 'Infinity', true)",
    ); // outra sessao grava e confirma DEPOIS da foto (o +Infinity passa pela 400)
    try {
      await a.query(sql);
    } catch (e) {
      erro = e;
    }
    await a.query(erro ? "ROLLBACK" : "COMMIT");
    ficou = await aplicado(b);
    try {
      await b.query(
        "UPDATE public.coupons SET usage_count = usage_count WHERE code = 'B156CORRIDA'",
      );
    } catch (e) {
      estrago = e.code;
    }
  } finally {
    await limpar().catch(() => {});
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
  return { erro, ficou, estrago };
}

prova(
  "CORRIDA: a foto (REPEATABLE READ) leu antes, outra sessao grava cupom infinito e confirma, e a migration RECUSA (23514 do ADD validado); nenhuma restricao fica",
  async () => {
    const { erro, ficou, estrago } = await corrida(MIGRATION);
    assert.ok(
      erro,
      "a migration devia ter recusado a linha gravada na corrida",
    );
    assert.equal(erro.code, "23514", erro.message);
    assert.equal(ficou, false, "ficou restricao depois da recusa");
    assert.equal(estrago, null, "o cupom infinito travou UPDATE?");
  },
);

prova(
  "MUTANTE NOT VALID (com a guarda): na corrida a migration APLICA por cima da linha gravada e o UPDATE do cupom passa a recusar (23514)",
  async () => {
    const { erro, ficou, estrago } = await corrida(comNotValid(MIGRATION));
    assert.equal(
      erro,
      null,
      "o mutante devia aplicar (a guarda nao ve a corrida)",
    );
    assert.equal(ficou, true);
    assert.equal(
      estrago,
      "23514",
      "o UPDATE de outra coluna do cupom devia recusar",
    );
  },
);

for (const [tabela, gravar] of [
  [
    "store_config",
    "UPDATE public.store_config SET store_name = store_name WHERE false",
  ],
  [
    "product_variants",
    "UPDATE public.product_variants SET stock_increment = stock_increment WHERE false",
  ],
  [
    "coupons",
    "INSERT INTO public.coupons (code, type, value) VALUES ('EMVOO1560', 'fixed', 1)",
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
    await P.executar("o-infinito-nao-entra-no-banco");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
