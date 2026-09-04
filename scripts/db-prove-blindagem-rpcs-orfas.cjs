#!/usr/bin/env node
/**
 * PROVA da aposentadoria das RPCs órfãs (BANCO-070, issue #114 — frente
 * blindagem-banco-0409).
 *
 * NADA É GRAVADO: os REVOKE/DROP da migration 20261091000000 são executados
 * DENTRO de uma transação e desfeitos com ROLLBACK no final. O banco sai
 * exatamente como entrou.
 *
 * O QUE ELE PROVA (critério de aceite da #114):
 *   PRÉ-CONDIÇÕES (ao vivo, ANTES de simular — se qualquer uma falhar, ABORTA
 *   sem simular nada: o mapa de 04/09 deixou de valer e a migration tem que
 *   ser redesenhada):
 *   P1. Nenhuma das 22 órfãs é chamada (`.rpc(`) nem CITADA como string no
 *       código (src/ + supabase/functions/) — nome em variável/ternário cai
 *       na rede de citação, como o caso real da v23/v24 em useOrders.ts.
 *   P2. As 2 sobrecargas que a migration DROPA não são referenciadas por
 *       nenhuma policy, view, cron, default, índice ou corpo de outra função.
 *
 *   AFIRMATIVAS (dentro da tx, DEPOIS dos REVOKE/DROP):
 *   A1. v22: anon e authenticated SEM EXECUTE; service_role mantém.
 *   A2. v23/v24 (as vivas do checkout): PUBLIC sem EXECUTE; anon E
 *       authenticated MANTÊM (checkout de convidado roda com chave anon).
 *   A3. Cada órfã do bloco 4: anon e authenticated sem EXECUTE.
 *   A4. Sobrecargas: exatamente UMA get_sales_analytics e UMA
 *       get_retention_analytics no catálogo (a ambiguidade morreu).
 *   A5. NÃO-REGRESSÃO: toda RPC que o código chama via .rpc( continua com
 *       EXATAMENTE os mesmos privilégios EXECUTE que tinha ANTES (fotografia
 *       antes == depois, papel a papel).
 *
 *   ENCERRAMENTO: ROLLBACK devolve o ACL ao estado de entrada.
 *
 * COMO RODAR (antes E depois de a central aplicar a migration):
 *   node scripts/db-prove-blindagem-rpcs-orfas.cjs
 *
 * Exit 0 = pré-condições + afirmativas todas OK. Exit 1 = algo caiu.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

/* eslint-disable security/detect-object-injection --
 * Índices dinâmicos são as chaves internas do próprio varredor (nomes de
 * função e papéis de listas fixas declaradas neste arquivo). */

const PROJECT_ROOT = path.resolve(__dirname, "..");

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

/** As 22 órfãs completas do mapa de 04/09 (db-inspect-blindagem-114.cjs). */
const ORFAS = [
  "check_is_admin",
  "check_user_confirmation_status",
  "decrement_stock",
  "get_active_products_internal",
  "get_admin_dashboard_stats",
  "get_admin_dashboard_summary",
  "get_admin_executive_summary",
  "get_admin_list_paginated",
  "get_category_sales",
  "get_customer_intelligence",
  "get_inventory_health",
  "get_product_optimization_data",
  "get_product_stats",
  "get_products_with_variants",
  "get_retention_analytics",
  "get_sales_analytics",
  "handle_order_item_stock",
  "tr_prevent_role_change",
  "validate_coupon_secure",
];

/** As duas que a migration DROPA (por assinatura). */
const DROPADAS = [
  {
    nome: "get_sales_analytics",
    args: "start_date timestamp without time zone, end_date timestamp without time zone",
    rotulo: "get_sales_analytics(timestamp,timestamp)",
  },
  {
    nome: "get_retention_analytics",
    args: "p_days integer",
    rotulo: "get_retention_analytics(integer)",
  },
];

