"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, ids de cenário) ou do JSON
 * da própria RPC no Postgres efêmero; todo caminho de arquivo é literal do repositório. */

/**
 * PROVA VIVA da 20261402000000 (o Início mostra o dinheiro a devolver e a margem do Financeiro).
 * `public.painel_inicio()` ganha duas chaves, sem mudar nenhuma outra:
 *
 *   1. `dinheiro_a_devolver` = {valor (reais), pedidos}: a MESMA conta da lista "Devolver agora" da tela de Pedidos
 *      (baldeDeEstorno + valorDevolverAgoraDescontandoLedger). Os cenários moram em `dinheiro-a-devolver-cenarios.json`,
 *      COMPARTILHADO com o teste do front, que passa os mesmos casos pelas funções reais da tela; o esperado é escrito à mão
 *      (centavos inteiros), nunca calculado pelo SQL.
 *   2. `mes.receita_liquida` = a receita líquida que o `fin_dre` devolve no MESMO período do lucro (o mês inteiro).
 *
 * O que esta prova mede:
 *   D-<id>              cada cenário do JSON, semeado sozinho (pedido, devoluções, linhas do ledger), dentro de um SAVEPOINT;
 *                       o que o painel acrescenta ao que já existia tem de ser o esperado (a conta é por diferença, para não
 *                       depender de pedido que outra prova tenha deixado no banco base).
 *   D-soma-de-todos     todos os cenários semeados de uma vez: a soma bate (a conta é por pedido, sem um mascarar o outro).
 *   D-sem-janela        pedido pago e cancelado há MAIS de dois anos continua na conta (dinheiro devido não envelhece).
 *   L-receita-liquida   venda 100 + estorno concluído 20 no mês: receita líquida 80 (bruta 100), igual à do fin_dre do mesmo período.
 *   L-lucro-intacto     o lucro estimado continua sendo o lucro_liquido do fin_dre (a leitura única do fin_dre não mudou a conta).
 *   J-resto-do-json     tirando as duas chaves novas, o JSON é IDÊNTICO ao do corpo anterior (o rollback), no mesmo banco.
 *   S-admin             cliente comum recebe 42501; anon e PUBLIC não executam; authenticated e service_role sim.
 *   C-consultas         154a/154b (rol fechado; corpo novo, anterior e estranho) e as vizinhas 116a, 97a, 30a, 17a, 8e e 119a aceitam o corpo novo.
 *   M-reaplicar         aplicar duas vezes deixa o mesmo corpo, os mesmos atributos e a mesma ACL (idempotência).
 *   M-rollback          o rollback devolve o corpo da 20261399300000 BYTE A BYTE (comparado ao texto da migration anterior);
 *                       repetir o rollback é recusado sem escrever; reaplicar volta ao corpo novo.
 *   M-preflight         corpo desconhecido, atributo trocado e ACL aberta são recusados (B1_BASELINE_DIVERGENT) antes de escrever.
 *   M-atomica           conferência final sabotada derruba a migration inteira: depois do desfazer da transação o corpo é o vigente.
 *
 * MUTANTES: MUTANTE_R142A=<nome> troca UM trecho do corpo vivo (pg_get_functiondef, dentro da transação desfeita); a prova TEM
 * de ficar vermelha nos cenários prometidos (e verde nos controles). A RODADA PADRÃO (sem a variável) roda os cenários e DEPOIS a lista
 * inteira de mutantes, e só sai 0 se todos foram pegos como prometido. MUTANTE_R142A=todos roda só a lista; um nome roda um só. Nome desconhecido é ERRO. `corpo-anterior` instala o corpo da 20261399300000: é o controle de que os
 * cenários nascem VERMELHOS sem a migration.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-inicio-dinheiro-a-devolver-viva.cjs
 */

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO = "Prova viva: o Início mostra o dinheiro a devolver (rpc-ci)";
const PAINEL = "public.painel_inicio()";
const NOME_NOVA =
  "20261402000000_o_inicio_mostra_o_dinheiro_a_devolver_e_a_margem_do_financeiro.sql";
const NOME_ANTERIOR =
  "20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql";
const HASH_VIGENTE = "8d58e15e7410afe0d254f37f38251df4"; // corpo da 20261399300000
const HASH_NOVO = "b4c3665bd806ae8fe8960e5f6d9dde29"; // corpo da 20261402000000

const U_ADMIN = "d0d14200-0000-4000-8000-0000000000a1";
const U_CLIENTE = "d0d14200-0000-4000-8000-0000000000b1";

const raiz = path.join(__dirname, "..", "..");
const lerArquivo = (...partes) =>
  fs.readFileSync(path.join(raiz, ...partes), "utf8").replace(/\r/g, "");
