#!/usr/bin/env node
/**
 * PROVA da convergência de grants da loja clonada (frente
 * grants-da-loja-clonada, 08/09/2026 — brief da mesa
 * equipe/entregas/20260908-brief-migration-convergencia-de-grants-loja-clonada.md).
 *
 * NADA É GRAVADO: o conteúdo da migration 2026110000200 é LIDO DO DISCO
 * (sha256 impresso) e executado DENTRO de uma transação desfeita com
 * ROLLBACK no final. O arquivo de rollback-manual também é lido do disco e
 * executado na MESMA transação, para provar que ele é o inverso fiel.
 *
 * O ALVO (58 funções × PUBLIC/anon/authenticated) está EMBUTIDO abaixo — é
 * a fotografia do banco PRINCIPAL medida em 08/09/2026 (`acl-main.json` da
 * frente), não um arquivo de scratchpad que pode sumir.
 *
 * MODOS:
 *   padrão     — lê o estado VIVO como "entrada", roda o arquivo da
 *                migration na tx, prova que o resultado bate com o ALVO,
 *                roda o rollback-manual na MESMA tx e prova que ele devolve
 *                a fotografia de ENTRADA (só quando a migration mudou algo —
 *                ver nota sobre no-op abaixo), e termina em ROLLBACK.
 *   --verificar — NÃO simula nada: mede o estado VIVO (fora de transação) e
 *                compara direto contra o ALVO. Uso: depois de aplicar de
 *                verdade no banco.
 *
 * SOBRE O CASO NO-OP (banco PRINCIPAL): se o estado de ENTRADA já bate com o
 * ALVO — que é exatamente o caso do principal, porque o ALVO É a fotografia
 * do principal —, o corpo da migration não muda nada (REVOKE de privilégio
 * ausente é no-op) e o EXERCÍCIO DO ROLLBACK É PULADO DE PROPÓSITO: o
 * rollback-manual faz GRANT incondicional (nunca é no-op), então rodá-lo
 * a partir de um estado que já é o ALVO NÃO devolveria a fotografia de
 * entrada — devolveria o estado FROUXO da Savy, que é outra coisa. Isto não
 * é uma falha da prova: é a mesma disciplina de
 * `db-prove-blindagem-anon-produtos.cjs` (ali documentada para o modo
 * `--depois`) aplicada aqui sem precisar de uma flag nova, porque quem
 * decide se o exercício se aplica é o próprio estado medido, não um rótulo
 * de "qual banco é este". No banco onde a migration muda algo (a Savy), o
 * exercício roda inteiro.
 *
 * NUNCA IMPRIME A DATABASE_URL NEM O HOST — nenhuma mensagem deste script
 * cita a URL, o host ou qualquer fragmento dela; só "conectado"/"desconectado".
 *
 * Exit 0 = tudo OK. Exit 1 = alguma afirmativa caiu. Exit 2 = INCONCLUSIVO
 * (pré-condição não bateu — nada foi simulado).
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");
const { Client } = require("pg");

/* eslint-disable security/detect-object-injection --
 * Índices dinâmicos são as 58 chaves do próprio ALVO, uma lista fixa
 * declarada neste arquivo. Nunca há payload de terceiro. */

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODO_VERIFICAR = process.argv.includes("--verificar");
const MIGRATION = path.join(
  PROJECT_ROOT,
  "supabase/migrations/2026110000200_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
);
const ROLLBACK = path.join(
  PROJECT_ROOT,
  "supabase/migrations/rollback-manual-2026110000200_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
);

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
 * Separador de statements: corta ";" no nível zero — fora de aspas simples,
 * comentários (-- e bloco) e dollar-quoting. Este arquivo não tem
 * dollar-quoting (só REVOKE/GRANT), mas o parser é o mesmo das provas irmãs
 * (db-prove-blindagem-rpcs-orfas.cjs) para não reinventar um parser de SQL
 * pela metade.
 */
function separarStatements(sql) {
  const statements = [];
  let atual = "";
  let emAspas = false;
  let emBloco = false;
  let emLinha = false;
  let emDollar = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const prox = sql[i + 1];
    if (emDollar !== null) {
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
  return statements.filter(
    (s) =>
      s
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--[^\n]*/g, "")
        .trim().length > 0,
  );
}

