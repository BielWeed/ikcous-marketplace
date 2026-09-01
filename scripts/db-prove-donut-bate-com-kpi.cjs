#!/usr/bin/env node
/**
 * Prova a correção do A6 (laudo novos ângulos 01/09) sem comitar nada no banco.
 *
 * TUDO roda em UMA transação terminada em ROLLBACK. Nada é gravado. Isso só
 * é verdade porque a migration NÃO tem BEGIN/COMMIT embutido — se alguém
 * acrescentar um, este script passa a gravar em produção sem avisar.
 *
 * A migration é aplicada DENTRO da transação (mesmo padrão do
 * db-prove-estoque-volta-uma-vez.cjs): a fase ANTES mede o defeito com a
 * função viva de hoje, dá ROLLBACK TO SAVEPOINT, aplica o arquivo novo e
 * refaz o cenário — antes e depois na mesma rodada, contra o MESMO banco.
 *
 * O CENÁRIO-CHAVE (A6): pedido SONDA com dois itens (categoria A = 100,
 * categoria B = 50) e total 140 — isto é, 150 de itens, MENOS 30 de cupom,
 * MAIS 20 de frete. O donut vivo soma os itens BRUTOS (150 ≠ 140 do KPI);
 * o corrigido RATEIA o total do pedido pela fração de cada categoria
 * (A = 93,33; B = 46,67) e a soma das fatias IGUALA o total — o donut vira
 * o KPI fatiado por categoria.
 *
 * AS ASSERTIVAS GLOBAIS são relativas: o banco de dev tem pedidos reais —
 * contra o mundo inteiro só se afirma "o donut nunca PASSA do dinheiro
 * reconhecido" (pedido com produto apagado sai do donut, não do KPI).
 *
 * USO:  node scripts/db-prove-donut-bate-com-kpi.cjs
 * Sai com código 0 só se todas as asserções passarem.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.join(__dirname, "..");
const MIGRATION = path.join(
  RAIZ,
  "supabase/migrations/20261063" + "000000_o_donut_soma_o_dinheiro_do_kpi.sql",
);
const CAT_A = "SONDA-A-0109";
const CAT_B = "SONDA-B-0109";
const ETIQUETA = "SONDA LAUDO 0109 DONUT";

let falhas = 0;
function asserir(condicao, rotulo) {
  if (condicao) {
    console.log(`  ✔ ${rotulo}`);
  } else {
    falhas += 1;
    console.error(`  ✘ ${rotulo}`);
  }
}

// Massa que respeita as colunas obrigatórias reais da tabela, lidas do
// information_schema — mesmo padrão do db-prove-estoque-volta-uma-vez.cjs.
async function massaGenerica(client, tabela, colsFixos, etiqueta) {
  const obrigatorias = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
        AND is_nullable='NO' AND column_default IS NULL
        AND is_identity='NO' AND is_generated='NEVER'`,
    [tabela],
  );
  const cols = { ...colsFixos };
  const usadas = new Set(Object.keys(cols));
  for (const { column_name, data_type } of obrigatorias.rows) {
    if (usadas.has(column_name)) continue;
    const generico =
      data_type === "text" ||
      data_type === "character varying" ||
      data_type === "character"
        ? `'${etiqueta}'`
        : data_type === "boolean"
          ? "false"
          : data_type === "numeric" ||
              data_type === "integer" ||
              data_type === "bigint"
            ? "0"
            : data_type.includes("timestamp") || data_type === "date"
              ? "now()"
              : data_type === "jsonb" || data_type === "json"
                ? "'{}'"
                : data_type === "uuid"
                  ? "gen_random_uuid()"
                  : null;
    if (generico === null) continue;
    // eslint-disable-next-line security/detect-object-injection -- coluna vem do information_schema, script local sem entrada de rede
    cols[column_name] = generico;
  }
  const ins = await client.query(
    `INSERT INTO ${tabela} (${Object.keys(cols).join(", ")})
     VALUES (${Object.values(cols).join(", ")}) RETURNING id`,
  );
  return ins.rows[0].id;
}

async function main() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
  const env = fs.readFileSync(path.join(RAIZ, ".env"), "utf8");
  const linha = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  const dbUrl = linha
    .slice("DATABASE_URL=".length)
    .replace(/^"|"$/g, "");

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo da migration desta frente, sem entrada externa
  const migration = fs.readFileSync(MIGRATION, "utf8");

  const contagemAntes = async () =>
    (
      await client.query(
        `SELECT
           (SELECT count(*) FROM marketplace_orders WHERE customer_data->>'nome' = $1) AS pedidos,
           (SELECT count(*) FROM produtos WHERE nome = $1) AS produtos,
           (SELECT count(*) FROM marketplace_order_items WHERE product_name = $1) AS itens`,
        [ETIQUETA],
      )
    ).rows[0];
  const antes = await contagemAntes();

  try {
    await client.query("BEGIN");

    // is_admin() não tem atalho para a sessão psql crua (current_setting
    // ('role') é 'none' numa conexão comum — medido no corpo vivo): o
    // caminho do admin aqui é o MESMO do db-prove-estoque-volta-uma-vez —
    // claims de JWT de um admin real, transaction-local.
    const adminId = (
      await client.query(`SELECT id FROM profiles WHERE role = 'admin' LIMIT 1`)
    ).rows[0].id;
    const virarAdmin = async () => {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({
          sub: adminId,
          role: "authenticated",
          app_metadata: { role: "admin" },
        }),
      ]);
    };

    // Massa: 2 produtos (categorias A e B) + pedido total 140 + 2 itens.
    const pA = await massaGenerica(
      client, "produtos",
      { nome: `'${ETIQUETA} A'`, categoria: `'${CAT_A}'`, preco_venda: "100.00", estoque: "10", ativo: "true" },
      ETIQUETA,
    );
    const pB = await massaGenerica(
      client, "produtos",
      { nome: `'${ETIQUETA} B'`, categoria: `'${CAT_B}'`, preco_venda: "50.00", estoque: "10", ativo: "true" },
      ETIQUETA,
    );
    const pedido = await massaGenerica(
      client, "marketplace_orders",
      { status: "'processing'", payment_status: "'pago'", total: "140.00" },
      ETIQUETA,
    );
    await massaGenerica(
      client, "marketplace_order_items",
      { order_id: `'${pedido}'`, product_id: `'${pA}'`, quantity: "1", price: "100.00" },
      ETIQUETA,
    );
    await massaGenerica(
      client, "marketplace_order_items",
      { order_id: `'${pedido}'`, product_id: `'${pB}'`, quantity: "1", price: "50.00" },
      ETIQUETA,
    );

    const donutSonda = async () =>
      (
        await client.query(
          `SELECT name, value FROM get_category_analytics(
             now() - interval '1 day', now() + interval '1 hour')
            WHERE name IN ($1, $2) ORDER BY name`,
          [CAT_A, CAT_B],
        )
      ).rows;

    // ======================================================================
    // FASE ANTES — a função viva de hoje, com o defeito documentado
    // ======================================================================
    console.log("\n[ANTES] função viva (donut soma itens brutos — defeito esperado):");
    await client.query("SAVEPOINT sp_antes");
    {
      await virarAdmin();
      const linhas = await donutSonda();
      const somaBruta = linhas.reduce((s, l) => s + Number(l.value), 0);
      asserir(
        linhas.length === 2,
        `as duas categorias SONDA aparecem (${linhas.length}/2)`,
      );
      asserir(
        Math.abs(somaBruta - 150) < 0.001,
        `donut soma os itens BRUTOS (${somaBruta}) — diverge do total 140 do KPI`,
      );
    }
    await client.query("ROLLBACK TO SAVEPOINT sp_antes");

    // ======================================================================
    // FASE DEPOIS — a migration aplicada dentro da transação
    // ======================================================================
    console.log("\n[DEPOIS] migration 20261063 aplicada na transação:");
    await client.query(migration);
    {
      // O ROLLBACK TO SAVEPOINT acima desfaz o set_config local de claims
      // (GUCs voltam ao valor do savepoint) — re-armar para esta fase.
      await virarAdmin();
      const linhas = await donutSonda();
      const porNome = Object.fromEntries(
        linhas.map((l) => [l.name, Number(l.value)]),
      );
      asserir(
        linhas.length === 2,
        `as duas categorias SONDA continuam no donut (${linhas.length}/2)`,
      );
      // eslint-disable-next-line security/detect-object-injection -- chaves são constantes locais (CAT_A/CAT_B), não entrada de rede
      const fatiaA = porNome[CAT_A] ?? 0;
      // eslint-disable-next-line security/detect-object-injection -- idem
      const fatiaB = porNome[CAT_B] ?? 0;
      asserir(
        Math.abs(fatiaA - 140 * (100 / 150)) < 0.01,
        `fatia da categoria A = 93,33 (${fatiaA}) — 140 × 100/150`,
      );
      asserir(
        Math.abs(fatiaB - 140 * (50 / 150)) < 0.01,
        `fatia da categoria B = 46,67 (${fatiaB}) — 140 × 50/150`,
      );
      const somaFatias = linhas.reduce((s, l) => s + Number(l.value), 0);
      asserir(
        Math.abs(somaFatias - 140) < 0.001,
        `soma das fatias = ${somaFatias} = o total do pedido que o KPI soma`,
      );

      // Mundo inteiro (com pedidos reais do dev): o donut nunca PASSA do
      // dinheiro reconhecido do período — igualdade exata só com catálogo
      // íntegro; pedido com produto apagado sai do donut e deixa o KPI maior.
      const global = (
        await client.query(
          `WITH cat AS (
             SELECT COALESCE(SUM(value), 0)::numeric AS s
             FROM get_category_analytics(now() - interval '90 days', now())
           ), kpi AS (
             SELECT COALESCE(SUM(total), 0)::numeric AS s
             FROM marketplace_orders
              WHERE created_at >= now() - interval '90 days'
                AND status NOT IN ('cancelled', 'returned')
                AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
           )
           SELECT cat.s AS donut, kpi.s AS kpi FROM cat, kpi`,
        )
      ).rows[0];
      asserir(
        Number(global.donut) <= Number(global.kpi) + 0.001,
        `donut global (${global.donut}) ≤ dinheiro reconhecido do período (${global.kpi})`,
      );

      // Guarda de admin de pé: SEM claims (set_config NULL) e com o papel
      // anon, is_admin() tem que recusar — é o caminho do cliente real.
      // O SAVEPOINT é o que mantém a transação viva DEPOIS do RAISE
      // esperado (recusa de RPC aborta a transação; sem savepoint, nem o
      // RESET ROLE do finally executa).
      let recusouAnon = false;
      // `''` e não NULL: é o vazio que o próprio is_admin trata como
      // "sem claims" (IS NOT NULL AND <> ''); NULL não derruba a GUC.
      await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
      await client.query("SET LOCAL ROLE anon");
      await client.query("SAVEPOINT sp_anon");
      try {
        await client.query(
          "SELECT * FROM get_category_analytics(now(), now())",
        );
      } catch (e) {
        // Duas portas honestas: o EXECUTE da função é revogado para anon
        // ("permission denied") e, mesmo com EXECUTE, o is_admin() de
        // dentro levanta "Acesso negado". Qualquer das duas serve.
        recusouAnon = /Acesso negado|permission denied/.test(e.message);
        await client.query("ROLLBACK TO SAVEPOINT sp_anon");
      } finally {
        await client.query("RESET ROLE");
      }
      asserir(recusouAnon, "anon continua RECUSADO na função");
    }
  } finally {
    await client.query("ROLLBACK");
    const depois = await contagemAntes();
    const limpo =
      Number(depois.pedidos) === Number(antes.pedidos) &&
      Number(depois.produtos) === Number(antes.produtos) &&
      Number(depois.itens) === Number(antes.itens);
    asserir(limpo, `resíduo zero (antes ${antes.pedidos}/${antes.produtos}/${antes.itens}, depois ${depois.pedidos}/${depois.produtos}/${depois.itens})`);
    await client.end();
  }

  if (falhas > 0) {
    console.error(`\nPROVA REPROVADA: ${falhas} asserção(ões).`);
    process.exit(1);
  }
  console.log("\nPROVA VERDE: o donut soma o dinheiro do KPI.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