const MIGRATION = lerArquivo("supabase", "migrations", NOME_NOVA);
const ROLLBACK = lerArquivo(
  "supabase",
  "migrations",
  `rollback-manual-${NOME_NOVA}`,
);
const ANTERIOR = lerArquivo("supabase", "migrations", NOME_ANTERIOR);
const CENARIOS_JSON = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "dinheiro-a-devolver-cenarios.json"),
    "utf8",
  ),
).cenarios;

const md5 = (t) => crypto.createHash("md5").update(t).digest("hex");

/** O corpo (prosrc) que uma migration instala em painel_inicio: do `AS $$` ao `$$;` da função. */
function corpoDe(sql) {
  const ini = sql.indexOf("CREATE OR REPLACE FUNCTION public.painel_inicio()");
  assert.ok(ini >= 0, "a migration não define painel_inicio");
  const abre = sql.indexOf("AS $$", ini) + "AS $$".length;
  return sql.slice(abre, sql.indexOf("\n$$;", abre) + 1);
}
const CORPO_NOVO = corpoDe(MIGRATION);
const CORPO_ANTERIOR = corpoDe(ANTERIOR);

// ---------------------------------------------------------------- mutantes
// `trocas` = trechos EXATOS do corpo vivo (pg_get_functiondef), cada `de` 1x. `vermelho` = cenários onde a prova TEM de ficar
// vermelha; `verde` = controles que TÊM de continuar verdes (o mutante só mexe no que promete).
const TODOS_OS_D = [
  ...CENARIOS_JSON.map((x) => `D-${x.id}`),
  "D-soma-de-todos",
  "D-sem-janela",
];
const MUTANTES = {
  "corpo-anterior": {
    instalar: "rollback",
    vermelho: [...TODOS_OS_D, "L-receita-liquida"],
    verde: ["L-lucro-intacto"],
  },
  "status-cancelado-trocado": {
    trocas: [
      [
        "WHERE o.status = 'cancelled'\n           AND o.payment_status IN",
        "WHERE o.status <> 'cancelled'\n           AND o.payment_status IN",
      ],
    ],
    vermelho: [
      "D-pago-cancelado-sem-devolucao",
      "D-pedido-pago-normal",
      "D-tudo-junto",
      "D-soma-de-todos",
    ],
    verde: ["D-cancelado-que-nunca-pagou", "L-receita-liquida"],
  },
  "sem-exclusao-do-que-esta-em-andamento": {
    trocas: [["- COALESCE(l.em_curso, 0) -", "-"]],
    vermelho: [
      "D-estorno-em-andamento-total",
      "D-estorno-em-processamento-parcial",
      "D-estorno-do-proprio-mercado-pago",
      "D-estorno-travado-sem-confirmacao",
      "D-tudo-junto",
      "D-soma-de-todos",
    ],
    verde: [
      "D-pago-cancelado-sem-devolucao",
      "D-devolucao-manual-parcial",
      "D-linha-morta-do-ledger",
    ],
  },
  "receita-bruta-no-lugar-da-liquida": {
    trocas: [["v_dre ->> 'receita_liquida'", "v_dre ->> 'receita_bruta'"]],
    vermelho: ["L-receita-liquida"],
    verde: ["D-pago-cancelado-sem-devolucao", "L-lucro-intacto"],
  },
  "sem-a-espera-do-produto": {
    trocas: [
      [
        "\n           AND NOT (COALESCE(o.cancelled_after_shipping, false) AND o.returned_to_seller_at IS NULL)",
        "",
      ],
    ],
    vermelho: ["D-cancelado-depois-de-enviado-sem-retorno", "D-soma-de-todos"],
    verde: [
      "D-cancelado-depois-de-enviado-produto-voltou",
      "D-pago-cancelado-sem-devolucao",
    ],
  },
  "sem-desconto-da-devolucao-manual": {
    trocas: [[" - round(COALESCE(dm.valor, 0) * 100)", ""]],
    vermelho: [
      "D-devolucao-manual-parcial",
      "D-devolucao-manual-total",
      "D-tudo-junto",
      "D-soma-de-todos",
    ],
    verde: ["D-devolucao-que-nao-conta", "D-valor-estornado-parcial"],
  },
  "concluido-descontado-duas-vezes": {
    trocas: [
      [
        "GREATEST(COALESCE(l.concluido, 0) - b.estornado, 0)",
        "COALESCE(l.concluido, 0)",
      ],
    ],
    vermelho: [
      "D-estorno-concluido-parcial-em-dia",
      "D-tudo-junto",
      "D-soma-de-todos",
    ],
    verde: [
      "D-estorno-concluido-que-a-lista-ainda-nao-viu",
      "D-pago-cancelado-sem-devolucao",
    ],
  },
  "so-pago-conta-como-dinheiro-que-entrou": {
    trocas: [
      [
        "o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')",
        "o.payment_status = 'pago'",
      ],
    ],
    vermelho: [
      "D-pago-apos-expirar-cancelado",
      "D-recebido-na-entrega-cancelado",
      "D-soma-de-todos",
    ],
    verde: ["D-pago-cancelado-sem-devolucao", "D-cancelado-ja-estornado"],
  },
  "linha-morta-do-ledger-conta-como-em-curso": {
    trocas: [
      [
        "FILTER (WHERE r.status IN ('solicitado', 'em_processamento')) AS em_curso",
        "FILTER (WHERE r.status <> 'concluido') AS em_curso",
      ],
      [
        "AND r.status IN ('solicitado', 'em_processamento', 'concluido')",
        "AND true",
      ],
    ],
    vermelho: ["D-linha-morta-do-ledger", "D-soma-de-todos"],
    verde: ["D-estorno-em-andamento-total", "D-pago-cancelado-sem-devolucao"],
  },
  "pedido-de-resto-zero-entra-na-contagem": {
    trocas: [
      [
        "'pedidos', (SELECT count(*) FROM a_devolver WHERE resto > 0)",
        "'pedidos', (SELECT count(*) FROM a_devolver)",
      ],
    ],
    vermelho: [
      "D-estorno-em-andamento-total",
      "D-estorno-do-proprio-mercado-pago",
      "D-em-curso-maior-que-o-que-falta",
    ],
    verde: ["D-pago-cancelado-sem-devolucao", "D-devolucao-manual-parcial"],
  },
};

