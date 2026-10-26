"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/**
 * PROVA VIVA da migration 20261391200000_o_financeiro_descreve_a_venda_do_balcao_como_o_app_mostra.sql
 * (public.fin__movimentos, coluna descricao) contra o Postgres EFEMERO com as migrations aplicadas do zero
 * (rpc-ci, job do dinheiro). Nunca banco de loja.
 *
 * O que prova:
 *  (1) Os textos novos: numero do pedido = 6 ULTIMOS caracteres do id em maiusculas (igual a
 *      src/lib/numero-do-pedido.ts); venda do balcao sem cliente sem o nome repetido; venda do balcao anulada pelo
 *      app (a marca 'desfeito' recebido_na_entrega -> estornado que a anular_venda_presencial grava) com descricao
 *      propria; estorno feito fora do app (balcao ou online, inclusive com "desfazer recebimento" antes) continua
 *      "Estorno registrado fora do app"; estorno do app (order_refunds) e reembolso de devolucao.
 *  (2) So o TEXTO muda: com a mesma fixture, todas as linhas e todas as colunas MENOS descricao sao identicas no
 *      corpo novo e no corpo anterior (o rollback), e a soma por tipo e por conta tambem.
 *  (3) Mutantes (8 primeiros caracteres; sem o NULLIF do nome padrao; marca sem o payment_status_depois; marca em
 *      qualquer canal; mexer no valor) deixam a prova vermelha; o corpo anterior (rollback) tambem.
 *  (4) Reaplicar 2x deixa OID, dono, ACL, atributos e texto iguais; rollback devolve o corpo da 20261177000000 byte
 *      a byte; o segundo rollback recusa; reaplicar depois do rollback volta.
 *  (5) Pre-voo recusa sem escrever: corpo desconhecido, ACL aberta (authenticated), sobrecarga.
 *  (6) Consultas 100a/100b leem o estado certo nos dois sentidos, com o rol fechado do conferir-banco.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-financeiro-descreve-a-venda-do-balcao-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME =
  "20261391200000_o_financeiro_descreve_a_venda_do_balcao_como_o_app_mostra.sql";
