"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário) ou do JSON da própria RPC no Postgres efêmero; nunca de entrada
 * de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) da lista de pedidos do painel:
 * public.get_admin_orders_paged (corpo vigente desde
 * 20261399900000_a_busca_de_pedidos_acha_o_telefone_colado_com_o_55.sql), contra o Postgres EFÊMERO com as
 * migrations aplicadas do zero (rpc-ci). Só o clone descartável do rodar-isolado.cjs, nunca banco de loja.
 *
 * O QUE O CORPO GUARDA (na contagem E na página, que são duas consultas separadas):
 *   - período: `created_at >= p_start_date` E `created_at <= p_end_date` (as DUAS bordas entram); é o que faz o
 *     fechamento do mês e o CSV do período trazerem só o mês pedido;
 *   - "Em Aberto" (`p_status = 'open'`): `status NOT IN ('cancelled', 'delivered')`; é o filtro padrão da tela e
 *     esconde cancelados, entregues e as vendas do balcão (que já nascem entregues);
 *   - o resto (status exato, canal) combina com os dois por AND.
 *
 * FIXTURE (ano 2031; nenhum outro teste escreve nele; created_at todos DISTINTOS, a ordem da lista é a da data
 * decrescente; a transação começa apagando, DESFEITA no fim, qualquer pedido que o clone já traga):
 *   n   created_at (UTC)           status      canal       por que existe
 *   1   2031-01-31 23:59:59        pending     online      último instante ANTES do período
 *   2   2031-02-01 00:00:00        processing  online      borda de INÍCIO (entra)
 *   3   2031-02-10 12:00:00        shipping    online      dentro
 *   4   2031-02-15 12:00:00        delivered   online      dentro, mas não é "em aberto"
 *   5   2031-02-20 12:00:00        cancelled   online      dentro, mas não é "em aberto"
 *   6   2031-02-25 12:00:00        delivered   presencial  venda do balcão (nasce entregue)
 *   7   2031-02-26 12:00:00        new         online      dentro; 'new' É em aberto (só cancelled/delivered saem)
 *   8   2031-02-28 23:59:59        pending     online      borda de FIM (entra)
 *   9   2031-03-01 00:00:00        pending     online      primeiro instante DEPOIS do período
 *   10  2031-05-10 12:00:00        processing  online      3 meses depois
 *   11  2030-11-05 12:00:00        shipping    online      muito antigo
 *   12  2031-02-12 12:00:00        pending     presencial  balcão ainda aberto (combina canal + em aberto)
 *   => ordem da lista (data decrescente): 10, 9, 8, 7, 6, 5, 4, 12, 3, 2, 1, 11
 *   => período fev/2031 [2031-02-01T00:00:00Z, 2031-02-28T23:59:59Z]: 8, 7, 6, 5, 4, 12, 3, 2 (total 8)
 *
 * CENÁRIOS (cada um confere ids, ORDEM e total_count de TODAS as páginas, mais uma página além do fim):
 *   G  controle sem filtro (12 pedidos): a fixture está inteira e na ordem
 *   A  período fev/2031, paginado de 3 em 3: só os 8 do intervalo, com as duas bordas dentro
 *   B  as bordas, uma por vez: janela [31/01 23:59:59, 01/02 00:00:00] = {2, 1}; instante único = {2};
 *      início 1s depois do pedido 2 o tira; fim 1s antes do pedido 8 o tira
 *   C  só início e só fim (cada corte sozinho)
 *   D  Em Aberto sem datas: 9 pedidos; sem cancelled, delivered nem o balcão entregue; 'new' fica
 *   E  Em Aberto + período fev/2031: 5 pedidos (8, 7, 12, 3, 2)
 *   F  combinados: período + canal presencial, período + 'open' + presencial, período + status exato
 *      (cancelled, delivered), período sem pedido nenhum, página além do fim
 *
 * MUTANTES: MUTANTE_R112E=<nome> troca UM trecho do corpo vivo (via pg_get_functiondef, dentro da transação
 * desfeita; a contagem e a página são separadas no marcador "-- Fetch paginated data") e roda os cenários; a
 * execução TEM de ficar vermelha, e vermelha num cenário que o nome promete. Nome desconhecido é ERRO.
 * Sem MUTANTE_R112E a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-lista-de-pedidos-do-painel-respeita-periodo-e-em-aberto-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: a lista de pedidos do painel respeita o período e o Em Aberto (rpc-ci)";
const FN =
  "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)";