// ---------------------------------------------------------------- ajudantes
async function logar(c, id) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [id]);
}
const painel = async (c) => (await c.query(`SELECT ${PAINEL} AS r`)).rows[0].r;
const hashVivo = async (c) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = $1::regprocedure",
      [PAINEL],
    )
  ).rows[0].h;
const prosrc = async (c) =>
  (
    await c.query(
      "SELECT replace(prosrc, chr(13), '') AS s FROM pg_proc WHERE oid = $1::regprocedure",
      [PAINEL],
    )
  ).rows[0].s;
const atributos = async (c) =>
  (
    await c.query(
      "SELECT (to_jsonb(p) - 'prosrc') AS a FROM pg_proc p WHERE oid = $1::regprocedure",
      [PAINEL],
    )
  ).rows[0].a;
const centavosDe = (valor) => Math.round(Number(valor) * 100);

/** Ponto de salvamento aninhado: devolve o erro (ou null) e desfaz tudo o que a ação fez. */
async function recusa(c, acao) {
  await c.query("SAVEPOINT recusa");
  let erro = null;
  try {
    await acao();
  } catch (e) {
    erro = e;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa");
    await c.query("RELEASE SAVEPOINT recusa");
  }
  return erro;
}

/** A chave nova tem de existir e ter a forma {valor, pedidos}: sem ela o cenário fica VERMELHO (asserção), não quebrado. */
function lerDevolver(json) {
  const d = json?.dinheiro_a_devolver;
  assert.ok(
    d && typeof d === "object",
    "o painel não devolve 'dinheiro_a_devolver'",
  );
  assert.ok(
    Object.hasOwn(d, "valor") && Object.hasOwn(d, "pedidos"),
    "dinheiro_a_devolver sem valor/pedidos",
  );
  return { pedidos: Number(d.pedidos), centavos: centavosDe(d.valor) };
}
async function devolverAgora(c) {
  return lerDevolver(await painel(c));
}

/** Semeia UM cenário do JSON: o pedido (cancelado por padrão), as devoluções e as linhas do ledger. */
async function semear(c, cen, ordem) {
  const p = cen.pedido;
  const status = p.status ?? "cancelled";
  const pedido = (
    await c.query(
      `INSERT INTO public.marketplace_orders
         (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status,
          cancelled_after_shipping, returned_to_seller_at, valor_estornado, created_at, updated_at)
       VALUES ($1, $2, '{}'::jsonb, $3, $3, $4, 'online', 'online', $5, $6, $7, $8, $9::timestamptz, $9::timestamptz)
       RETURNING id`,
      [
        U_CLIENTE,
        `Cliente 142 ${ordem}`,
        p.total,
        status,
        p.payment_status,
        p.cancelled_after_shipping === true,
        p.voltou_ao_vendedor === true ? "2026-10-03T12:00:00-03:00" : null,
        p.valor_estornado ?? 0,
        p.criado_em ?? "2026-10-01T12:00:00-03:00",
      ],
    )
  ).rows[0].id;
  let n = 0;
  for (const d of cen.devolucoes ?? []) {
    n += 1;
    await c.query(
      `INSERT INTO public.devolucoes
         (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno, valor_itens, prazo_ate,
          politica, status, valor_reembolso, reembolso_manual)
       VALUES ($1, $2, $3, 'arrependimento', 'desisti', 'reembolso', 'local', 'entrega_na_loja', 0, DATE '2026-12-31',
               '{}'::jsonb, $4, $5, $6)`,
      [
        `P142-${ordem}-${n}`,
        pedido,
        U_CLIENTE,
        d.status,
        d.valor_reembolso,
        d.reembolso_manual,
      ],
    );
  }
  for (const r of cen.reembolsos ?? []) {
    await c.query(
      `INSERT INTO public.order_refunds (order_id, amount, status, solicitado_por, tentativas, concluido_em)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $3 = 'concluido' THEN now() ELSE NULL END)`,
      [pedido, r.amount, r.status, r.solicitado_por, r.tentativas ?? 0],
    );
  }
  return pedido;
}