const NOME_ANTERIOR = "20261177000000_o_financeiro_da_loja_nasce.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA));
const corpoDe = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.fin__movimentos\(p_inicio date, p_fim date\)[\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_ANTERIOR}`));
const CORPO_NOVO = corpoDe(migration);
const HASH_ANTES = "ec01f5e2eff4f132aaf075951484ea8a";
const HASH_NOVO = "26473edd94ad6547d95de43433088304";
const ASSINATURA = "public.fin__movimentos(date,date)";
const C100A = "100a-conferir-o-financeiro-descreve-a-venda-do-balcao-aplicado";
const C100B = "100b-antes-o-financeiro-descreve-a-venda-do-balcao-base-vigente";

// Pedidos da fixture: o sufixo de 6 caracteres e' o que a lojista ve; o prefixo de 8 e' o que o corpo antigo mostrava.
const ID = {
  balcaoSemCliente: "c35ce4dd-1391-4000-8000-0000003884be",
  balcaoComCliente: "c35ce4dd-1391-4000-8000-00000000a1b2",
  online: "c35ce4dd-1391-4000-8000-00000000c3d4",
  balcaoAnulado: "c35ce4dd-1391-4000-8000-00000000e5f6",
  balcaoEstornadoFora: "c35ce4dd-1391-4000-8000-0000000a7b8c",
  onlineEstornadoFora: "c35ce4dd-1391-4000-8000-0000000d9e0f",
  balcaoDesfeitoEFora: "c35ce4dd-1391-4000-8000-000000001a2b",
  onlineComEstornoDoApp: "c35ce4dd-1391-4000-8000-000000003c4d",
  onlineComMarcaNaoBalcao: "c35ce4dd-1391-4000-8000-000000005e6f",
};
const REFUND = "c35ce4dd-1391-4000-8000-00000000ffff";
const DEVOLUCAO = "c35ce4dd-1391-4000-8000-00000000dddd";
const num6 = (id) => id.slice(-6).toUpperCase();

async function funcao(c) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${ASSINATURA}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso391e");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso391e");
    await c.query("RELEASE SAVEPOINT caso391e");
  }
}
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa391e");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa391e");
    await c.query("RELEASE SAVEPOINT recusa391e");
  }
}
const CABECALHO_DA_FUNCAO = migration.match(
  /CREATE OR REPLACE FUNCTION public\.fin__movimentos\(p_inicio date, p_fim date\)[\s\S]*?\nAS \$\$/,
)[0];
const trocarCorpo = (c, corpo) => c.query(`${CABECALHO_DA_FUNCAO}${corpo}$$;`);

async function fixture(c) {
  // Fixture como dono da conexao, sem gatilhos nem chaves estrangeiras (so interessam as linhas que o Financeiro le).
  await c.query("SET LOCAL session_replication_role = replica");
  const pedido = (id, o) =>
    c.query(
      `INSERT INTO public.marketplace_orders
         (id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status,
          paid_at, pagamento_recebido_em, metodo_online, valor_estornado, estorno_manual_registrado_em, updated_at)
       VALUES ($1, $2, '{}'::jsonb, $3, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10, 0, $11::timestamptz,
               '2001-03-10T15:00:00Z')`,
      [
        id,
        o.nome,
        o.total,
        o.status,
        o.canal,
        o.forma,
        o.ps,
        o.pagoEm || null,
        o.recebidoEm || null,
        o.metodoOnline || null,
        o.estornoEm || null,
      ],
    );
  const historico = (id, acao, antes, depois) =>
    c.query(
      `INSERT INTO public.marketplace_order_payment_history (order_id, acao, payment_status_antes, payment_status_depois)
       VALUES ($1, $2, $3, $4)`,
      [id, acao, antes, depois],
    );
  const H = "2001-03-10T13:00:00Z";
  const E = "2001-03-10T14:00:00Z";
  await pedido(ID.balcaoSemCliente, {
    nome: "Venda no balcão",
    total: 30,
    status: "delivered",
    canal: "presencial",
    forma: "cash",
    ps: "recebido_na_entrega",
    recebidoEm: H,
  });
  await pedido(ID.balcaoComCliente, {
    nome: "  Maria Fictícia  ",
    total: 45.5,
    status: "delivered",
    canal: "presencial",
    forma: "pix",
    ps: "recebido_na_entrega",
    recebidoEm: H,
  });
  await pedido(ID.online, {
    nome: "João Fictício",
    total: 120,
    status: "processing",
    canal: "online",
    forma: "online",
    ps: "pago",
    pagoEm: H,
    metodoOnline: "pix",
  });
  // Anulada pelo app: exatamente o que anular_venda_presencial (20261204000000) deixa.
  await pedido(ID.balcaoAnulado, {
    nome: "Venda no balcão",
    total: 25,
    status: "cancelled",
    canal: "presencial",
    forma: "cash",
    ps: "estornado",
    recebidoEm: H,
    estornoEm: E,
  });
  await historico(ID.balcaoAnulado, "recebido", null, "recebido_na_entrega");
  await historico(
    ID.balcaoAnulado,
    "desfeito",
    "recebido_na_entrega",
    "estornado",
  );
  // Balcao estornado FORA do app ("Ja estornei"): nenhuma marca de anulacao.
  await pedido(ID.balcaoEstornadoFora, {
    nome: "Ana Fictícia",
    total: 60,
    status: "delivered",
    canal: "presencial",
    forma: "card",
    ps: "estornado",
    recebidoEm: H,
    estornoEm: E,
  });
  await historico(
    ID.balcaoEstornadoFora,
    "recebido",
    null,
    "recebido_na_entrega",
  );
  await pedido(ID.onlineEstornadoFora, {
    nome: "Bia Fictícia",
    total: 80,
    status: "delivered",
    canal: "online",
    forma: "online",
    ps: "estornado",
    pagoEm: H,
    metodoOnline: "credito",
    estornoEm: E,
  });
  // Balcao com "desfazer recebimento" (desfeito -> NULL) e depois estornado fora: NAO e' anulacao.
  await pedido(ID.balcaoDesfeitoEFora, {
    nome: "Venda no balcão",
    total: 15,
    status: "delivered",
    canal: "presencial",
    forma: "cash",
    ps: "estornado",
    recebidoEm: H,
    estornoEm: E,
  });
  await historico(
    ID.balcaoDesfeitoEFora,
    "desfeito",
    "recebido_na_entrega",
    null,
  );
  await historico(
    ID.balcaoDesfeitoEFora,
    "recebido",
    null,
    "recebido_na_entrega",
  );
  // Online com a mesma linha de historico que a anulacao (nao acontece hoje): continua estorno de fora (so balcao).
  await pedido(ID.onlineComMarcaNaoBalcao, {
    nome: "Caio Fictício",
    total: 70,
    status: "delivered",
    canal: "online",
    forma: "cash",
    ps: "estornado",
    pagoEm: H,
    estornoEm: E,
  });
  await historico(
    ID.onlineComMarcaNaoBalcao,
    "desfeito",
    "recebido_na_entrega",
    "estornado",
  );
  // Estorno do app (ledger order_refunds) concluido + reembolso manual de devolucao (no pedido estornado por fora:
  // o valor do estorno de fora desconta a devolucao, e o mutante que mexe no valor tem onde aparecer).
  await pedido(ID.onlineComEstornoDoApp, {
    nome: "Dani Fictícia",
    total: 90,
    status: "delivered",
    canal: "online",
    forma: "online",
    ps: "pago",
    pagoEm: H,
    metodoOnline: "pix",
  });
  await c.query(
    `INSERT INTO public.order_refunds (id, order_id, amount, motivo, status, concluido_em, solicitado_por)
     VALUES ($1, $2, 40, 'arrependimento', 'concluido', $3::timestamptz, 'lojista')`,
    [REFUND, ID.onlineComEstornoDoApp, E],
  );
  await c.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno, valor_itens,
        prazo_ate, politica, status, reembolso_manual, valor_reembolso, concluida_em)
     VALUES ($1, 'DV391E', $2, gen_random_uuid(), 'vicio', 'defeito', 'reembolso', 'local', 'entrega_na_loja', 10,
             DATE '2001-03-20', '{}'::jsonb, 'concluida', true, 10, $3::timestamptz)`,
    [DEVOLUCAO, ID.onlineEstornadoFora, E],
  );
  await c.query("SET LOCAL session_replication_role = origin");
}

