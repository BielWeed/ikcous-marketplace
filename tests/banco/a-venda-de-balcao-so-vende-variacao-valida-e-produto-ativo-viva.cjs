"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário, FX) ou do JSON da própria RPC no Postgres efêmero; nunca de
 * entrada de rede nem de terceiro. */

/**
 * PROVA VIVA (só teste; nenhum SQL de produção muda) de o que o laço de
 * conferência de public.registrar_venda_presencial (PDV/balcão; corpo vigente
 * desde 20261280000000_o_balcao_registra_so_o_total_conferido.sql) deixa
 * vender, contra o Postgres EFÊMERO com as migrations aplicadas do zero
 * (rpc-ci). Chamada como admin ATUAL (papel authenticated + JWT de admin), do
 * jeito que o PDV chama.
 *
 * A RPC não lê nem escreve o caixa: o que ela grava é pedido, item, os dois
 * históricos, a nota privada e o ESTOQUE. A "foto" de cada recusa cobre tudo
 * isso (contagens da loja inteira + estoque de todo produto e variação da
 * fixture, em hash) — recusa é ZERO linha, não "linha parcial".
 *
 * CENÁRIOS (valores exatos; cada um num SAVEPOINT desfeito):
 *   S1  produto com variação ativa vendido SEM escolher a variação (variant_id
 *       ausente e variant_id null) -> 22023 'Escolha uma variação para o
 *       produto Camiseta Fixture.' (sem a guarda, vendia a R$ 100 de preço-base
 *       e baixava o estoque agregado em vez do tamanho)
 *   S2  variação inativa de produto ativo -> 22023 'Produto não encontrado
 *       não disponível.' (a RPC não lê o nome quando recusa)
 *   S3  produto INATIVO (ativo=false): simples e com variação ativa -> 22023
 *       'não disponível'
 *   S4  produto ARQUIVADO (deleted_at preenchido, ativo=true: isola a guarda do
 *       deleted_at): simples e com variação ativa -> 22023 'não disponível'
 *   S5  variação de OUTRO produto (product_id do item = um produto, variant_id
 *       = variação de outro, ambos ativos) -> 22023 'não disponível'
 *   S6  estoque insuficiente: variação (pede 6, há 5) e produto simples (pede
 *       11, há 10) -> 22023 'Estoque insuficiente ... (Disponível: 5, Solicitado:
 *       6)'
 *   S7  quantidade 0, -1 e null -> 22023 'Quantidade inválida'
 *   S8  venda MISTA: um item válido + um inválido -> recusa inteira; o estoque
 *       do item válido NÃO desce
 *   S9  CONTROLE: venda válida da variação (2 un. a R$ 150, total conferido
 *       300) baixa só o estoque da variação (5 -> 3; o do produto-pai fica em
 *       20), grava item com variant_id e preço do banco, pedido com total 300;
 *       e produto cujas variações estão TODAS inativas vende sem variant_id (a
 *       guarda não bloqueia o que não tem variação ativa).
 *
 * NÃO coberto aqui: total conferido errado (PDV01) -> pdv-total-conferido-viva.cjs;
 * desconto, pagamento, motivo e chave repetida -> vizinhos
 * balcao-recusa-desconto-negativo-e-pagamento-invalido-viva.cjs,
 * pdv-motivo-privado-viva.cjs e venda-balcao-mesma-chave-viva.cjs.
 *
 * MUTANTES: MUTANTE_R112F=<nome> troca UM trecho do corpo vivo (via
 * pg_get_functiondef, dentro da transação desfeita) e roda os cenários; a
 * execução TEM de ficar vermelha, e vermelha no cenário que o nome promete.
 * Nome desconhecido é ERRO. Sem MUTANTE_R112F a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-venda-de-balcao-so-vende-variacao-valida-e-produto-ativo-viva.cjs
 */

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: o balcão só vende variação válida e produto ativo (rpc-ci)";
const RPC =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid,numeric)";
const ADMIN = "e1120000-0000-4000-8000-0000000000f1";

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem
// de aparecer 1x. `espera` = cenário(s) onde a prova TEM de ficar vermelha.
const VARIANTE_FILTRO =
  "AND v.active = true AND p.ativo = true AND p.deleted_at IS NULL";
