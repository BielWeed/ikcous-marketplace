"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, FX,
 * nomes de cenário); nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA (só teste; nenhum SQL de produção muda) de que o estoque de um
 * produto nunca fica negativo no banco. Quem segura é a CHECK
 * check_estoque_positivo (produtos.estoque >= 0, baseline 20260806000000:839) e,
 * na venda de balcão, a segunda trava do laço de baixa
 * (`AND estoque >= v_quantity` + ROW_COUNT = 0, 20261280000000:797-800).
 * Estoque negativo derruba as métricas de estoque baixo e o valor do estoque e,
 * como decrement_stock (service role) não tem cláusula `>=`, deixa a baixa
 * negativar de vez.
 *
 * Quem hoje chega perto: variante-estoque-negativo-e-recusado-no-banco-viva.cjs
 * só derruba a CHECK da VARIAÇÃO (check_stock_increment_positivo); os testes de
 * balcão pedem 999 ou 999999 e são recusados no PRIMEIRO laço, nunca chegando
 * ao segundo nem à CHECK. Esta prova é o espelho da variante para o produto.
 *
 * CENÁRIOS (chamada como admin ATUAL, papel authenticated + JWT de admin, do
 * jeito do painel e do PDV; cada um num SAVEPOINT desfeito):
 *   A1  salvar_produto_com_grade com estoque = -1 -> 23514 na constraint
 *       check_estoque_positivo; nome, versão (ultima_atualizacao), estoque e
 *       variações ficam EXATAMENTE como antes
 *   A2  CONTROLE: estoque 0 salva (nome novo, estoque 0). A versão não é afirmada
 *       aqui: dentro da transação desfeita now() é um só, então ela não avança
 *   B1  registrar_venda_presencial com a MESMA linha repetida em p_itens
 *       (produto simples, qty 1 cada, estoque 1): o primeiro laço deixa passar
 *       cada linha isolada; a venda é recusada 22023 'Estoque insuficiente'
 *   B2  essa recusa não deixa NADA: estoque continua 1, nenhum pedido, item,
 *       histórico, pagamento ou nota nasce
 *   B3  CONTROLES: a mesma linha repetida com estoque 2 vende (estoque -> 0, um
 *       pedido com 2 itens); a última unidade numa linha só vende (1 -> 0)
 *
 * Por que B1 e B2 são separados: se alguém tirar só o `>=` do UPDATE, a CHECK
 * ainda segura o estoque em 0 (B2 fica verde: nada é gravado) mas a recusa
 * deixa de ser a mensagem da loja e vira um 23514 cru (B1 fica vermelho). Só
 * tirando AS DUAS redes a venda passa e o estoque vai a -1 (B2 vermelho).
 *
 * NÃO coberto aqui: venda de variação (stock_increment) -> variante-estoque-
 * negativo-e-recusado-no-banco-viva.cjs e a-venda-de-balcao-so-vende-variacao-
 * valida-e-produto-ativo-viva.cjs; a baixa da venda ONLINE -> as provas de
 * estoque da compra.
 *
 * MUTANTES: MUTANTE_R122C=<nome> troca UM trecho (ou o par de redes) dentro da
 * transação desfeita e roda os cenários; a execução TEM de ficar vermelha, no
 * cenário que o nome promete, e os cenários de `verde` TÊM de continuar
 * verdes. Nome desconhecido é ERRO.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-estoque-do-produto-nunca-fica-negativo-viva.cjs
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
  "Prova viva: o estoque do produto nunca fica negativo no banco (rpc-ci)";
const RPC_BALCAO =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid,numeric)";
const ADMIN = "e122c000-0000-4000-8000-0000000000f1";
const CHECK = "check_estoque_positivo";
const DROP_CHECK = `ALTER TABLE public.produtos DROP CONSTRAINT ${CHECK}`;

// ---------------------------------------------------------------- mutantes
// `sql` roda direto; `de`/`para` trocam UM trecho EXATO do corpo vivo da
// `funcao` (cada `de` aparece 1x). `espera` = cenários onde TEM de ficar
// vermelho; `verde` = cenários que TÊM de continuar verdes (o que a outra rede
// ainda segura).
const SEGUNDA_TRAVA = "WHERE id = v_product_id AND estoque >= v_quantity;";
const MUTANTES = {
  "check-de-estoque-removida": {
    espera: ["A1"],
    verde: ["A2", "B1", "B2", "B3"],
    sql: DROP_CHECK,
  },
  "balcao-sem-a-segunda-trava": {
    // A CHECK ainda impede o -1 (B2 verde), mas a recusa vira 23514 cru.
    espera: ["B1"],
    verde: ["A1", "A2", "B2", "B3"],
    funcao: RPC_BALCAO,
    de: SEGUNDA_TRAVA,
    para: "WHERE id = v_product_id;",
  },
  "balcao-sem-a-segunda-trava-e-sem-check": {
    espera: ["A1", "B1", "B2"],
    verde: ["A2", "B3"],
    sql: DROP_CHECK,
    funcao: RPC_BALCAO,
    de: SEGUNDA_TRAVA,
    para: "WHERE id = v_product_id;",
  },
};