// As linhas da fixture (janela de 2001: nenhum outro dado do clone entra).
async function linhas(c) {
  return (
    await c.query(
      `SELECT * FROM public.fin__movimentos(DATE '2001-03-01', DATE '2001-03-31') m
        WHERE m.pedido_id::text LIKE 'c35ce4dd-1391-%' ORDER BY m.id`,
    )
  ).rows;
}
const semDescricao = (rs) => rs.map(({ descricao, ...resto }) => resto);
const descricoes = (rs) =>
  Object.fromEntries(rs.map((r) => [r.id, r.descricao]));

// O que a lojista tem de ler no extrato, linha a linha (oraculo escrito a mao, fora do SQL).
const ESPERADO = {
  [`pedido:${ID.balcaoSemCliente}`]: `Venda no balcão #${num6(ID.balcaoSemCliente)}`,
  [`pedido:${ID.balcaoComCliente}`]: `Venda no balcão #${num6(ID.balcaoComCliente)} · Maria Fictícia`,
  [`pedido:${ID.online}`]: `Pedido #${num6(ID.online)} · João Fictício`,
  [`pedido:${ID.balcaoAnulado}`]: `Venda no balcão #${num6(ID.balcaoAnulado)}`,
  [`estorno_externo:${ID.balcaoAnulado}`]: `Venda do balcão anulada · #${num6(ID.balcaoAnulado)}`,
  [`pedido:${ID.balcaoEstornadoFora}`]: `Venda no balcão #${num6(ID.balcaoEstornadoFora)} · Ana Fictícia`,
  [`estorno_externo:${ID.balcaoEstornadoFora}`]: `Estorno registrado fora do app · pedido #${num6(ID.balcaoEstornadoFora)}`,
  [`pedido:${ID.onlineEstornadoFora}`]: `Pedido #${num6(ID.onlineEstornadoFora)} · Bia Fictícia`,
  [`estorno_externo:${ID.onlineEstornadoFora}`]: `Estorno registrado fora do app · pedido #${num6(ID.onlineEstornadoFora)}`,
  [`pedido:${ID.balcaoDesfeitoEFora}`]: `Venda no balcão #${num6(ID.balcaoDesfeitoEFora)}`,
  [`estorno_externo:${ID.balcaoDesfeitoEFora}`]: `Estorno registrado fora do app · pedido #${num6(ID.balcaoDesfeitoEFora)}`,
  [`pedido:${ID.onlineComMarcaNaoBalcao}`]: `Pedido #${num6(ID.onlineComMarcaNaoBalcao)} · Caio Fictício`,
  [`estorno_externo:${ID.onlineComMarcaNaoBalcao}`]: `Estorno registrado fora do app · pedido #${num6(ID.onlineComMarcaNaoBalcao)}`,
  [`pedido:${ID.onlineComEstornoDoApp}`]: `Pedido #${num6(ID.onlineComEstornoDoApp)} · Dani Fictícia`,
  [`estorno:${REFUND}`]: `Estorno do pedido #${num6(ID.onlineComEstornoDoApp)} · arrependimento`,
  [`devolucao:${DEVOLUCAO}`]: "Reembolso da devolução DV391E",
};