const SIMPLES_FILTRO =
  "WHERE p.id = v_product_id AND p.ativo = true AND p.deleted_at IS NULL";

const MUTANTES = {
  "balcao-sem-exigir-variacao": {
    espera: ["S1"],
    de: "IF v_db_price IS NOT NULL AND EXISTS (",
    para: "IF false AND EXISTS (",
  },
  "balcao-variacao-inativa-passa": {
    espera: ["S2"],
    de: VARIANTE_FILTRO,
    para: "AND p.ativo = true AND p.deleted_at IS NULL",
  },
  "balcao-variacao-de-produto-inativo-passa": {
    espera: ["S3"],
    de: VARIANTE_FILTRO,
    para: "AND v.active = true AND p.deleted_at IS NULL",
  },
  "balcao-variacao-de-produto-arquivado-passa": {
    espera: ["S4"],
    de: VARIANTE_FILTRO,
    para: "AND v.active = true AND p.ativo = true",
  },
  "balcao-produto-inativo-passa": {
    espera: ["S3"],
    de: SIMPLES_FILTRO,
    para: "WHERE p.id = v_product_id AND p.deleted_at IS NULL",
  },
  "balcao-produto-arquivado-passa": {
    espera: ["S4"],
    de: SIMPLES_FILTRO,
    para: "WHERE p.id = v_product_id AND p.ativo = true",
  },
  "balcao-variacao-de-outro-produto-passa": {
    espera: ["S5"],
    de: "WHERE v.id = v_variant_id AND p.id = v_product_id",
    para: "WHERE v.id = v_variant_id",
  },
  "balcao-estoque-insuficiente-passa": {
    // A 2ª trava (UPDATE ... >= no laço de baixa) ainda recusa, com outra
    // mensagem: é a mensagem com "Disponível/Solicitado" que prova a 1ª.
    espera: ["S6"],
    de: "IF v_db_stock < v_quantity THEN",
    para: "IF false THEN",
  },
  "balcao-quantidade-passa": {
    espera: ["S7"],
    de: "IF v_quantity IS NULL OR v_quantity <= 0 THEN",
    para: "IF false THEN",
  },
};

