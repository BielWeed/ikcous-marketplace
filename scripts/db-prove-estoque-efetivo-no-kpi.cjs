#!/usr/bin/env node
/**
 * ATENCAO -- ESTE SCRIPT SO VALE ANTES DE A MIGRATION SER APLICADA.
 * Ele mede "antes x depois" aplicando a migration DENTRO de uma transacao que
 * termina em ROLLBACK. Se a migration ja estiver no banco, a rodada "antes" ja
 * mede a funcao corrigida e 5 das 13 asseveracoes ficam VERMELHAS com a
 * migration perfeitamente correta (A antes, D antes, E antes, o CONTROLE
 * POSITIVO e o passo 5). Vermelho aqui depois da aplicacao NAO e defeito da
 * migration -- e este script fora da janela em que ele mede alguma coisa.
 *
 * Prova a migration 20260902000000_kpi_usa_o_mesmo_estoque_que_a_tela.sql
 * (auditoria do painel, achado 13) sem gravar nada no banco.
 *
 * TUDO roda em UMA transação terminada em ROLLBACK. Nada é gravado — nem os
 * produtos de teste, nem as variantes, nem o CREATE OR REPLACE da função.
 * Isso só é verdade porque a migration NÃO tem BEGIN/COMMIT embutido: se
 * alguém acrescentar um, este script passa a gravar de verdade sem avisar
 * (por isso a checagem logo abaixo, antes de aplicar).
 *
 * POR QUE `SET LOCAL ROLE authenticated` + `request.jwt.claims`: igual ao
 * script irmão db-prove-analitico-dinheiro-real.cjs — get_admin_analytics_v2
 * exige is_admin() = true, e isso só acontece de graça quando o papel da
 * sessão já é 'postgres'/'service_role', o que não é o caso da conexão
 * direta usada aqui.
 *
 * A CONEXÃO PODE ABRIR EM MODO SOMENTE LEITURA: por isso `BEGIN READ WRITE`
 * em vez de `BEGIN` — este script precisa inserir produto e variante de teste
 * dentro da transação. NUNCA `SET default_transaction_read_only = off`: isso é
 * `SET SESSION` por definição e gruda na conexão do pooler (porta 6543), que é
 * reaproveitada entre programas. `BEGIN READ WRITE` é escopo de TRANSAÇÃO e
 * some sozinho no ROLLBACK.
 *
 * COMO CADA CASO É MEDIDO — por DELTA de um produto isolado, nunca por
 * número absoluto: `inventory.totalCost`, `inventory.totalValue` e
 * `inventoryAlerts` são agregados sobre TODA a tabela `produtos`, e este
 * banco de desenvolvimento já tem produtos reais (inclusive alguns com
 * variante, ver a auditoria). Para não depender do que já existe no banco
 * no dia em que alguém rodar isto, cada caso:
 *   1. mede o KPI ANTES de criar o produto de teste,
 *   2. cria o produto (e as variantes, se o caso pedir),
 *   3. mede o KPI DEPOIS,
 *   4. APAGA o produto na hora (a migration não muda nada em produto sem
 *      variante nem depende de ordem entre casos — apagar cedo evita que um
 *      caso contamine a medição do próximo),
 *   5. delta = depois - antes é a contribuição EXATA daquele produto,
 *      isolada de qualquer outro dado do banco.
 * Isso é repetido duas vezes: uma vez com a função ANTES da migration
 * (comportamento hoje: lê a coluna `estoque` crua) e uma vez DEPOIS (lê o
 * estoque efetivo). Os produtos de teste são recriados idênticos nas duas
 * rodadas — o que muda entre elas é só a definição da função.
 *
 * OS CINCO CASOS (nomes A-E no código, "achado 13" na tarefa):
 *   A. Produto COM variantes ativas, números diferentes de propósito
 *      (coluna 11, soma das ativas 10, mais uma variante INATIVA de 999
 *      para provar que ela é ignorada). Depois da migration o KPI usa 10.
 *   B. Produto SEM variante nenhuma (não-regressão — é o caso mais comum no
 *      banco real). Continua usando a coluna, idêntico antes e depois.
 *   C. Produto com variantes TODAS inativas. Pela regra de mappers.ts cai
 *      na coluna, não em zero — o caso mais fácil de errar. Idêntico antes
 *      e depois (a função antiga também nunca olhava variante; o que este
 *      caso prova é que o fallback da função nova não vira 0).
 *   D. Estoque Baixo, sentido 1: coluna ACIMA do mínimo, variante ativa
 *      ABAIXO. Antes não contava como baixo; depois passa a contar.
 *   E. Estoque Baixo, sentido 2 (o inverso): coluna ABAIXO do mínimo,
 *      variante ativa ACIMA. Antes contava como baixo; depois deixa de
 *      contar.
 *
 * CONTROLE POSITIVO: o caso A também prova que o instrumento ENXERGA
 * mudança — `depois.cost !== antes.cost` para o mesmo produto A, só porque
 * a definição da função mudou. Sem essa asserção, "tudo bateu" seria
 * indistinguível de "a migration não fez nada".
 *
 * REPRODUZIR O VERMELHO (reverte, SÓ EM MEMÓRIA — nunca grava em disco —, o
 * bloco novo da migration para o bloco antigo que lia a coluna crua, sem
 * olhar variante nenhuma. Os casos que dependem do estoque efetivo (A, D, E
 * e o controle positivo) falham; B e C continuam passando, porque não
 * dependem da correção):
 *   SEM_FIX_ESTOQUE=1 node scripts/db-prove-estoque-efetivo-no-kpi.cjs
 *
 * USO NORMAL:
 *   node scripts/db-prove-estoque-efetivo-no-kpi.cjs
 * Sai com código 0 só se todas as asserções passarem.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260902000000_kpi_usa_o_mesmo_estoque_que_a_tela.sql",
);
const NOME_TESTE = "PROVA ESTOQUE EFETIVO";
const MARCADOR_CORRIGIDO = "estoque_efetivo";

// O bloco exato que a migration escreve (ver o arquivo da migration) e o
// bloco antigo que ele substitui — usados só para reproduzir o vermelho com
// SEM_FIX_ESTOQUE, nunca gravados em disco.
const BLOCO_COM_FIX = `    -- Estoque efetivo: soma dos \`stock_increment\` das variantes ATIVAS
    -- quando existe ao menos uma variante ativa; senão a coluna
    -- \`produtos.estoque\` crua. É a MESMA regra de src/lib/mappers.ts:98-107
    -- (mapProductFromDB), que o cartão do produto, o formulário e a loja já
    -- usam — antes esta função lia a coluna crua e divergia (achado 13,
    -- 20/08/2026). Calculada uma única vez e usada nos dois agregados
    -- abaixo (estoque baixo, custo/valor de estoque).
    WITH estoque_efetivo AS (
        SELECT
            p.custo,
            p.preco_venda,
            p.estoque_minimo,
            CASE
                WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)
                ELSE p.estoque
            END AS estoque
        FROM public.produtos p
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE pv.active) AS qtd_ativas,
                SUM(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas
            FROM public.product_variants pv
            WHERE pv.product_id = p.id
        ) v ON true
        WHERE p.deleted_at IS NULL AND p.ativo = true
    )
    SELECT
        COUNT(*) FILTER (WHERE estoque <= COALESCE(estoque_minimo, 5)),
        COALESCE(SUM(custo * estoque), 0),
        COALESCE(SUM(preco_venda * estoque), 0)
    INTO low_stock_count, inv_cost_total, inv_value_total
    FROM estoque_efetivo;`;

const BLOCO_SEM_FIX = `    SELECT COUNT(*) INTO low_stock_count
    FROM public.produtos
    WHERE estoque <= COALESCE(estoque_minimo, 5) AND ativo = true AND deleted_at IS NULL;

    -- Compute current total inventory cost and value
    SELECT
        COALESCE(SUM(custo * estoque), 0),
        COALESCE(SUM(preco_venda * estoque), 0)
    INTO inv_cost_total, inv_value_total
    FROM public.produtos
    WHERE deleted_at IS NULL AND ativo = true;`;

/** Reverte, só em memória, o bloco da correção para o bloco antigo (lê a
 * coluna crua, sem olhar variante). Usado só com SEM_FIX_ESTOQUE=1. */