const V22 = {
  nome: "create_marketplace_order_v22",
  args: "p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb",
};
const V23_24_ARGS =
  "p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb, p_destination_cep text, p_shipping_option_id text, p_idempotency_key uuid";

let falhas = 0;
function afirmar(rotulo, cond, detalhe) {
  const marca = cond ? "OK  " : "FALHOU";
  if (!cond) falhas += 1;
  console.log(`  [${marca}] ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

/** Varredura igual à do inventário: chamadas .rpc( e citações como string. */
function acharUsosNoCodigo() {
  const chamadas = new Map();
  const citacoes = new Map();
  const raizes = ["src", "supabase/functions"];
  const exts = /\.(ts|tsx|js|jsx|deno)$/;
  function registrar(mapa, nome, onde) {
    if (!mapa.has(nome)) mapa.set(nome, []);
    if (!mapa.get(nome).includes(onde)) mapa.get(nome).push(onde);
  }
  function varrer(dir) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- árvore do próprio repo
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const caminho = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name === "node_modules" || entrada.name === ".git")
          continue;
        varrer(caminho);
      } else if (exts.test(entrada.name)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
        const conteudo = fs.readFileSync(caminho, "utf8");
        for (const [padrao, tipo] of [
          [/\.rpc\(\s*["']([^"']+)["']/g, "chamada"],
          [/["']([a-z0-9_]{4,})["']/g, "citacao"],
        ]) {
          let m;
          while ((m = padrao.exec(conteudo)) !== null) {
            const linha = conteudo.slice(0, m.index).split(/\r?\n/).length;
            registrar(
              tipo === "chamada" ? chamadas : citacoes,
              m[1],
              `${path.relative(PROJECT_ROOT, caminho)}:${linha}`,
            );
          }
        }
      }
    }
  }
  for (const raiz of raizes) {
    const caminho = path.join(PROJECT_ROOT, raiz);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- raiz fixa declarada acima
    if (fs.existsSync(caminho)) varrer(caminho);
  }
  return { chamadas, citacoes };
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Prova em transação com ROLLBACK — nada é gravado (migration 20261091000000 simulada dentro da tx).\n",
  );

  // ---------- PRÉ-CONDIÇÕES (ao vivo) ------------------------------------
  console.log("=== PRÉ-CONDIÇÕES (o mapa de 04/09 ainda vale?) ===");
  const { chamadas, citacoes } = acharUsosNoCodigo();
  let preOk = true;
  for (const nome of ORFAS) {
    const c = chamadas.get(nome) ?? [];
    const t = citacoes.get(nome) ?? [];
    if (c.length > 0 || t.length > 0) {
      preOk = false;
      console.log(
        `  [FALHOU] ${nome} passou a ser usada no código: ${c[0] ?? t[0]}`,
      );
    }
  }
  afirmar(
    "P1: nenhuma das órfãs é chamada ou citada no código",
    preOk,
    preOk ? `${ORFAS.length} nomes conferidos` : "ver acima",
  );

  const refsPolicies = await client.query(
    `SELECT count(*)::int AS n FROM pg_policies
     WHERE schemaname='public' AND (qual ~ $1 OR with_check ~ $1)`,
    ["(get_sales_analytics|get_retention_analytics)"],
  );
  const refsViews = await client.query(
    `SELECT count(*)::int AS n FROM pg_views
     WHERE schemaname='public' AND definition ~ $1`,
    ["(get_sales_analytics|get_retention_analytics)"],
  );
  const refsCron = await client
    .query("SELECT count(*)::int AS n FROM cron.job WHERE command ~ $1", [
      "(get_sales_analytics|get_retention_analytics)",
    ])
    .catch(() => ({ rows: [{ n: 0 }] }));
  const refsDefaults = await client.query(
    `SELECT count(*)::int AS n FROM pg_attrdef d
     JOIN pg_class c ON c.oid = d.adrelid
     JOIN pg_namespace n2 ON n2.oid = c.relnamespace
     WHERE n2.nspname='public' AND pg_get_expr(d.adbin, d.adrelid) ~ $1`,
    ["(get_sales_analytics|get_retention_analytics)"],
  );
  const refsCorpos = await client.query(
    `SELECT count(*)::int AS n FROM pg_proc p
     JOIN pg_namespace n2 ON n2.oid = p.pronamespace
     WHERE n2.nspname='public' AND p.prosrc ~ $1
       AND p.proname !~ '(get_sales_analytics|get_retention_analytics)'`,
    ["(get_sales_analytics|get_retention_analytics)"],
  );
  const p2 =
    refsPolicies.rows[0].n === 0 &&
    refsViews.rows[0].n === 0 &&
    refsCron.rows[0].n === 0 &&
    refsDefaults.rows[0].n === 0 &&
    refsCorpos.rows[0].n === 0;
  // Nota da revisão de 04/09: P2 não consulta pg_matviews nem pg_depend —
  // hoje é indiferente (0 matviews e 0 dependências pg_depend deptype='n'
  // medidas pelo revisor), e o DROP aqui é sem CASCADE, que FALHA (não quebra
  // em cascata) se dependência existir. Se o banco ganhar views
  // materializadas, estender P2 aqui.
  afirmar(
    "P2: as 2 DROPadas não têm policy/view/cron/default/corpo apontando",
    p2,
    p2
      ? "zero referências"
      : `policies=${refsPolicies.rows[0].n} views=${refsViews.rows[0].n} cron=${refsCron.rows[0].n} defaults=${refsDefaults.rows[0].n} corpos=${refsCorpos.rows[0].n}`,
  );

  if (!preOk || !p2) {
    console.log(
      "\nABORTADO antes de simular: pré-condição caiu — a migration precisa ser redesenhada.",
    );
    await client.end();
    process.exit(1);
  }

  // ---------- FOTOGRAFIA DE EXECUTE (por papel) ---------------------------
  async function fotoExecute(nomes) {
    const r = await client.query(
      `SELECT p.proname AS nome,
              pg_get_function_identity_arguments(p.oid) AS args,
              coalesce(g.grantee::regrole::text,'PUBLIC') AS grantee
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(p.proacl) g(grantor, grantee, privilege_type, is_grantable)
       WHERE n.nspname='public' AND p.proname = ANY($1::text[])
         AND g.privilege_type='EXECUTE'
       ORDER BY p.proname, args, grantee`,
      [nomes],
    );
    const foto = {};
    for (const row of r.rows) {
      const chave = `${row.nome}(${row.args})`;
      foto[chave] ??= [];
      foto[chave].push(row.grantee);
    }
    return foto;
  }

  const ALVO = [
    ...new Set([
      ...ORFAS,
      V22.nome,
      "create_marketplace_order_v23",
      "create_marketplace_order_v24",
    ]),
  ];
  const nomesChamados = [...chamadas.keys()];
  const TODOS = [...new Set([...ALVO, ...nomesChamados])];

  console.log("\n=== Fotografia ANTES (EXECUTE por papel) ===");
  const antes = await fotoExecute(TODOS);
  console.log(`  ${Object.keys(antes).length} função(ões) fotografadas.`);
  for (const chave of Object.keys(antes).sort()) {
    console.log(`  ${chave}: ${antes[chave].join(", ")}`);
  }

  // ---------- SIMULAÇÃO (dentro de tx) -------------------------------------
  console.log(
    "\n=== Simulação do DEPOIS (REVOKE/DROP dentro de transação) ===",
  );
  await client.query("BEGIN");
  await client.query(
    `REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v22(${V22.args}) FROM anon, authenticated`,
  );
  await client.query(
    `REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v23(${V23_24_ARGS}) FROM PUBLIC`,
  );
  await client.query(
    `REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v24(${V23_24_ARGS}) FROM PUBLIC`,
  );
  for (const d of DROPADAS) {
    await client.query(`DROP FUNCTION IF EXISTS public.${d.nome}(${d.args})`);
  }
  const revokes = [
    "check_is_admin()",
    "check_user_confirmation_status(p_email text)",
    "decrement_stock(p_id uuid, quantity integer)",
    "get_active_products_internal()",
    "get_admin_dashboard_stats()",
    "get_admin_dashboard_summary()",
    "get_admin_executive_summary()",
    "get_admin_list_paginated(p_table_name text, p_page_size integer, p_page_number integer, p_search_query text, p_filter_status text)",
    "get_category_sales(start_date text, end_date text)",
    "get_customer_intelligence()",
    "get_inventory_health()",
    "get_product_optimization_data()",
    "get_product_stats()",
    "get_products_with_variants()",
    "validate_coupon_secure(p_code text, p_subtotal numeric)",
    "get_retention_analytics()",
    "get_sales_analytics(start_date timestamp with time zone, end_date timestamp with time zone)",
    "handle_order_item_stock()",
    "tr_prevent_role_change()",
  ];
  for (const fn of revokes) {
    await client.query(
      `REVOKE EXECUTE ON FUNCTION public.${fn} FROM anon, authenticated`,
    );
  }

  const depois = await fotoExecute(TODOS);

  async function temExec(nome, args, papel) {
    // has_function_privilege exige a assinatura SÓ COM TIPOS (sem nomes de
    // parâmetro): "p_items jsonb, p_total_amount numeric" -> "jsonb, numeric".
    const soTipos = args
      .split(",")
      .map((parte) => {
        const palavras = parte.trim().split(/\s+/);
        // Se o primeiro token não é um tipo conhecido, é nome de parâmetro.
        const tiposConhecidos = new Set([
          "jsonb",
          "numeric",
          "text",
          "uuid",
          "integer",
          "bigint",
          "boolean",
          "timestamp",
          "timestamptz",
          "date",
          "json",
          "real",
          "double",
          "interval",
        ]);
        if (tiposConhecidos.has(palavras[0])) return parte.trim();
        return palavras.slice(1).join(" ");
      })
      .join(", ");
    const r = await client.query(
      `SELECT has_function_privilege($1,
         'public.${nome}(' || $2 || ')', 'EXECUTE') AS tem`,
      [papel, soTipos],
    );
    return r.rows[0].tem;
  }
  async function publicTemExecute(nome, args) {
    const r = await client.query(
      `SELECT count(*)::int AS n
       FROM pg_proc p
       JOIN pg_namespace n2 ON n2.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(p.proacl) g(grantor, grantee, privilege_type, is_grantable)
       WHERE n2.nspname='public' AND p.proname=$1
         AND pg_get_function_identity_arguments(p.oid)=$2
         AND g.privilege_type='EXECUTE' AND g.grantee = 0`,
      [nome, args],
    );
    return r.rows[0].n > 0;
  }

  console.log("\n=== Afirmativas do critério de aceite (#114) ===");
  // A1: v22
  afirmar(
    "A1: v22 sem EXECUTE para anon",
    (await temExec(V22.nome, V22.args, "anon")) === false,
  );
  afirmar(
    "A1: v22 sem EXECUTE para authenticated",
    (await temExec(V22.nome, V22.args, "authenticated")) === false,
  );
  afirmar(
    "A1: v22 MANTÉM EXECUTE para service_role",
    (await temExec(V22.nome, V22.args, "service_role")) === true,
  );
  // A2: v23/v24
  for (const v of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    afirmar(
      `A2: ${v} SEM PUBLIC`,
      (await publicTemExecute(v, V23_24_ARGS)) === false,
    );
    afirmar(
      `A2: ${v} MANTÉM EXECUTE para anon (checkout de convidado)`,
      (await temExec(v, V23_24_ARGS, "anon")) === true,
    );
    afirmar(
      `A2: ${v} MANTÉM EXECUTE para authenticated`,
      (await temExec(v, V23_24_ARGS, "authenticated")) === true,
    );
  }
  // A3: órfãs
  const comArgs = {
    check_is_admin: "()",
    check_user_confirmation_status: "(p_email text)",
    decrement_stock: "(p_id uuid, quantity integer)",
    get_active_products_internal: "()",
    get_admin_dashboard_stats: "()",
    get_admin_dashboard_summary: "()",
    get_admin_executive_summary: "()",
    get_admin_list_paginated:
      "(p_table_name text, p_page_size integer, p_page_number integer, p_search_query text, p_filter_status text)",
    get_category_sales: "(start_date text, end_date text)",
    get_customer_intelligence: "()",
    get_inventory_health: "()",
    get_product_optimization_data: "()",
    get_product_stats: "()",
    get_products_with_variants: "()",
    validate_coupon_secure: "(p_code text, p_subtotal numeric)",
    get_retention_analytics: "()",
    get_sales_analytics:
      "(start_date timestamp with time zone, end_date timestamp with time zone)",
    handle_order_item_stock: "()",
    tr_prevent_role_change: "()",
  };
  for (const [nome, argsParen] of Object.entries(comArgs)) {
    const args = argsParen.slice(1, -1);
    const anonSem = (await temExec(nome, args, "anon")) === false;
    const authSem = (await temExec(nome, args, "authenticated")) === false;
    afirmar(
      `A3: ${nome}${argsParen} fora do alcance de anon e authenticated`,
      anonSem && authSem,
    );
  }
  // A4: sobrecargas
  const sobreg = await client.query(
    `SELECT p.proname, count(*)::int AS n
     FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace
     WHERE n2.nspname='public' AND p.proname IN ('get_sales_analytics','get_retention_analytics')
     GROUP BY p.proname`,
  );
  const conta = Object.fromEntries(sobreg.rows.map((r) => [r.proname, r.n]));
  afirmar(
    "A4: exatamente UMA get_sales_analytics no catálogo",
    conta.get_sales_analytics === 1,
    `tem ${conta.get_sales_analytics ?? 0}`,
  );
  afirmar(
    "A4: exatamente UMA get_retention_analytics no catálogo",
    conta.get_retention_analytics === 1,
    `tem ${conta.get_retention_analytics ?? 0}`,
  );
  // A5: não-regressão das chamadas pelo código
  let regressoes = 0;
  for (const nome of nomesChamados) {
    const chavesAntes = Object.keys(antes).filter((k) =>
      k.startsWith(`${nome}(`),
    );
    for (const chave of chavesAntes) {
      const _args = chave.slice(nome.length + 1, -1);
      const depoisSet = (depois[chave] ?? []).slice().sort().join(",");
      const antesSet = antes[chave].slice().sort().join(",");
      if (antesSet !== depoisSet) {
        regressoes += 1;
        console.log(
          `  [FALHOU] A5: ${chave} mudou: antes={${antesSet}} depois={${depoisSet}}`,
        );
      }
    }
  }
  afirmar(
    `A5: nenhuma RPC chamada pelo código (${nomesChamados.length} nomes) mudou de ACL`,
    regressoes === 0,
  );

  // ---------- ROLLBACK ------------------------------------------------------
  console.log("\n=== ROLLBACK — nada saiu gravado ===");
  await client.query("ROLLBACK");
  const apos = await fotoExecute(TODOS);
  const igual =
    JSON.stringify(
      Object.keys(apos)
        .sort()
        .map((k) => [k, apos[k].sort()]),
    ) ===
    JSON.stringify(
      Object.keys(antes)
        .sort()
        .map((k) => [k, antes[k].sort()]),
    );
  afirmar(
    "ACL pós-ROLLBACK idêntico ao de entrada (prova não gravou nada)",
    igual,
  );

  await client.end();
  console.log(
    `\n${falhas === 0 ? "TODAS AS AFIRMATIVAS PASSARAM" : `${falhas} AFIRMATIVA(S) CAÍRAM`}`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  // Se a explosão aconteceu com a tx de simulação aberta, o Postgres descarta
  // a transação órfã com ROLLBACK quando a conexão cai — nada é gravado.
  console.error(e.message);
  process.exit(1);
});