// O ALVO: fotografia do banco PRINCIPAL (acl-main.json, 08/09/2026) para as
// 58 funções que a migration toca — embutido aqui (o brief exige NÃO
// depender do scratchpad, que é efêmero).
const ALVO = {
  "answer_question_atomic(uuid,text,uuid)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "answer_question_atomic(uuid,text)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "check_is_admin()": { PUBLIC: false, anon: false, authenticated: false },
  "clean_expired_shipping_quotes()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "clean_old_shipping_logs()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "create_marketplace_order_v22(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb)":
    { PUBLIC: false, anon: false, authenticated: false },
  "create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)":
    { PUBLIC: false, anon: true, authenticated: true },
  "create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)":
    { PUBLIC: false, anon: true, authenticated: true },
  "decrement_stock(uuid,integer)": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "ensure_role_protection()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "generate_order_otp_v1(text,text,text)": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_active_products_internal()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_admin_analytics_v2(integer)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "get_admin_customers_paged(text,text,text,integer,integer)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "get_admin_dashboard_stats()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_admin_dashboard_summary()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_admin_executive_summary()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_admin_list_paginated(text,integer,integer,text,text)": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_admin_products_paged(text,text,text,text,integer,integer)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "get_admin_questions_paged(text,text,integer,integer)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "get_admin_reviews_paged(text,text,integer,integer)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "get_admin_user_detail(uuid)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "get_category_analytics(timestamp with time zone,timestamp with time zone)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "get_category_sales(text,text)": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_coupon_stats()": { PUBLIC: false, anon: false, authenticated: true },
  "get_customer_intelligence()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_inventory_health()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_my_complete_profile()": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "get_orders_by_otp_v1(text,text)": {
    PUBLIC: false,
    anon: true,
    authenticated: true,
  },
  "get_orders_by_whatsapp_v3(text,text,text)": {
    PUBLIC: false,
    anon: true,
    authenticated: true,
  },
  "get_product_optimization_data()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_product_recommendations(uuid,integer)": {
    PUBLIC: false,
    anon: true,
    authenticated: true,
  },
  "get_product_stats()": { PUBLIC: false, anon: false, authenticated: false },
  "get_products_with_variants()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_retention_analytics()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_retention_rate()": { PUBLIC: false, anon: false, authenticated: true },
  "get_reviews_metrics(text,integer)": {
    PUBLIC: false,
    anon: true,
    authenticated: true,
  },
  "get_sales_analytics(timestamp with time zone,timestamp with time zone)": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "get_segmented_push_targets(text,numeric,integer)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "handle_default_address()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "handle_new_user()": { PUBLIC: false, anon: false, authenticated: false },
  "handle_order_item_stock()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "handle_profile_role_sync_to_auth()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "handle_public_profile_sync()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "handle_updated_at()": { PUBLIC: false, anon: false, authenticated: false },
  "increment_helpful(uuid)": { PUBLIC: false, anon: true, authenticated: true },
  "is_admin()": { PUBLIC: false, anon: true, authenticated: true },
  "prevent_role_change()": { PUBLIC: false, anon: false, authenticated: false },
  "record_vor_action(text,jsonb,jsonb,text)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "reply_review_atomic(uuid,text,uuid)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "reply_review_atomic(uuid,text)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "swap_banner_order(uuid,uuid)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "sync_cart_atomic(jsonb)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "tr_prevent_role_change()": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
  "update_my_profile_secure(text,text,text,text)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "update_order_status_atomic(uuid,text,text,boolean)": {
    PUBLIC: false,
    anon: false,
    authenticated: true,
  },
  "validate_coupon_secure_v2(text,numeric)": {
    PUBLIC: false,
    anon: true,
    authenticated: true,
  },
  "validate_coupon_secure(text,numeric)": {
    PUBLIC: false,
    anon: false,
    authenticated: false,
  },
};
const FUNCOES = Object.keys(ALVO);