function reinserirLeituraCrua(sql) {
  if (!sql.includes(BLOCO_COM_FIX)) {
    throw new Error(
      "SEM_FIX_ESTOQUE=1 não achou o bloco esperado -- a migration mudou.",
    );
  }
  return sql.replace(BLOCO_COM_FIX, BLOCO_SEM_FIX);
}

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

let passou = 0;
let falhou = 0;

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok    ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

/** Chama get_admin_analytics_v2 assumindo o papel authenticated + claim de
 * admin, e devolve o papel a postgres logo depois. */
async function chamarComoAdmin(client, days = 30) {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      sub: "00000000-0000-0000-0000-000000000000",
      role: "authenticated",
      app_metadata: { role: "admin" },
    }),
  ]);
  const { rows } = await client.query(
    "SELECT public.get_admin_analytics_v2($1) AS j",
    [days],
  );
  await client.query("RESET ROLE");
  return rows[0].j;
}

async function criarProduto(
  client,
  { custo, precoVenda, estoque, estoqueMinimo },
) {
  const { rows } = await client.query(
    `INSERT INTO public.produtos
       (nome, custo, preco_venda, estoque, estoque_minimo, categoria, ativo)
     VALUES ($1, $2, $3, $4, $5, 'teste', true)
     RETURNING id`,
    [NOME_TESTE, custo, precoVenda, estoque, estoqueMinimo],
  );
  return rows[0].id;
}