/** Devolve a lista de divergencias do corpo VIVO contra o oraculo (vazia = verde). */
async function divergencias(c, referencia) {
  const rs = await linhas(c);
  const erros = [];
  const vivo = descricoes(rs);
  for (const [id, texto] of Object.entries(ESPERADO)) {
    const lido = new Map(Object.entries(vivo)).get(id);
    if (lido !== texto) erros.push(`${id}: "${lido}" (esperado "${texto}")`);
  }
  for (const id of Object.keys(vivo))
    if (!(id in ESPERADO)) erros.push(`linha a mais: ${id}`);
  // So o texto muda: todas as outras colunas iguais as do corpo anterior.
  try {
    assert.deepEqual(semDescricao(rs), referencia);
  } catch {
    erros.push("alguma coluna alem de descricao mudou");
  }
  return erros;
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // ---- 0. O topo instalado pelo CI e' o desta migration; o anterior e' o da 20261177000000. ----
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o da 20261391200000",
    );
    assert.equal(md5(topo.prosrc), HASH_NOVO);
    assert.equal(
      md5(CORPO_ANTES),
      HASH_ANTES,
      "o anterior nao e o da 20261177000000",
    );
    console.log(
      "  PASSOU o topo instalado e o corpo desta migration (md5 conhecido)",
    );

    await fixture(c);

    // A referencia de "so o texto muda": as linhas do corpo ANTERIOR, sem a descricao.
    const anterior = await isolado(c, async () => {
      await c.query(rollback);
      assert.equal(md5((await funcao(c)).prosrc), HASH_ANTES);
      const rs = await linhas(c);
      return { semDescricao: semDescricao(rs), descricoes: descricoes(rs) };
    });
    assert.equal(
      anterior.semDescricao.length,
      Object.keys(ESPERADO).length,
      "a fixture rende uma linha por caso",
    );
    // O defeito, medido no corpo anterior: 8 primeiros caracteres, nome repetido, anulacao como estorno de fora.
    assert.equal(
      anterior.descricoes[`pedido:${ID.balcaoSemCliente}`],
      "Venda no balcão #C35CE4DD · Venda no balcão",
    );
    assert.equal(
      anterior.descricoes[`estorno_externo:${ID.balcaoAnulado}`],
      "Estorno registrado fora do app · pedido #C35CE4DD",
    );
    console.log(
      "  PASSOU controle: o corpo anterior mostra os 3 defeitos (8 primeiros, nome repetido, anulacao como estorno de fora)",
    );

    // ---- 1 e 2. Textos novos e NADA alem do texto mudou. ----
    const verde = await divergencias(c, anterior.semDescricao);
    assert.deepEqual(verde, [], verde.join("\n"));
    const somas = async () =>
      (
        await c.query(
          `SELECT tipo, conta_id, status, sum(valor)::text AS s, count(*)::int AS n
             FROM public.fin__movimentos(NULL, NULL) GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
        )
      ).rows;
    const somasNovas = await somas();
    const somasAntigas = await isolado(c, async () => {
      await c.query(rollback);
      return somas();
    });
    assert.deepEqual(
      somasNovas,
      somasAntigas,
      "a soma por tipo, conta e status mudou",
    );
    console.log(
      "  PASSOU textos novos (6 ultimos, sem nome repetido, anulacao propria) e so a descricao mudou (linhas e somas iguais)",
    );

    // ---- 3. Mutantes e o corpo anterior: a prova fica vermelha. ----
    const mutantes = [
      [
        "8 primeiros caracteres",
        (s) =>
          s
            .split("upper(right(v.id::text, 6))")
            .join("upper(left(v.id::text, 8))"),
      ],
      [
        "sem o NULLIF do nome padrao",
        (s) =>
          s.replace(
            "NULLIF(NULLIF(btrim(v.customer_name), ''), 'Venda no balcão')",
            "NULLIF(btrim(v.customer_name), '')",
          ),
      ],
      [
        "marca sem o payment_status_depois",
        (s) =>
          s.replace(
            "\n                     AND h.payment_status_depois = 'estornado')",
            ")",
          ),
      ],
      [
        "marca em qualquer canal",
        (s) =>
          s.replace(
            "CASE WHEN v.canal = 'presencial' AND EXISTS (",
            "CASE WHEN EXISTS (",
          ),
      ],
      [
        "mexe no valor do estorno de fora",
        (s) =>
          s.replace(
            "(v.total - COALESCE(v.valor_estornado, 0) - COALESCE(dm.valor, 0))::numeric,",
            "(v.total - COALESCE(v.valor_estornado, 0))::numeric,",
          ),
      ],
      [
        "estorno do app com 8 primeiros",
        (s) =>
          s.replace(
            "'Estorno do pedido #' || upper(right(o.id::text, 6))",
            "'Estorno do pedido #' || upper(left(o.id::text, 8))",
          ),
      ],
    ];
    for (const [nome, mutar] of mutantes) {
      const corpo = mutar(CORPO_NOVO);
      assert.notEqual(corpo, CORPO_NOVO, `o mutante "${nome}" nao mudou nada`);
      const erros = await isolado(c, async () => {
        await trocarCorpo(c, corpo);
        return divergencias(c, anterior.semDescricao);
      });
      assert.ok(erros.length > 0, `o mutante "${nome}" sobreviveu`);
    }
    const errosAnterior = await isolado(c, async () => {
      await c.query(rollback);
      return divergencias(c, anterior.semDescricao);
    });
    assert.ok(
      errosAnterior.length >= 5,
      "o corpo anterior teria de reprovar a bateria",
    );
    console.log(
      `  PASSOU ${mutantes.length} mutantes e o corpo anterior reprovam a bateria`,
    );

    // ---- 4. Reaplicar, rollback byte a byte, segundo rollback recusa, reaplicar depois do rollback. ----
    await isolado(c, async () => {
      await c.query(migration);
      await c.query(migration);
      const depois = await funcao(c);
      assert.deepEqual(
        depois,
        topo,
        "reaplicar 2x mudou OID, dono, ACL, atributos ou texto",
      );
      await c.query(rollback);
      const volta = await funcao(c);
      assert.equal(
        volta.prosrc,
        CORPO_ANTES,
        "o rollback nao devolveu o corpo da 20261177000000 byte a byte",
      );
      assert.deepEqual(
        { ...volta, prosrc: null },
        { ...topo, prosrc: null },
        "o rollback mexeu em atributo, dono ou ACL",
      );
      await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
      await c.query(migration);
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar depois do rollback nao voltou ao mesmo estado",
      );
    });
    console.log(
      "  PASSOU reaplicar 2x, rollback byte a byte, segundo rollback recusa e reaplicar volta",
    );

    // ---- 5. Pre-voo recusa sem escrever. ----
    const sabotagens = [
      [
        "corpo desconhecido",
        () => trocarCorpo(c, CORPO_NOVO.replace("'Pedido #'", "'Pedido nº'")),
      ],
      [
        "ACL aberta para authenticated",
        () =>
          c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO authenticated`),
      ],
      [
        "sobrecarga",
        () =>
          c.query(
            "CREATE FUNCTION public.fin__movimentos(p_inicio date) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
          ),
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await isolado(c, async () => {
        await sabotar();
        const antes = await funcao(c);
        await recusa(c, migration, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await funcao(c),
          antes,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
      });
    }
    console.log(
      `  PASSOU pre-voo recusa sem escrever (${sabotagens.length} sabotagens)`,
    );

    // ---- 6. Consultas 100a/100b nos dois sentidos, com o rol fechado. ----
    const consulta = async (nome) => {
      const rows = (
        await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        [...ROL.get(nome)].sort(),
        `${nome}: o rol nao e o do conferir-banco`,
      );
      return rows.filter((r) => r.ok !== true).map((r) => r.item);
    };
    assert.deepEqual(await consulta(C100A), []);
    assert.deepEqual(await consulta(C100B), [
      "fin__movimentos: corpo exato (md5)",
    ]);
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C100B), []);
      assert.deepEqual(await consulta(C100A), [
        "fin__movimentos: corpo exato (md5)",
      ]);
    });
    console.log("  PASSOU consultas 100a/100b nos dois sentidos, rol fechado");

    console.log(
      "\n[o-financeiro-descreve-a-venda-do-balcao] todas as provas passaram.",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
