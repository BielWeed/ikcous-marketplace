#!/usr/bin/env node
/**
 * Prova a correção do A7 (laudo novos ângulos 01/09) sem comitar nada no banco.
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
 * O CENÁRIO-CHAVE (A7): o banco roda em TimeZone = UTC, então o "Hoje" vivo
 * começa às 21h de ONTEM no fuso de Brasília. Massa SONDA:
 *   O1 — criada às 22:00 de Brasília de ONTEM (o pico noturno): a função
 *        viva (UTC) CONTA no Hoje errado; a corrigida NÃO conta.
 *   O2 — criada às 00:30 de Brasília de HOJE: as duas contam (controle).
 * O balde do gráfico: O1 cai no dia de ONTEM em Brasília e no dia de HOJE
 * em UTC — as duas marcações divergem de propósito.
 *
 * AS ASSERTIVAS RELATIVAS: o banco de dev tem pedidos reais; nenhuma
 * asserção de valor é absoluta — a função tem que bater com a SOMA da
 * consulta equivalente no mesmo instante (é exatamente isso que "KPI =
 * dinheiro reconhecido do período" significa).
 *
 * USO:  node scripts/db-prove-fuso-do-hoje.cjs
 * Sai com código 0 só se todas as asserções passarem.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.join(__dirname, "..");
const MIGRATION = path.join(
  RAIZ,
  "supabase/migrations/20261062" + "000000_o_hoje_do_painel_e_o_dia_do_lojista.sql",
);
const NOME_PRODUTO = "SONDA LAUDO 0109 FUSO PRODUTO";

let falhas = 0;
function asserir(condicao, rotulo) {
  if (condicao) {
    console.log(`  ✔ ${rotulo}`);
  } else {
    falhas += 1;
    console.error(`  ✘ ${rotulo}`);
  }
}

// Igual ao db-prove-estoque-volta-uma-vez.cjs: massa que respeita as colunas
// obrigatórias reais da tabela, lidas do information_schema — schema muda, a
// massa continua válida.
async function massaDePedido(client, etiqueta) {
  const obrigatorias = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='marketplace_orders'
        AND is_nullable='NO' AND column_default IS NULL
        AND is_identity='NO' AND is_generated='NEVER'`,
  );
  const cols = {
    status: "'processing'",
    payment_status: "'pago'",
    total: "140.00",
  };
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
    `INSERT INTO marketplace_orders (${Object.keys(cols).join(", ")})
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

  // Contagem de resíduo ANTES — no fim, ROLLBACK garante zero diferença.
  const contagemAntes = async () =>
    (
      await client.query(
        `SELECT
           (SELECT count(*) FROM marketplace_orders WHERE customer_data->>'nome' LIKE 'SONDA LAUDO 0109 FUSO%') AS pedidos,
           (SELECT count(*) FROM produtos WHERE nome = $1) AS produtos`,
        [NOME_PRODUTO],
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

    // A fronteira NOVA (a que a migration planta) e a VELHA (a viva hoje).
    const HOJE_NOVO =
      "date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'";
    const HOJE_VELHO = "date_trunc('day', now())";
    const RECONHECIDO =
      "status NOT IN ('cancelled', 'returned') AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))";

    // Massa: O1 = 22:00 de Brasília de ONTEM; O2 = 00:30 de Brasília de HOJE.
    const criarPedidoNoHorario = async (etiqueta, horarioLocalSql) => {
      const id = await massaDePedido(client, etiqueta);
      await client.query(
        `UPDATE marketplace_orders
            SET created_at = (${horarioLocalSql}) AT TIME ZONE 'America/Sao_Paulo'
          WHERE id = $1`,
        [id],
      );
      return id;
    };
    const ontem22 =
      "date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 day' + interval '22 hours'";
    const hoje0030 =
      "date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '30 minutes'";
    const o1 = await criarPedidoNoHorario("SONDA LAUDO 0109 FUSO O1", ontem22);
    const o2 = await criarPedidoNoHorario("SONDA LAUDO 0109 FUSO O2", hoje0030);

    // ======================================================================
    // FASE ANTES — a função viva de hoje, com o defeito documentado
    // ======================================================================
    console.log("\n[ANTES] função viva (Hoje em UTC — defeito esperado):");
    await client.query("SAVEPOINT sp_antes");
    {
      const contaVelha = async (id) =>
        (
          await client.query(
            `SELECT count(*)::int AS n FROM marketplace_orders
              WHERE id = $1 AND created_at >= ${HOJE_VELHO}`,
            [id],
          )
        ).rows[0].n;
      asserir((await contaVelha(o1)) === 1,
        "O1 (22:00 de Brasília de ONTEM) entra no 'Hoje' UTC — o defeito");
      asserir((await contaVelha(o2)) === 1, "O2 (00:30 de hoje) entra (controle)");

      await virarAdmin();
      const kpi = await client.query("SELECT get_admin_analytics_v2(1) AS r");
      const hojeDaFuncao = Number(kpi.rows[0].r.today.revenue);
      const somaVelha = (
        await client.query(
          `SELECT COALESCE(SUM(total), 0)::numeric AS s FROM marketplace_orders
            WHERE created_at >= ${HOJE_VELHO} AND ${RECONHECIDO}`,
        )
      ).rows[0].s;
      asserir(
        Math.abs(hojeDaFuncao - Number(somaVelha)) < 0.001,
        `função Hoje (${hojeDaFuncao}) = soma do período UTC (${somaVelha}) — a função mede o dia UTC`,
      );
    }
    await client.query("ROLLBACK TO SAVEPOINT sp_antes");

    // ======================================================================
    // FASE DEPOIS — a migration aplicada dentro da transação
    // ======================================================================
    console.log("\n[DEPOIS] migration 20261062 aplicada na transação:");
    await client.query(migration);
    {
      // O ROLLBACK TO SAVEPOINT acima desfaz o set_config local de claims
      // (GUCs voltam ao valor do savepoint) — re-armar para esta fase.
      await virarAdmin();
      const contaNova = async (id) =>
        (
          await client.query(
            `SELECT count(*)::int AS n FROM marketplace_orders
              WHERE id = $1 AND created_at >= ${HOJE_NOVO}`,
            [id],
          )
        ).rows[0].n;
      asserir((await contaNova(o1)) === 0,
        "O1 (pico de ontem) SAI do 'Hoje' — o dia virou o do lojista");
      asserir((await contaNova(o2)) === 1, "O2 (00:30 de hoje) continua no 'Hoje'");

      const kpi = await client.query("SELECT get_admin_analytics_v2(1) AS r");
      const hojeDaFuncao = Number(kpi.rows[0].r.today.revenue);
      const somaNova = (
        await client.query(
          `SELECT COALESCE(SUM(total), 0)::numeric AS s FROM marketplace_orders
            WHERE created_at >= ${HOJE_NOVO} AND ${RECONHECIDO}`,
        )
      ).rows[0].s;
      asserir(
        Math.abs(hojeDaFuncao - Number(somaNova)) < 0.001,
        `função Hoje (${hojeDaFuncao}) = soma do período LOCAL (${somaNova}) — KPI acompanhou a fronteira`,
      );

      // Balde do gráfico: O1 muda de dia entre UTC e Brasília.
      const baldes = (
        await client.query(
          `SELECT
             (created_at AT TIME ZONE 'UTC')::date AS dia_utc,
             (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia_local
           FROM marketplace_orders WHERE id = $1`,
          [o1],
        )
      ).rows[0];
      asserir(
        String(baldes.dia_utc) !== String(baldes.dia_local),
        `balde muda de dia para o pico noturno (UTC ${baldes.dia_utc} ≠ local ${baldes.dia_local})`,
      );

      // O último dia do histórico é o dia civil LOCAL de hoje.
      const hist = await client.query(
        `SELECT (elem->>'date') AS d
           FROM json_array_elements(get_admin_analytics_v2(7)->'revenueHistory') elem
          ORDER BY 1 DESC LIMIT 1`,
      );
      const hojeLocal = (
        await client.query(
          `SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d`,
        )
      ).rows[0].d;
      asserir(
        hist.rows[0].d === hojeLocal,
        `último balde do gráfico = hoje de Brasília (${hojeLocal})`,
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
        await client.query("SELECT get_admin_analytics_v2(1)");
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
      Number(depois.produtos) === Number(antes.produtos);
    asserir(limpo, `resíduo zero (antes ${antes.pedidos}/${antes.produtos}, depois ${depois.pedidos}/${depois.produtos})`);
    await client.end();
  }

  if (falhas > 0) {
    console.error(`\nPROVA REPROVADA: ${falhas} asserção(ões).`);
    process.exit(1);
  }
  console.log("\nPROVA VERDE: o Hoje do painel é o dia do lojista.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
