"use strict";

/**
 * Prova VIVA da migration 20261395100000 (a grade antiga nao ressuscita variacao excluida: `salvar_produto_com_grade` PULA o id de
 * variacao que nao existe em lugar nenhum, em vez de reinseri-lo com o mesmo id), num Postgres EFEMERO local, sem rede, com os
 * papeis de verdade. Esqueleto de migration em `prova-de-troca-de-corpo.cjs`.
 *
 *  ANTES      controle: a variacao EXCLUIDA por outra pessoa renasce quando a tela velha salva a grade (e a que esta ao mesmo tempo em
 *             p_apagar e em p_variantes tambem): o defeito.
 *  DEPOIS     nao renasce; a existente atualiza (inclusive o estoque, com a versao conferida); a de OUTRO produto segue recusada
 *             (22023); a nova (sem id) segue inserindo; a que esta numa venda segue indo para `recusadas`; mesma resposta (as tres chaves);
 *             o produto salva junto; so o admin ATUAL chama (cliente 42501, anon sem EXECUTE).
 *  DIFEREN.   no roteiro que nao envolve id inexistente, o estado final e a resposta sao IDENTICOS aos do corpo antigo.
 *  CONCORR.   duas conexoes reais com COMMIT: a exclusao em andamento segura a trava e o salvamento ESPERA; depois da exclusao
 *             commitada, o salvamento da grade velha nao traz a variacao de volta.
 *  MUTANTES   cada regra sabotada deixa a verificacao certa VERMELHA.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-grade-antiga-nao-ressuscita-variacao-excluida-viva.cjs
 */

const assert = require("node:assert/strict");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const { criar } = require("./prova-de-troca-de-corpo.cjs");

const ARQ =
  "20261395100000_a_grade_antiga_nao_ressuscita_variacao_excluida.sql";
const FN = "salvar_produto_com_grade";
const SIG =
  "public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])";
const SQL_RPC =
  "SELECT public.salvar_produto_com_grade($1::uuid, $2::timestamptz, $3::jsonb, $4::jsonb, $5::uuid[]) AS r";

const BLOCO_NOVO =
  "      -- 20261395100000: variacao que alguem excluiu depois que esta tela abriu NAO renasce. Um id que nao existe em lugar nenhum\n" +
  "      -- so chega aqui como reenvio de uma grade antiga (a tela nunca manda id de variacao nova: manda sem id, e o banco sorteia o\n" +
  "      -- proprio). O INSERT abaixo, com esse id, trazia a variacao de volta com o estoque da tela velha. Segue para a proxima.\n" +
  "      CONTINUE;\n";
/** Desfaz a troca (escrita a parte): tira o bloco novo. */
function inverso(corpo) {
  assert.equal(corpo.split(BLOCO_NOVO).length - 1, 1, "bloco novo nao e unico");
  return corpo.replace(BLOCO_NOVO, () => "");
}

const ESTRAGOS = [];
const T = criar({
  arq: ARQ,
  origem: {
    arquivo: "20261352000000_o_produto_e_a_grade_salvam_numa_transacao_so.sql",
  },
  fn: FN,
  delim: "$function$",
  sig: SIG,
  hAntes: "09c2a4b5724acbe46fb2c2e758e96c8f",
  hDepois: "10fc8c0f1e305666b39e5f1f383815e2",
  volatil: "v",
  aclDeSempre: [
    "authenticated=X/postgres",
    "postgres=X/postgres",
    "service_role=X/postgres",
  ],
  consulta: {
    a: "109a-conferir-a-grade-antiga-nao-ressuscita-variacao-excluida-aplicado",
    b: "109b-antes-a-grade-antiga-nao-ressuscita-variacao-excluida-base-vigente",
    rotulos: [
      "controle: funcoes de public visiveis a este papel",
      "salvar_produto_com_grade: corpo exato (md5)",
      "salvar_produto_com_grade: o corpo traz a recusa de ressuscitar variacao (uma vez)",
      "salvar_produto_com_grade: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)",
    ],
    fixos: [
      "controle: funcoes de public visiveis a este papel",
      "salvar_produto_com_grade: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)",
    ],
    attr: "salvar_produto_com_grade: uma assinatura so, atributos e EXECUTE de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno jsonb; authenticated e service_role, sem anon e sem PUBLIC)",
  },
  inverso,
  estragosDaConsulta: ESTRAGOS,
});
ESTRAGOS.push([
  T.decl(
    T.NOVA,
    T.NOVA.corpo.replace(
      "      -- 20261395100000: variacao que alguem excluiu",
      () =>
        "      -- 20261395100000: variacao que alguem excluiu (copia)\n      -- 20261395100000: variacao que alguem excluiu",
    ),
  ),
  "salvar_produto_com_grade: o corpo traz a recusa de ressuscitar variacao (uma vez)",
]);