const ADMIN = "b112e000-0000-4000-8000-0000000000a1";
const CLIENTE = "b112e000-0000-4000-8000-0000000000a2";
const id = (n) => `b112e000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSAO = {
  uid: ADMIN,
  claims: JSON.stringify({
    sub: ADMIN,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};

const INICIO = "2031-02-01T00:00:00Z";
const FIM = "2031-02-28T23:59:59Z";

// [n, created_at, status, canal]
const PEDIDOS = [
  [1, "2031-01-31T23:59:59Z", "pending", "online"],
  [2, "2031-02-01T00:00:00Z", "processing", "online"],
  [3, "2031-02-10T12:00:00Z", "shipping", "online"],
  [4, "2031-02-15T12:00:00Z", "delivered", "online"],
  [5, "2031-02-20T12:00:00Z", "cancelled", "online"],
  [6, "2031-02-25T12:00:00Z", "delivered", "presencial"],
  [7, "2031-02-26T12:00:00Z", "new", "online"],
  [8, "2031-02-28T23:59:59Z", "pending", "online"],
  [9, "2031-03-01T00:00:00Z", "pending", "online"],
  [10, "2031-05-10T12:00:00Z", "processing", "online"],
  [11, "2030-11-05T12:00:00Z", "shipping", "online"],
  [12, "2031-02-12T12:00:00Z", "pending", "presencial"],
];

// ---------------------------------------------------------------- mutantes
// Os trechos EXATOS do corpo vivo. Cada um aparece 1x na contagem e 1x na página
// (o marcador separa as duas metades); o mutante diz em qual(is) mexe.
const DIVISOR = "    -- Fetch paginated data";
const CORTE_INICIO =
  "AND (p_start_date = '' OR o.created_at >= p_start_date::TIMESTAMPTZ)";
const CORTE_FIM =
  "AND (p_end_date = '' OR o.created_at <= p_end_date::TIMESTAMPTZ)";
const EM_ABERTO =
  "OR (p_status = 'open' AND o.status NOT IN ('cancelled', 'delivered'))";

/** Um mutante = um trecho trocado na(s) metade(s) pedida(s): "ambas", "contagem" ou "pagina". */
const mut = (espera, de, para, onde = "ambas") => ({
  espera,
  de,
  para,
  onde,
});
const MUTANTES = {
  // Os cinco principais: a guarda some da contagem E da página.
  "pedidos-sem-corte-de-inicio": mut(["A"], CORTE_INICIO, "AND TRUE"),
  "pedidos-sem-corte-de-fim": mut(["A"], CORTE_FIM, "AND TRUE"),
  "pedidos-em-aberto-sem-filtro": mut(
    ["D"],
    EM_ABERTO,
    "OR (p_status = 'open')",
  ),
  // A guarda some de UMA das duas consultas: a contagem (total_count do paginador) ou a página (as linhas).
  "pedidos-sem-corte-de-inicio-so-na-contagem": mut(
    ["A"],
    CORTE_INICIO,
    "AND TRUE",
    "contagem",
  ),
  "pedidos-sem-corte-de-inicio-so-na-pagina": mut(
    ["A"],
    CORTE_INICIO,
    "AND TRUE",
    "pagina",
  ),
  "pedidos-sem-corte-de-fim-so-na-contagem": mut(
    ["A"],
    CORTE_FIM,
    "AND TRUE",
    "contagem",
  ),
  "pedidos-sem-corte-de-fim-so-na-pagina": mut(
    ["A"],
    CORTE_FIM,
    "AND TRUE",
    "pagina",
  ),
  "pedidos-em-aberto-sem-filtro-so-na-contagem": mut(
    ["D"],
    EM_ABERTO,
    "OR (p_status = 'open')",
    "contagem",
  ),
  "pedidos-em-aberto-sem-filtro-so-na-pagina": mut(
    ["D"],
    EM_ABERTO,
    "OR (p_status = 'open')",
    "pagina",
  ),
  // As bordas: o corte é >= e <=, e as duas bordas ENTRAM.
  "pedidos-inicio-sem-igual": mut(
    ["B"],
    "o.created_at >= p_start_date::TIMESTAMPTZ",
    "o.created_at > p_start_date::TIMESTAMPTZ",
  ),
  "pedidos-fim-sem-igual": mut(
    ["B"],
    "o.created_at <= p_end_date::TIMESTAMPTZ",
    "o.created_at < p_end_date::TIMESTAMPTZ",
  ),
  // Em Aberto exclui OS DOIS: tirar um deles deixa o outro vazar para a fila de trabalho.
  "pedidos-em-aberto-sem-excluir-entregue": mut(
    ["D"],
    EM_ABERTO,
    "OR (p_status = 'open' AND o.status NOT IN ('cancelled'))",
  ),
  "pedidos-em-aberto-sem-excluir-cancelado": mut(
    ["D"],
    EM_ABERTO,
    "OR (p_status = 'open' AND o.status NOT IN ('delivered'))",
  ),
  // Sem a ramificação 'open': cai em `o.status = 'open'` e a lista Em Aberto some (nenhum pedido tem esse status).
  "pedidos-em-aberto-sem-a-ramificacao": mut(["D"], EM_ABERTO, "OR FALSE"),
};

// ------------------------------------------------------------------ semente

/** Chama a RPC como o administrador (papel authenticated + JWT), a mesma porta do painel. */
async function listar(
  c,
  {
    busca = "",
    status = "all",
    inicio = "",
    fim = "",
    pagina = 0,
    tamanho = 100,
    pagamento = "all",
    canal = "all",
  },
) {
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [SESSAO.uid, SESSAO.claims],
  );
  await c.query("SET LOCAL ROLE authenticated");
  try {
    const r = await c.query(
      "SELECT public.get_admin_orders_paged($1,$2,$3,$4,$5,$6,$7,$8) AS r",
      [busca, status, inicio, fim, pagina, tamanho, pagamento, canal],
    );
    return {
      ids: r.rows[0].r.data.map((o) => o.id),
      total: Number(r.rows[0].r.total_count),
    };
  } finally {
    await c.query("RESET ROLE");
  }
}

/**
 * Confere TODAS as páginas de um filtro: ids na ordem, total_count igual em cada uma, e uma página além do
 * fim vazia que ainda carrega o total.
 */
async function conferir(c, rotulo, filtro, paginas, total) {
  for (const [pagina, numeros] of paginas.entries()) {
    const r = await listar(c, { ...filtro, pagina, tamanho: filtro.tamanho });
    assert.strictEqual(
      r.total,
      total,
      `[${rotulo}] total_count da página ${pagina} (o paginador): esperado ${total}`,
    );
    assert.deepStrictEqual(
      r.ids,
      numeros.map(id),
      `[${rotulo}] linhas da página ${pagina}: pedido de fora do filtro, ordem ou limite errados`,
    );
  }
  const alem = await listar(c, {
    ...filtro,
    pagina: paginas.length,
    tamanho: filtro.tamanho,
  });
  assert.deepStrictEqual(
    { ids: alem.ids, total: alem.total },
    { ids: [], total },
    `[${rotulo}] a página além do fim vem vazia e ainda carrega o total ${total}`,
  );
}

// ---------------------------------------------------------------- cenários

const CENARIOS = [];

CENARIOS.push({
  id: "G",
  nome: "G: controle sem filtro — os 12 pedidos da fixture, na ordem da data decrescente",
  corpo: async (c) => {
    await conferir(
      c,
      "G",
      { tamanho: 5 },
      [
        [10, 9, 8, 7, 6],
        [5, 4, 12, 3, 2],
        [1, 11],
      ],
      12,
    );
    await conferir(
      c,
      "G open",
      { status: "all", tamanho: 12 },
      [[10, 9, 8, 7, 6, 5, 4, 12, 3, 2, 1, 11]],
      12,
    );
  },
});

CENARIOS.push({
  id: "A",
  nome: "A: período fev/2031 (todos os status), de 3 em 3 — só os 8 do intervalo, as duas bordas dentro",
  corpo: async (c) => {
    await conferir(
      c,
      "A período",
      { inicio: INICIO, fim: FIM, tamanho: 3 },
      [
        [8, 7, 6],
        [5, 4, 12],
        [3, 2],
      ],
      8,
    );
  },
});

CENARIOS.push({
  id: "B",
  nome: "B: as bordas, uma por vez — janela de 1s em volta de 01/02 00:00:00, instante único, início +1s e fim -1s",
  corpo: async (c) => {
    // Último instante do dia anterior + primeiro do período: os DOIS pedidos de borda entram (>= e <=).
    await conferir(
      c,
      "B janela de 1s",
      {
        inicio: "2031-01-31T23:59:59Z",
        fim: "2031-02-01T00:00:00Z",
        tamanho: 10,
      },
      [[2, 1]],
      2,
    );
    // Início e fim no MESMO instante: só o pedido que nasceu exatamente nele (o início é >=, o fim é <=).
    await conferir(
      c,
      "B instante único (início)",
      {
        inicio: "2031-02-01T00:00:00Z",
        fim: "2031-02-01T00:00:00Z",
        tamanho: 10,
      },
      [[2]],
      1,
    );
    await conferir(
      c,
      "B instante único (fim)",
      {
        inicio: "2031-02-28T23:59:59Z",
        fim: "2031-02-28T23:59:59Z",
        tamanho: 10,
      },
      [[8]],
      1,
    );
    // Começar 1s depois do pedido 2 tira o pedido 2 e só ele.
    await conferir(
      c,
      "B início +1s",
      { inicio: "2031-02-01T00:00:01Z", fim: FIM, tamanho: 10 },
      [[8, 7, 6, 5, 4, 12, 3]],
      7,
    );
    // Terminar 1s antes do pedido 8 tira o pedido 8 e só ele.
    await conferir(
      c,
      "B fim -1s",
      { inicio: INICIO, fim: "2031-02-28T23:59:58Z", tamanho: 10 },
      [[7, 6, 5, 4, 12, 3, 2]],
      7,
    );
  },
});

CENARIOS.push({
  id: "C",
  nome: "C: só o início (sem fim) e só o fim (sem início) — cada corte vale sozinho",
  corpo: async (c) => {
    await conferir(
      c,
      "C só início",
      { inicio: INICIO, tamanho: 4 },
      [
        [10, 9, 8, 7],
        [6, 5, 4, 12],
        [3, 2],
      ],
      10,
    );
    await conferir(
      c,
      "C só fim",
      { fim: FIM, tamanho: 4 },
      [
        [8, 7, 6, 5],
        [4, 12, 3, 2],
        [1, 11],
      ],
      10,
    );
  },
});

CENARIOS.push({
  id: "D",
  nome: "D: Em Aberto sem datas — 9 pedidos, sem cancelled, sem delivered, sem o balcão entregue; 'new' fica",
  corpo: async (c) => {
    await conferir(
      c,
      "D open",
      { status: "open", tamanho: 4 },
      [[10, 9, 8, 7], [12, 3, 2, 1], [11]],
      9,
    );
    // Os status de fora, um por um, ainda existem quando pedidos pelo nome (o 'open' não os apaga do banco).
    await conferir(
      c,
      "D cancelled",
      { status: "cancelled", tamanho: 10 },
      [[5]],
      1,
    );
    await conferir(
      c,
      "D delivered",
      { status: "delivered", tamanho: 10 },
      [[6, 4]],
      2,
    );
  },
});

CENARIOS.push({
  id: "E",
  nome: "E: Em Aberto + período fev/2031 — 5 pedidos (8, 7, 12, 3, 2); entregues e cancelado de fora",
  corpo: async (c) => {
    await conferir(
      c,
      "E open + período",
      { status: "open", inicio: INICIO, fim: FIM, tamanho: 2 },
      [[8, 7], [12, 3], [2]],
      5,
    );
  },
});

CENARIOS.push({
  id: "F",
  nome: "F: filtros combinados — canal, status exato, período vazio e página além do fim",
  corpo: async (c) => {
    // Período + balcão: os dois pedidos presenciais de fevereiro.
    await conferir(
      c,
      "F período + presencial",
      { inicio: INICIO, fim: FIM, canal: "presencial", tamanho: 10 },
      [[6, 12]],
      2,
    );
    // Período + Em Aberto + balcão: só o balcão que ainda está aberto (o entregue sai).
    await conferir(
      c,
      "F período + open + presencial",
      {
        status: "open",
        inicio: INICIO,
        fim: FIM,
        canal: "presencial",
        tamanho: 10,
      },
      [[12]],
      1,
    );
    // Período + status exato: pending dentro de fev é só o 8 e o 12 (o 1 e o 9 ficam nas bordas de fora).
    await conferir(
      c,
      "F período + pending",
      { status: "pending", inicio: INICIO, fim: FIM, tamanho: 10 },
      [[8, 12]],
      2,
    );
    // Período + cancelled / delivered.
    await conferir(
      c,
      "F período + cancelled",
      { status: "cancelled", inicio: INICIO, fim: FIM, tamanho: 10 },
      [[5]],
      1,
    );
    await conferir(
      c,
      "F período + delivered",
      { status: "delivered", inicio: INICIO, fim: FIM, tamanho: 10 },
      [[6, 4]],
      2,
    );
    // Período em que não houve pedido: lista vazia e total 0 (nunca "todos").
    await conferir(
      c,
      "F período vazio",
      {
        inicio: "2031-04-01T00:00:00Z",
        fim: "2031-04-30T23:59:59Z",
        tamanho: 10,
      },
      [],
      0,
    );
    // Período vazio + Em Aberto continua vazio.
    await conferir(
      c,
      "F período vazio + open",
      {
        status: "open",
        inicio: "2031-04-01T00:00:00Z",
        fim: "2031-04-30T23:59:59Z",
        tamanho: 10,
      },
      [],
      0,
    );
    // Mês seguinte: o pedido do dia 01/03 00:00:00 entra no seu mês e não no de fevereiro.
    await conferir(
      c,
      "F março",
      {
        inicio: "2031-03-01T00:00:00Z",
        fim: "2031-03-31T23:59:59Z",
        tamanho: 10,
      },
      [[9]],
      1,
    );
    // Em aberto sem datas + canal presencial: só o balcão aberto.
    await conferir(
      c,
      "F open + presencial",
      { status: "open", canal: "presencial", tamanho: 10 },
      [[12]],
      1,
    );
  },
});

// ------------------------------------------------------------------ rodada

/**
 * Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). A contagem e a página são
 * separadas no marcador; o trecho tem de aparecer exatamente 1x em cada metade, e o mutante mexe só onde diz.
 */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R112E='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
    ).rows[0].d.replace(/\r/g, "");
  const def = await ler();
  assert.strictEqual(
    def.split(DIVISOR).length - 1,
    1,
    "o marcador que separa a contagem da página tem de aparecer 1x",
  );
  const [contagem, pagina] = def.split(DIVISOR);
  for (const [metade, texto] of [
    ["contagem", contagem],
    ["pagina", pagina],
  ]) {
    const ocorrencias = texto.split(m.de).length - 1;
    assert.strictEqual(
      ocorrencias,
      1,
      `mutante ${nome}: o trecho tem de aparecer 1x na ${metade} do corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
    );
  }
  const novaContagem =
    m.onde === "pagina" ? contagem : contagem.replace(m.de, () => m.para);
  const novaPagina =
    m.onde === "contagem" ? pagina : pagina.replace(m.de, () => m.para);
  const mutado = novaContagem + DIVISOR + novaPagina;
  assert.notStrictEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  assert.strictEqual(
    await ler(),
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), o admin, a loja limpa e os 12 pedidos. Cada cenário só lê.
 * Devolve {passou:[ids], falhou:[{id, nome, erro}]}. Erro que não é de asserção (SQL, conexão) sobe: é do
 * teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    // O clone nem sempre libera o schema auth para o papel authenticated; some no ROLLBACK.
    await c.query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin@r112e.fixture.invalid', '{"role":"admin"}'::jsonb),
              ($2, 'cliente@r112e.fixture.invalid', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN, CLIENTE],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Admin Ficticio', 'admin'), ($2, 'Cliente Ficticio', 'customer')
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN, CLIENTE],
    );
    // Números absolutos da loja inteira: limpa o que o clone já traga. Sem gatilho nem FK (replica) e DESFEITO
    // no ROLLBACK; o que se insere depois volta ao papel normal, com os gatilhos de produção.
    const antes = (
      await c.query("SELECT count(*)::int AS n FROM public.marketplace_orders")
    ).rows[0].n;
    if (antes > 0) {
      console.log(
        `    (clone com ${antes} pedido(s): apagados só nesta transação)`,
      );
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query("DELETE FROM public.marketplace_orders");
      await c.query("SET LOCAL session_replication_role = origin");
    }
    for (const [n, criado, status, canal] of PEDIDOS) {
      await c.query(
        `INSERT INTO public.marketplace_orders
           (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
            payment_method, payment_status, created_at, updated_at)
         VALUES ($1, $2, 'Cliente Ficticio', '{}'::jsonb, 100, 100, $3, $4,
                 'pix', 'aguardando', $5, $5)`,
        [id(n), CLIENTE, status, canal, criado],
      );
    }
    const gravados = (
      await c.query("SELECT count(*)::int AS n FROM public.marketplace_orders")
    ).rows[0].n;
    assert.strictEqual(
      gravados,
      PEDIDOS.length,
      "a prova parte da loja só com os pedidos da fixture",
    );

    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id: cenario, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
        resultado.passou.push(cenario);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id: cenario, nome, erro });
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

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R112E || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R112E='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
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
    for (const idCenario of r.passou) console.log(`  PASSOU ${idCenario}`);
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
        (cenario) => !r.falhou.some((f) => f.id === cenario),
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
        "A lista de pedidos do painel não respeitou o período ou o Em Aberto — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[a-lista-de-pedidos-do-painel] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
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