// ------------------------------------------------------------------ semente
const id = (n) => `e122c000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FX = {
  P_GRADE: id(1), // produto com uma variação (a grade do painel)
  V_GRADE: id(11),
  P_UM: id(2), // simples, estoque 1, preço 80
  P_DOIS: id(3), // simples, estoque 2, preço 80
};
const PRODUTOS = [FX.P_GRADE, FX.P_UM, FX.P_DOIS];

async function semear(c) {
  await c.query("GRANT USAGE ON SCHEMA auth TO authenticated");
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'admin@estoque122c.fixture.invalid', '{"role":"admin"}'::jsonb)`,
    [ADMIN],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role)
     VALUES ($1, 'Admin Estoque 122c', 'admin')
     ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
    [ADMIN],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES
       ($1, 'Camiseta Grade Fixture', 100, 20, true, 40, false),
       ($2, 'Caneca Ultima Fixture',   80,  1, true, 40, false),
       ($3, 'Caneca Dupla Fixture',    80,  2, true, 40, false)`,
    [FX.P_GRADE, FX.P_UM, FX.P_DOIS],
  );
  await c.query(
    `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active)
     VALUES ($1, $2, 'Tamanho', 'P', 5, true)`,
    [FX.V_GRADE, FX.P_GRADE],
  );
}

// ------------------------------------------------------------------ chamadas
/** Executa `fn` como admin ATUAL num SAVEPOINT; devolve {ok, rows} ou {ok:false, code, constraint, message}. */
async function comoAdmin(c, sql, params) {
  await c.query("SAVEPOINT chamada");
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
    const { rows } = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT chamada");
    return { ok: true, rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT chamada");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT chamada");
    return {
      ok: false,
      code: e.code,
      constraint: e.constraint,
      message: e.message,
    };
  }
}

const versao = async (c) =>
  (
    await c.query(
      // ::text de propósito: o Date do Node perde os microssegundos da versão.
      "SELECT ultima_atualizacao::text AS v FROM public.produtos WHERE id = $1",
      [FX.P_GRADE],
    )
  ).rows[0].v;

const salvar = async (c, produto) =>
  comoAdmin(
    c,
    "SELECT public.salvar_produto_com_grade($1::uuid, $2::timestamptz, $3::jsonb, $4::jsonb, $5::uuid[]) AS r",
    [FX.P_GRADE, await versao(c), JSON.stringify(produto), "[]", []],
  );

const vender = (c, itens) =>
  comoAdmin(
    c,
    `SELECT public.registrar_venda_presencial(
       $1::jsonb, 'cash', NULL, 'Cliente Fixture', NULL, 0::numeric, NULL,
       $2::uuid, NULL::numeric) AS r`,
    [JSON.stringify(itens), randomUUID()],
  );

/** O que o painel poderia mexer: o produto inteiro (to_jsonb) e as variações. */
async function fotoDoProduto(c) {
  return (
    await c.query(
      `SELECT to_jsonb(p) AS produto,
              (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id)
                 FROM public.product_variants v WHERE v.product_id = p.id) AS variantes
         FROM public.produtos p WHERE p.id = $1`,
      [FX.P_GRADE],
    )
  ).rows[0];
}

/** O que a venda poderia escrever: contagens da loja + estoque dos produtos. */
async function fotoDaVenda(c) {
  return (
    await c.query(
      `SELECT
         (SELECT count(*)::int FROM public.marketplace_orders) AS pedidos,
         (SELECT count(*)::int FROM public.marketplace_order_items) AS itens,
         (SELECT count(*)::int FROM public.marketplace_order_history) AS historico,
         (SELECT count(*)::int FROM public.marketplace_order_payment_history) AS pagamentos,
         (SELECT count(*)::int FROM public.marketplace_order_internal_notes) AS notas,
         (SELECT jsonb_object_agg(id::text, estoque) FROM public.produtos WHERE id = ANY($1::uuid[])) AS estoques`,
      [PRODUTOS],
    )
  ).rows[0];
}

const linhaRepetida = (produto, quantity = 1) => ({
  product_id: produto,
  quantity,
});

// ---------------------------------------------------------------- cenários
const CENARIOS = [];

CENARIOS.push({
  id: "A1",
  nome: "A1: salvar com estoque -1 -> 23514 em check_estoque_positivo, produto e variações intactos",
  corpo: async (c) => {
    const antes = await fotoDoProduto(c);
    const r = await salvar(c, {
      nome: "Nome que não pode persistir",
      estoque: -1,
    });
    assert.equal(
      r.ok,
      false,
      "[A1] o painel gravou estoque -1 (a CHECK do produto não segurou)",
    );
    assert.equal(r.code, "23514", `[A1] código (${r.message})`);
    assert.equal(r.constraint, CHECK, "[A1] constraint");
    assert.deepEqual(
      await fotoDoProduto(c),
      antes,
      "[A1] a recusa deixou nome, versão, estoque ou variações alterados",
    );
  },
});

CENARIOS.push({
  id: "A2",
  nome: "A2: controle — estoque 0 salva (nome novo, estoque 0)",
  corpo: async (c) => {
    const r = await salvar(c, { nome: "Nome salvo com zero", estoque: 0 });
    assert.equal(r.ok, true, `[A2] estoque 0 foi recusado: ${r.message}`);
    const depois = await fotoDoProduto(c);
    assert.equal(depois.produto.nome, "Nome salvo com zero", "[A2] nome");
    assert.equal(depois.produto.estoque, 0, "[A2] estoque");
  },
});

CENARIOS.push({
  id: "B1",
  nome: "B1: a mesma linha repetida (qty 1 + 1, estoque 1) -> 22023 'Estoque insuficiente'",
  corpo: async (c) => {
    const r = await vender(c, [linhaRepetida(FX.P_UM), linhaRepetida(FX.P_UM)]);
    assert.equal(
      r.ok,
      false,
      "[B1] a venda foi GRAVADA: vendeu 2 de um produto com 1 em estoque",
    );
    assert.equal(
      r.code,
      "22023",
      `[B1] código — a recusa tem de ser da loja, não da CHECK crua (${r.message})`,
    );
    assert.match(
      r.message,
      /^Estoque insuficiente para o produto Caneca Ultima Fixture$/,
      "[B1] mensagem",
    );
  },
});

CENARIOS.push({
  id: "B2",
  nome: "B2: a recusa não deixa nada — estoque continua 1, nenhum pedido, item, histórico, pagamento ou nota",
  corpo: async (c) => {
    const antes = await fotoDaVenda(c);
    assert.equal(antes.estoques[FX.P_UM], 1, "[B2] a semente tem estoque 1");
    const r = await vender(c, [linhaRepetida(FX.P_UM), linhaRepetida(FX.P_UM)]);
    assert.equal(r.ok, false, "[B2] a venda foi GRAVADA");
    assert.deepEqual(
      await fotoDaVenda(c),
      antes,
      "[B2] a recusa deixou estoque, pedido, item, histórico, pagamento ou nota alterados",
    );
    const { rows } = await c.query(
      "SELECT estoque FROM public.produtos WHERE id = $1",
      [FX.P_UM],
    );
    assert.equal(rows[0].estoque, 1, "[B2] estoque continua 1 (nunca -1)");
  },
});

CENARIOS.push({
  id: "B3",
  nome: "B3: controles — a mesma linha repetida com estoque 2 vende (2 -> 0); a última unidade numa linha só vende (1 -> 0)",
  corpo: async (c) => {
    const dupla = await vender(c, [
      linhaRepetida(FX.P_DOIS),
      linhaRepetida(FX.P_DOIS),
    ]);
    assert.equal(
      dupla.ok,
      true,
      `[B3] venda legítima recusada: ${dupla.message}`,
    );
    assert.equal(dupla.rows[0].r.items.length, 2, "[B3] dois itens");
    const ultima = await vender(c, [linhaRepetida(FX.P_UM)]);
    assert.equal(
      ultima.ok,
      true,
      `[B3] última unidade recusada: ${ultima.message}`,
    );
    const depois = await fotoDaVenda(c);
    assert.equal(depois.estoques[FX.P_DOIS], 0, "[B3] estoque do dois");
    assert.equal(depois.estoques[FX.P_UM], 0, "[B3] estoque do um");
    assert.equal(depois.pedidos, 2, "[B3] dois pedidos");
    assert.equal(depois.itens, 3, "[B3] três itens");
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R122C='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  if (m.sql) await c.query(m.sql);
  if (m.de) {
    const ler = async () =>
      (
        await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
          m.funcao,
        ])
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
  }
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), fixture, e cada cenário num
 * SAVEPOINT. Erro que não é de asserção (SQL, conexão) sobe: é do teste.
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
  const nomeMutante = process.env.MUTANTE_R122C || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R122C='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
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
      const quebrou = (r.mutante.verde || []).filter((cid) =>
        r.falhou.some((f) => f.id === cid),
      );
      if (quebrou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} derrubou [${quebrou.join(", ")}], que deveriam seguir verdes (a outra rede ainda segura)`,
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
        "O estoque do produto pode ficar negativo (ou a recusa não é a da loja) — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[estoque-nunca-negativo] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
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