// ------------------------------------------------------------------ semente
// Ids de fixture em hex válido (prefixo e112 = onda 112-f).
const id = (n) => `e1120000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FX = {
  // Com variação ativa (preço-base 100, tamanho M a 150; estoque do pai 20).
  P_VAR: id(1),
  V_ATIVA: id(11),
  V_INATIVA: id(12),
  // Simples (preço 80, estoque 10).
  P_SIMPLES: id(2),
  // Produto cujas variações estão todas inativas (preço 60, estoque 4).
  P_SEM_ATIVA: id(3),
  V_TODAS_INATIVAS: id(13),
  // Inativos (ativo=false): simples e com variação ativa.
  P_INATIVO: id(4),
  P_INATIVO_VAR: id(5),
  V_DO_INATIVO: id(14),
  // Arquivados (deleted_at preenchido, ativo=true): simples e com variação.
  P_ARQ: id(6),
  P_ARQ_VAR: id(7),
  V_DO_ARQ: id(15),
  // Dono da variação alheia.
  P_OUTRO: id(8),
  V_OUTRO: id(16),
};
const PRODUTOS = [
  FX.P_VAR,
  FX.P_SIMPLES,
  FX.P_SEM_ATIVA,
  FX.P_INATIVO,
  FX.P_INATIVO_VAR,
  FX.P_ARQ,
  FX.P_ARQ_VAR,
  FX.P_OUTRO,
];
const VARIANTES = [
  FX.V_ATIVA,
  FX.V_INATIVA,
  FX.V_TODAS_INATIVAS,
  FX.V_DO_INATIVO,
  FX.V_DO_ARQ,
  FX.V_OUTRO,
];

async function semear(c) {
  await c.query("GRANT USAGE ON SCHEMA auth TO authenticated");
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'admin@balcao112f.fixture.invalid', '{"role":"admin"}'::jsonb)`,
    [ADMIN],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role)
     VALUES ($1, 'Admin Balcao 112f', 'admin')
     ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
    [ADMIN],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, deleted_at) VALUES
       ($1, 'Camiseta Fixture', 100, 20, true,  50, NULL),
       ($2, 'Caneca Fixture',    80, 10, true,  40, NULL),
       ($3, 'Meia Fixture',      60,  4, true,  30, NULL),
       ($4, 'Boné Inativo',      70, 10, false, 35, NULL),
       ($5, 'Jaqueta Inativa',  100, 20, false, 50, NULL),
       ($6, 'Copo Arquivado',    90, 10, true,  45, now()),
       ($7, 'Calça Arquivada',  110, 20, true,  55, now()),
       ($8, 'Moletom Fixture',  120, 20, true,  60, NULL)`,
    [
      FX.P_VAR,
      FX.P_SIMPLES,
      FX.P_SEM_ATIVA,
      FX.P_INATIVO,
      FX.P_INATIVO_VAR,
      FX.P_ARQ,
      FX.P_ARQ_VAR,
      FX.P_OUTRO,
    ],
  );
  await c.query(
    `INSERT INTO public.product_variants
       (id, product_id, name, value, sku, stock_increment, price_override, active) VALUES
       ($1,  $7,  'Tamanho', 'M',  'F112-VAR-M',  5, 150, true),
       ($2,  $7,  'Tamanho', 'G',  'F112-VAR-G',  5, 130, false),
       ($3,  $8,  'Tamanho', 'P',  'F112-SEM-P',  4,  70, false),
       ($4,  $9,  'Tamanho', 'M',  'F112-INA-M',  5, 150, true),
       ($5,  $10, 'Tamanho', 'M',  'F112-ARQ-M',  5, 150, true),
       ($6,  $11, 'Tamanho', 'M',  'F112-OUT-M',  5, 160, true)`,
    [
      FX.V_ATIVA,
      FX.V_INATIVA,
      FX.V_TODAS_INATIVAS,
      FX.V_DO_INATIVO,
      FX.V_DO_ARQ,
      FX.V_OUTRO,
      FX.P_VAR,
      FX.P_SEM_ATIVA,
      FX.P_INATIVO_VAR,
      FX.P_ARQ_VAR,
      FX.P_OUTRO,
    ],
  );
}

// ------------------------------------------------------------------ chamada
/** Chama a RPC como o PDV (admin atual). Devolve {ok, r} ou {ok:false, code, message}. */
async function vender(c, itens, { esperado = null, desconto = 0 } = {}) {
  await c.query("SAVEPOINT venda");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [
        ADMIN,
        JSON.stringify({
          sub: ADMIN,
          role: "authenticated",
          app_metadata: { role: "admin" },
        }),
      ],
    );
    const { rows } = await c.query(
      `SELECT public.registrar_venda_presencial(
         $1::jsonb, 'cash', NULL, 'Cliente Fixture', NULL, $2::numeric, NULL,
         $3::uuid, $4::numeric) AS r`,
      [JSON.stringify(itens), desconto, randomUUID(), esperado],
    );
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT venda");
    return { ok: true, r: rows[0].r };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT venda");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT venda");
    return { ok: false, code: e.code, message: e.message };
  }
}

/** Tudo que a venda poderia escrever: contagens da loja + estoque da fixture. */
async function foto(c) {
  return (
    await c.query(
      `SELECT
         (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos,
         (SELECT count(*)::int FROM public.marketplace_order_items) AS itens,
         (SELECT count(*)::int FROM public.marketplace_order_history) AS historico,
         (SELECT count(*)::int FROM public.marketplace_order_payment_history) AS pagamentos,
         (SELECT count(*)::int FROM public.marketplace_order_internal_notes) AS notas,
         (SELECT md5(string_agg(id::text || ':' || estoque::text, ',' ORDER BY id))
            FROM public.produtos WHERE id = ANY($1::uuid[])) AS estoque_produtos,
         (SELECT md5(string_agg(id::text || ':' || stock_increment::text, ',' ORDER BY id))
            FROM public.product_variants WHERE id = ANY($2::uuid[])) AS estoque_variantes`,
      [PRODUTOS, VARIANTES],
    )
  ).rows[0];
}

/** Recusa 22023 com a mensagem esperada E zero escrita. */
async function recusada(c, rotulo, itens, mensagem, opcoes) {
  const antes = await foto(c);
  const r = await vender(c, itens, opcoes);
  assert.equal(
    r.ok,
    false,
    `[${rotulo}] a venda foi GRAVADA (deveria ser recusada): ${JSON.stringify(r.r?.order?.total)}`,
  );
  assert.equal(r.code, "22023", `[${rotulo}] código (${r.message})`);
  assert.match(r.message, mensagem, `[${rotulo}] mensagem`);
  assert.deepEqual(
    await foto(c),
    antes,
    `[${rotulo}] a recusa deixou pedido, item, histórico, nota ou estoque alterado`,
  );
}

const um = (product_id, variant_id, quantity = 1) =>
  variant_id === undefined
    ? [{ product_id, quantity }]
    : [{ product_id, variant_id, quantity }];

// ---------------------------------------------------------------- cenários
const CENARIOS = [];

CENARIOS.push({
  id: "S1",
  nome: "S1: produto com variação ativa vendido sem escolher a variação -> 'Escolha uma variação', zero linha",
  corpo: async (c) => {
    const msg = /^Escolha uma variação para o produto Camiseta Fixture\.$/;
    await recusada(c, "S1 sem chave variant_id", um(FX.P_VAR, undefined), msg);
    await recusada(c, "S1 variant_id null", um(FX.P_VAR, null), msg);
  },
});

CENARIOS.push({
  id: "S2",
  nome: "S2: variação inativa de produto ativo -> 'não disponível', zero linha",
  corpo: async (c) => {
    await recusada(
      c,
      "S2",
      um(FX.P_VAR, FX.V_INATIVA),
      /^Produto não encontrado não disponível\.$/,
    );
  },
});

CENARIOS.push({
  id: "S3",
  nome: "S3: produto inativo (ativo=false), simples e com variação ativa -> 'não disponível', zero linha",
  corpo: async (c) => {
    // Sem nome na mensagem: o produto não é lido, então o texto cai no padrão.
    await recusada(
      c,
      "S3 simples",
      um(FX.P_INATIVO, undefined),
      /^Produto não encontrado não disponível\.$/,
    );
    await recusada(
      c,
      "S3 com variação ativa",
      um(FX.P_INATIVO_VAR, FX.V_DO_INATIVO),
      /^Produto não encontrado não disponível\.$/,
    );
  },
});

CENARIOS.push({
  id: "S4",
  nome: "S4: produto arquivado (deleted_at, ativo=true), simples e com variação ativa -> 'não disponível', zero linha",
  corpo: async (c) => {
    await recusada(
      c,
      "S4 simples",
      um(FX.P_ARQ, undefined),
      /^Produto não encontrado não disponível\.$/,
    );
    await recusada(
      c,
      "S4 com variação ativa",
      um(FX.P_ARQ_VAR, FX.V_DO_ARQ),
      /^Produto não encontrado não disponível\.$/,
    );
  },
});

CENARIOS.push({
  id: "S5",
  nome: "S5: variação de OUTRO produto (ambos ativos) -> 'não disponível', zero linha",
  corpo: async (c) => {
    // P_SIMPLES (ativo, sem variação) + variação que pertence a P_OUTRO.
    await recusada(
      c,
      "S5 pai sem variação",
      um(FX.P_SIMPLES, FX.V_OUTRO),
      /^Produto não encontrado não disponível\.$/,
    );
    // P_VAR (ativo, com variação ativa) + variação que pertence a P_OUTRO.
    await recusada(
      c,
      "S5 pai com variação",
      um(FX.P_VAR, FX.V_OUTRO),
      /^Produto não encontrado não disponível\.$/,
    );
  },
});

CENARIOS.push({
  id: "S6",
  nome: "S6: estoque insuficiente (variação pede 6 de 5; simples pede 11 de 10) -> recusa com Disponível/Solicitado, zero linha",
  corpo: async (c) => {
    await recusada(
      c,
      "S6 variação",
      um(FX.P_VAR, FX.V_ATIVA, 6),
      /^Estoque insuficiente para o produto Camiseta Fixture \(Disponível: 5, Solicitado: 6\)$/,
    );
    await recusada(
      c,
      "S6 simples",
      um(FX.P_SIMPLES, undefined, 11),
      /^Estoque insuficiente para o produto Caneca Fixture \(Disponível: 10, Solicitado: 11\)$/,
    );
  },
});

CENARIOS.push({
  id: "S7",
  nome: "S7: quantidade 0, -1 e null -> 'Quantidade inválida', zero linha",
  corpo: async (c) => {
    for (const quantity of [0, -1, null]) {
      await recusada(
        c,
        `S7 quantidade ${quantity}`,
        [{ product_id: FX.P_SIMPLES, quantity }],
        /^Quantidade inválida para um dos itens\.$/,
      );
    }
  },
});

CENARIOS.push({
  id: "S8",
  nome: "S8: venda mista (item válido + item inválido) -> recusa inteira, o estoque do item válido não desce",
  corpo: async (c) => {
    await recusada(
      c,
      "S8 válido + variação inativa",
      [
        { product_id: FX.P_SIMPLES, quantity: 1 },
        { product_id: FX.P_VAR, variant_id: FX.V_INATIVA, quantity: 1 },
      ],
      /^Produto não encontrado não disponível\.$/,
    );
    await recusada(
      c,
      "S8 variação válida + produto pai sem escolher",
      [
        { product_id: FX.P_VAR, variant_id: FX.V_ATIVA, quantity: 1 },
        { product_id: FX.P_VAR, quantity: 1 },
      ],
      /^Escolha uma variação para o produto Camiseta Fixture\.$/,
    );
  },
});

CENARIOS.push({
  id: "S9",
  nome: "S9: controle — venda válida da variação baixa só a variação e grava o total conferido; produto sem variação ativa vende sem variant_id",
  corpo: async (c) => {
    const r = await vender(c, um(FX.P_VAR, FX.V_ATIVA, 2), { esperado: 300 });
    assert.equal(r.ok, true, `[S9] venda válida recusada: ${r.message}`);
    assert.equal(r.r.ja_existia, false, "[S9] ja_existia");
    assert.equal(Number(r.r.order.total), 300, "[S9] total = 2 x 150");
    assert.equal(Number(r.r.order.subtotal), 300, "[S9] subtotal");
    assert.equal(r.r.order.canal, "presencial", "[S9] canal");
    assert.equal(r.r.items.length, 1, "[S9] um item");
    assert.equal(r.r.items[0].variant_id, FX.V_ATIVA, "[S9] item na variação");
    assert.equal(r.r.items[0].product_id, FX.P_VAR, "[S9] item no produto");
    assert.equal(Number(r.r.items[0].price), 150, "[S9] preço do BANCO");
    assert.equal(r.r.items[0].quantity, 2, "[S9] quantidade");
    const est = async () =>
      (
        await c.query(
          `SELECT
             (SELECT stock_increment FROM public.product_variants WHERE id = $1) AS variante,
             (SELECT stock_increment FROM public.product_variants WHERE id = $2) AS variante_inativa,
             (SELECT estoque FROM public.produtos WHERE id = $3) AS pai,
             (SELECT estoque FROM public.produtos WHERE id = $4) AS sem_ativa`,
          [FX.V_ATIVA, FX.V_TODAS_INATIVAS, FX.P_VAR, FX.P_SEM_ATIVA],
        )
      ).rows[0];
    assert.deepEqual(
      await est(),
      { variante: 3, variante_inativa: 4, pai: 20, sem_ativa: 4 },
      "[S9] a variação desce 5 -> 3 e o estoque do produto-pai FICA em 20 (baixa XOR)",
    );

    // Produto com variações todas inativas: vende pelo produto, sem variant_id.
    const s = await vender(c, um(FX.P_SEM_ATIVA, undefined, 1), {
      esperado: 60,
    });
    assert.equal(s.ok, true, `[S9] produto sem variação ativa: ${s.message}`);
    assert.equal(Number(s.r.order.total), 60, "[S9] total do sem-variação");
    assert.equal(s.r.items[0].variant_id, null, "[S9] sem variant_id");
    assert.deepEqual(
      await est(),
      { variante: 3, variante_inativa: 4, pai: 20, sem_ativa: 3 },
      "[S9] o produto desce 4 -> 3 e a variação inativa fica em 4",
    );
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R112F='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [RPC])
    ).rows[0].d.replace(/\r/g, "");
  const def = await ler();
  const ocorrencias = def.split(m.de).length - 1;
  assert.equal(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  assert.equal(
    await ler(),
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), fixture, e cada cenário num
 * SAVEPOINT. Devolve {mutante, passou:[ids], falhou:[{id, nome, erro}]}. Erro
 * que não é de asserção (SQL, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await semear(c);
    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id: cid, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
        resultado.passou.push(cid);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id: cid, nome, erro });
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT cenario");
        await c.query("RELEASE SAVEPOINT cenario");
      }
    }
    return resultado;
  } finally {
    await c.query("ROLLBACK");
  }
}

const linha = (e) => `${e.message.split("\n")[0]}`;

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R112F || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R112F='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  try {
    const r = await rodar(cliente, nomeMutante);
    for (const cid of r.passou) console.log(`  PASSOU ${cid}`);
    for (const f of r.falhou) {
      console.error(`  VERMELHO ${f.id}: ${linha(f.erro)}`);
    }

    if (nomeMutante) {
      console.log(
        `  MUTANTE ${nomeMutante}: vermelho em [${r.falhou.map((f) => f.id).join(", ")}], verde em [${r.passou.join(", ")}]`,
      );
      if (r.falhou.length === 0) {
        falhar(
          "SOBREVIVEU",
          `o mutante ${nomeMutante} deixou TODOS os cenários verdes: a prova não guarda esse trecho`,
        );
      }
      const faltou = r.mutante.espera.filter(
        (cid) => !r.falhou.some((f) => f.id === cid),
      );
      if (faltou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho, mas NÃO em [${faltou.join(", ")}] (esperado ${r.mutante.espera.join(", ")})`,
        );
      }
      falhar(
        "VERMELHO",
        `mutante ${nomeMutante} pego, como esperado, em [${r.mutante.espera.join(", ")}]`,
      );
    }

    if (r.falhou.length > 0) {
      anexarAoSummary(
        TITULO,
        r.falhou
          .map(
            (f) => `- ❌ ${f.nome}\n  - \`${f.erro.message.split("\n")[0]}\``,
          )
          .join("\n"),
      );
      falhar(
        "FALHOU",
        "O balcão vendeu (ou recusou errado) variação inválida ou produto fora de venda — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[a-venda-de-balcao] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
    );
    anexarAoSummary(
      TITULO,
      `${CENARIOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CENARIOS.length}/${CENARIOS.length} cenários** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();