async function criarVariante(client, { produtoId, active, stockIncrement }) {
  await client.query(
    `INSERT INTO public.product_variants (product_id, name, value, active, stock_increment)
     VALUES ($1, 'Cor', 'Padrão', $2, $3)`,
    [produtoId, active, stockIncrement],
  );
}

// --- os cinco casos ---------------------------------------------------

/** A: variantes ativas somam 10 (6+4); a coluna diz 11; uma variante
 * INATIVA de 999 tem de ser ignorada. estoque_minimo=0 (neutro para o
 * teste de estoque baixo, que é o caso D/E). */
async function criarCasoA(client) {
  const id = await criarProduto(client, {
    custo: 10,
    precoVenda: 20,
    estoque: 11,
    estoqueMinimo: 0,
  });
  await criarVariante(client, {
    produtoId: id,
    active: true,
    stockIncrement: 6,
  });
  await criarVariante(client, {
    produtoId: id,
    active: true,
    stockIncrement: 4,
  });
  await criarVariante(client, {
    produtoId: id,
    active: false,
    stockIncrement: 999,
  });
  return id;
}

/** B: sem variante nenhuma -- continua usando a coluna. */
async function criarCasoB(client) {
  return criarProduto(client, {
    custo: 5,
    precoVenda: 9,
    estoque: 7,
    estoqueMinimo: 0,
  });
}

/** C: uma variante, INATIVA -- cai na coluna (6), não em zero. */
async function criarCasoC(client) {
  const id = await criarProduto(client, {
    custo: 8,
    precoVenda: 15,
    estoque: 6,
    estoqueMinimo: 0,
  });
  await criarVariante(client, {
    produtoId: id,
    active: false,
    stockIncrement: 50,
  });
  return id;
}

/** D: coluna (20) ACIMA do mínimo (5); variante ativa (3) ABAIXO. Antes não
 * é estoque baixo; depois passa a ser. */
async function criarCasoD(client) {
  const id = await criarProduto(client, {
    custo: 1,
    precoVenda: 2,
    estoque: 20,
    estoqueMinimo: 5,
  });
  await criarVariante(client, {
    produtoId: id,
    active: true,
    stockIncrement: 3,
  });
  return id;
}

/** E: o inverso de D -- coluna (3) ABAIXO do mínimo (5); variante ativa
 * (20) ACIMA. Antes é estoque baixo; depois deixa de ser. */
async function criarCasoE(client) {
  const id = await criarProduto(client, {
    custo: 1,
    precoVenda: 2,
    estoque: 3,
    estoqueMinimo: 5,
  });
  await criarVariante(client, {
    produtoId: id,
    active: true,
    stockIncrement: 20,
  });
  return id;
}

/** Mede a contribuição isolada de UM produto de teste: KPI antes de criar,
 * cria, KPI depois, apaga na hora (ON DELETE CASCADE cuida das variantes).
 * O delta é a contribuição exata daquele produto, isolada de qualquer outro
 * dado do banco. */