let falhas = 0;
function afirmar(rotulo, cond, detalhe) {
  const marca = cond ? "OK  " : "FALHOU";
  if (!cond) falhas += 1;
  console.log(`  [${marca}] ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

/** Existência das 58 funções (pré-condição: falha fechada se alguma sumiu ou
 * mudou de assinatura — nunca assume, sempre mede antes de simular). */
async function existemTodas(client) {
  const faltando = [];
  for (const fn of FUNCOES) {
    const r = await client.query(
      "SELECT to_regprocedure('public.' || $1) IS NOT NULL AS existe",
      [fn],
    );
    if (!r.rows[0].existe) faltando.push(fn);
  }
  return faltando;
}

/** Fotografia PUBLIC/anon/authenticated/service_role das 58 funções.
 * PUBLIC mede por aclexplode (grantee=0) — has_function_privilege NÃO é
 * usado para PUBLIC aqui (mesma disciplina de
 * db-prove-blindagem-rpcs-orfas.cjs: a doc da casa documenta o pseudo-papel
 * só para o texto da GRANT/REVOKE, a leitura de estado usa o catálogo). */
async function fotografar(client) {
  const foto = {};
  for (const fn of FUNCOES) {
    const r = await client.query(
      `SELECT
         has_function_privilege('anon', 'public.' || $1, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', 'public.' || $1, 'EXECUTE') AS authenticated,
         has_function_privilege('service_role', 'public.' || $1, 'EXECUTE') AS service_role,
         EXISTS (
           SELECT 1 FROM pg_proc p
           CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
                g(grantor, grantee, privilege_type, is_grantable)
           WHERE p.oid = ('public.' || $1)::regprocedure
             AND g.privilege_type = 'EXECUTE' AND g.grantee = 0
         ) AS "PUBLIC"`,
      [fn],
    );
    foto[fn] = r.rows[0];
  }
  return foto;
}

function fotosIguais(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function compararComAlvo(foto) {
  const divergencias = [];
  for (const fn of FUNCOES) {
    const alvo = ALVO[fn];
    const medido = foto[fn];
    for (const papel of ["PUBLIC", "anon", "authenticated"]) {
      if (medido[papel] !== alvo[papel]) {
        divergencias.push(
          `${fn} · ${papel}: medido=${medido[papel]} alvo=${alvo[papel]}`,
        );
      }
    }
  }
  return divergencias;
}

/** true se a fotografia já bate com o ALVO nos 3 papéis das 58 funções
 * (o caso do banco PRINCIPAL — ver nota do cabeçalho sobre o no-op). */
function jaEhAlvo(foto) {
  return compararComAlvo(foto).length === 0;
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  client.on("notice", () => {}); // REVOKE de privilégio ausente emite NOTICE — esperado, não é erro
  console.log("Conectado.");
  console.log(
    MODO_VERIFICAR
      ? "Modo --verificar: SEM simulação — mede o estado VIVO contra o ALVO."
      : "Modo padrão: lê o estado VIVO como entrada; o ARQUIVO da migration roda numa transação desfeita com ROLLBACK.",
  );

  // ---------- A0: fonte é o ARQUIVO, não texto redigitado ----------------
  const sqlMigration = fs.readFileSync(MIGRATION, "utf8");
  const sqlRollback = fs.readFileSync(ROLLBACK, "utf8");
  const shaMigration = crypto
    .createHash("sha256")
    .update(sqlMigration)
    .digest("hex");
  const shaRollback = crypto
    .createHash("sha256")
    .update(sqlRollback)
    .digest("hex");
  let commit = "(git indisponível)";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: PROJECT_ROOT })
      .toString()
      .trim();
  } catch {
    /* sem git na máquina: os hashes seguem valendo */
  }
  console.log(
    `\n=== A0: fonte da simulação são os ARQUIVOS do disco ===\n  ${path.basename(MIGRATION)} · sha256=${shaMigration}\n  ${path.basename(ROLLBACK)} · sha256=${shaRollback}\n  commit=${commit} · ${FUNCOES.length} funções no ALVO`,
  );
  const statementsMigration = separarStatements(sqlMigration);
  const statementsRollback = separarStatements(sqlRollback);
  if (statementsMigration.length === 0 || statementsRollback.length === 0) {
    console.log(
      "\n[ERRO] zero statements lidos de um dos dois arquivos — parser ou arquivo errado.",
    );
    process.exit(1);
  }
  console.log(
    `  ${statementsMigration.length} statements na migration · ${statementsRollback.length} statements no rollback`,
  );

  // ---------- PRÉ-CONDIÇÃO: as 58 funções existem no catálogo ------------
  console.log(
    "\n=== Pré-condição: as 58 funções do ALVO existem no catálogo ===",
  );
  const faltando = await existemTodas(client);
  if (faltando.length > 0) {
    console.log(
      `\nINCONCLUSIVO: ${faltando.length} função(ões) do ALVO NÃO existem neste banco (assinatura mudou ou banco divergiu do molde) — nada foi simulado:\n  - ${faltando.join("\n  - ")}`,
    );
    await client.end();
    process.exit(2);
  }
  console.log(`  [OK  ] 58/58 funções existem (${FUNCOES.length} conferidas)`);

  if (MODO_VERIFICAR) {
    const vivo = await fotografar(client);
    console.log(
      "\n=== --verificar: estado VIVO comparado direto contra o ALVO (sem tx) ===",
    );
    const divergencias = compararComAlvo(vivo);
    afirmar(
      `As 58 funções batem com o ALVO nos 3 papéis (PUBLIC/anon/authenticated) — ${FUNCOES.length * 3} comparações`,
      divergencias.length === 0,
      divergencias.length === 0 ? "idêntico" : divergencias.join(" | "),
    );
    await client.end();
    console.log(
      `\n${falhas === 0 ? "TODAS AS AFIRMATIVAS PASSARAM (--verificar, contra o estado VIVO)" : `${falhas} AFIRMATIVA(S) CAÍRAM`}`,
    );
    process.exit(falhas === 0 ? 0 : 1);
    return;
  }

  // ---------- ANTES (estado vivo, fora de tx) ----------------------------
  console.log(
    "\n=== Fotografia de ENTRADA (estado vivo, antes de qualquer coisa) ===",
  );
  const antes = await fotografar(client);
  const entradaJaEhAlvo = jaEhAlvo(antes);
  console.log(
    entradaJaEhAlvo
      ? "  entrada já bate com o ALVO — este banco é o PRINCIPAL (ou já convergiu); a migration deve ser NO-OP aqui."
      : "  entrada diverge do ALVO — este banco tem o ACL frouxo (o caso da Savy); a migration deve fechar a diferença.",
  );

  // ---------- SIMULAÇÃO: migration roda inteira do disco, numa tx --------
  console.log("\n=== 1. A migration roda do disco dentro de uma transação ===");
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '3s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
  for (const stmt of statementsMigration) {
    await client.query(stmt);
  }
  const depoisMigration = await fotografar(client);
  const divergenciasAlvo = compararComAlvo(depoisMigration);
  afirmar(
    `A migration converge as 58 funções para o ALVO do principal (${FUNCOES.length * 3} comparações PUBLIC/anon/authenticated)`,
    divergenciasAlvo.length === 0,
    divergenciasAlvo.length === 0
      ? "idêntico ao ALVO"
      : divergenciasAlvo.join(" | "),
  );
  // Controle: papéis que a migration NUNCA deveria tocar continuam intactos.
  let serviceRoleIntacto = true;
  for (const fn of FUNCOES) {
    if (depoisMigration[fn].service_role !== antes[fn].service_role)
      serviceRoleIntacto = false;
  }
  afirmar(
    "Controle: service_role mantém EXATAMENTE o que tinha em todas as 58 funções (a migration nunca o cita)",
    serviceRoleIntacto,
  );
  afirmar(
    entradaJaEhAlvo
      ? "NO-OP confirmado: a fotografia não mudou (entrada == depois == ALVO) — é o esperado no principal"
      : "A migration MUDOU o estado (entrada != depois) — não é um vermelho-vácuo",
    entradaJaEhAlvo
      ? fotosIguais(antes, depoisMigration)
      : !fotosIguais(antes, depoisMigration),
  );

  // ---------- ROLLBACK-MANUAL: só faz sentido quando a migration mudou algo
  if (!entradaJaEhAlvo) {
    console.log(
      "\n=== 2. O ARQUIVO de rollback-manual roda na MESMA tx e devolve a fotografia de ENTRADA ===",
    );
    for (const stmt of statementsRollback) {
      await client.query(stmt);
    }
    const aposRollbackArquivo = await fotografar(client);
    afirmar(
      "O rollback-manual do disco devolve o ACL EXATAMENTE à fotografia de entrada (58 funções, 4 papéis medidos)",
      fotosIguais(aposRollbackArquivo, antes),
    );
    // Reaplica a migration para o ROLLBACK final da tx fechar um estado
    // consistente (mesma disciplina das provas irmãs).
    for (const stmt of statementsMigration) {
      await client.query(stmt);
    }
  } else {
    console.log(
      "\n=== 2. Exercício do rollback-manual: PULADO DE PROPÓSITO (entrada já era o ALVO — ver nota do cabeçalho) ===",
    );
  }

  // ---------- ROLLBACK — nada saiu gravado --------------------------------
  console.log("\n=== 3. ROLLBACK — nada saiu gravado ===");
  await client.query("ROLLBACK");
  const apos = await fotografar(client);
  afirmar(
    "ACL pós-ROLLBACK idêntico ao de entrada (58 funções, 4 papéis — a prova não gravou nada)",
    fotosIguais(apos, antes),
  );

  await client.end();
  console.log(
    `\n${falhas === 0 ? "TODAS AS AFIRMATIVAS PASSARAM" : `${falhas} AFIRMATIVA(S) CAÍRAM`}`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(
    `[ERRO na prova — nada é gravado; a tx órfã é descartada pelo servidor] ${e.message}`,
  );
  process.exit(1);
});