async function fixarRelogio(c, dia) {
  await c.query(
    `CREATE OR REPLACE FUNCTION public.fin__hoje() RETURNS date LANGUAGE sql STABLE
       SET search_path TO 'public' AS $$ SELECT DATE '${dia}' $$`,
  );
}

// ---------------------------------------------------------------- cenários
const CENARIOS = [];
const cenario = (id, nome, corpo) => CENARIOS.push({ id, nome, corpo });

for (const cen of CENARIOS_JSON) {
  cenario(`D-${cen.id}`, `${cen.id}: ${cen.descricao}`, async (c) => {
    await logar(c, U_ADMIN);
    const antes = await devolverAgora(c);
    await semear(c, cen, cen.id);
    const depois = await devolverAgora(c);
    assert.deepStrictEqual(
      {
        pedidos: depois.pedidos - antes.pedidos,
        centavos: depois.centavos - antes.centavos,
      },
      cen.esperado,
      `[${cen.id}] o que o Início acrescenta a "dinheiro a devolver"`,
    );
  });
}

cenario(
  "D-soma-de-todos",
  "todos os cenários de uma vez: a soma bate e um pedido não mascara o outro",
  async (c) => {
    await logar(c, U_ADMIN);
    const antes = await devolverAgora(c);
    let ordem = 0;
    for (const cen of CENARIOS_JSON)
      await semear(c, cen, `junto-${(ordem += 1)}`);
    const depois = await devolverAgora(c);
    const esperado = CENARIOS_JSON.reduce(
      (s, x) => ({
        pedidos: s.pedidos + x.esperado.pedidos,
        centavos: s.centavos + x.esperado.centavos,
      }),
      { pedidos: 0, centavos: 0 },
    );
    assert.deepStrictEqual(
      {
        pedidos: depois.pedidos - antes.pedidos,
        centavos: depois.centavos - antes.centavos,
      },
      esperado,
    );
  },
);

cenario(
  "D-sem-janela",
  "pedido pago e cancelado há mais de dois anos continua na conta (sem janela de datas)",
  async (c) => {
    await logar(c, U_ADMIN);
    const antes = await devolverAgora(c);
    await semear(
      c,
      {
        pedido: {
          total: 250,
          payment_status: "pago",
          criado_em: "2024-01-05T12:00:00-03:00",
        },
      },
      "antigo",
    );
    const depois = await devolverAgora(c);
    assert.deepStrictEqual(
      {
        pedidos: depois.pedidos - antes.pedidos,
        centavos: depois.centavos - antes.centavos,
      },
      { pedidos: 1, centavos: 25000 },
    );
  },
);