// ---------------------------------------------------------------------------
// Semente
// ---------------------------------------------------------------------------
const ADMIN = "7e395100-0000-4000-8000-0000000000a1";
const CLIENTE = "7e395100-0000-4000-8000-0000000000c1";
const P = "7e395100-0000-4000-8000-000000000001"; // o produto editado
const Q = "7e395100-0000-4000-8000-000000000002"; // outro produto
const V1 = "7e395100-0000-4000-8000-000000000011";
const V2 = "7e395100-0000-4000-8000-000000000012";
const V3 = "7e395100-0000-4000-8000-000000000013";
const W = "7e395100-0000-4000-8000-000000000021"; // variacao do OUTRO produto
const FANTASMA = "7e395100-0000-4000-8000-0000000000ff"; // id que nunca existiu em lugar nenhum

async function semear(c = T.C) {
  await c.query(
    `INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
       ($1,'admin395b@fixture.test','{"role":"admin"}'),($2,'cliente395b@fixture.test','{}')
     ON CONFLICT DO NOTHING`,
    [ADMIN, CLIENTE],
  );
  await c.query(
    `INSERT INTO public.profiles(id,full_name,role) VALUES
       ($1,'Admin fixture','admin'),($2,'Cliente fixture','customer')
     ON CONFLICT DO NOTHING`,
    [ADMIN, CLIENTE],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES
       ($1,'Produto editado 395b',100,10,true,40,false),($2,'Outro produto 395b',100,10,true,40,false)
     ON CONFLICT (id) DO NOTHING`,
    [P, Q],
  );
  await c.query(
    `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active, sku) VALUES
       ($1,$4,'Tamanho','P',50,true,'SKU395B-1'),($2,$4,'Tamanho','M',50,true,'SKU395B-2'),
       ($3,$4,'Tamanho','G',50,true,'SKU395B-3'),($5,$6,'Cor','Azul',50,true,'SKU395B-W')
     ON CONFLICT (id) DO NOTHING`,
    [V1, V2, V3, P, W, Q],
  );
}

/** A "tela velha": a grade que estava aberta, com id de cada variacao (como `variacoesParaBanco` manda), sem estoque. */
const telaVelha = (extra = {}) => [
  {
    id: V1,
    name: "Tamanho",
    value: "P",
    sku: "SKU395B-1",
    active: true,
    ...extra,
  },
  {
    id: V2,
    name: "Tamanho",
    value: "M",
    sku: "SKU395B-2",
    active: true,
    ...extra,
  },
  {
    id: V3,
    name: "Tamanho",
    value: "G",
    sku: "SKU395B-3",
    active: true,
    ...extra,
  },
];

/** Chama a RPC como `papel` (admin atual por padrao), dentro de um savepoint. Devolve {r} ou {codigo, erro}. */
async function salvar({
  papel = "admin",
  base = null,
  produto = {},
  variantes = [],
  apagar = [],
  produtoId = P,
} = {}) {
  const C = T.C;
  await C.query("SAVEPOINT salvar");
  try {
    await C.query(
      "SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
      [
        papel === "cliente" ? CLIENTE : ADMIN,
        JSON.stringify(
          papel === "cliente"
            ? { role: "authenticated" }
            : { role: "authenticated", app_metadata: { role: "admin" } },
        ),
      ],
    );
    await C.query(
      `SET LOCAL ROLE ${papel === "anon" ? "anon" : "authenticated"}`,
    );
    const r = (
      await C.query(SQL_RPC, [
        produtoId,
        base,
        JSON.stringify(produto),
        JSON.stringify(variantes),
        apagar,
      ])
    ).rows[0].r;
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT salvar");
    return { r };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT salvar");
    await C.query("RESET ROLE");
    return { codigo: e.code, erro: e.message };
  }
}
const grade = async (produto = P) =>
  (
    await T.C.query(
      "SELECT id, name, value, sku, active, stock_increment, price_override FROM public.product_variants WHERE product_id = $1 ORDER BY id",
      [produto],
    )
  ).rows;
const idsDa = async (produto = P) => (await grade(produto)).map((v) => v.id);
const versao = async (produto = P) =>
  (
    await T.C.query(
      "SELECT ultima_atualizacao::text AS v FROM public.produtos WHERE id = $1",
      [produto],
    )
  ).rows[0].v;

const CHECKS = {
  /** O defeito: a tela velha salva a grade e a variacao que outra pessoa excluiu NAO volta. */
  async naoRenasce() {
    const f = [];
    await T.C.query("DELETE FROM public.product_variants WHERE id = $1", [V2]); // outra lojista excluiu a M
    const { r, erro } = await salvar({
      produto: { nome: "Nome novo 395b" },
      variantes: telaVelha().map((v) => ({ ...v, name: "Tam" })),
    });
    if (!r) return [`naoRenasce: erro ${erro}`];
    const ids = await idsDa();
    if (ids.includes(V2)) f.push("naoRenasce: a variacao excluida RENASCEU");
    if (JSON.stringify(ids) !== JSON.stringify([V1, V3]))
      f.push(`naoRenasce: ids ${JSON.stringify(ids)} (esperado V1 e V3)`);
    const g = await grade();
    if (!g.every((v) => v.name === "Tam"))
      f.push("naoRenasce: as variacoes que existem NAO foram atualizadas");
    const nome = (
      await T.C.query("SELECT nome FROM public.produtos WHERE id = $1", [P])
    ).rows[0].nome;
    if (nome !== "Nome novo 395b")
      f.push("naoRenasce: o produto nao foi salvo junto");
    return f;
  },
  /** Id que nunca existiu em lugar nenhum tambem e' pulado (nada e' inserido), com estoque no payload e a versao conferida. */
  async fantasma() {
    const f = [];
    const antes = JSON.stringify(await grade());
    const r1 = await salvar({
      base: await versao(),
      variantes: [
        {
          id: FANTASMA,
          name: "Tamanho",
          value: "XG",
          sku: "SKU395B-XG",
          active: true,
          stock_increment: 999,
        },
      ],
    });
    if (!r1.r) f.push(`fantasma: erro ${r1.erro}`);
    if (JSON.stringify(await grade()) !== antes)
      f.push("fantasma: a grade mudou");
    const n = (
      await T.C.query(
        "SELECT count(*)::int AS n FROM public.product_variants WHERE id = $1 OR sku = 'SKU395B-XG'",
        [FANTASMA],
      )
    ).rows[0].n;
    if (n !== 0) f.push("fantasma: o id/sku fantasma foi gravado");
    return f;
  },
  /** A mesma variacao em p_apagar e em p_variantes: fica apagada (antes: apagava e recriava). */
  async apagarEReenviar() {
    const f = [];
    const { r, erro } = await salvar({
      variantes: telaVelha(),
      apagar: [V1],
    });
    if (!r) return [`apagarEReenviar: erro ${erro}`];
    if (!r.apagadas.includes(V1))
      f.push(`apagarEReenviar: apagadas ${JSON.stringify(r.apagadas)}`);
    if ((await idsDa()).includes(V1))
      f.push("apagarEReenviar: a apagada RENASCEU");
    return f;
  },
  /** A que existe atualiza como sempre, inclusive o estoque (com a versao conferida). */
  async existenteAtualiza() {
    const f = [];
    const { r, erro } = await salvar({
      base: await versao(),
      variantes: [
        {
          id: V1,
          name: "Tamanho",
          value: "PP",
          sku: "SKU395B-1N",
          active: false,
          price_override: 77.5,
          stock_increment: 33,
        },
      ],
    });
    if (!r) return [`existenteAtualiza: erro ${erro}`];
    const v = (await grade()).find((x) => x.id === V1);
    if (
      !v ||
      v.value !== "PP" ||
      v.sku !== "SKU395B-1N" ||
      v.active !== false ||
      Number(v.price_override) !== 77.5 ||
      v.stock_increment !== 33
    )
      f.push(`existenteAtualiza: ${JSON.stringify(v)}`);
    return f;
  },
  /** Variacao de OUTRO produto segue recusada (22023) e nada e' gravado. */
  async outroProduto() {
    const f = [];
    const antes = JSON.stringify([await grade(), await grade(Q)]);
    const x = await salvar({
      produto: { nome: "Nao pode gravar" },
      variantes: [
        { id: V1, name: "Tamanho", value: "ALTERADA", active: true },
        { id: W, name: "Cor", value: "Roubada", active: true },
      ],
    });
    if (x.codigo !== "22023")
      f.push(`outroProduto: codigo ${x.codigo ?? "passou"} (esperado 22023)`);
    if (x.erro && !/pertence a outro produto/.test(x.erro))
      f.push(`outroProduto: mensagem ${x.erro}`);
    if (JSON.stringify([await grade(), await grade(Q)]) !== antes)
      f.push("outroProduto: algo foi gravado");
    return f;
  },
  /** Variacao nova (sem id) segue inserindo, junto da pulada e da atualizada. */
  async nova() {
    const f = [];
    const { r, erro } = await salvar({
      variantes: [
        {
          id: V1,
          name: "Tamanho",
          value: "P2",
          sku: "SKU395B-1",
          active: true,
        },
        {
          id: FANTASMA,
          name: "Tamanho",
          value: "XG",
          sku: "SKU395B-XG",
          active: true,
        },
        {
          name: "Tamanho",
          value: "NOVA",
          sku: "SKU395B-NOVA",
          active: true,
          stock_increment: 5,
        },
      ],
    });
    if (!r) return [`nova: erro ${erro}`];
    const g = await grade();
    if (g.length !== 4)
      f.push(`nova: ${g.length} variacoes (esperado 4: V1, V2, V3 e a nova)`);
    const nova = g.find((x) => x.sku === "SKU395B-NOVA");
    if (!nova || nova.stock_increment !== 5 || nova.id === FANTASMA)
      f.push(`nova: ${JSON.stringify(nova)}`);
    if (g.some((x) => x.id === FANTASMA))
      f.push("nova: o fantasma foi gravado");
    if (g.find((x) => x.id === V1)?.value !== "P2")
      f.push("nova: a existente nao foi atualizada");
    return f;
  },
  /** A resposta continua com as TRES chaves de sempre. */
  async resposta() {
    const f = [];
    const { r, erro } = await salvar({
      variantes: [{ id: FANTASMA, name: "x", value: "y", active: true }],
      apagar: [V3],
    });
    if (!r) return [`resposta: erro ${erro}`];
    if (
      JSON.stringify(Object.keys(r).sort()) !==
      JSON.stringify(["apagadas", "recusadas", "ultima_atualizacao"])
    )
      f.push(`resposta: chaves ${JSON.stringify(Object.keys(r))}`);
    if (
      JSON.stringify(r.apagadas) !== JSON.stringify([V3]) ||
      r.recusadas.length !== 0
    )
      f.push(`resposta: ${JSON.stringify(r)}`);
    return f;
  },
  /** A variacao que esta numa venda segue indo para `recusadas` (FK), e a pulada nao atrapalha. */
  async comVenda() {
    const f = [];
    await T.C.query(
      `INSERT INTO public.marketplace_orders (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,canal,payment_method,payment_status)
       VALUES ('7e395100-0000-4000-8000-0000000000d1',$1,'Venda 395b','{}',100,100,0,'delivered','online','online','pago')`,
      [CLIENTE],
    );
    await T.C.query(
      `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
       VALUES ('7e395100-0000-4000-8000-0000000000d1',$1,$2,'Item 395b',1,100)`,
      [P, V3],
    );
    const { r, erro } = await salvar({
      variantes: [{ id: FANTASMA, name: "x", value: "y", active: true }],
      apagar: [V3, V1],
    });
    if (!r) return [`comVenda: erro ${erro}`];
    if (
      JSON.stringify(r.recusadas) !== JSON.stringify([V3]) ||
      JSON.stringify(r.apagadas) !== JSON.stringify([V1])
    )
      f.push(`comVenda: ${JSON.stringify(r)}`);
    if (!(await idsDa()).includes(V3))
      f.push("comVenda: a variacao vendida sumiu");
    return f;
  },
  /** A porta: so o admin ATUAL; anon sem EXECUTE. */
  async porta() {
    const f = [];
    const x = await salvar({ papel: "cliente", variantes: telaVelha() });
    if (x.codigo !== "42501")
      f.push(`porta(cliente): ${x.codigo ?? "passou"} (esperado 42501)`);
    const a = await salvar({ papel: "anon", variantes: telaVelha() });
    if (a.codigo !== "42501")
      f.push(`porta(anon): ${a.codigo ?? "passou"} (esperado 42501)`);
    return f;
  },
};

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe)
// ---------------------------------------------------------------------------
T.prova(
  "ANTES: com o corpo antigo (o da 20261352, byte a byte) a variacao EXCLUIDA por outra pessoa RENASCE quando a tela velha salva a grade (e a que esta em p_apagar e em p_variantes tambem; e um id que nunca existiu e' criado com o mesmo id)",
  () =>
    T.emTransacao(async () => {
      assert.equal(await T.prosrcVivo(), T.ANTIGA.corpo);
      await semear();
      await T.C.query("DELETE FROM public.product_variants WHERE id = $1", [
        V2,
      ]);
      const a = await salvar({ variantes: telaVelha() });
      assert.ok(a.r, a.erro);
      assert.deepEqual(
        await idsDa(),
        [V1, V2, V3],
        "a excluida devia renascer (o defeito)",
      );
      // A que foi apagada e reenviada na mesma chamada volta.
      const b = await salvar({ variantes: telaVelha(), apagar: [V1] });
      assert.ok(b.r, b.erro);
      assert.ok(
        (await idsDa()).includes(V1),
        "apagada e reenviada devia renascer (o defeito)",
      );
      // E um id que nunca existiu e' criado exatamente com ele.
      const c = await salvar({
        variantes: [
          {
            id: FANTASMA,
            name: "x",
            value: "y",
            sku: "FANT395B",
            active: true,
          },
        ],
      });
      assert.ok(c.r, c.erro);
      assert.ok(
        (await idsDa()).includes(FANTASMA),
        "o fantasma devia ser criado (o defeito)",
      );
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------
T.prova(
  "DEPOIS: a excluida nao renasce (nem a reenviada em p_apagar, nem um id fantasma, nem com estoque no payload); a existente atualiza (estoque com a versao conferida); a de outro produto segue recusada; a nova (sem id) insere; a resposta tem as tres chaves; a vendida vai para recusadas; so o admin atual chama",
  async () => {
    const falhas = await T.todasAsVerificacoes(CHECKS, T.instalarNova, semear);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

T.prova(
  "DIFERENCIAL: no roteiro SEM id inexistente (atualizar, apagar, inserir, produto, estoque com a versao, outro produto, venda) a resposta e o estado final sao IDENTICOS nos dois corpos",
  async () => {
    const roteiro = async (estado) =>
      T.emTransacao(
        async () => {
          await semear();
          const saida = [];
          const passo = async (args) => {
            const x = await salvar(args);
            saida.push(
              x.r
                ? { apagadas: x.r.apagadas, recusadas: x.r.recusadas }
                : { codigo: x.codigo },
            );
          };
          await passo({
            produto: { nome: "Roteiro 395b", preco_venda: 123 },
            variantes: telaVelha().map((v) => ({ ...v, name: "Tam" })),
          });
          await passo({
            base: await versao(),
            produto: { estoque: 8 },
            variantes: [
              {
                id: V1,
                name: "Tamanho",
                value: "P",
                active: true,
                stock_increment: 41,
              },
            ],
          });
          await passo({
            variantes: [
              {
                name: "Tamanho",
                value: "NOVA",
                sku: "SKU395B-ROT",
                active: true,
                stock_increment: 3,
              },
            ],
          });
          await passo({
            variantes: [{ id: W, name: "Cor", value: "Roubada", active: true }],
          });
          await passo({ apagar: [V2] });
          await passo({ produto: { campo_invalido: 1 } });
          await passo({
            base: "2001-01-01T00:00:00Z",
            produto: { nome: "versao velha" },
          });
          const final = (
            await T.C.query(
              `SELECT (SELECT nome FROM public.produtos WHERE id = $1) AS nome,
                      (SELECT preco_venda::text FROM public.produtos WHERE id = $1) AS preco,
                      (SELECT estoque FROM public.produtos WHERE id = $1) AS estoque,
                      (SELECT jsonb_agg(jsonb_build_object('name', v.name, 'value', v.value, 'sku', v.sku, 'active', v.active, 'estoque', v.stock_increment, 'preco', v.price_override) ORDER BY v.sku) FROM public.product_variants v WHERE v.product_id = $1) AS grade`,
              [P],
            )
          ).rows[0];
          return { saida, final };
        },
        { estado },
      );
    const antes = await roteiro("antes");
    const depois = await roteiro("depois");
    assert.deepEqual(depois, antes, "o roteiro sem id inexistente mudou");
    assert.equal(depois.saida[3].codigo, "22023");
    assert.equal(depois.saida[6].codigo, "PRD01");
  },
);

// Duas conexoes reais com COMMIT no clone descartavel: a exclusao em andamento segura a trava e o salvamento espera; depois do COMMIT
// da exclusao, a grade velha NAO traz a variacao de volta. Tudo e' apagado no fim.
T.prova(
  "CONCORRENCIA: com a exclusao da variacao em andamento (outra conexao, COMMIT depois), o salvamento da grade velha ESPERA a trava e termina sem ressuscitar; com o corpo antigo ressuscita (controle)",
  async () => {
    const url = lerDatabaseUrlEfemera();
    const novo = async () => {
      const c = new Client({ connectionString: url });
      await c.connect();
      return c;
    };
    const rodada = async (corpoNovo) => {
      const [a, b, mon] = [await novo(), await novo(), await novo()];
      try {
        await semear(mon);
        if (corpoNovo) await mon.query(T.MIGRATION);
        else await mon.query(T.decl(T.ANTIGA));
        await a.query("BEGIN");
        await a.query("DELETE FROM public.product_variants WHERE id = $1", [
          V2,
        ]); // a excluiu a M e ainda nao commitou
        const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
        await b.query("BEGIN");
        await b.query(
          "SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
          [
            ADMIN,
            JSON.stringify({
              role: "authenticated",
              app_metadata: { role: "admin" },
            }),
          ],
        );
        await b.query("SET LOCAL ROLE authenticated");
        const emVoo = b
          .query(SQL_RPC, [
            P,
            null,
            JSON.stringify({}),
            JSON.stringify(telaVelha()),
            [],
          ])
          .then(
            (r) => ({ ok: r.rows[0].r }),
            (e) => ({ codigo: e.code }),
          );
        let esperou = false;
        for (let i = 0; i < 100 && !esperou; i++) {
          const w = await mon.query(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
            [pidB],
          );
          esperou = w.rows[0]?.wait_event_type === "Lock";
          if (!esperou) await new Promise((r) => setTimeout(r, 50));
        }
        assert.ok(
          esperou,
          "o salvamento devia ESPERAR a trava da exclusao em andamento",
        );
        await a.query("COMMIT"); // a exclusao termina
        const fim = await emVoo;
        assert.ok(fim.ok, JSON.stringify(fim));
        await b.query("COMMIT");
        return (
          await mon.query(
            "SELECT id FROM public.product_variants WHERE product_id = $1 ORDER BY id",
            [P],
          )
        ).rows.map((x) => x.id);
      } finally {
        await mon
          .query(
            "DELETE FROM public.product_variants WHERE product_id IN ($1,$2)",
            [P, Q],
          )
          .catch(() => {});
        await mon
          .query("DELETE FROM public.produtos WHERE id IN ($1,$2)", [P, Q])
          .catch(() => {});
        await mon
          .query("DELETE FROM public.profiles WHERE id IN ($1,$2)", [
            ADMIN,
            CLIENTE,
          ])
          .catch(() => {});
        await mon
          .query("DELETE FROM auth.users WHERE id IN ($1,$2)", [ADMIN, CLIENTE])
          .catch(() => {});
        await Promise.all([a, b, mon].map((x) => x.end().catch(() => {})));
      }
    };
    const antes = await rodada(false);
    assert.deepEqual(
      antes,
      [V1, V2, V3],
      "controle: o corpo antigo devia ressuscitar a M",
    );
    const depois = await rodada(true);
    assert.deepEqual(depois, [V1, V3], "o corpo novo nao pode ressuscitar a M");
    await T.C.query(T.MIGRATION); // deixa o clone no estado novo
  },
);

// ---------------------------------------------------------------------------
// MUTANTES
// ---------------------------------------------------------------------------
const trocar = (de, para) => (corpo) => {
  assert.equal(
    corpo.split(de).length - 1,
    1,
    `a ancora do mutante nao e unica: ${de}`,
  );
  return corpo.replace(de, () => para);
};
T.mutantes(
  {
    "sem o CONTINUE novo (o corpo antigo)": {
      aplica: inverso,
      vermelho: ["naoRenasce", "fantasma", "apagarEReenviar"],
    },
    "recusa com erro em vez de pular (RAISE no lugar do CONTINUE)": {
      aplica: trocar(
        "      CONTINUE;\n    END IF;\n    INSERT INTO public.product_variants",
        "      RAISE EXCEPTION 'Variacao excluida: %', v_id USING ERRCODE = '22023';\n    END IF;\n    INSERT INTO public.product_variants",
      ),
      vermelho: ["naoRenasce"],
    },
    "pula tambem a variacao de OUTRO produto (sem a recusa 22023)": {
      aplica: trocar(
        "IF EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_id) THEN",
        "IF FALSE THEN",
      ),
      vermelho: ["outroProduto"],
    },
    "a existente deixa de pular: cai no CONTINUE sem atualizar? (sem o CONTINUE do UPDATE)":
      {
        aplica: trocar("IF FOUND THEN CONTINUE; END IF;", ""),
        vermelho: ["existenteAtualiza"],
      },
    "pula tambem a variacao nova (sem id)": {
      aplica: trocar("IF v_id IS NOT NULL THEN", "IF TRUE THEN"),
      vermelho: ["nova"],
    },
  },
  CHECKS,
  semear,
);

T.main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
