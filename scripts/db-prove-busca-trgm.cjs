/**
 * db-prove-busca-trgm.cjs — prova da migration
 * 20261068000000_a_busca_de_pedidos_para_de_varrer_o_banco.sql (P-3, laudo
 * varredura-profunda-molde-0109, onda 3).
 *
 * TUDO em transação com ROLLBACK — nada é gravado:
 *
 *   1. MASSA descartável: ~8000 pedidos (user_id NULL — não toca auth.users)
 *      + 1 item por pedido (product_id real emprestado só como valor de FK),
 *      com nomes/cupons/rastreios/telefones com e sem acento.
 *   2. ANTES: resultados da função viva `get_admin_orders_paged` (corpo com
 *      `unaccent(` cru) para termos com e sem acento; EXPLAIN da consulta
 *      crua NÃO cita índice (controle negativo).
 *   3. APLICA a migration inteira (arquivo, inline na transação).
 *   4. DEPOIS: mesmas chamadas — total_count e ids idênticos aos de ANTES;
 *      EXPLAIN da consulta reescrita CITA o índice; `f_unaccent`/`f_digitos`
 *      existem; `get_admin_orders_paged` segue com UMA sobrecarga.
 *   5. ROLLBACK — o banco volta exatamente ao estado inicial.
 *
 * USO: node scripts/db-prove-busca-trgm.cjs   (DATABASE_URL do .env)
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.join(__dirname, "..");
const MASSA = 8000;

let falhas = 0;
function asserir(condicao, rotulo) {
  if (condicao) {
    console.log(`  ok  ${rotulo}`);
  } else {
    falhas += 1;
    console.error(`  FALHOU  ${rotulo}`);
  }
}

async function main() {
  const envPath = path.join(RAIZ, ".env");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
  const env = fs.readFileSync(envPath, "utf8");
  const linha = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  const dbUrl = linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  const contagemInicial = (
    await client.query("SELECT count(*)::int AS n FROM marketplace_orders")
  ).rows[0].n;

  try {
    await client.query("BEGIN");

    // ---- massa descartável por generate_series (rápida, em transação) ---
    // Nomes com acento e sem: a prova é que a busca COMporta acento dos dois
    // lados exatamente como antes. Telefone mascarado em customer_data,
    // como o checkout grava.
    await client.query(
      `INSERT INTO marketplace_orders
        (id, customer_name, customer_data, total, subtotal, status, payment_method,
         coupon_code, tracking_code, customer_phone)
       SELECT
        (md5('sonda-prova-p3-' || g))::uuid,
        -- O PREFIXO identifica a massa para o INSERT dos itens abaixo
        -- (ressalva da revisão da onda 3: sem ele, a tabela de itens da
        -- prova nascia vazia e o EXPLAIN do ramo EXISTS rodava sobre a
        -- tabela real). O prefixo não afeta os termos de busca de baixo.
        'SONDA PROVA P3 ' ||
        (ARRAY['José da Silva','Maria de Fátima','João Souza','Sebastião Café','Águas Claras'])[1 + (g % 5)] || ' ' || g,        jsonb_build_object('whatsapp', '(34) 9' || lpad(((g % 10000))::text, 4, '0') || '-0001'),
        100, 100, 'pending', 'pix',
        CASE WHEN g % 3 = 0 THEN 'VERÃO10' || g ELSE NULL END,
        CASE WHEN g % 4 = 0 THEN 'JR' || lpad(g::text, 8, '0') ELSE NULL END,
        CASE WHEN g % 2 = 0 THEN '(34) 97777-' || lpad(g::text, 4, '0') ELSE NULL END
       FROM generate_series(1, $1) AS g`,
      [MASSA],
    );
    const produtoId = (
      await client.query(
        "SELECT id FROM produtos ORDER BY data_cadastro LIMIT 1",
      )
    ).rows[0]?.id;
    if (!produtoId) throw new Error("dev sem produto real para a FK do item");
    await client.query(
      `INSERT INTO marketplace_order_items
        (order_id, product_id, product_name, quantity, price)
       SELECT o.id, $1,
        (ARRAY['Cafeteira Elétrica','Caneta 3D','Kit de Adesivos','Açúcar Mascavo'])[1 + (length(o.id::text) % 4)] || ' sonda ' || o.customer_name,
        1, 10
       FROM marketplace_orders o WHERE o.customer_name LIKE 'SONDA PROVA P3 %'`,
      [produtoId],
    );

    // ---- identidade: admin real (is_admin) para chamar a RPC -------------
    const adminId = (
      await client.query("SELECT id FROM profiles WHERE role = 'admin' LIMIT 1")
    ).rows[0].id;

    const chamarBusca = async (termo) => {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: adminId,
          role: "authenticated",
          app_metadata: { role: "admin" },
        }),
      ]);
      const r = await client.query(
        "SELECT get_admin_orders_paged($1, 'all', '', '', 0, 50, 'all') AS resultado",
        [termo],
      );
      await client.query("RESET ROLE");
      return r.rows[0].resultado;
    };

    const resumo = (r) => ({
      total: r.total_count,
      ids: (r.data || []).map((p) => p.id).sort(),
    });

    const TERMOS = [
      "José",
      "jose",
      "CAFÉ",
      "Maria de Fatima",
      "VERAO10",
      "7777",
    ];
    const antes = new Map();
    for (const t of TERMOS) {
      antes.set(t, resumo(await chamarBusca(t)));
    }

    // ---- controle negativo: sem os índices, consulta crua NÃO usa índice --
    const planoAntes = (
      await client.query(
        "EXPLAIN SELECT count(*) FROM marketplace_orders WHERE unaccent(customer_name) ILIKE '%jose%'",
      )
    ).rows
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    asserir(
      !planoAntes.includes("idx_orders_busca"),
      "controle negativo: consulta CRUA sem os índices não cita nenhum idx_orders_busca",
    );

    // ---- aplica a migration inteira (inline na transação) ----------------
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
    const migrationSql = fs.readFileSync(
      path.join(
        RAIZ,
        "supabase/migrations/20261068000000_a_busca_de_pedidos_para_de_varrer_o_banco.sql",
      ),
      "utf8",
    );
    await client.query(migrationSql);

    // ---- DEPOIS: planos citam os índices ---------------------------------
    const planoDepois = (
      await client.query(
        "EXPLAIN SELECT count(*) FROM marketplace_orders WHERE public.f_unaccent(customer_name) ILIKE '%jose%'",
      )
    ).rows
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    asserir(
      planoDepois.includes("idx_orders_busca_cliente"),
      "com os índices: EXPLAIN da consulta reescrita cita idx_orders_busca_cliente",
    );

    const planoItens = (
      await client.query(
        "EXPLAIN SELECT o.id FROM marketplace_orders o WHERE EXISTS (SELECT 1 FROM marketplace_order_items oi WHERE oi.order_id = o.id AND public.f_unaccent(oi.product_name) ILIKE '%cafeteira%')",
      )
    ).rows
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    asserir(
      planoItens.includes("idx_order_items_busca_produto"),
      "com os índices: EXPLAIN da busca por PRODUTO cita idx_order_items_busca_produto",
    );

    const planoFone = (
      await client.query(
        `EXPLAIN SELECT count(*) FROM marketplace_orders WHERE length(regexp_replace(coalesce(customer_phone, customer_data->>'whatsapp', ''), '[^0-9]', '', 'g')) >= 4 AND regexp_replace(coalesce(customer_phone, customer_data->>'whatsapp', ''), '[^0-9]', '', 'g') LIKE '%977770001%'`,
      )
    ).rows
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    asserir(
      planoFone.includes("idx_orders_busca_telefone"),
      "com os índices: EXPLAIN da busca por TELEFONE cita idx_orders_busca_telefone",
    );

    // ---- resultados idênticos antes/depois para TODO termo ---------------
    for (const t of TERMOS) {
      const depois = resumo(await chamarBusca(t));
      const era = antes.get(t);
      asserir(
        depois.total === era.total && depois.ids.join() === era.ids.join(),
        `resultados idênticos para "${t}" (total ${era.total} = ${depois.total}, ${era.ids.length} ids na página)`,
      );
    }

    // ---- wrappers existem; sobrecarga única; pg_trgm instalado -----------
    asserir(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('f_unaccent','f_digitos')",
        )
      ).rows[0].n === 2,
      "wrappers f_unaccent e f_digitos existem no schema public",
    );
    asserir(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'get_admin_orders_paged'",
        )
      ).rows[0].n === 1,
      "get_admin_orders_paged continua com UMA sobrecarga viva",
    );
    asserir(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_indexes WHERE indexname IN ('idx_orders_busca_cliente','idx_orders_busca_cupom','idx_orders_busca_rastreio','idx_orders_busca_id','idx_orders_busca_telefone','idx_order_items_busca_produto')",
        )
      ).rows[0].n === 6,
      "os 6 índices GIN existem",
    );

    await client.query("ROLLBACK");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }

  // ---- resíduo zero -------------------------------------------------------
  const client2 = new Client({ connectionString: dbUrl });
  await client2.connect();
  const contagemFinal = (
    await client2.query("SELECT count(*)::int AS n FROM marketplace_orders")
  ).rows[0].n;
  await client2.end();
  asserir(
    contagemFinal === contagemInicial,
    `resíduo zero: ${contagemFinal} pedidos (igual aos ${contagemInicial} de antes da prova)`,
  );

  if (falhas > 0) {
    console.error(`\nPROVA INCOMPLETA: ${falhas} asserção(ões) falharam.`);
    process.exit(1);
  }
  console.log(
    "\nPROVA COMPLETA: todas as asserções passaram. Nada foi gravado (ROLLBACK).",
  );
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
