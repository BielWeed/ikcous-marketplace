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

/**
 * As órfãs completas do mapa de 04/09 (db-inspect-blindagem-114.cjs).
 * Conta para quem auditar (laudo 20260904-1012, ressalva 7): 19 NOMES aqui
 * = 21 assinaturas (get_sales_analytics e get_retention_analytics têm duas
 * cada) — somadas à v22 são as "22 funções órfãs" do mapa.
 */
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
  const exts = /\.(ts|tsx|js|jsx|mjs|cjs|deno)$/;
  // A passada de CITAÇÃO ignora comentários: código documenta FUNÇÃO MORTA
  // citando o nome dela (medido em 04/09: AuthContext.tsx:976 explica por que
  // check_user_confirmation_status saiu — sem o strip, a P1 abortava com a
  // citação de um comentário histórico). Chamada real nunca mora em comentário.
  const stripComentarios = (t) =>
    t
      .replace(/\/\*[\s\S]*?\*\//g, (m) => {
        removidosPeloStrip.push(m);
        return "";
      })
      .replace(/^\s*(\/\/|#).*$/gm, "");
  // B-4 do laudo 20260904-1012: o strip de comentário NÃO pode alimentar a
  // passada de CHAMADA — "image/*" de um <input accept> abre "/*" e come JSX
  // vivo até um */ dezenas de linhas adiante (medido em 4 arquivos do repo).
  // Chamada lê o BRUTO (código inteiro, linha certa); citação lê o STRIPPED
  // (documentação de função morta não é uso — AuthContext.tsx:976); e se o
  // que o strip removeu contiver .rpc(, o varredor PARA — o mapa que
  // autoriza DROP não pode depender de sorte de layout de JSX.
  const removidosPeloStrip = [];
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
      } else if (
        exts.test(entrada.name) &&
        !/_test\.|\.test\./.test(entrada.name)
      ) {
        // Arquivos de TESTE fora: uso do app é src/ e functions/, não suíte
        // (o webhook index_test.ts documenta um cliente falso com .rpc( em
        // comentário — pego pelo guarda do strip, medido em 04/09).
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
        const bruto = fs.readFileSync(caminho, "utf8");
        removidosPeloStrip.length = 0;
        const conteudo = stripComentarios(bruto);
        if (removidosPeloStrip.some((t) => /\.rpc\s*\(/.test(t))) {
          throw new Error(
            `${path.relative(PROJECT_ROOT, caminho)}: bloco removido pelo strip contém .rpc( — strip inseguro aqui; revisar à mão`,
          );
        }
        const linhaNo = (idx, texto) =>
          texto.slice(0, idx).split(/\r?\n/).length;
        for (const [padrao, tipo, texto] of [
          // Aspas-simples/aspas-duplas/CRASE no MESMO conjunto (laudo
          // 20260904-0935) — sobre o BRUTO.
          [/\.rpc\(\s*["'`]([^"'`]+)["'`]/g, "chamada", bruto],
          [/["'`]([a-z0-9_]{4,})["'`]/g, "citacao", conteudo],
        ]) {
          let m;
          while ((m = padrao.exec(texto)) !== null) {
            registrar(
              tipo === "chamada" ? chamadas : citacoes,
              m[1],
              `${path.relative(PROJECT_ROOT, caminho)}:${linhaNo(m.index, texto)}`,
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
  // A v22 entra na conferência de orfandade (laudo 20260904-1012, ressalva
  // 6): ela é o único alvo com anon cuja orfandade a P1 não media.
  const nomesOrfos = [...ORFAS, V22.nome];
  for (const nome of nomesOrfos) {
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
    preOk
      ? `${nomesOrfos.length} nomes conferidos (19 do mapa + a v22)`
      : "ver acima",
  );

  // P2 falha FECHADA (laudo 20260904-0935, bloqueio 1): "não consegui ler"
  // nunca pode valer "zero" no portão que autoriza DROP FUNCTION. Cada
  // checagem mede; se a consulta lança, P2 FALHA com o erro na frente.
  // Cron por proveniência: pg_cron ausente do banco é MEDIDO (to_regclass),
  // não capturado por catch.
  const PADRAO = "(get_sales_analytics|get_retention_analytics)";
  async function contar(rotulo, sql, params = []) {
    try {
      const r = await client.query(sql, params);
      return { rotulo, n: r.rows[0].n, nota: "" };
    } catch (e) {
      return {
        rotulo,
        n: 1,
        nota: `ERRO ao medir (${e.message}) — vale FALHA`,
      };
    }
  }
  const cronExiste = await client.query(
    "SELECT to_regclass('cron.job') IS NOT NULL AS ok",
  );
  const checagens = [
    await contar(
      "policies (TODOS os schemas)",
      "SELECT count(*)::int AS n FROM pg_policies WHERE qual ~ $1 OR with_check ~ $1",
      [PADRAO],
    ),
    await contar(
      "views (TODOS os schemas)",
      "SELECT count(*)::int AS n FROM pg_views WHERE definition ~ $1",
      [PADRAO],
    ),
    await contar(
      "views materializadas",
      "SELECT count(*)::int AS n FROM pg_matviews WHERE definition ~ $1",
      [PADRAO],
    ),
    cronExiste.rows[0].ok
      ? await contar(
          "cron jobs",
          "SELECT count(*)::int AS n FROM cron.job WHERE command ~ $1",
          [PADRAO],
        )
      : {
          rotulo: "cron jobs",
          n: 0,
          nota: "pg_cron ausente deste banco (to_regclass mediu)",
        },
    await contar(
      "defaults de coluna",
      `SELECT count(*)::int AS n FROM pg_attrdef d
       JOIN pg_class c ON c.oid = d.adrelid
       JOIN pg_namespace n2 ON n2.oid = c.relnamespace
       WHERE n2.nspname='public' AND pg_get_expr(d.adbin, d.adrelid) ~ $1`,
      [PADRAO],
    ),
    await contar(
      "índices com expressão",
      `SELECT count(*)::int AS n FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       WHERE i.indexprs IS NOT NULL AND pg_get_expr(i.indexprs, i.indrelid) ~ $1`,
      [PADRAO],
    ),
    await contar(
      "corpos de outras funções (exclusão ANCORADA: só as próprias, não a família de nomes)",
      `SELECT count(*)::int AS n FROM pg_proc p
       JOIN pg_namespace n2 ON n2.oid = p.pronamespace
       WHERE n2.nspname='public' AND p.prosrc ~ $1
         AND p.proname !~ '^(get_sales_analytics|get_retention_analytics)$'`,
      [PADRAO],
    ),
    await contar(
      "pg_depend (deptype n)",
      `SELECT count(*)::int AS n FROM pg_depend d
       WHERE d.deptype = 'n'
         AND d.refobjid IN (
           SELECT p.oid FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
           WHERE n2.nspname='public' AND p.proname IN ('get_sales_analytics','get_retention_analytics')
         )`,
    ),
  ];
  const p2 = checagens.every((c) => c.n === 0);
  afirmar(
    "P2: as 2 DROPadas não têm NADA apontando (policies/views/matviews/cron/defaults/índices/corpos/pg_depend)",
    p2,
    p2
      ? checagens
          .map((c) => `${c.rotulo}=0${c.nota ? ` [${c.nota}]` : ""}`)
          .join("; ")
      : checagens
          .filter((c) => c.n > 0)
          .map((c) => `${c.rotulo}=${c.n}${c.nota ? ` [${c.nota}]` : ""}`)
          .join("; "),
  );

  if (!preOk || !p2) {
    console.log(
      "\nABORTADO antes de simular: pré-condição caiu — a migration precisa ser redesenhada.",
    );
    await client.end();
    process.exit(1);
  }

  // ---------- FOTOGRAFIA DE EXECUTE (por papel) ---------------------------
  // proacl NULL significa "ACL default" (EXECUTE para PUBLIC, entre outros) —
  // e aclexplode(NULL) devolve ZERO linhas, o que faria a função SUMIR da
  // fotografia e a A5 passar sem compará-la (laudo 20260904-0935). O
  // COALESCE com acldefault materializa o default: função sem GRANT/REVOKE
  // explícito entra na foto com o que efetivamente vale.
  async function fotoExecute(nomes) {
    const r = await client.query(
      `SELECT p.proname AS nome,
              pg_get_function_identity_arguments(p.oid) AS args,
              coalesce(pg_get_userbyid(nullif(g.grantee, 0)), 'PUBLIC') AS grantee
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
            g(grantor, grantee, privilege_type, is_grantable)
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

  // ---------- SIMULAÇÃO: o ARQUIVO .sql é a fonte (A0) ----------------------
  // Laudo 20260904-1012, B-2: a prova não testemunhava sobre o .sql — os
  // comandos eram digitados em JS e três mutações no arquivo passavam verde.
  // Agora: os statements são LIDOS do disco, executados NA ORDEM, e a prova
  // imprime SHA-256 + contagem (e cai se a contagem for zero). Nenhum
  // comando de mudança é digitado neste .cjs.
  const MODO_VERIFICAR = process.argv.includes("--verificar");
  const crypto = require("node:crypto");
  const { execSync } = require("node:child_process");
  const MIGRACAO_114 = path.join(
    PROJECT_ROOT,
    "supabase/migrations/20261091000000_a_rpc_orfa_perde_o_execute_e_a_ambigua_morre.sql",
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo versionado no repo
  const sqlArquivo = fs.readFileSync(MIGRACAO_114, "utf8");
  const hashArquivo = crypto
    .createHash("sha256")
    .update(sqlArquivo)
    .digest("hex");
  let commit = "(git indisponível)";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: PROJECT_ROOT })
      .toString()
      .trim();
  } catch {
    /* sem git na máquina: o hash do arquivo segue valendo */
  }

  /**
   * Separador de statements: corta ";" no nível zero — fora de aspas
   * simples, comentários (-- e bloco) e DOLLAR-QUOTING ($$...$$ e
   * $tag$...$tag$ — o rollback-manual tem CREATE FUNCTION AS $function$...
   * com ";" dentro do corpo; medido: sem isto o parser corta no meio).
   */
  function separarStatements(sql) {
    const statements = [];
    let atual = "";
    let emAspas = false;
    let emBloco = false;
    let emLinha = false;
    let emDollar = null; // guarda a tag de abertura ("$$" ou "$function$")
    for (let i = 0; i < sql.length; i += 1) {
      const ch = sql[i];
      const prox = sql[i + 1];
      if (emDollar !== null) {
        // Dentro do dollar-quote: tudo é LITERAL (inclusive ;) até a tag
        // de fechamento idêntica à de abertura.
        if (sql.startsWith(emDollar, i)) {
          atual += emDollar;
          i += emDollar.length - 1;
          emDollar = null;
        } else {
          atual += ch;
        }
        continue;
      }
      if (emLinha) {
        if (ch === "\n") emLinha = false;
        atual += ch;
        continue;
      }
      if (emBloco) {
        if (ch === "*" && prox === "/") {
          emBloco = false;
          atual += "*/";
          i += 1;
        } else atual += ch;
        continue;
      }
      if (emAspas) {
        atual += ch;
        if (ch === "'") emAspas = false;
        continue;
      }
      if (ch === "-" && prox === "-") {
        emLinha = true;
        atual += "--";
        i += 1;
        continue;
      }
      if (ch === "/" && prox === "*") {
        emBloco = true;
        atual += "/*";
        i += 1;
        continue;
      }
      if (ch === "'") {
        emAspas = true;
        atual += ch;
        continue;
      }
      // dollar-quoting no nível zero: $$ ou $tag$
      if (ch === "$") {
        const m = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i));
        if (m) {
          emDollar = m[0];
          atual += m[0];
          i += m[0].length - 1;
          continue;
        }
      }
      if (ch === ";") {
        statements.push(atual);
        atual = "";
        continue;
      }
      atual += ch;
    }
    if (atual.trim()) statements.push(atual);
    // Statement que só tem comentário/whitespace não é comando.
    return statements.filter(
      (s) =>
        s
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/--[^\n]*/g, "")
          .trim().length > 0,
    );
  }
  const statementsArquivo = separarStatements(sqlArquivo);

  console.log(
    `\n=== A0: fonte da simulação é o ARQUIVO da migration ===\n  ${path.basename(MIGRACAO_114)}\n  sha256=${hashArquivo.slice(0, 16)}… · commit=${commit} · ${statementsArquivo.length} statements`,
  );
  if (statementsArquivo.length === 0) {
    console.log(
      "\n[ERRO] zero statements lidos do .sql — parser ou arquivo errado.",
    );
    process.exit(1);
  }

  // Papel da conexão (laudo 20260904-1012, ressalva 8): as afirmativas
  // "MANTÉM para postgres" medem acesso EFETIVO — e este postgres NÃO é
  // superuser, mas É membro de service_role (medição abaixo), então elas
  // têm dente: falhariam se service_role perdesse EXECUTE.
  const papelCon = await client.query(
    "SELECT current_user AS eu, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super, (SELECT pg_has_role(current_user, 'service_role', 'MEMBER')) AS membro_svc",
  );
  console.log(
    `  conexão: ${papelCon.rows[0].eu} (super=${papelCon.rows[0].super}, membro de service_role=${papelCon.rows[0].membro_svc})`,
  );

  let depois;
  if (MODO_VERIFICAR) {
    // R10: pular a simulação e medir o VIVO (pós-aplicação): as afirmativas
    // A1-A4 abaixo rodam contra o banco real, sem tx.
    console.log(
      "\n=== Modo --verificar: SEM simulação — A1-A4 medem o estado VIVO ===",
    );
    depois = await fotoExecute(TODOS);
  } else {
    console.log(
      "\n=== Simulação do DEPOIS: o ARQUIVO inteiro roda dentro de transação ===",
    );
    await client.query("BEGIN");
    // Limites da transação (laudo 20260904-0935, item 6): a tx segura
    // AccessExclusiveLock sobre ~21 objetos. Os três timeouts são DO
    // SERVIDOR — cobrem hibernação e queda sem FIN (idle > 15 s é abortado
    // pelo backend, soltando os locks).
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    for (const stmt of statementsArquivo) {
      await client.query(stmt);
    }
    depois = await fotoExecute(TODOS);
  }

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
    // O MESMO coalesce da fotoExecute (laudo 20260904-1012, B-3): sem ele,
    // aclexplode(NULL) devolve zero linhas e "SEM PUBLIC" fica verde com a
    // porta escancada num banco onde a função nasceu sem GRANT explícito
    // (o default do Postgres PARA FUNÇÃO dá EXECUTE a PUBLIC).
    const r = await client.query(
      `SELECT count(*)::int AS n
       FROM pg_proc p
       JOIN pg_namespace n2 ON n2.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g(grantor, grantee, privilege_type, is_grantable)
       WHERE n2.nspname='public' AND p.proname=$1
         AND pg_get_function_identity_arguments(p.oid)=$2
         AND g.privilege_type='EXECUTE' AND g.grantee = 0`,
      [nome, args],
    );
    return { tem: r.rows[0].n > 0, n: r.rows[0].n };
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
  // A2: v23/v24 (as vivas do checkout) — TODOS os papéis que precisam
  // continuar (laudo 20260904-0935: A2 não verificava service_role/postgres
  // nelas — assimetria sem motivo com a A1 da v22).
  for (const v of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    afirmar(
      `A2: ${v} SEM PUBLIC`,
      (await publicTemExecute(v, V23_24_ARGS)).tem === false,
    );
    afirmar(
      `A2: ${v} MANTÉM EXECUTE para anon (checkout de convidado)`,
      (await temExec(v, V23_24_ARGS, "anon")) === true,
    );
    afirmar(
      `A2: ${v} MANTÉM EXECUTE para authenticated`,
      (await temExec(v, V23_24_ARGS, "authenticated")) === true,
    );
    afirmar(
      `A2: ${v} MANTÉM EXECUTE para service_role (edges)`,
      (await temExec(v, V23_24_ARGS, "service_role")) === true,
    );
    afirmar(
      `A2: ${v} MANTÉM EXECUTE para postgres`,
      (await temExec(v, V23_24_ARGS, "postgres")) === true,
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
    // Rotular o no-op (laudo 20260904-0935): 4 destas órfãs JÁ estavam sem
    // anon/authenticated — a afirmativa passa igual se o REVOKE sumir. O
    // rótulo usa a fotografia ANTES, não adivinhação.
    const tinhamNoAntes = (antes[`${nome}(${args})`] ?? []).some(
      (p) => p === "anon" || p === "authenticated",
    );
    // A ressalva gêmea: a migration declara "postgres e service_role ficam"
    // — a prova confere em CADA uma (um FROM a mais digitado por engano
    // passaria sem isto).
    const svcMantem = (await temExec(nome, args, "service_role")) === true;
    const pgMantem = (await temExec(nome, args, "postgres")) === true;
    afirmar(
      `A3: ${nome}${argsParen} fora do alcance de anon e authenticated${tinhamNoAntes ? "" : " (no-op: já estava fechada — o REVOKE aqui não muda nada)"}`,
      anonSem && authSem && svcMantem && pgMantem,
    );
  }
  // A4: sobrecargas — conta E PINA a assinatura do sobrevivente (laudo
  // 20260904-0935: contar por nome não diz QUAL sobreviveu; se as
  // assinaturas tivessem sido trocadas, "tem 1" continuava verde).
  const sobreg = await client.query(
    `SELECT p.proname, count(*)::int AS n,
            (array_agg(pg_get_function_identity_arguments(p.oid) ORDER BY pg_get_function_identity_arguments(p.oid)))[1] AS args_sobrevivente
     FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace
     WHERE n2.nspname='public' AND p.proname IN ('get_sales_analytics','get_retention_analytics')
     GROUP BY p.proname`,
  );
  const conta = Object.fromEntries(sobreg.rows.map((r) => [r.proname, r]));
  afirmar(
    "A4: exatamente UMA get_sales_analytics e é a (timestamptz, timestamptz)",
    conta.get_sales_analytics?.n === 1 &&
      conta.get_sales_analytics?.args_sobrevivente ===
        "start_date timestamp with time zone, end_date timestamp with time zone",
    `tem ${conta.get_sales_analytics?.n ?? 0}: ${conta.get_sales_analytics?.args_sobrevivente ?? "(nenhuma)"}`,
  );
  afirmar(
    "A4: exatamente UMA get_retention_analytics e é a () RETURNS TABLE",
    conta.get_retention_analytics?.n === 1 &&
      conta.get_retention_analytics?.args_sobrevivente === "",
    `tem ${conta.get_retention_analytics?.n ?? 0}: ${conta.get_retention_analytics?.args_sobrevivente ?? "(nenhuma)"}`,
  );
  // A5: não-regressão das chamadas pelo código — nomeia cada alvo e PROVA
  // que o comparou (laudo 20260904-0935: com proacl NULL a função sumia da
  // fotografia e a afirmativa passava sem comparar nada; a foto agora
  // materializa o default com acldefault e a guarda abaixo exige chaves
  // para todo nome que existe no catálogo). v23/v24 entram na lista mesmo
  // sendo chamadas por ternário (o vão das funções do dinheiro).
  const alvosA5 = [
    ...new Set([
      ...nomesChamados,
      "create_marketplace_order_v23",
      "create_marketplace_order_v24",
    ]),
  ];
  const funcoesExistentes = new Set(
    (
      await client.query(
        `SELECT DISTINCT p.proname AS nome FROM pg_proc p
         JOIN pg_namespace n2 ON n2.oid = p.pronamespace WHERE n2.nspname='public'`,
      )
    ).rows.map((r) => r.nome),
  );
  let comparadas = 0;
  let regressoes = 0;
  for (const nome of alvosA5) {
    if (!funcoesExistentes.has(nome)) {
      regressoes += 1;
      console.log(
        `  [FALHOU] A5: ${nome} NÃO EXISTE no catálogo — o código chama um fantasma`,
      );
      continue;
    }
    const chavesAntes = Object.keys(antes).filter((k) =>
      k.startsWith(`${nome}(`),
    );
    if (chavesAntes.length === 0) {
      regressoes += 1;
      console.log(
        `  [FALHOU] A5: ${nome} existe mas não entrou na fotografia — comparação vazia é verde falso`,
      );
      continue;
    }
    for (const chave of chavesAntes) {
      comparadas += 1;
      // A isenção que a migration justifica é do PAPEL PUBLIC, não da função
      // (laudo 20260904-1012, ressalva 1): compara-se o conjunto com PUBLIC
      // descontado — v23/v24 perdem PUBLIC de propósito, e qualquer OUTRA
      // mudança nelas (ou numa v25 futura) continua sendo regressão.
      const sem = (set) =>
        (set ?? [])
          .filter((p) => p !== "PUBLIC")
          .sort()
          .join(",");
      const depoisSet = sem(depois[chave]);
      const antesSet = sem(antes[chave]);
      if (antesSet !== depoisSet) {
        regressoes += 1;
        console.log(
          `  [FALHOU] A5: ${chave} mudou: antes={${antesSet}} depois={${depoisSet}}`,
        );
      }
    }
  }
  afirmar(
    `A5: nenhuma RPC chamada pelo código (${alvosA5.length} nomes, ${comparadas} assinaturas comparadas — inclui v23/v24 do ternário) mudou de ACL (exceto PUBLIC onde a migration tira de propósito)`,
    regressoes === 0,
  );

  // ---------- ROLLBACK (só no modo simulação) --------------------------------
  if (MODO_VERIFICAR) {
    await client.end();
    console.log(
      `\n${falhas === 0 ? "TODAS AS AFIRMATIVAS PASSARAM (contra o estado VIVO)" : `${falhas} AFIRMATIVA(S) CAÍRAM`}`,
    );
    process.exit(falhas === 0 ? 0 : 1);
  }
  // R2 do laudo 20260904-1012: o ROLLBACK-MANUAL também é texto que ninguém
  // exercitava — o db-prove-rollback da casa não cobre migration de puro
  // REVOKE/DROP (detectarAlvos só enxerga CREATE FUNCTION/ALTER TABLE; ele
  // próprio falha fechado com INSTRUMENTO_QUEBRADO, medido — dívida
  // registrada no PR). Então a partida é aqui: o ARQUIVO de rollback roda
  // em cima do estado simulado e tem que devolver a fotografia de entrada.
  console.log(
    "\n=== O ROLLBACK-MANUAL do disco roda na tx e restaura a entrada ===",
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo versionado no repo
  const rollbackArquivo = fs.readFileSync(
    path.join(
      PROJECT_ROOT,
      "supabase/migrations/rollback-manual-20261091000000_a_rpc_orfa_perde_o_execute_e_a_ambigua_morre.sql",
    ),
    "utf8",
  );
  for (const stmt of separarStatements(rollbackArquivo)) {
    await client.query(stmt);
  }
  const aposRollbackArquivo = await fotoExecute(TODOS);
  const chavesFoto = new Set([
    ...Object.keys(antes),
    ...Object.keys(aposRollbackArquivo),
  ]);
  const diverg = [];
  for (const k of [...chavesFoto].sort()) {
    const a = (antes[k] ?? []).sort().join(",");
    const d = (aposRollbackArquivo[k] ?? []).sort().join(",");
    if (a !== d) diverg.push(`${k}: antes={${a}} depois={${d}}`);
  }
  afirmar(
    "P5: o ARQUIVO de rollback-manual executado devolve o ACL à fotografia de entrada (inclui os 2 CREATEs recriados)",
    diverg.length === 0,
    diverg.length === 0 ? "idêntico" : diverg.join(" | "),
  );
  // Re-executa a migration (fonte: o disco) para o ROLLBACK final fechar
  // um estado consistente e a fotografia final medir o que espera.
  for (const stmt of statementsArquivo) {
    await client.query(stmt);
  }

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
  // a transação órfã com ROLLBACK quando a conexão cai (e o
  // idle_in_transaction_session_timeout do servidor recolhe os locks). A
  // mensagem diz a fase para um log truncado não parecer sucesso parcial.
  console.error(
    `[ERRO na prova — nada é gravado; a tx órfã é descartada pelo servidor] ${e.message}`,
  );
  process.exit(1);
});