cenario(
  "L-receita-liquida",
  "venda 100 + estorno concluído 20 no mês: receita líquida 80 (bruta 100), a mesma do fin_dre",
  async (c) => {
    await logar(c, U_ADMIN);
    await fixarRelogio(c, "2026-10-15");
    const lerDre = async () =>
      (
        await c.query(
          "SELECT public.fin_dre(DATE '2026-10-01', DATE '2026-10-31') AS r",
        )
      ).rows[0].r;
    const antes = await painel(c);
    const dreAntes = await lerDre();
    const pedido = (
      await c.query(
        `INSERT INTO public.marketplace_orders
         (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at, created_at)
       VALUES ($1, 'Cliente 142 liquida', '{}'::jsonb, 100, 100, 'delivered', 'online', 'online', 'pago',
               '2026-10-10T15:00:00-03:00', '2026-10-10T15:00:00-03:00')
       RETURNING id`,
        [U_CLIENTE],
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO public.order_refunds (order_id, amount, status, solicitado_por, tentativas, concluido_em)
     VALUES ($1, 20, 'concluido', 'lojista', 1, '2026-10-12T10:00:00-03:00')`,
      [pedido],
    );
    const depois = await painel(c);
    const dre = await lerDre();
    assert.strictEqual(
      centavosDe(dre.receita_bruta) - centavosDe(dreAntes.receita_bruta),
      10000,
      "controle: a receita BRUTA do mês sobe 100 (a líquida sobe 80: são números diferentes neste cenário)",
    );
    assert.ok(
      Object.hasOwn(depois.mes, "receita_liquida"),
      "o painel não devolve mes.receita_liquida",
    );
    assert.strictEqual(
      centavosDe(depois.mes.receita_liquida) -
        centavosDe(antes.mes.receita_liquida),
      8000,
      "a receita líquida do mês sobe 80 (100 de venda menos 20 de estorno)",
    );
    assert.strictEqual(
      centavosDe(depois.mes.receita_liquida),
      centavosDe(dre.receita_liquida),
      "a receita líquida do Início é a do fin_dre do MESMO período (mês inteiro)",
    );
  },
);

cenario(
  "L-lucro-intacto",
  "o lucro estimado continua sendo o lucro_liquido do fin_dre do mês inteiro",
  async (c) => {
    await logar(c, U_ADMIN);
    await fixarRelogio(c, "2026-10-15");
    await c.query(
      `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at, created_at)
     VALUES ($1, 'Cliente 142 lucro', '{}'::jsonb, 100, 100, 'delivered', 'online', 'online', 'pago',
             '2026-10-10T15:00:00-03:00', '2026-10-10T15:00:00-03:00')`,
      [U_CLIENTE],
    );
    const json = await painel(c);
    const dre = (
      await c.query(
        "SELECT public.fin_dre(DATE '2026-10-01', DATE '2026-10-31') AS r",
      )
    ).rows[0].r;
    assert.strictEqual(
      centavosDe(json.mes.lucro_estimado),
      centavosDe(dre.lucro_liquido),
    );
  },
);

cenario(
  "J-resto-do-json",
  "tirando as duas chaves novas, o JSON é idêntico ao do corpo anterior (mesmo banco, mesmo instante)",
  async (c) => {
    await logar(c, U_ADMIN);
    let ordem = 0;
    for (const cen of CENARIOS_JSON)
      await semear(c, cen, `json-${(ordem += 1)}`);
    await c.query(
      `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at, created_at)
     VALUES ($1, 'Cliente 142 json', '{}'::jsonb, 77.7, 77.7, 'delivered', 'online', 'online', 'pago', now(), now())`,
      [U_CLIENTE],
    );
    const novo = await painel(c);
    assert.ok(
      Object.hasOwn(novo, "dinheiro_a_devolver") &&
        Object.hasOwn(novo.mes, "receita_liquida"),
      "as duas chaves novas existem",
    );
    const { dinheiro_a_devolver: _d, ...semDevolver } = novo;
    const { receita_liquida: _r, ...mesSemLiquida } = novo.mes;
    await c.query(ROLLBACK);
    assert.strictEqual(await hashVivo(c), HASH_VIGENTE);
    const antigo = await painel(c);
    assert.deepStrictEqual({ ...semDevolver, mes: mesSemLiquida }, antigo);
    assert.ok(
      !Object.hasOwn(antigo, "dinheiro_a_devolver"),
      "o corpo anterior não tem a chave nova (controle)",
    );
  },
);

cenario(
  "S-admin",
  "cliente comum recebe 42501; anon e PUBLIC não executam; authenticated e service_role sim",
  async (c) => {
    await logar(c, U_CLIENTE);
    const erro = await recusa(c, () => painel(c));
    assert.ok(erro, "cliente comum chamou painel_inicio sem erro");
    assert.strictEqual(erro.code, "42501");
    const acl = (
      await c.query(
        `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS auth,
              has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS servico,
              EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = $1::regprocedure AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) AS publico`,
        [PAINEL],
      )
    ).rows[0];
    assert.deepStrictEqual(acl, {
      anon: false,
      auth: true,
      servico: true,
      publico: false,
    });
  },
);

cenario(
  "M-reaplicar",
  "aplicar duas vezes deixa o mesmo corpo, os mesmos atributos e a mesma ACL",
  async (c) => {
    const antes = { h: await hashVivo(c), a: await atributos(c) };
    assert.strictEqual(antes.h, HASH_NOVO);
    await c.query(MIGRATION);
    await c.query(MIGRATION);
    assert.deepStrictEqual(
      { h: await hashVivo(c), a: await atributos(c) },
      antes,
    );
    // CRLF (arquivo baixado no Windows): o mesmo corpo para o banco, porque o pré-voo e a conferência normalizam o CR.
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    assert.strictEqual(await hashVivo(c), HASH_NOVO);
  },
);

cenario(
  "M-rollback",
  "o rollback devolve o corpo da 20261399300000 byte a byte; repetir recusa; reaplicar volta ao novo",
  async (c) => {
    const atrAntes = await atributos(c);
    await c.query(ROLLBACK);
    assert.strictEqual(await hashVivo(c), HASH_VIGENTE);
    assert.strictEqual(
      await prosrc(c),
      CORPO_ANTERIOR,
      "o corpo restaurado não é o texto da 20261399300000, byte a byte",
    );
    assert.deepStrictEqual(
      await atributos(c),
      atrAntes,
      "OID, dono, ACL e atributos intactos",
    );
    const erro = await recusa(c, () => c.query(ROLLBACK));
    assert.ok(
      erro && /B1_BASELINE_DIVERGENT/.test(erro.message),
      "repetir o rollback tem de ser recusado",
    );
    assert.strictEqual(
      await hashVivo(c),
      HASH_VIGENTE,
      "a recusa não gravou nada",
    );
    await c.query(MIGRATION);
    assert.strictEqual(await hashVivo(c), HASH_NOVO);
    assert.strictEqual(await prosrc(c), CORPO_NOVO);
  },
);

cenario(
  "M-preflight",
  "corpo desconhecido, atributo trocado e ACL aberta são recusados antes de escrever",
  async (c) => {
    // Parte do corpo VIGENTE: o corpo desconhecido é o vigente com um comentário a mais.
    await c.query(ROLLBACK);
    const comentado = (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        PAINEL,
      ])
    ).rows[0].d.replace("RETURN v_res;", "RETURN v_res; -- adulterado");
    await c.query(comentado);
    assert.notStrictEqual(await hashVivo(c), HASH_VIGENTE);
    let erro = await recusa(c, () => c.query(MIGRATION));
    assert.ok(
      erro && /B1_BASELINE_DIVERGENT.*corpo vivo/.test(erro.message),
      `corpo desconhecido: ${erro?.message}`,
    );
    await c.query(ROLLBACK.replaceAll(HASH_NOVO, md5(await prosrc(c)))); // volta ao vigente para os próximos casos
    assert.strictEqual(await hashVivo(c), HASH_VIGENTE);

    await c.query("ALTER FUNCTION public.painel_inicio() SECURITY INVOKER");
    erro = await recusa(c, () => c.query(MIGRATION));
    assert.ok(
      erro && /B1_BASELINE_DIVERGENT.*atributos/.test(erro.message),
      `atributo trocado: ${erro?.message}`,
    );
    await c.query("ALTER FUNCTION public.painel_inicio() SECURITY DEFINER");

    await c.query("GRANT EXECUTE ON FUNCTION public.painel_inicio() TO anon");
    erro = await recusa(c, () => c.query(MIGRATION));
    assert.ok(
      erro && /B1_BASELINE_DIVERGENT.*ACL/.test(erro.message),
      `ACL aberta: ${erro?.message}`,
    );
    await c.query(
      "REVOKE EXECUTE ON FUNCTION public.painel_inicio() FROM anon",
    );

    // Nada foi gravado pelas recusas: o corpo segue o vigente e a migration ainda aplica limpa.
    assert.strictEqual(await hashVivo(c), HASH_VIGENTE);
    await c.query(MIGRATION);
    assert.strictEqual(await hashVivo(c), HASH_NOVO);
  },
);

cenario(
  "M-atomica",
  "conferência final sabotada derruba a migration inteira: depois de desfeita a transação o corpo é o vigente",
  async (c) => {
    await c.query(ROLLBACK);
    assert.strictEqual(await hashVivo(c), HASH_VIGENTE);
    const sabotada = MIGRATION.replace(
      `IS DISTINCT FROM '${HASH_NOVO}'`,
      "IS DISTINCT FROM '00000000000000000000000000000000'",
    );
    assert.notStrictEqual(
      sabotada,
      MIGRATION,
      "a sabotagem não achou o trecho",
    );
    const erro = await recusa(c, () => c.query(sabotada));
    assert.ok(
      erro && /conferencia 20261402/.test(erro.message),
      `a conferência sabotada tinha de abortar: ${erro?.message}`,
    );
    assert.strictEqual(
      await hashVivo(c),
      HASH_VIGENTE,
      "nada ficou gravado depois do erro",
    );
    await c.query(MIGRATION);
  },
);

cenario(
  "C-consultas",
  "154a/154b leem o estado certo e as consultas vizinhas (116a, 97a, 30a, 17a, 8e, 119a) aceitam o corpo novo e reprovam corpo estranho",
  async (c) => {
    // eslint-disable-next-line security/detect-non-literal-require -- caminho montado de literais do proprio teste, dentro do repositorio.
    const { ROL_FECHADO_POR_CONSULTA } = require(
      path.join(raiz, "scripts", "publicacao", "conferir-banco.cjs"),
    );
    const A154 = "154a-conferir-o-inicio-mostra-o-dinheiro-a-devolver-aplicado";
    const B154 =
      "154b-antes-o-inicio-mostra-o-dinheiro-a-devolver-base-vigente";
    const rodarConsulta = async (nome) =>
      (
        await c.query(
          lerArquivo("scripts", "publicacao", "consultas", `${nome}.sql`),
        )
      ).rows;
    const reprovadas = (rows) =>
      rows
        .filter((r) => r.ok !== true)
        .map((r) => r.item)
        .sort();
    const soPainel = (rows) =>
      rows.filter((r) => /^painel_inicio:/.test(r.item));
    const LINHA_CORPO = "painel_inicio: corpo exato (md5)";
    const VIZINHAS = [
      "116a-conferir-o-inicio-compara-o-mes-anterior-ate-a-mesma-hora-aplicado",
      "97a-conferir-o-lucro-do-inicio-conta-o-mes-inteiro-aplicado",
      "17a-conferir-estoque-do-painel-aplicado",
      "30a-conferir-numeros-do-painel-aplicado",
      "8e-conferir-92-a-202-aplicado",
    ];
    const C119A =
      "119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado";

    // Corpo novo no ar: a 154a fecha, a 154b reprova SO a linha do corpo; o rol e fechado nas duas.
    const a = await rodarConsulta(A154);
    const b = await rodarConsulta(B154);
    for (const [nome, rows] of [
      [A154, a],
      [B154, b],
    ])
      assert.deepStrictEqual(
        rows.map((r) => r.item).sort(),
        [...ROL_FECHADO_POR_CONSULTA[nome]].sort(),
        `${nome}: rol fechado`,
      );
    assert.deepStrictEqual(reprovadas(a), [], "154a com o corpo novo");
    assert.deepStrictEqual(
      reprovadas(b),
      [LINHA_CORPO],
      "154b com o corpo novo",
    );
    for (const nome of [...VIZINHAS, C119A])
      assert.deepStrictEqual(
        reprovadas(
          nome === C119A
            ? soPainel(await rodarConsulta(nome))
            : await rodarConsulta(nome),
        ),
        [],
        `${nome} com o corpo novo`,
      );

    // Corpo anterior (o rollback): a 154b fecha e a 154a reprova SO a linha do corpo; as vizinhas seguem aceitando.
    await c.query("SAVEPOINT anterior");
    await c.query(ROLLBACK);
    assert.deepStrictEqual(
      reprovadas(await rodarConsulta(A154)),
      [LINHA_CORPO],
      "154a com o corpo anterior",
    );
    assert.deepStrictEqual(
      reprovadas(await rodarConsulta(B154)),
      [],
      "154b com o corpo anterior",
    );
    for (const nome of VIZINHAS)
      assert.deepStrictEqual(
        reprovadas(await rodarConsulta(nome)),
        [],
        `${nome} com o corpo anterior`,
      );
    await c.query("ROLLBACK TO SAVEPOINT anterior");
    await c.query("RELEASE SAVEPOINT anterior");

    // Corpo estranho: reprova a linha do corpo na 154a, na 154b e na 119a, e os portoes que leem a funcao.
    const estranho = (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        PAINEL,
      ])
    ).rows[0].d.replace("RETURN v_res;", "RETURN v_res; -- estranho");
    await c.query(estranho);
    for (const nome of [A154, B154, C119A])
      assert.ok(
        reprovadas(soPainel(await rodarConsulta(nome))).includes(LINHA_CORPO),
        `${nome}: aceitou painel_inicio estranho`,
      );
    for (const nome of VIZINHAS)
      assert.ok(
        reprovadas(await rodarConsulta(nome)).length > 0,
        `${nome}: aceitou painel_inicio estranho`,
      );
  },
);

// ------------------------------------------------------------------ rodada
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (m.instalar === "rollback") {
    await c.query(ROLLBACK);
    assert.strictEqual(await hashVivo(c), HASH_VIGENTE);
    return m;
  }
  let def = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [PAINEL])
  ).rows[0].d.replace(/\r/g, "");
  for (const [de, para] of m.trocas) {
    const n = def.split(de).length - 1;
    assert.strictEqual(
      n,
      1,
      `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo (achei ${n}): ${JSON.stringify(de.slice(0, 90))}`,
    );
    def = def.replace(de, () => para);
  }
  await c.query(def);
  assert.notStrictEqual(
    await hashVivo(c),
    HASH_NOVO,
    "o mutante não alterou o corpo",
  );
  return m;
}

/** Uma transação só, SEMPRE desfeita; cada cenário num SAVEPOINT. Erro que não é de asserção sobe: é do teste, não do corpo. */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL TimeZone = 'UTC'");
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1::uuid, 'admin@dinheiro142.fixture.invalid', '{"role":"admin"}'::jsonb),
              ($2::uuid, 'cliente@dinheiro142.fixture.invalid', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN, U_CLIENTE],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin 142', 'admin'), ($2, 'Cliente 142', 'customer')
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [U_ADMIN, U_CLIENTE],
    );
    const resultado = { mutante: null, passou: [], falhou: [] };
    const base = nomeMutante ? null : { h: await hashVivo(c) };
    if (base)
      assert.strictEqual(
        base.h,
        HASH_NOVO,
        "o painel_inicio vivo não é o corpo da 20261402000000",
      );
    // Com mutante só rodam os cenários de VALOR (D- e L-): J, S e M testam a migration e o rollback, que o mutante deixa de ser.
    const doRodada = nomeMutante
      ? CENARIOS.filter((x) => /^[DL]-/.test(x.id))
      : CENARIOS;
    for (const { id, nome, corpo } of doRodada) {
      await c.query("SAVEPOINT cenario");
      try {
        // O mutante é instalado DENTRO do savepoint do cenário e desfeito junto: cada cenário vê o corpo mutante, e o seguinte o vivo.
        if (nomeMutante)
          resultado.mutante = await aplicarMutante(c, nomeMutante);
        await corpo(c);
        resultado.passou.push(id);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id, nome, erro });
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

const linha = (e) =>
  `${e.message.split("\n")[0]} (visto ${JSON.stringify(e.actual)}, esperado ${JSON.stringify(e.expected)})`;

/** Confere um mutante contra a promessa; devolve a lista de falhas da PROMESSA (vazia = pego como prometido). */
function conferirMutante(nome, r) {
  const falhou = new Set(r.falhou.map((f) => f.id));
  const m = MUTANTES[nome];
  const problemas = [];
  for (const id of m.vermelho)
    if (!falhou.has(id))
      problemas.push(`${id} deveria ficar VERMELHO e ficou verde`);
  for (const id of m.verde)
    if (falhou.has(id))
      problemas.push(`${id} é controle e deveria ficar VERDE`);
  return problemas;
}

/** Roda os mutantes pedidos; cada um TEM de ficar vermelho onde prometeu e verde nos controles. Devolve quantos foram pegos. */
async function rodarMutantes(cliente, nomes) {
  let pegos = 0;
  for (const nome of nomes) {
    const r = await rodar(cliente, nome);
    if (r.falhou.length === 0) {
      falhar(
        "SOBREVIVEU",
        `o mutante ${nome} deixou TODOS os cenários verdes: a prova não guarda esse trecho`,
      );
    }
    const problemas = conferirMutante(nome, r);
    if (problemas.length > 0) {
      falhar(
        "ASSERCAO-ERRADA",
        `o mutante ${nome} ficou vermelho em lugar diferente do prometido:\n  ${problemas.join("\n  ")}`,
      );
    }
    pegos += 1;
    console.log(
      `  MUTANTE ${nome}: pego, vermelho em [${r.falhou.map((f) => f.id).join(", ")}]`,
    );
  }
  return pegos;
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const pedido = process.env.MUTANTE_R142A || "";
  if (pedido && pedido !== "todos" && !MUTANTES[pedido]) {
    falhar(
      "ERRO",
      `MUTANTE_R142A='${pedido}' desconhecido. Nomes: todos, ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  try {
    if (pedido) {
      const nomes = pedido === "todos" ? Object.keys(MUTANTES) : [pedido];
      const pegos = await rodarMutantes(cliente, nomes);
      console.log(
        `\n[o-inicio-dinheiro-a-devolver] ${pegos}/${nomes.length} mutantes pegos como prometido.`,
      );
      if (pedido !== "todos") process.exitCode = 1; // mutante único: vermelho de propósito, como a prova do CRM
      return;
    }

    const r = await rodar(cliente, "");
    for (const id of r.passou) console.log(`  PASSOU ${id}`);
    for (const f of r.falhou)
      console.error(`  VERMELHO ${f.id}: ${linha(f.erro)}`);
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
        "Um número do Início (dinheiro a devolver, receita líquida) saiu diferente do esperado — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[o-inicio-dinheiro-a-devolver] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
    );
    // A rodada padrão TAMBÉM prova que cada mutante é pego (um passo só no CI: a lista do job do dinheiro cobra uma execução por prova).
    const nomesDosMutantes = Object.keys(MUTANTES);
    const pegos = await rodarMutantes(cliente, nomesDosMutantes);
    console.log(
      `[o-inicio-dinheiro-a-devolver] ${pegos}/${nomesDosMutantes.length} mutantes pegos como prometido.`,
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