async function medirDelta(client, criarFn, dias = 30) {
  const antes = await chamarComoAdmin(client, dias);
  const id = await criarFn(client);
  const depois = await chamarComoAdmin(client, dias);
  await client.query("DELETE FROM public.produtos WHERE id = $1", [id]);
  return {
    cost:
      Number(depois.inventory.totalCost) - Number(antes.inventory.totalCost),
    value:
      Number(depois.inventory.totalValue) - Number(antes.inventory.totalValue),
    low: depois.inventoryAlerts - antes.inventoryAlerts,
  };
}

async function medirTodosOsCasos(client, dias = 30) {
  return {
    A: await medirDelta(client, criarCasoA, dias),
    B: await medirDelta(client, criarCasoB, dias),
    C: await medirDelta(client, criarCasoC, dias),
    D: await medirDelta(client, criarCasoD, dias),
    E: await medirDelta(client, criarCasoE, dias),
  };
}

async function main() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(MIGRATION))
    throw new Error(`Migration não encontrada: ${MIGRATION}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  let migrationSql = fs.readFileSync(MIGRATION, "utf8");
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(migrationSql)) {
    throw new Error(
      `${MIGRATION} tem BEGIN/COMMIT embutido: o ROLLBACK desta prova viraria no-op e a mudança ficaria gravada. Abortando.`,
    );
  }
  if (process.env.SEM_FIX_ESTOQUE) {
    console.log(
      "SEM_FIX_ESTOQUE=1: revertendo, SÓ EM MEMÓRIA, o bloco novo para o " +
        "bloco antigo (lê a coluna crua, sem olhar variante) -- nada disto " +
        "vai para o arquivo.\n",
    );
    migrationSql = reinserirLeituraCrua(migrationSql);
  }

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  await client.query("RESET ALL");
  // NUNCA `SET default_transaction_read_only = off` aqui: isso E `SET SESSION` por
  // definicao (sem LOCAL), e a DATABASE_URL aponta para o pooler do Supabase
  // (porta 6543), que reaproveita conexao entre programas -- o valor gruda na
  // conexao e vaza para o proximo script que pegar a mesma emprestada. Ja produziu
  // falso negativo na auditoria de outra sessao neste repositorio.
  // `BEGIN READ WRITE` e escopo de TRANSACAO e some sozinho no ROLLBACK.
  await client.query("BEGIN READ WRITE");

  try {
    const antesTudo = await chamarComoAdmin(client, 30);

    console.log("=== 1. Os cinco casos, função ANTES da migration ===");
    const antes = await medirTodosOsCasos(client);
    console.log("A (com variantes ativas):", JSON.stringify(antes.A));
    console.log("B (sem variante):        ", JSON.stringify(antes.B));
    console.log("C (variantes inativas):  ", JSON.stringify(antes.C));
    console.log("D (baixo só na variante):", JSON.stringify(antes.D));
    console.log("E (baixo só na coluna):  ", JSON.stringify(antes.E));

    conferir(
      "A antes: usa a coluna crua (11) -- custo 110, valor 220",
      antes.A.cost === 110 && antes.A.value === 220 && antes.A.low === 0,
      JSON.stringify(antes.A),
    );
    conferir(
      "D antes: coluna (20) acima do mínimo (5) -- NÃO é estoque baixo",
      antes.D.low === 0,
      JSON.stringify(antes.D),
    );
    conferir(
      "E antes: coluna (3) abaixo do mínimo (5) -- É estoque baixo",
      antes.E.low === 1,
      JSON.stringify(antes.E),
    );

    console.log("\n=== 2. Migration aplicada (dentro da transação) ===");
    await client.query(migrationSql);
    const defAplicada = await client.query(
      `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'get_admin_analytics_v2'`,
    );
    const temMarcador = defAplicada.rows[0].def.includes(MARCADOR_CORRIGIDO);
    if (process.env.SEM_FIX_ESTOQUE) {
      conferir(
        "SEM_FIX_ESTOQUE ativo: o marcador da correção NÃO está na função (reversão em memória confirmada)",
        !temMarcador,
      );
    } else {
      conferir(
        "a função aplicada na transação tem o marcador da correção (estoque_efetivo)",
        temMarcador,
      );
    }

    console.log("\n=== 3. Os cinco casos, função DEPOIS da migration ===");
    const depois = await medirTodosOsCasos(client);
    console.log("A (com variantes ativas):", JSON.stringify(depois.A));
    console.log("B (sem variante):        ", JSON.stringify(depois.B));
    console.log("C (variantes inativas):  ", JSON.stringify(depois.C));
    console.log("D (baixo só na variante):", JSON.stringify(depois.D));
    console.log("E (baixo só na coluna):  ", JSON.stringify(depois.E));

    // --- Caso A: soma das variantes ativas (10), não a coluna (11) -------
    conferir(
      "A depois: usa a soma das variantes ATIVAS (10, ignora a inativa de 999) -- custo 100, valor 200",
      depois.A.cost === 100 && depois.A.value === 200 && depois.A.low === 0,
      JSON.stringify(depois.A),
    );
    conferir(
      "CONTROLE POSITIVO: o número do produto A realmente se move com a correção (depois != antes)",
      depois.A.cost !== antes.A.cost && depois.A.value !== antes.A.value,
      `antes ${JSON.stringify(antes.A)}, depois ${JSON.stringify(depois.A)}`,
    );

    // --- Caso B: sem variante -- não-regressão, idêntico antes e depois --
    conferir(
      "B: sem variante nenhuma -- idêntico antes e depois (continua na coluna, 35/63)",
      depois.B.cost === antes.B.cost &&
        depois.B.value === antes.B.value &&
        depois.B.cost === 35 &&
        depois.B.value === 63,
      `antes ${JSON.stringify(antes.B)}, depois ${JSON.stringify(depois.B)}`,
    );

    // --- Caso C: todas inativas -- cai na coluna (6), não em zero --------
    conferir(
      "C: variantes todas INATIVAS -- cai na coluna (6), NÃO em zero -- custo 48, valor 90, idêntico antes e depois",
      depois.C.cost === antes.C.cost &&
        depois.C.value === antes.C.value &&
        depois.C.cost === 48 &&
        depois.C.value === 90,
      `antes ${JSON.stringify(antes.C)}, depois ${JSON.stringify(depois.C)}`,
    );

    // --- Caso D: passa a contar como estoque baixo ------------------------
    conferir(
      "D depois: variante ativa (3) abaixo do mínimo (5) -- PASSA a ser estoque baixo",
      depois.D.low === 1 && depois.D.cost === 3 && depois.D.value === 6,
      JSON.stringify(depois.D),
    );

    // --- Caso E: deixa de contar como estoque baixo ------------------------
    conferir(
      "E depois: variante ativa (20) acima do mínimo (5) -- DEIXA de ser estoque baixo",
      depois.E.low === 0 && depois.E.cost === 20 && depois.E.value === 40,
      JSON.stringify(depois.E),
    );

    console.log("\n=== 4. Nenhuma chave do JSON sumiu ===");
    const depoisTudo = await chamarComoAdmin(client, 30);
    const chavesAntes = Object.keys(antesTudo);
    const chavesDepois = Object.keys(depoisTudo);
    const sumiram = chavesAntes.filter((k) => !chavesDepois.includes(k));
    conferir(
      "toda chave que existia antes continua existindo depois",
      sumiram.length === 0,
      `sumiram: ${JSON.stringify(sumiram)}`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }

  console.log(
    "\n=== 5. Fora da transação: a migration realmente não foi gravada ===",
  );
  const defDepoisDoRollback = await client.query(
    `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'get_admin_analytics_v2'`,
  );
  conferir(
    "a função voltou a ser a antiga (sem o marcador da correção)",
    !defDepoisDoRollback.rows[0].def.includes(MARCADOR_CORRIGIDO),
  );

  const produtoAindaExiste = await client.query(
    "SELECT COUNT(*) AS n FROM public.produtos WHERE nome = $1",
    [NOME_TESTE],
  );
  conferir(
    "os produtos de teste sumiram (ROLLBACK desfez os INSERTs)",
    Number(produtoAindaExiste.rows[0].n) === 0,
    `contagem encontrada: ${produtoAindaExiste.rows[0].n}`,
  );

  await client.end();

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
