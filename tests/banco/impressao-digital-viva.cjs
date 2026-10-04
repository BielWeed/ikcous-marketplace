"use strict";

/**
 * Prova VIVA do envelope de impressão digital do aplicar-migrations.yml
 * (scripts/publicacao/impressao-digital.sql), num Postgres EFÊMERO local.
 *
 * O QUE RODA: o MESMO código do workflow — o trecho entre ENVELOPE_INICIO e
 * ENVELOPE_FIM do YAML é extraído (desfazendo os escapes do bash) e executado
 * aqui, não copiado. Cada arquivo passa pelo mesmo caminho do workflow:
 * conferirCorpo → PROVA (BEGIN…ROLLBACK) → envelope (REPEATABLE READ + FP antes
 * + corpo + FP depois + COMMIT), com a leitura que a Management API devolve
 * (o último resultado NÃO-VAZIO do comando multi-instrução).
 *
 * PRÉ-REQUISITO: DATABASE_URL aponta para o servidor EFÊMERO (CI_BANCO_EFEMERO=1,
 * localhost — efemero.cjs); o banco da URL só empresta host e credencial. A
 * prova monta o SEU banco-base: um banco novo, provisionado
 * (tests/banco/provisionar.cjs) com as migrations ANTERIORES à 20261192000000
 * (o estado em que a loja está antes da publicação) — por isso roda tanto pelo
 * rodar-isolado.cjs do CI (banco já com tudo aplicado) quanto num servidor
 * vazio. Cada cenário é um clone (CREATE DATABASE … TEMPLATE) e some no fim.
 *
 * AS PROVAS:
 *  (a) as 9 migrations (92…202) e depois a 201, cada uma pelo envelope → todas
 *      COMMIT com FP igual; a coluna nova das 92/96 nasce NULL nas linhas que
 *      já existiam, e o DEFAULT da 201 não toca linha existente;
 *  (b) MUTANTE: a migration com um UPDATE/INSERT/DELETE de topo → RAISE
 *      FP_DIVERGIU e NADA fica gravado (hash do esquema + dado idênticos);
 *  (c) CONCORRÊNCIA: outra conexão comita escrita em marketplace_orders entre o
 *      FP_ANTES e o corpo → a migration COMMIT normal (snapshot) e a leitura
 *      fresca mostra a atividade; CONTROLE: a mesma corrida com READ COMMITTED
 *      dá alarme falso (por isso o REPEATABLE READ);
 *  (d) ADD COLUMN com DEFAULT não nulo (e backfill) → recusa pela régua da
 *      coluna nova, e a mensagem que decidiu é a da coluna;
 *  (e) COMMIT de topo dentro do arquivo: o envelope sozinho NÃO recusa antes de
 *      gravar (controle: o dado fica gravado); o conferirCorpo do workflow
 *      recusa antes de qualquer rede;
 *  (f) cadeia de rollback-manual no esquema final (mesma ordem de desfazer) →
 *      todos COMMIT com FP igual; rollback FORA de ordem → recusa pela guarda
 *      do próprio arquivo com nada gravado;
 *  (g) rollback que REMOVE coluna ou tabela (com dado, sem dado) → recusa antes
 *      do COMMIT; DEFAULT novo em coluna existente e TABELA nova passam e são
 *      LISTADOS;
 *  (h) o apply que falha (HTTP, corpo com erro, timeout, rede): uma única
 *      requisição, mensagem "ESTADO DESCONHECIDO", sem retry nem ROLLBACK paralelo;
 *  (i) o GATE DE TRANSPORTE: o SQL da sonda no PG e o parser da resposta, com
 *      mutantes causais e formatos desconhecidos (desconhecido não é sucesso);
 *  (j) as consultas só-leitura 8a..8g (scripts/publicacao/consultas/) rodadas
 *      como papel só-leitura (pg_read_all_data + transação somente leitura) no
 *      banco pré-92 e no banco com 92..202 aplicadas, com mutantes causais e o
 *      controle de visibilidade contra RLS cega.
 *
 * LIMITE DECLARADO: nada aqui prova o TRANSPORTE real (a Management API). O
 * Postgres local só prova o SQL e o parser; se a API roda o corpo
 * multi-instrução numa transação única, na mesma sessão, só o gate rodando
 * contra a loja prova.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/<qualquer> \
 *        node tests/banco/rodar-isolado.cjs tests/banco/impressao-digital-viva.cjs
 *      (ou direto com node tests/banco/impressao-digital-viva.cjs)
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vêm do próprio repositório (supabase/migrations, o workflow e o
 * SQL da impressão digital), nunca de entrada de rede. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
process.chdir(REPO);
const MIGRATIONS = path.join(REPO, "supabase", "migrations");

const NOVE = [
  "20261192000000_o_ledger_registra_cada_estorno_do_mp_uma_vez.sql",
  "20261194000000_ja_estornei_so_em_pedido_pago.sql",
  "20261195000000_recusado_e_recebido_recusam_nulo.sql",
  "20261196000000_a_contestacao_decide_sob_a_trava_do_pedido.sql",
  "20261197000000_dinheiro_exige_admin_atual.sql",
  "20261198000000_cancelar_pedido_anula_a_cobranca.sql",
  "20261199000000_portas_do_painel_exigem_admin_atual.sql",
  "20261200000000_a_decisao_da_devolucao_exige_o_admin_atual.sql",
  "20261202000000_as_politicas_do_pedido_e_do_financeiro_exigem_o_admin_atual.sql",
];
const M201 = "20261201000000_linha_nova_nasce_sob_autorizacao.sql";
// Ordem de desfazer: 202 → 200 → 99 → 98 → 97 → 201 → 96 → 95 → 94 → 92
// (rb201 antes de rb96: o rollback da 96 recusa enquanto o DEFAULT true da 201
// está no ar).
const CADEIA_DE_ROLLBACK = [
  "rollback-manual-20261202000000_as_politicas_do_pedido_e_do_financeiro_exigem_o_admin_atual.sql",
  "rollback-manual-20261200000000_a_decisao_da_devolucao_exige_o_admin_atual.sql",
  "rollback-manual-20261199000000_portas_do_painel_exigem_admin_atual.sql",
  "rollback-manual-20261198000000_cancelar_pedido_anula_a_cobranca.sql",
  "rollback-manual-20261197000000_dinheiro_exige_admin_atual.sql",
  "rollback-manual-20261201000000_linha_nova_nasce_sob_autorizacao.sql",
  "rollback-manual-20261196000000_a_contestacao_decide_sob_a_trava_do_pedido.sql",
  "rollback-manual-20261195000000_recusado_e_recebido_recusam_nulo.sql",
  "rollback-manual-20261194000000_ja_estornei_so_em_pedido_pago.sql",
  "rollback-manual-20261192000000_o_ledger_registra_cada_estorno_do_mp_uma_vez.sql",
];

const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const PAPEL_RO = "ip_ro_prova";
const PAPEL_CEGO = "ip_ro_cego";
let resultados = 0;
function ok(msg) {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
}

// ---------------------------------------------------------------------------
// O código REAL do workflow, extraído entre os marcadores.
// ---------------------------------------------------------------------------
function carregarEnvelopeDoWorkflow(saidaDeConsole) {
  const yaml = fs.readFileSync(
    path.join(REPO, ".github", "workflows", "aplicar-migrations.yml"),
    "utf8",
  );
  const ini = yaml.indexOf("ENVELOPE_INICIO");
  const fim = yaml.indexOf("ENVELOPE_FIM");
  assert.ok(ini > 0 && fim > ini, "marcadores ENVELOPE_* ausentes no workflow");
  const trecho = yaml
    .slice(ini, fim)
    .split("\n")
    .slice(1)
    .join("\n")
    // O trecho vive dentro de node -e "…" (bash): desfaz o ÚNICO escape que o
    // bash faria, para enxergar o que o node veria em produção.
    .replace(/\\([\\$"`])/g, "$1");
  const reqRelativo = (p) =>
    require(p.startsWith(".") ? path.join(REPO, p) : p);
  const fabrica = new Function(
    "fs",
    "require",
    "console",
    `${trecho}\nreturn { secoesDoEnvelope, conferirCorpo, envelope, aplicarEnvelope, linhasDaResposta, imprimirFp, linhaDasSondas, avaliarSondas, gateDeTransporte };`,
  );
  return fabrica(fs, reqRelativo, saidaDeConsole);
}

const linhasImpressas = [];
const WF = carregarEnvelopeDoWorkflow({
  log: (...a) => linhasImpressas.push(a.join(" ")),
});

// ---------------------------------------------------------------------------
// Infra de banco
// ---------------------------------------------------------------------------
const urlBase = lerDatabaseUrlEfemera();
const nomeBase = "ip_base_pre92";
function urlDe(db) {
  const u = new URL(urlBase);
  u.pathname = `/${db}`;
  return u.toString();
}
async function usar(db, fn) {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}
async function clonar(molde, novo) {
  await usar("template1", async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${novo}"`);
    await a.query(`CREATE DATABASE "${novo}" TEMPLATE "${molde}"`);
  });
}
const clones = [];
async function clone(molde, novo) {
  await clonar(molde, novo);
  clones.push(novo);
  return novo;
}

/** O que a Management API devolve de um comando multi-instrução: o ÚLTIMO
 * resultado não-vazio (postgres-meta: res.reverse().find(rows.length !== 0)). */
function comoAApi(resultado) {
  const lista = Array.isArray(resultado) ? [...resultado] : [resultado];
  const achado = lista.reverse().find((r) => r.rows && r.rows.length !== 0);
  return JSON.stringify(achado ? achado.rows : []);
}

/** Um passo `sql()` do workflow: devolve o texto; lança em erro. */
async function sqlDoWorkflow(c, query) {
  return comoAApi(await c.query(query));
}

/** O caminho de UM arquivo no workflow: conferirCorpo → PROVA → envelope. */
async function aplicarComoOWorkflow(c, arquivo, corpo, { semProva } = {}) {
  WF.conferirCorpo(arquivo, corpo);
  if (!semProva) {
    await sqlDoWorkflow(c, `BEGIN;\n${corpo}\nROLLBACK;`);
  }
  try {
    return await sqlDoWorkflow(c, WF.envelope(corpo));
  } catch (e) {
    // SÓ higiene da conexão DESTE harness (que reaproveita a conexão entre
    // casos). O workflow NÃO faz isto: a falha para o workflow inteiro, sem
    // ROLLBACK em outra requisição.
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

const HASH_DO_ESQUEMA = `
SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
  SELECT 'f:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid))
         || ':' || coalesce(p.proacl::text, '') || ':' || coalesce(obj_description(p.oid, 'pg_proc'), '') AS x
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
  UNION ALL
  SELECT 'p:' || schemaname || '.' || tablename || '.' || policyname || ':' ||
         md5(coalesce(qual, '') || '/' || coalesce(with_check, '') || '/' || cmd::text || '/' || roles::text)
    FROM pg_policies WHERE schemaname = 'public'
  UNION ALL
  SELECT 'i:' || indexname || ':' || md5(indexdef) FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'c:' || table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '')
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL
  SELECT 't:' || c.relname || ':' || c.relkind::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
) s`;
async function hashDoEsquema(db) {
  return usar(db, async (c) => (await c.query(HASH_DO_ESQUEMA)).rows[0].h);
}
async function fpDeDados(db) {
  // As mesmas 11 tabelas, só que lidas por fora do envelope, linha a linha.
  return usar(db, async (c) => {
    const saida = {};
    for (const t of [
      "marketplace_orders",
      "marketplace_order_items",
      "marketplace_order_history",
      "marketplace_order_payment_history",
      "order_refunds",
      "devolucoes",
      "devolucao_itens",
      "fin_lancamentos",
      "fin_caixa_sessoes",
      "produtos",
      "product_variants",
    ]) {
      const r = await c.query(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(md5((to_jsonb(t) - ARRAY['mp_chargeback_id','mp_chargeback_case_id','mp_chargeback_valor_do_caso','post_autorizado_em','criada_sob_autorizacao'])::text), '' ORDER BY id), '')) AS h FROM public.${t} t`,
      );
      saida[t] = r.rows[0];
    }
    return saida;
  });
}
const existeRegistro = async (db, sql) =>
  usar(db, async (c) => (await c.query(sql)).rows[0].v);

// ---------------------------------------------------------------------------
// Fixtures: dado real nas 11 tabelas, para o hash significar alguma coisa.
// ---------------------------------------------------------------------------
const U_CLIENTE = "11111111-1111-4111-8111-111111111111";
const U_ADMIN = "22222222-2222-4222-8222-222222222222";
const P_A = "aaaaaaa1-0000-4000-8000-000000000001";
const P_B = "aaaaaaa2-0000-4000-8000-000000000002";
const V_A = "bbbbbbb1-0000-4000-8000-000000000001";
const O1 = "00000001-0000-4000-8000-000000000001";
const O2 = "00000001-0000-4000-8000-000000000002";
const O3 = "00000001-0000-4000-8000-000000000003";
const CAIXA = "f1000000-0000-4000-8000-000000000001";

async function semear(c) {
  for (const [id, meta] of [
    [U_CLIENTE, "{}"],
    [U_ADMIN, '{"role":"admin"}'],
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@fp.teste', $2::jsonb)`,
      [id, meta],
    );
  }
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin FP', 'admin') ON CONFLICT (id) DO NOTHING`,
    [U_ADMIN],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
     VALUES ($1, 'Produto A', 50, 100, true, 20), ($2, 'Produto B', 30, 100, true, 10)`,
    [P_A, P_B],
  );
  await c.query(
    `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active)
     VALUES ($1, $2, 'Tamanho', 'M', 10, true)`,
    [V_A, P_A],
  );
  const pedidos = [
    [O1, 100, "processing", "online", "pago", "credito"],
    [O2, 30, "delivered", "online", "pago", "pix"],
    [O3, 40, "pending", "online", "aguardando", null],
  ];
  for (const [id, total, status, canal, pagamento, metodo] of pedidos) {
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
          payment_method, payment_status, paid_at, metodo_online)
       VALUES ($1, $2, 'Cliente FP', '{}'::jsonb, $3, $3, $4, $5, 'online', $6,
               CASE WHEN $6 = 'pago' THEN now() END, $7)`,
      [id, U_CLIENTE, total, status, canal, pagamento, metodo],
    );
    await c.query(
      `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'Produto A', 2, $3 / 2)`,
      [id, P_A, total],
    );
    await c.query(
      `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, created_at)
       VALUES ($1, 'pending', $2, now())`,
      [id, status],
    );
  }
  await c.query(
    `INSERT INTO public.marketplace_order_payment_history (order_id, acao) VALUES ($1, 'recebido')`,
    [O2],
  );
  await c.query(
    `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, concluido_em)
     VALUES ($1, 20, 'lojista', 'concluido', now()), ($2, 10, 'lojista', 'solicitado', NULL)`,
    [O1, O2],
  );
  const itemO2 = await c.query(
    "SELECT id FROM public.marketplace_order_items WHERE order_id = $1",
    [O2],
  );
  const dev = await c.query(
    `INSERT INTO public.devolucoes (
       id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
       modalidade, metodo_retorno, status, valor_itens, valor_reembolso, reembolso_manual,
       prazo_ate, politica, concluida_em
     ) VALUES (
       gen_random_uuid(), 'DV-FP-TESTE', $1, $2, 'arrependimento', 'desisti', 'reembolso', 'reembolso',
       'local', 'entrega_na_loja', 'concluida', 30, 30, true,
       current_date + 7, '{}'::jsonb, now()
     ) RETURNING id`,
    [O2, U_CLIENTE],
  );
  await c.query(
    `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, quantidade, valor_unitario, reestocado_em)
     VALUES ($1, $2, $3, 1, 50, now())`,
    [dev.rows[0].id, itemO2.rows[0].id, P_A],
  );
  await c.query(
    `INSERT INTO public.fin_lancamentos (tipo, status, valor, conta_id, categoria_id, descricao, data_competencia, data_realizacao)
     VALUES ('entrada', 'realizado', 7, $1, (SELECT id FROM public.fin_categorias WHERE natureza = 'receita' LIMIT 1), 'lancamento FP', current_date, current_date)`,
    [CAIXA],
  );
  await c.query(
    "INSERT INTO public.fin_caixa_sessoes (conta_id, valor_abertura) VALUES ($1, 100)",
    [CAIXA],
  );
}

// ---------------------------------------------------------------------------
// Asserções auxiliares
// ---------------------------------------------------------------------------
function linhasFp(texto) {
  const linhas = WF.linhasDaResposta(texto).filter(
    (l) => l.resultado !== "tabela_nova",
  );
  assert.equal(linhas.length, 11, "a API devolveu uma linha por tabela (11)");
  return linhas;
}
function tabelasNovas(texto) {
  return WF.linhasDaResposta(texto)
    .filter((l) => l.resultado === "tabela_nova")
    .map((l) => l.tabela);
}
function assertFpIgual(texto, rotulo) {
  for (const l of linhasFp(texto)) {
    assert.equal(l.resultado, "igual", `${rotulo}: ${l.tabela}`);
    assert.equal(
      l.linhas_antes,
      l.linhas_depois,
      `${rotulo}: ${l.tabela} linhas`,
    );
    assert.equal(l.md5_antes, l.md5_depois, `${rotulo}: ${l.tabela} md5`);
  }
}
async function esperaRecusa(promessa, trechos, rotulo) {
  let erro = null;
  try {
    await promessa;
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, `${rotulo}: deveria ter sido recusado, mas COMMITOU`);
  for (const t of trechos) {
    assert.ok(
      erro.message.includes(t),
      `${rotulo}: a recusa veio pela guarda ERRADA. Esperava "${t}", veio: ${erro.message.slice(0, 400)}`,
    );
  }
  return erro;
}

// ---------------------------------------------------------------------------
/** Monta o banco-base: provisiona um banco NOVO e aplica só as migrations
 * anteriores à 20261192000000 (o estado da loja antes da publicação), pelos
 * mesmos scripts que o rpc-ci.yml usa. */
async function montarBase() {
  await usar("template1", async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nomeBase}"`);
    await a.query(`CREATE DATABASE "${nomeBase}"`);
  });
  clones.push(nomeBase);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ip-pre92-"));
  try {
    // Mesmo critério do aplicar-migrations.cjs (arquivo .sql, sem rollback-):
    // nem todo nome histórico tem 14 dígitos, e a ordem é a do nome.
    for (const e of fs.readdirSync(MIGRATIONS, { withFileTypes: true })) {
      const f = e.name;
      if (
        e.isFile() &&
        f.endsWith(".sql") &&
        !f.startsWith("rollback-") &&
        f < "20261192"
      ) {
        fs.copyFileSync(path.join(MIGRATIONS, f), path.join(dir, f));
      }
    }
    const env = { ...process.env, DATABASE_URL: urlDe(nomeBase) };
    for (const argv of [
      [path.join(__dirname, "provisionar.cjs")],
      [path.join(__dirname, "aplicar-migrations.cjs"), dir],
    ]) {
      const r = spawnSync(process.execPath, argv, { env, encoding: "utf8" });
      assert.equal(
        r.status,
        0,
        `${path.basename(argv[0])} falhou ao montar o base:\n${(r.stdout || "").slice(-600)}\n${(r.stderr || "").slice(-600)}`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  await montarBase();
  // 0. o banco base é o estado de ANTES da publicação.
  await usar(nomeBase, async (c) => {
    const r = await c.query(
      `SELECT to_regclass('public.contestacoes_decisao_final') IS NULL AS sem_tabela,
              NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_refunds' AND column_name = 'mp_chargeback_id') AS sem_coluna`,
    );
    assert.ok(
      r.rows[0].sem_tabela && r.rows[0].sem_coluna,
      "o banco base precisa ter só as migrations ANTERIORES à 20261192000000",
    );
  });
  ok("banco base = estado de ANTES (sem a 92 nem a 96)");

  const semeado = await clone(nomeBase, "ip_semeado");
  await usar(semeado, semear);
  ok(
    "fixtures: pedidos, itens, histórico, reembolsos, devolução, lançamento e caixa semeados",
  );

  // -------- 0. controle: envelope em volta de um no-op ---------------------
  {
    const db = await clone(semeado, "ip_s0");
    await usar(db, async (c) => {
      const r = await aplicarComoOWorkflow(c, "noop.sql", "SELECT 1;");
      assertFpIgual(r, "no-op");
      const linhas = linhasFp(r);
      assert.ok(
        Number(
          linhas.find((l) => l.tabela === "marketplace_orders").linhas_antes,
        ) === 3,
        "a impressão digital enxerga as 3 linhas semeadas (não é um hash de tabela vazia)",
      );
      assert.ok(
        linhas.every((l) => l.colunas_novas === "-"),
        "no-op: nenhuma coluna nova",
      );
    });
    ok(
      "(0) controle: envelope em volta de SELECT 1 → COMMIT, FP igual, 3 pedidos medidos",
    );
  }

  // -------- (a) as 9 + a 201 pelo envelope ---------------------------------
  const cheio = "ip_cheio";
  {
    const db = await clone(semeado, "ip_a");
    const antes = await fpDeDados(db);
    await usar(db, async (c) => {
      for (const arquivo of [...NOVE, M201]) {
        const r = await aplicarComoOWorkflow(c, arquivo, ler(arquivo));
        assertFpIgual(r, arquivo);
        WF.imprimirFp(arquivo, r);
        assert.deepEqual(
          tabelasNovas(r),
          arquivo === NOVE[3] ? ["contestacoes_decisao_final"] : [],
          `${arquivo}: só a 96 cria tabela, e ela aparece LISTADA (fora da comparação)`,
        );
      }
    });
    const depois = await fpDeDados(db);
    assert.deepEqual(
      depois,
      antes,
      "o dado das 11 tabelas é o mesmo, lido por fora",
    );
    ok(
      "(a) a 96 cria a tabela contestacoes_decisao_final: listada como TABELA_NOVA, fora da comparação",
    );
    ok(
      "(a) as 9 migrations + a 201 pelo envelope → 10 COMMIT, FP igual em todas; dado idêntico lido por fora",
    );
    // as colunas novas nasceram NULL nas linhas que já existiam
    await usar(db, async (c) => {
      const r = await c.query(
        `SELECT count(*)::int AS n,
                count(mp_chargeback_id)::int AS a, count(mp_chargeback_case_id)::int AS b,
                count(mp_chargeback_valor_do_caso)::int AS c, count(post_autorizado_em)::int AS d,
                count(criada_sob_autorizacao)::int AS e
           FROM public.order_refunds`,
      );
      assert.equal(r.rows[0].n, 2);
      assert.deepEqual(
        [r.rows[0].a, r.rows[0].b, r.rows[0].c, r.rows[0].d, r.rows[0].e],
        [0, 0, 0, 0, 0],
        "as 5 colunas novas continuam NULL nas 2 linhas pré-existentes (inclusive criada_sob_autorizacao, apesar do DEFAULT true da 201)",
      );
      await c.query(
        `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status) VALUES ($1, 5, 'lojista', 'solicitado')`,
        [O3],
      );
      const nova = await c.query(
        "SELECT criada_sob_autorizacao FROM public.order_refunds WHERE order_id = $1",
        [O3],
      );
      assert.equal(
        nova.rows[0].criada_sob_autorizacao,
        true,
        "linha NOVA nasce true (201)",
      );
      await c.query("DELETE FROM public.order_refunds WHERE order_id = $1", [
        O3,
      ]);
    });
    ok(
      "(a) coluna nova NULL nas linhas antigas; linha nova nasce criada_sob_autorizacao=true",
    );
    // o esquema final serve de molde para a cadeia de rollback e para o fora-de-ordem
    const hashFinal = await hashDoEsquema(db);
    await clone(db, cheio);
    const hashClone = await hashDoEsquema(cheio);
    assert.equal(hashClone, hashFinal);
    // as impressões saíram no formato do workflow
    assert.ok(
      linhasImpressas.some((l) =>
        /^FP_ANTES {2}20261192000000_.* marketplace_orders linhas=3 md5=[0-9a-f]{32}$/.test(
          l,
        ),
      ),
      "imprimirFp do workflow imprimiu FP_ANTES com contagem e md5",
    );
    assert.ok(
      linhasImpressas.some((l) =>
        /FP_DEPOIS 20261192000000_.* order_refunds linhas=2 md5=[0-9a-f]{32} colunas_novas=mp_chargeback_id defaults_alterados=- igual$/.test(
          l,
        ),
      ),
      "imprimirFp imprimiu FP_DEPOIS com a coluna nova da 92",
    );
    console.log("  amostra da saída impressa pelo workflow:");
    for (const l of linhasImpressas.filter((x) =>
      /20261192000000_.*(marketplace_orders|order_refunds)/.test(x),
    ))
      console.log(`    ${l}`);
    for (const l of linhasImpressas.filter((x) =>
      /20261196000000_.* order_refunds /.test(x),
    ))
      console.log(`    ${l}`);
  }

  // -------- (b) mutantes: dado alterado de topo -> RAISE e nada gravado -----
  {
    const mutantes = [
      [
        "UPDATE de topo em marketplace_orders",
        "UPDATE public.marketplace_orders SET customer_name = customer_name || ' x';",
        ["FP_DIVERGIU", "[marketplace_orders: linhas 3 -> 3, md5"],
      ],
      [
        "INSERT de topo em order_refunds",
        `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status) VALUES ('${O3}', 1, 'lojista', 'solicitado');`,
        ["FP_DIVERGIU", "[order_refunds: linhas 2 -> 3"],
      ],
      [
        "DELETE de topo em marketplace_order_history",
        "DELETE FROM public.marketplace_order_history;",
        ["FP_DIVERGIU", "[marketplace_order_history: linhas 3 -> 0"],
      ],
      [
        "DROP COLUMN de coluna que existia (fin_caixa_sessoes.observacao)",
        "ALTER TABLE public.fin_caixa_sessoes DROP COLUMN observacao;",
        ["FP_DIVERGIU", "fin_caixa_sessoes: coluna(s) removida(s): observacao"],
      ],
    ];
    for (const [nome, extra, trechos] of mutantes) {
      const db = await clone(semeado, "ip_b");
      const arquivo = NOVE[0];
      const corpo = `${ler(arquivo)}\n${extra}\n`;
      const hEsq = await hashDoEsquema(db);
      const hDados = await fpDeDados(db);
      await usar(db, async (c) => {
        const erro = await esperaRecusa(
          aplicarComoOWorkflow(c, arquivo, corpo),
          trechos,
          nome,
        );
        if (nome.startsWith("UPDATE")) {
          // O snapshot REPEATABLE READ NÃO esconde a escrita da PRÓPRIA transação:
          // o FP_DEPOIS enxerga o UPDATE (md5 diferente do FP_ANTES).
          const m =
            /marketplace_orders: linhas 3 -> 3, md5 ([0-9a-f]{32}) -> ([0-9a-f]{32})\]/.exec(
              erro.message,
            );
          assert.ok(m, "a mensagem traz os dois md5 de marketplace_orders");
          assert.notEqual(
            m[1],
            m[2],
            "FP_DEPOIS enxergou o UPDATE da própria migration (md5 mudou)",
          );
          console.log(
            `    md5 antes ${m[1]} -> depois ${m[2]} (mesma contagem, dado mudou)`,
          );
        }
      });
      assert.equal(await hashDoEsquema(db), hEsq, `${nome}: esquema intacto`);
      assert.deepEqual(await fpDeDados(db), hDados, `${nome}: dado intacto`);
      assert.equal(
        await existeRegistro(
          db,
          "SELECT to_regclass('public.uq_order_refunds_pedido_refund_mp') IS NULL AS v",
        ),
        true,
        `${nome}: o índice da 92 NÃO ficou (a migration inteira voltou)`,
      );
      assert.equal(
        await existeRegistro(
          db,
          "SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='order_refunds' AND column_name='mp_chargeback_id') AS v",
        ),
        true,
        `${nome}: a coluna da 92 NÃO ficou`,
      );
      ok(
        `(b) mutante ${nome} → FP_DIVERGIU e nada gravado (esquema+dado idênticos)`,
      );
    }
  }

  // -------- (c) concorrência -----------------------------------------------
  async function corrida(db, { readCommitted }) {
    const arquivo = NOVE[0]; // a 92: ADD COLUMN + índice em order_refunds
    const base = ler(arquivo);
    // o lock avisa: a migration ESPERA aqui, depois do FP_ANTES (snapshot já tirado)
    const corpo = `SELECT pg_advisory_lock(424242);\nSELECT pg_advisory_unlock(424242);\n${base}`;
    let envelopeTexto = WF.envelope(corpo);
    if (readCommitted) {
      assert.ok(envelopeTexto.includes("REPEATABLE READ"));
      envelopeTexto = envelopeTexto.replace(
        "REPEATABLE READ",
        "READ COMMITTED",
      );
    }
    const segurador = new Client({ connectionString: urlDe(db) });
    const migrador = new Client({ connectionString: urlDe(db) });
    const escritor = new Client({ connectionString: urlDe(db) });
    await segurador.connect();
    await migrador.connect();
    await escritor.connect();
    try {
      await segurador.query("SELECT pg_advisory_lock(424242)");
      const pidMigrador = (await migrador.query("SELECT pg_backend_pid() AS p"))
        .rows[0].p;
      const correndo = migrador.query(envelopeTexto).then(
        (r) => ({ r }),
        (e) => ({ e }),
      );
      // espera o migrador PARAR no lock (determinístico: FP_ANTES já rodou)
      let esperando = false;
      for (let i = 0; i < 200 && !esperando; i++) {
        const r = await escritor.query(
          `SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock' AND wait_event = 'advisory'`,
          [pidMigrador],
        );
        esperando = r.rowCount === 1;
        if (!esperando) await new Promise((res) => setTimeout(res, 50));
      }
      assert.ok(
        esperando,
        "o migrador parou no advisory lock (depois do FP_ANTES)",
      );
      // cron/webhook comitam enquanto a migration está parada
      await escritor.query(
        `UPDATE public.marketplace_orders SET customer_name = 'mudou pelo webhook' WHERE id = $1`,
        [O3],
      );
      await escritor.query(
        `INSERT INTO public.marketplace_orders (id, user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status)
         VALUES (gen_random_uuid(), $1, 'pedido novo do cron', '{}'::jsonb, 9, 9, 'pending', 'online', 'online', 'aguardando')`,
        [U_CLIENTE],
      );
      await escritor.query(
        `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status) VALUES ($1, 3, 'lojista', 'solicitado')`,
        [O3],
      );
      await segurador.query("SELECT pg_advisory_unlock(424242)");
      const desfecho = await correndo;
      return {
        desfecho,
        escritor,
        fechar: async () => {
          await segurador.end().catch(() => {});
          await migrador.end().catch(() => {});
          await escritor.end().catch(() => {});
        },
      };
    } catch (e) {
      await segurador.end().catch(() => {});
      await migrador.end().catch(() => {});
      await escritor.end().catch(() => {});
      throw e;
    }
  }
  {
    const db = await clone(semeado, "ip_c");
    const { desfecho, escritor, fechar } = await corrida(db, {
      readCommitted: false,
    });
    try {
      assert.ok(
        !desfecho.e,
        `a migration deveria COMMITar normalmente; veio: ${desfecho.e?.message}`,
      );
      assertFpIgual(comoAApi(desfecho.r), "corrida (snapshot)");
      const linhas = linhasFp(comoAApi(desfecho.r));
      assert.equal(
        Number(
          linhas.find((l) => l.tabela === "marketplace_orders").linhas_antes,
        ),
        3,
        "o snapshot NÃO viu o pedido novo",
      );
      // a leitura fresca (fora do snapshot) mostra a atividade
      const fresca = WF.linhasDaResposta(
        comoAApi(await escritor.query(WF.secoesDoEnvelope().fresca)),
      );
      const agora = Object.fromEntries(
        fresca.map((l) => [l.tabela, Number(l.linhas_agora)]),
      );
      assert.equal(
        agora.marketplace_orders,
        4,
        "a leitura fresca vê o pedido novo (atividade concorrente)",
      );
      assert.equal(agora.order_refunds, 3, "e o reembolso novo");
      assert.equal(
        (
          await escritor.query(
            `SELECT to_regclass('public.uq_order_refunds_pedido_refund_mp') IS NOT NULL AS v`,
          )
        ).rows[0].v,
        true,
        "a 92 COMMITOU (índice presente)",
      );
    } finally {
      await fechar();
    }
    ok(
      "(c) escrita concorrente comitada entre FP_ANTES e o corpo → a 92 COMMIT normal (FP igual no snapshot); leitura fresca mostra +1 pedido e +1 reembolso",
    );
  }
  {
    const db = await clone(semeado, "ip_c2");
    const { desfecho, fechar } = await corrida(db, { readCommitted: true });
    try {
      assert.ok(
        desfecho.e,
        "CONTROLE: em READ COMMITTED a mesma corrida dá alarme falso",
      );
      assert.ok(
        desfecho.e.message.includes("FP_DIVERGIU"),
        `controle: veio ${desfecho.e.message.slice(0, 200)}`,
      );
    } finally {
      await fechar();
    }
    ok(
      "(c) CONTROLE: a mesma corrida em READ COMMITTED acusa FP_DIVERGIU (alarme falso) — é o REPEATABLE READ que a evita",
    );
  }

  // -------- (d) coluna nova com valor não nulo -----------------------------
  {
    const ancora = "ADD COLUMN IF NOT EXISTS mp_chargeback_id text;";
    const casos = [
      [
        "ADD COLUMN com DEFAULT não nulo",
        (corpo) => {
          assert.ok(corpo.includes(ancora), "âncora do mutante presente na 92");
          return corpo.replace(
            ancora,
            "ADD COLUMN IF NOT EXISTS mp_chargeback_id text DEFAULT 'x';",
          );
        },
      ],
      [
        "backfill (UPDATE só da coluna nova)",
        (corpo) =>
          `${corpo}\nUPDATE public.order_refunds SET mp_chargeback_id = 'backfill';\n`,
      ],
    ];
    for (const [nome, mutar] of casos) {
      const db = await clone(semeado, "ip_d");
      const arquivo = NOVE[0];
      const corpo = mutar(ler(arquivo));
      const hEsq = await hashDoEsquema(db);
      await usar(db, async (c) => {
        const erro = await esperaRecusa(
          aplicarComoOWorkflow(c, arquivo, corpo),
          [
            "FP_DIVERGIU",
            "[order_refunds.mp_chargeback_id: coluna nova com valor nao nulo em 2 linha(s) que ja existiam]",
          ],
          nome,
        );
        // a guarda que decidiu foi a da COLUNA, não a do hash das colunas antigas
        assert.ok(
          !erro.message.includes("md5 "),
          `${nome}: o hash das colunas antigas NÃO divergiu (só a régua da coluna nova)`,
        );
      });
      assert.equal(await hashDoEsquema(db), hEsq, `${nome}: esquema intacto`);
      ok(
        `(d) ${nome} → recusa pela régua da coluna nova (hash das colunas antigas igual); esquema intacto`,
      );
    }
  }

  // -------- (e) COMMIT de topo dentro do arquivo ---------------------------
  {
    const db = await clone(semeado, "ip_e");
    const corpoComCommit = `UPDATE public.marketplace_orders SET customer_name = 'gravado antes da conferencia';\nCOMMIT;\n${ler(NOVE[0])}`;
    // CONTROLE: o envelope sozinho (sem o conferirCorpo) já gravou o UPDATE quando o erro chega
    await usar(db, async (c) => {
      await esperaRecusa(
        sqlDoWorkflow(c, WF.envelope(corpoComCommit)).catch(async (e) => {
          await c.query("ROLLBACK").catch(() => {});
          throw e;
        }),
        ["FP_SEM_ANTES"],
        "controle COMMIT de topo",
      );
    });
    const gravado = await usar(
      db,
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM public.marketplace_orders WHERE customer_name = 'gravado antes da conferencia'`,
          )
        ).rows[0].n,
    );
    assert.equal(
      gravado,
      3,
      "CONTROLE: sem o conferirCorpo, o COMMIT de topo GRAVOU o UPDATE (a recusa chegou tarde)",
    );
    // o workflow recusa ANTES de qualquer rede
    assert.throws(
      () => WF.conferirCorpo("x.sql", corpoComCommit),
      /RECUSADO \(controle de transacao/,
    );
    assert.throws(
      () => WF.conferirCorpo("x.sql", "BEGIN;\nSELECT 1;"),
      /RECUSADO \(controle de transacao/,
    );
    assert.throws(
      () => WF.conferirCorpo("x.sql", "-- c\n  rollback ;"),
      /RECUSADO \(controle de transacao/,
    );
    assert.throws(
      () => WF.conferirCorpo("x.sql", "SELECT 1;\nSELECT 2"),
      /sem ponto e virgula/,
    );
    assert.doesNotThrow(() =>
      WF.conferirCorpo(
        "x.sql",
        "SELECT 'COMMIT;'; -- END;\nDO $a$ BEGIN PERFORM 1; END; $a$;\n-- fim",
      ),
    );
    for (const arquivo of [...NOVE, M201, ...CADEIA_DE_ROLLBACK]) {
      assert.doesNotThrow(
        () => WF.conferirCorpo(arquivo, ler(arquivo)),
        arquivo,
      );
    }
    ok(
      "(e) COMMIT de topo: controle mostra que o envelope sozinho grava antes de recusar; conferirCorpo recusa antes da rede (e passa nos 20 arquivos reais)",
    );
  }

  // -------- (e2) a guarda de COMMIT contra o parser REAL do Postgres --------
  {
    // O oráculo é o Postgres: executa o corpo cru dentro de BEGIN com uma tabela
    // temporária ON COMMIT DROP; se um COMMIT/ROLLBACK/END de TOPO aconteceu, a
    // tabela sumiu. Não depende do lexer do repositório.
    const oraculoPg = async (c, corpo) => {
      try {
        const r = await c.query(
          `BEGIN;\nCREATE TEMP TABLE zz_oraculo (x int) ON COMMIT DROP;\n${corpo}\n;SELECT to_regclass('pg_temp.zz_oraculo') IS NOT NULL AS viva;`,
        );
        const ultimo = Array.isArray(r) ? r[r.length - 1] : r;
        return ultimo.rows[0].viva ? "nao_encerrou" : "encerrou";
      } catch (e) {
        return `erro:${e.message.slice(0, 60)}`;
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    };
    const corpus = [
      ["SELECT simples", "SELECT 1;", "nao_encerrou", false],
      ["COMMIT de topo", "SELECT 1;\nCOMMIT;", "encerrou", true],
      [
        "commit minúsculo e espaço antes do ;",
        "SELECT 1;\n  commit ;",
        "encerrou",
        true,
      ],
      [
        "COMMIT em comentário de linha",
        "-- COMMIT;\nSELECT 1;",
        "nao_encerrou",
        false,
      ],
      [
        "COMMIT em comentário de bloco",
        "/* COMMIT; */ SELECT 1;",
        "nao_encerrou",
        false,
      ],
      [
        "COMMIT em comentário de bloco ANINHADO",
        "/* a /* b */ COMMIT; */ SELECT 1;",
        "nao_encerrou",
        false,
      ],
      [
        "COMMIT depois de comentário de bloco",
        "SELECT 1;\n/* x */ COMMIT;",
        "encerrou",
        true,
      ],
      [
        "COMMIT depois de comentário de linha",
        "SELECT 1; -- c\nCOMMIT;",
        "encerrou",
        true,
      ],
      ["COMMIT dentro de string", "SELECT 'COMMIT;';", "nao_encerrou", false],
      [
        "COMMIT em E-string com aspa escapada",
        "SELECT E'it\\'s; COMMIT;';",
        "nao_encerrou",
        false,
      ],
      [
        "COMMIT depois de string com $$ dentro",
        "SELECT '$$'; COMMIT;",
        "encerrou",
        true,
      ],
      [
        "COMMIT em identificador entre aspas",
        'SELECT 1 AS "x; COMMIT;";',
        "nao_encerrou",
        false,
      ],
      [
        "COMMIT depois de identificador com $",
        "SELECT 1 AS x$y$; COMMIT;",
        "encerrou",
        true,
      ],
      [
        "COMMIT dentro de $$…$$ (corpo de DO)",
        "DO $$ BEGIN PERFORM 1; END; COMMIT; $$;",
        "erro",
        false,
      ],
      [
        "COMMIT dentro de função $body$",
        "CREATE FUNCTION pg_temp.zz() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN COMMIT; END $body$;",
        "nao_encerrou",
        false,
      ],
      [
        "tags aninhadas $a$ $b$ COMMIT",
        "SELECT $a$ x $b$ COMMIT; $b$ y $a$;",
        "nao_encerrou",
        false,
      ],
      [
        "COMMIT depois de dollar-quote fechado",
        "SELECT $a$ x; $a$;\nCOMMIT;",
        "encerrou",
        true,
      ],
      ["END de topo (sinônimo de COMMIT)", "SELECT 1;\nEND;", "encerrou", true],
      ["ROLLBACK de topo", "SELECT 1;\nROLLBACK;", "encerrou", true],
      ["ABORT de topo", "SELECT 1;\nABORT;", "encerrou", true],
      [
        "SAVEPOINT / ROLLBACK TO / RELEASE (não encerram)",
        "SAVEPOINT s1;\nSELECT 1;\nROLLBACK TO SAVEPOINT s1;\nRELEASE SAVEPOINT s1;",
        "nao_encerrou",
        false,
      ],
      [
        "END dentro de CASE (não é fim de transação)",
        "SELECT CASE WHEN true THEN 1 END;",
        "nao_encerrou",
        false,
      ],
    ];
    await usar(await clone(semeado, "ip_e2"), async (c) => {
      for (const [nome, corpo, esperadoPg, recusa] of corpus) {
        const veredito = await oraculoPg(c, corpo);
        if (esperadoPg === "erro") {
          assert.ok(
            veredito.startsWith("erro:"),
            `${nome}: o Postgres deveria RECUSAR (transação inválida dentro de DO); veio ${veredito}`,
          );
        } else {
          assert.equal(
            veredito,
            esperadoPg,
            `${nome}: o oráculo (Postgres) discorda da expectativa`,
          );
        }
        let recusou = false;
        let msg = "";
        try {
          WF.conferirCorpo("corpus.sql", corpo);
        } catch (e) {
          recusou = true;
          msg = e.message;
        }
        assert.equal(
          recusou,
          recusa,
          `${nome}: guarda ${recusou ? "RECUSOU" : "PASSOU"} (${msg}); esperado ${recusa ? "recusar" : "passar"}`,
        );
        if (recusou) {
          assert.match(
            msg,
            /RECUSADO \(controle de transacao no topo/,
            `${nome}: recusou pela guarda ERRADA: ${msg}`,
          );
        }
      }
    });
    // por construção: BEGIN de topo é recusado mesmo sendo no-op no Postgres (regra da casa)
    assert.throws(
      () => WF.conferirCorpo("x.sql", "BEGIN;\nSELECT 1;"),
      /RECUSADO \(controle de transacao no topo/,
    );
    ok(
      `(e2) guarda de COMMIT/ROLLBACK/END vs Postgres real: ${corpus.length} casos adversariais ($$, $tag$ aninhado, comentário, string, identificador) — a guarda concorda com o oráculo em todos (sem falso positivo nem falso negativo)`,
    );
  }

  // -------- (f) a cadeia de rollback e o fora-de-ordem ---------------------
  {
    const db = await clone(cheio, "ip_f_cadeia");
    const hCheio = await hashDoEsquema(db);
    const dadosCheio = await fpDeDados(db);
    // fora de ordem PRIMEIRO, no esquema cheio: rb97 com a 98 (e a 99, 200, 202) no ar
    {
      const rb97 = CADEIA_DE_ROLLBACK[4];
      await usar(db, async (c) => {
        const erro = await esperaRecusa(
          aplicarComoOWorkflow(c, rb97, ler(rb97)),
          ["B1_BASELINE_DIVERGENT"],
          "rb97 fora de ordem",
        );
        console.log(
          `    mensagem que decidiu (rb97 com a 98 no ar): ${erro.message.slice(0, 260)}`,
        );
      });
      assert.equal(
        await hashDoEsquema(db),
        hCheio,
        "rb97 fora de ordem: esquema intacto",
      );
      assert.deepEqual(
        await fpDeDados(db),
        dadosCheio,
        "rb97 fora de ordem: dado intacto",
      );
      ok(
        "(f) rb97 com a 98 no ar → recusa pela guarda B1_BASELINE_DIVERGENT do próprio arquivo; nada gravado",
      );
    }
    // rb96 antes da rb201 também tem de recusar (o DEFAULT true da 201 está no ar)
    {
      const rb96 = CADEIA_DE_ROLLBACK[6];
      const db2 = await clone(cheio, "ip_f_rb96");
      await usar(db2, async (c) => {
        for (const rb of CADEIA_DE_ROLLBACK.slice(0, 5)) {
          assertFpIgual(await aplicarComoOWorkflow(c, rb, ler(rb)), rb);
        }
        const hAntes = await hashDoEsquema(db2);
        const erro = await esperaRecusa(
          aplicarComoOWorkflow(c, rb96, ler(rb96)),
          ["B1_BASELINE_DIVERGENT", "DEFAULT true"],
          "rb96 antes da rb201",
        );
        console.log(
          `    mensagem que decidiu (rb96 antes da rb201): ${erro.message.slice(0, 260)}`,
        );
        assert.equal(
          await hashDoEsquema(db2),
          hAntes,
          "rb96 antes da rb201: nada gravado",
        );
      });
      ok(
        "(f) rb96 com o DEFAULT true da 201 ainda no ar → recusa pela guarda do arquivo (ordem: 201 antes da 96)",
      );
    }
    // rb95 e rb94 com a 97 no ar (a 97 redefine registrar_pagamento_recebido e
    // registrar_estorno_manual): recusam pela guarda do próprio arquivo, nomeando
    // a função, e não gravam nada.
    {
      const db3 = await clone(cheio, "ip_f_rb95_rb94");
      const hAntes = await hashDoEsquema(db3);
      const dadosAntes = await fpDeDados(db3);
      for (const [rb, funcao] of [
        [CADEIA_DE_ROLLBACK[7], "registrar_pagamento_recebido"],
        [CADEIA_DE_ROLLBACK[8], "registrar_estorno_manual"],
      ]) {
        await usar(db3, async (c) => {
          const erro = await esperaRecusa(
            aplicarComoOWorkflow(c, rb, ler(rb)),
            ["B1_BASELINE_DIVERGENT", funcao],
            `${rb} com a 97 no ar`,
          );
          console.log(
            `    mensagem que decidiu (${rb.slice(16, 30)} com a 97 no ar): ${erro.message.slice(0, 260)}`,
          );
        });
        assert.equal(
          await hashDoEsquema(db3),
          hAntes,
          `${rb}: esquema intacto`,
        );
        assert.deepEqual(
          await fpDeDados(db3),
          dadosAntes,
          `${rb}: dado intacto`,
        );
      }
      ok(
        "(f) rb95 (nomeia registrar_pagamento_recebido) e rb94 (nomeia registrar_estorno_manual) com a 97 no ar → B1_BASELINE_DIVERGENT do próprio arquivo; esquema e dado intactos",
      );
    }
    // a cadeia inteira, na ordem
    await usar(db, async (c) => {
      for (const rb of CADEIA_DE_ROLLBACK) {
        const r = await aplicarComoOWorkflow(c, rb, ler(rb));
        assertFpIgual(r, rb);
        console.log(`    COMMIT ${rb} (FP igual nas 11 tabelas)`);
      }
    });
    assert.deepEqual(
      await fpDeDados(db),
      dadosCheio,
      "o dado das 11 tabelas é o mesmo depois da cadeia inteira",
    );
    assert.notEqual(
      await hashDoEsquema(db),
      hCheio,
      "e o ESQUEMA mudou (os rollbacks fizeram efeito)",
    );
    ok(
      "(f) cadeia rb202→rb200→rb99→rb98→rb97→rb201→rb96→rb95→rb94→rb92 → 10 COMMIT, FP igual nas 11 tabelas; dado idêntico; o esquema mudou (os rollbacks fizeram efeito)",
    );
  }

  // -------- (g) rollback que REMOVE coluna/tabela, e DEFAULT/TABELA nova ----
  {
    // base: o esquema final já com tudo aplicado; dado real nas colunas/tabelas que o mutante derruba.
    const base = await clone(cheio, "ip_g_base");
    await usar(base, async (c) => {
      await c.query(
        `UPDATE public.order_refunds SET mp_chargeback_id = 'chb-1' WHERE order_id = $1`,
        [O1],
      );
      await c.query(
        `INSERT INTO public.contestacoes_decisao_final (order_id, mp_chargeback_id, mp_chargeback_case_id, decisao, origem)
         VALUES ($1, 'chb-1', 'case-1', 'a_favor_da_loja', 'teste')`,
        [O1],
      );
      const d = await c.query("SELECT id FROM public.devolucoes LIMIT 1");
      await c.query(
        `INSERT INTO public.devolucao_eventos (devolucao_id, para_status, ator) VALUES ($1, 'concluida', 'sistema')`,
        [d.rows[0].id],
      );
    });
    const rb92 = CADEIA_DE_ROLLBACK[9];
    const casos = [
      [
        "rollback que DROPa coluna COM dado (order_refunds.mp_chargeback_id)",
        "ALTER TABLE public.order_refunds DROP COLUMN mp_chargeback_id;",
        ["FP_DIVERGIU", "order_refunds: coluna(s) removida(s)"],
      ],
      [
        "rollback que DROPa tabela COM linhas fora das 11 (contestacoes_decisao_final)",
        "DROP TABLE public.contestacoes_decisao_final;",
        [
          "FP_DIVERGIU",
          "tabela contestacoes_decisao_final removida (TINHA LINHAS: perda de dado)",
        ],
      ],
      [
        "rollback que DROPa tabela COM linhas fora das 11 (devolucao_eventos)",
        "DROP TABLE public.devolucao_eventos;",
        [
          "FP_DIVERGIU",
          "tabela devolucao_eventos removida (TINHA LINHAS: perda de dado)",
        ],
      ],
      [
        "rollback que DROPa uma das 11 (devolucao_itens, 1 linha)",
        "DROP TABLE public.devolucao_itens;",
        [
          "FP_DIVERGIU",
          "tabela devolucao_itens removida (TINHA LINHAS: perda de dado)",
        ],
      ],
      [
        "rollback que DROPa tabela VAZIA (zz_vazia, criada antes)",
        "DROP TABLE public.zz_vazia;",
        ["FP_DIVERGIU", "tabela zz_vazia removida (estava vazia)"],
      ],
    ];
    for (const [nome, extra, trechos] of casos) {
      const db = await clone(base, "ip_g");
      await usar(db, (c) => c.query("CREATE TABLE public.zz_vazia (id int)"));
      const hEsq = await hashDoEsquema(db);
      const hDados = await fpDeDados(db);
      await usar(db, async (c) => {
        await esperaRecusa(
          aplicarComoOWorkflow(c, rb92, `${ler(rb92)}\n${extra}\n`),
          trechos,
          nome,
        );
      });
      assert.equal(
        await hashDoEsquema(db),
        hEsq,
        `${nome}: esquema intacto (o DROP voltou)`,
      );
      assert.deepEqual(await fpDeDados(db), hDados, `${nome}: dado intacto`);
      ok(
        `(g) ${nome} → RECUSA antes do COMMIT (pela mensagem de remoção), nada gravado`,
      );
    }
    // DEFAULT novo em coluna existente: passa e é LISTADO; tabela nova: passa e é LISTADA
    {
      const db = await clone(base, "ip_g2");
      await usar(db, async (c) => {
        const r = await aplicarComoOWorkflow(
          c,
          rb92,
          `${ler(rb92)}\nALTER TABLE public.marketplace_orders ALTER COLUMN canal SET DEFAULT 'balcao';\nCREATE TABLE public.zz_nova_com_linha AS SELECT 1 AS x;\n`,
        );
        assertFpIgual(r, "default novo");
        const linha = linhasFp(r).find(
          (l) => l.tabela === "marketplace_orders",
        );
        assert.match(
          linha.defaults_alterados,
          /^canal: .* -> 'balcao'::text$/,
          `defaults_alterados lista a mudança: ${linha.defaults_alterados}`,
        );
        assert.deepEqual(tabelasNovas(r), ["zz_nova_com_linha"]);
        const nova = WF.linhasDaResposta(r).find(
          (l) => l.resultado === "tabela_nova",
        );
        assert.equal(Number(nova.linhas_depois), 1);
        console.log(`    defaults_alterados: ${linha.defaults_alterados}`);
        console.log(
          `    tabela_nova: ${nova.tabela} linhas=${nova.linhas_depois}`,
        );
      });
      ok(
        "(g) DEFAULT novo em coluna existente passa e é LISTADO; tabela nova passa e é LISTADA (fora da comparação)",
      );
    }
  }

  // -------- (h) o apply que falha: estado desconhecido, sem repetir --------
  {
    const chamadas = [];
    const falhas = [
      [
        "HTTP 502 depois do envio",
        () => {
          throw new Error("apply x -> HTTP 502: bad gateway");
        },
      ],
      [
        "corpo com erro",
        () => {
          throw new Error('apply x -> {"message":"boom"}');
        },
      ],
      [
        "TIMEOUT (AbortSignal)",
        () => {
          const e = new Error("The operation was aborted due to timeout");
          e.name = "TimeoutError";
          throw e;
        },
      ],
      [
        "rede caindo (fetch failed)",
        () => {
          throw new TypeError("fetch failed");
        },
      ],
    ];
    for (const [nome, falha] of falhas) {
      chamadas.length = 0;
      const sqlFalso = async (titulo) => {
        chamadas.push(titulo);
        if (titulo.startsWith("apply ")) falha();
        return "[]";
      };
      const erro = await esperaRecusa(
        WF.aplicarEnvelope(sqlFalso, "20261192000000_x.sql", "SELECT 1;"),
        [
          "ESTADO DESCONHECIDO",
          "8e-conferir-92-a-202-aplicado",
          "8a-antes-92-a-202-objetos-e-corpos",
          "por LEITURA",
          "ANTES de qualquer nova tentativa",
          "não repete sozinho",
        ],
        nome,
      );
      assert.ok(
        erro.message.includes("FALHOU no apply de 20261192000000_x.sql"),
      );
      assert.deepEqual(
        chamadas,
        ["apply 20261192000000_x.sql"],
        `${nome}: UMA requisição de apply, sem repetir e SEM ROLLBACK em outra requisição`,
      );
      ok(
        `(h) ${nome} → "ESTADO DESCONHECIDO … reconciliar por LEITURA (8e/8a) …", 1 única requisição, sem retry e sem ROLLBACK paralelo`,
      );
    }
  }

  // -------- (i) GATE DE TRANSPORTE: o SQL da sonda e o parser da resposta ----
  {
    const db = await clone(semeado, "ip_i");
    const gateSql = WF.secoesDoEnvelope().gate;
    const rodar = (sqlTexto) =>
      usar(db, async (c) => comoAApi(await c.query(sqlTexto)));
    const real = await rodar(gateSql);
    const verde = WF.avaliarSondas(real);
    assert.ok(
      verde.ok,
      `a sonda real do PG tem de passar o gate: ${verde.motivos}`,
    );
    const linhaReal = WF.linhaDasSondas(real);
    console.log(
      `    resposta real (última linha não vazia): ${JSON.stringify(linhaReal).slice(0, 420)}`,
    );
    ok(
      "(i) o SQL do gate, rodado como UMA requisição no PG: as duas sondas voltam numa linha e o gate PASSA (repeatable read, on, mesmo pid, now() igual, relógio +0,2 s)",
    );

    // os três formatos de multi-statement que a API poderia usar, ambos aceitos
    const linhas = JSON.parse(real);
    assert.ok(
      WF.avaliarSondas(JSON.stringify([linhas])).ok,
      "array de arrays (último resultado) aceito",
    );
    assert.ok(
      WF.avaliarSondas(
        JSON.stringify([[{ set_config: "x" }], [{ pg_sleep: "" }], linhas]),
      ).ok,
      "array de arrays por instrução aceito",
    );
    assert.ok(
      WF.avaliarSondas(
        JSON.stringify([{ set_config: "x" }, { pg_sleep: "" }, ...linhas]),
      ).ok,
      "todas as linhas achatadas aceito",
    );
    ok(
      "(i) parser aceita: array da última instrução, array de arrays, e todas as linhas achatadas",
    );

    // READ ONLY de verdade: a sonda não consegue escrever
    await usar(db, async (c) => {
      let erro = null;
      try {
        await c.query(
          "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nUPDATE public.marketplace_orders SET customer_name = 'x';\nCOMMIT;",
        );
      } catch (e) {
        erro = e;
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
      assert.ok(
        erro && erro.code === "25006",
        `READ ONLY barra a escrita (SQLSTATE 25006 read_only_sql_transaction): ${erro?.code} ${erro?.message}`,
      );
    });
    ok(
      "(i) o gate é READ ONLY por construção: um UPDATE dentro dele é barrado pelo Postgres",
    );

    // mutantes CAUSAIS do gate: cada um cai na SUA régua
    const casos = [
      [
        "isolamento READ COMMITTED",
        gateSql.replace(
          "REPEATABLE READ READ ONLY",
          "READ COMMITTED READ ONLY",
        ),
        /isolamento não é repeatable read/,
      ],
      [
        "transação NÃO é read only",
        gateSql.replace(
          "REPEATABLE READ READ ONLY",
          "REPEATABLE READ READ WRITE",
        ),
        /transaction_read_only não é on/,
      ],
      [
        "sem o sleep (as sondas não ficam separadas no tempo)",
        gateSql.replace("pg_sleep(0.2)", "pg_sleep(0)"),
        /o relógio não avançou/,
      ],
    ];
    for (const [nome, sqlMut, esperado] of casos) {
      assert.notEqual(sqlMut, gateSql, `${nome}: mutante aplicado`);
      const resp = await rodar(sqlMut);
      const r = WF.avaliarSondas(resp);
      assert.ok(!r.ok, `${nome}: o gate deveria reprovar`);
      assert.ok(
        r.motivos.some((m) => esperado.test(m)),
        `${nome}: reprovou pela régua ERRADA: ${r.motivos}`,
      );
      ok(
        `(i) mutante "${nome}" → gate reprova pela régua certa (${r.motivos[0].slice(0, 70)})`,
      );
    }
    // statements em autocommit (a API sem transação única): now() diferente
    {
      const sonda = `SELECT json_build_object('isolamento', current_setting('transaction_isolation'), 'somente_leitura', current_setting('transaction_read_only'), 'pid', pg_backend_pid(), 'agora', now()::text, 'relogio', extract(epoch FROM clock_timestamp()))::text AS j`;
      const [s1, s2] = await usar(db, async (c) => {
        const a = (await c.query(sonda)).rows[0].j;
        await c.query("SELECT pg_sleep(0.2)");
        const b = (await c.query(sonda)).rows[0].j;
        return [a, b];
      });
      const r = WF.avaliarSondas(JSON.stringify([{ sonda1: s1, sonda2: s2 }]));
      assert.ok(!r.ok);
      assert.ok(
        r.motivos.some((m) => /now\(\) diferente/.test(m)),
        `autocommit: régua errada: ${r.motivos}`,
      );
      assert.ok(
        r.motivos.some((m) => /isolamento não é repeatable read/.test(m)),
        "e o isolamento também denuncia",
      );
      ok(
        "(i) statements em autocommit (sem transação única) → reprova por now() diferente (e isolamento)",
      );
    }
    // backends diferentes
    {
      const sonda = `SELECT json_build_object('isolamento', 'repeatable read', 'somente_leitura', 'on', 'pid', pg_backend_pid(), 'agora', now()::text, 'relogio', extract(epoch FROM clock_timestamp()))::text AS j`;
      const rodar2 = async () =>
        usar(
          db,
          async (c) => (await c.query(`BEGIN; ${sonda}; COMMIT;`))[1].rows[0].j,
        );
      const [s1, s2] = await Promise.all([rodar2(), rodar2()]);
      // mesmo "now" forçado para isolar a régua do pid
      const j1 = JSON.parse(s1);
      const j2 = JSON.parse(s2);
      j2.agora = j1.agora;
      j2.relogio = j1.relogio + 1;
      const r = WF.avaliarSondas(
        JSON.stringify([
          { sonda1: JSON.stringify(j1), sonda2: JSON.stringify(j2) },
        ]),
      );
      assert.ok(!r.ok);
      assert.ok(
        r.motivos.some((m) => /backends diferentes/.test(m)),
        `pid: régua errada: ${r.motivos}`,
      );
      ok(
        "(i) duas conexões (pids diferentes, resto forjado igual) → reprova por backends diferentes",
      );
    }
    // formatos desconhecidos: NUNCA sucesso
    const desconhecidos = [
      ["objeto de erro", '{"message":"boom"}'],
      ["array vazio", "[]"],
      ["string", '"ok"'],
      ["null", "null"],
      ["texto não JSON", "OK"],
      ["linha sem sonda2", JSON.stringify([{ sonda1: "{}" }])],
      ["duas linhas candidatas", JSON.stringify([linhaReal, linhaReal])],
      [
        "sondas com JSON quebrado",
        JSON.stringify([{ sonda1: "{quebrado", sonda2: "{}" }]),
      ],
      [
        "sondas com tipos errados",
        JSON.stringify([{ sonda1: '{"isolamento":1}', sonda2: "[]" }]),
      ],
      ["sondas nulas", JSON.stringify([{ sonda1: null, sonda2: null }])],
    ];
    for (const [nome, texto] of desconhecidos) {
      const r = WF.avaliarSondas(texto);
      assert.equal(
        r.ok,
        false,
        `${nome}: formato desconhecido NÃO pode ser sucesso`,
      );
    }
    ok(
      `(i) ${desconhecidos.length} formatos desconhecidos/malformados → todos RECUSADOS (desconhecido não é sucesso)`,
    );
    // gateDeTransporte: sucesso registra, reprovado PARA
    {
      const chamadas = [];
      await WF.gateDeTransporte(async (titulo) => {
        chamadas.push(titulo);
        return titulo === "gate de transporte"
          ? real
          : '[{"pid":1,"txid":null}]';
      });
      assert.deepEqual(
        chamadas,
        ["gate de transporte", "registro do gate"],
        "duas requisições: o gate e o registro (que não decide)",
      );
      await esperaRecusa(
        WF.gateDeTransporte(async () => '{"message":"boom"}'),
        ["GATE DE TRANSPORTE REPROVADO", "O envelope NÃO roda"],
        "gate reprovado",
      );
      // o registro falhando não derruba o gate
      await WF.gateDeTransporte(async (titulo) => {
        if (titulo === "registro do gate") throw new Error("rede");
        return real;
      });
      ok(
        "(i) gateDeTransporte: aprovado faz a 2ª requisição só para REGISTRAR (falha dela não decide); reprovado lança e o envelope não roda",
      );
    }
  }

  // -------- (j) as consultas só-leitura 8a..8g, como papel só-leitura --------
  {
    const CONF = require(
      path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
    );
    // PAPEL_RO imita o `supabase_read_only_user` como o repositório
    // supabase/postgres o cria (migrations/db/init-scripts/00000000000000-initial-schema.sql:
    // `create role supabase_read_only_user with login bypassrls; grant
    // pg_read_all_data to supabase_read_only_user;` e, na migration
    // 20250710151649, `alter role … set default_transaction_read_only = on`).
    // PAPEL_CEGO é o MESMO sem BYPASSRLS: representa o papel que a RLS esconde
    // (o controle de visibilidade das consultas existe para ele). Não se sabe
    // se o papel VIVO da CAF ainda tem BYPASSRLS — por isso os controles ficam.
    await usar("template1", async (a) => {
      await a.query(
        `DO $r$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PAPEL_RO}') THEN CREATE ROLE ${PAPEL_RO} NOLOGIN BYPASSRLS; END IF;
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PAPEL_CEGO}') THEN CREATE ROLE ${PAPEL_CEGO} NOLOGIN; END IF;
         END $r$`,
      );
      await a.query(`GRANT pg_read_all_data TO ${PAPEL_RO}, ${PAPEL_CEGO}`);
    });
    /** Roda o arquivo como o papel só-leitura (pg_read_all_data + transação
     * somente leitura por padrão). */
    const consulta = async (db, nome, papel = PAPEL_RO) => {
      const sql = fs.readFileSync(
        path.join(REPO, "scripts", "publicacao", "consultas", `${nome}.sql`),
        "utf8",
      );
      assert.equal(
        CONF.contarStatements(sql),
        1,
        `${nome}: tem de ser exatamente 1 statement`,
      );
      return usar(db, async (c) => {
        await c.query(`SET ROLE ${papel}`);
        await c.query("SET default_transaction_read_only = on");
        try {
          assert.equal(
            (await c.query("SHOW transaction_read_only")).rows[0]
              .transaction_read_only,
            "on",
          );
          const r = await c.query(sql);
          assert.deepEqual(
            r.fields.map((f) => f.name),
            ["item", "esperado", "vivo", "ok"],
            `${nome}: colunas item/esperado/vivo/ok`,
          );
          return r.rows;
        } finally {
          await c.query("RESET ROLE");
        }
      });
    };
    const reprovadas = (rows) => rows.filter((r) => r.ok !== true);
    const linha = (rows, trecho) => {
      const l = rows.filter((r) => r.item.includes(trecho));
      assert.equal(
        l.length,
        1,
        `esperava 1 linha com "${trecho}", achei ${l.length}`,
      );
      return l[0];
    };
    const mutarCorpo = async (db, fn) => {
      await usar(db, async (c) => {
        const r = await c.query(
          `SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1`,
          [fn],
        );
        assert.equal(r.rows.length, 1);
        const novo = r.rows[0].d.replace(
          "AS $function$",
          "AS $function$ -- mutante",
        );
        assert.notEqual(novo, r.rows[0].d);
        await c.query(novo);
      });
    };

    // 8a / 8e: antes e depois da fila 92..202 (o estado depois é o `cheio`).
    const a_antes = await consulta(
      semeado,
      "8a-antes-92-a-202-objetos-e-corpos",
    );
    assert.deepEqual(reprovadas(a_antes), [], "8a no banco pré-92: tudo ok");
    assert.ok(
      a_antes.length >= 70,
      `8a deveria ter ~74 linhas, tem ${a_antes.length}`,
    );
    assert.equal(
      linha(a_antes, "BASE liberar_cobranca_do_pedido").vivo,
      "bae7882a60430547ee32b4b2092580a8",
    );
    const a_depois = await consulta(
      cheio,
      "8a-antes-92-a-202-objetos-e-corpos",
    );
    // Com a 92..202 aplicadas a 8a reprova tudo o que 92..202 cria/substitui; seguem
    // ok SÓ o controle, a BASE do liberar (nenhuma 92..202 a redefine) e os 15
    // itens da 90/91 (que a 92..202 não toca).
    const seguemOk = a_depois.filter((r) => r.ok === true).map((r) => r.item);
    assert.equal(
      seguemOk.length,
      2 + 15,
      `8a com 92..202 aplicadas: esperava 17 ok (controle, BASE, 15 da 90/91), vieram ${seguemOk.length}: ${seguemOk.join(" | ")}`,
    );
    assert.ok(
      seguemOk.every((i) =>
        /^(controle:|BASE liberar|base 90\/91 |tabela (reconciliacao_visitas|avisos_ao_lojista) existe|coluna (reconciliacao_visitas|avisos_ao_lojista)\.|RLS ligada em (reconciliacao_visitas|avisos_ao_lojista))/.test(
          i,
        ),
      ),
      `8a: itens ok inesperados: ${seguemOk.join(" | ")}`,
    );
    assert.equal(linha(a_depois, "BASE liberar_cobranca_do_pedido").ok, true);
    ok(
      `(j) 8a: pré-92 → ${a_antes.length}/${a_antes.length} ok (base do liberar bae7882a…; inclui as 15 linhas da 90/91); com 92..202 aplicadas → ${reprovadas(a_depois).length} reprovadas (seguem ok só o controle, a BASE do liberar e as 15 da 90/91)`,
    );

    // B1 (revisão Opus): uma loja SEM a 90/91 não pode passar na 8a. Base pré-92
    // com os rollbacks REAIS rb91 e rb90 aplicados (direto, não pelo envelope:
    // o envelope recusa DROP TABLE por desenho — aqui o alvo é a CONSULTA).
    {
      const RB91 =
        "rollback-manual-20261191000000_aviso_de_cobranca_duplicada_sai_uma_vez.sql";
      const RB90 =
        "rollback-manual-20261190000000_a_reconciliacao_alcanca_o_cartao_tardio.sql";
      const sem91 = await clone(nomeBase, "ip_j_sem91");
      await usar(sem91, (c) => c.query(ler(RB91)));
      const r91 = reprovadas(
        await consulta(sem91, "8a-antes-92-a-202-objetos-e-corpos"),
      ).map((x) => x.item);
      assert.deepEqual(
        r91.sort(),
        [
          "RLS ligada em avisos_ao_lojista (91)",
          "base 90/91 confirmar_aviso_ao_lojista",
          "base 90/91 liberar_aviso_ao_lojista",
          "base 90/91 reservar_aviso_ao_lojista",
          "coluna avisos_ao_lojista.chave e text (91)",
          "coluna avisos_ao_lojista.enviado e boolean (91)",
          "coluna avisos_ao_lojista.reservado_em e timestamp with time zone (91)",
          "tabela avisos_ao_lojista existe (91)",
        ].sort(),
        "sem a 91: a 8a reprova EXATAMENTE as 8 linhas da 91 (3 corpos, tabela, 3 colunas, RLS)",
      );
      const sem90 = await clone(sem91, "ip_j_sem90");
      await usar(sem90, (c) => c.query(ler(RB90)));
      const r90 = reprovadas(
        await consulta(sem90, "8a-antes-92-a-202-objetos-e-corpos"),
      ).map((x) => x.item);
      console.log(
        `    8a sem a 90 e sem a 91 reprova: ${r90.sort().join(" | ")}`,
      );
      assert.deepEqual(
        r90.sort(),
        [
          ...r91,
          "RLS ligada em reconciliacao_visitas (90)",
          "base 90/91 marcar_visitas_da_reconciliacao",
          "base 90/91 pagamentos_a_reconciliar",
          "coluna reconciliacao_visitas.cobranca_terminal e text (90)",
          "coluna reconciliacao_visitas.order_id e uuid (90)",
          "coluna reconciliacao_visitas.visitado_em e timestamp with time zone (90)",
          "tabela reconciliacao_visitas existe (90)",
        ].sort(),
        "sem a 90 e a 91: reprova as 8 da 91 + as 7 da 90 (2 corpos, tabela, 3 colunas, RLS)",
      );
      // só a 90 faltando? a 91 não depende dela: rb90 sozinha não reprova nada da 91
      assert.ok(
        !r90.some((i) => /liberar_cobranca/.test(i)),
        "a BASE do liberar não reprova (a 90 só comenta; o corpo é o mesmo)",
      );
      ok(
        "(j) 8a: SEM a 91 → reprova exatamente as 8 linhas da 91; SEM a 90 e a 91 (rb91+rb90 reais) → reprova exatamente 15 (a BASE do liberar segue ok, porque a 90 só comenta)",
      );
    }

    // Ressalva do revisor: as 5 funções da 90/91 casam pela ASSINATURA exata.
    // reservar_aviso_ao_lojista(character varying) com o MESMO corpo da (text)
    // não pode dar verde.
    {
      const ASSIN_OK =
        "reservar_aviso_ao_lojista(text) 1aed7ca9e2c55d1ea61e9773367faf06";
      const trocarPorVarchar = async (db, manterTexto) => {
        await usar(db, async (c) => {
          const r = await c.query(
            `SELECT pg_get_functiondef('public.reservar_aviso_ao_lojista(text)'::regprocedure) AS d`,
          );
          const def = r.rows[0].d;
          const comVarchar = def.replace(
            "reservar_aviso_ao_lojista(p_chave text)",
            "reservar_aviso_ao_lojista(p_chave character varying)",
          );
          assert.notEqual(
            comVarchar,
            def,
            "a definição tem a assinatura (p_chave text)",
          );
          if (!manterTexto) {
            await c.query(
              "DROP FUNCTION public.reservar_aviso_ao_lojista(text)",
            );
          }
          await c.query(comVarchar);
        });
      };
      const sig = await clone(nomeBase, "ip_j_sig");
      await trocarPorVarchar(sig, false);
      const rSig = await consulta(sig, "8a-antes-92-a-202-objetos-e-corpos");
      // o MESMO corpo (md5 igual): só a assinatura mudou
      assert.deepEqual(
        reprovadas(rSig).map((x) => x.item),
        ["base 90/91 reservar_aviso_ao_lojista"],
        "assinatura trocada: a 8a reprova EXATAMENTE a linha dela",
      );
      const linhaSig = linha(rSig, "base 90/91 reservar_aviso_ao_lojista");
      assert.equal(linhaSig.esperado, ASSIN_OK);
      assert.equal(
        linhaSig.vivo,
        "reservar_aviso_ao_lojista(character varying) 1aed7ca9e2c55d1ea61e9773367faf06",
        "o vivo mostra a assinatura ERRADA achada (com o md5 igual)",
      );
      console.log(`    8a, assinatura trocada: ${linhaSig.vivo}`);
      // sobrecarga a mais (a (text) fica e entra uma (character varying)): reprova e mostra as duas
      const dupla = await clone(nomeBase, "ip_j_sig2");
      await trocarPorVarchar(dupla, true);
      const rDupla = await consulta(
        dupla,
        "8a-antes-92-a-202-objetos-e-corpos",
      );
      assert.deepEqual(
        reprovadas(rDupla).map((x) => x.item),
        ["base 90/91 reservar_aviso_ao_lojista"],
      );
      assert.match(
        linha(rDupla, "base 90/91 reservar_aviso_ao_lojista").vivo,
        /^reservar_aviso_ao_lojista\(character varying\) [0-9a-f]{32}, reservar_aviso_ao_lojista\(text\) [0-9a-f]{32}$/,
      );
      // a base pré-92 completa continua com 0 reprovadas
      assert.deepEqual(
        reprovadas(a_antes),
        [],
        "base pré-92 completa: 0 reprovadas",
      );
      ok(
        "(j) 8a: reservar_aviso_ao_lojista(character varying) com o MESMO corpo no lugar da (text) → reprova EXATAMENTE a linha dela e o vivo mostra a assinatura errada; (text)+(varchar) juntas também reprovam; base pré-92 completa → 0 reprovadas",
      );
    }

    const e_depois = await consulta(cheio, "8e-conferir-92-a-202-aplicado");
    assert.deepEqual(reprovadas(e_depois), [], "8e depois da fila: tudo ok");
    assert.ok(
      e_depois.length >= 70,
      `8e deveria ter ~73 linhas, tem ${e_depois.length}`,
    );
    const e_antes = await consulta(semeado, "8e-conferir-92-a-202-aplicado");
    assert.equal(
      reprovadas(e_antes).length,
      e_antes.length - 1,
      "8e no pré-92: só o controle passa",
    );
    ok(
      `(j) 8e: com 92..202 → ${e_depois.length}/${e_depois.length} ok; pré-92 → ${reprovadas(e_antes).length} reprovadas (só o controle ok)`,
    );

    // mutantes causais: UMA função com o corpo alterado reprova SÓ ela
    {
      const db = await clone(cheio, "ip_j_mut_e");
      await mutarCorpo(db, "rls_admin_atual");
      const r = await consulta(db, "8e-conferir-92-a-202-aplicado");
      assert.deepEqual(
        reprovadas(r).map((x) => x.item),
        ["corpo final rls_admin_atual"],
        "8e: o corpo alterado de UMA função reprova só ela",
      );
      const db2 = await clone(semeado, "ip_j_mut_a");
      await mutarCorpo(db2, "liberar_cobranca_do_pedido");
      const rep = reprovadas(
        await consulta(db2, "8a-antes-92-a-202-objetos-e-corpos"),
      );
      assert.equal(rep.length, 1);
      assert.match(rep[0].vivo, /^base diferente: [0-9a-f]{32}$/);
      const db3 = await clone(semeado, "ip_j_mut_a2");
      await mutarCorpo(db3, "solicitar_estorno");
      const r3 = await consulta(db3, "8a-antes-92-a-202-objetos-e-corpos");
      assert.deepEqual(
        reprovadas(r3).map((x) => x.item),
        ["base solicitar_estorno"],
        "8a: um corpo vivo fora do baseline reprova só ele",
      );
      ok(
        "(j) 8a/8e: mutante causal — alterar o corpo de UMA função reprova exatamente a linha dela (e a base do liberar mostra 'base diferente: <md5>')",
      );
    }

    // 8b: papéis contraditórios (contagem), com controle de visibilidade
    {
      const b0 = await consulta(semeado, "8b-papeis-contraditorios");
      assert.deepEqual(
        reprovadas(b0),
        [],
        "8b: fixture sem contradição → tudo ok",
      );
      assert.equal(linha(b0, "controle: usuarios visiveis").vivo, ">0");
      const db = await clone(semeado, "ip_j_8b");
      await usar(db, async (c) => {
        // o cliente vira admin SÓ no app_metadata; o admin passa a "só no profiles"
        await c.query(
          `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id = $1`,
          [U_CLIENTE],
        );
        await c.query(
          `UPDATE auth.users SET raw_app_meta_data = '{}'::jsonb WHERE id = $1`,
          [U_ADMIN],
        );
      });
      const b1 = await consulta(db, "8b-papeis-contraditorios");
      assert.equal(linha(b1, "admin so no app_metadata").vivo, "1");
      assert.equal(linha(b1, "admin so no profiles").vivo, "1");
      assert.equal(linha(b1, "contraditorios (soma)").vivo, "2");
      assert.equal(
        linha(b1, "controle: admins pelas duas fontes").ok,
        false,
        "ninguém admin nas duas fontes: o controle reprova",
      );
      // cego (RLS ligada em profiles, sem política): o 0 não pode passar por "limpo"
      const cego = await clone(semeado, "ip_j_8b_cego");
      await usar(cego, (c) =>
        c.query("ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY"),
      );
      assert.equal(
        linha(
          await consulta(cego, "8b-papeis-contraditorios"),
          "controle: perfis visiveis",
        ).ok,
        true,
        "controle: o papel com BYPASSRLS (como o supabase_read_only_user) enxerga a tabela com RLS",
      );
      const b2 = await consulta(cego, "8b-papeis-contraditorios", PAPEL_CEGO);
      assert.equal(
        linha(b2, "controle: perfis visiveis").ok,
        false,
        "RLS esconde profiles → o controle de visibilidade reprova",
      );
      ok(
        "(j) 8b: fixture limpa → ok; 2 contradições plantadas → 'so no app_metadata'=1, 'so no profiles'=1, soma=2; profiles escondida por RLS → controle reprova (o 0 não passa por limpo)",
      );
    }

    // 8c: subtotal x soma dos itens
    {
      const c0 = await consulta(semeado, "8c-subtotal-divergente");
      assert.deepEqual(
        reprovadas(c0),
        [],
        "8c: fixture (subtotal = soma dos itens) → tudo ok",
      );
      const db = await clone(semeado, "ip_j_8c");
      await usar(db, async (c) => {
        await c.query(
          "UPDATE public.marketplace_order_items SET quantity = 3 WHERE order_id = $1",
          [O1],
        );
        await c.query(
          "DELETE FROM public.marketplace_order_items WHERE order_id = $1",
          [O3],
        );
        await c.query(
          "UPDATE public.marketplace_orders SET subtotal = 999 WHERE id = $1",
          [O2],
        );
      });
      const c1 = await consulta(db, "8c-subtotal-divergente");
      assert.equal(linha(c1, "pedidos com soma dos itens diferente").vivo, "3");
      assert.equal(linha(c1, "dos quais sem nenhum item").vivo, "1");
      const cego = await clone(semeado, "ip_j_8c_cego");
      await usar(cego, (c) =>
        c.query(
          "ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY",
        ),
      );
      const c2 = await consulta(cego, "8c-subtotal-divergente", PAPEL_CEGO);
      assert.equal(
        linha(c2, "pedidos com soma dos itens diferente").vivo,
        "0",
        "cego: o 0 de divergentes existe (e engana)",
      );
      assert.equal(
        linha(c2, "controle: pedidos visiveis").ok,
        false,
        "...mas o controle de visibilidade reprova",
      );
      ok(
        "(j) 8c: fixture → 0 divergentes; 3 plantados (quantidade alterada, itens apagados, subtotal adulterado) → 3 divergentes (1 sem item); RLS cega → 0 divergentes MAS o controle de visibilidade reprova",
      );
    }

    // 8d: órfãs
    {
      const db = await clone(semeado, "ip_j_8d");
      await usar(db, (c) => c.query("ANALYZE public.order_refunds"));
      const d0 = await consulta(db, "8d-orfas-pos-drain");
      assert.deepEqual(
        reprovadas(d0),
        [],
        "8d: sem órfã e com estimativa do catálogo → tudo ok",
      );
      await usar(db, (c) =>
        c.query(
          "UPDATE public.order_refunds SET concluido_em = NULL WHERE order_id = $1",
          [O1],
        ),
      );
      const d1 = await consulta(db, "8d-orfas-pos-drain");
      assert.equal(linha(d1, "orfas:").vivo, "1");
      assert.equal(linha(d1, "orfas:").ok, false);
      const cego = await clone(db, "ip_j_8d_cego");
      await usar(cego, (c) =>
        c.query("ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY"),
      );
      const d2 = await consulta(cego, "8d-orfas-pos-drain", PAPEL_CEGO);
      assert.equal(linha(d2, "orfas:").vivo, "0", "cego: 0 órfãs (e engana)");
      assert.match(
        linha(d2, "controle: linhas visiveis vs estimativa").vivo,
        /^ESCONDIDAS/,
      );
      assert.equal(
        linha(d2, "controle: linhas visiveis vs estimativa").ok,
        false,
      );
      ok(
        "(j) 8d: sem órfã → ok; 1 órfã plantada → 1; RLS cega → 0 MAS o controle contra a estimativa do catálogo diz ESCONDIDAS",
      );
    }

    // 8f: DEFAULT da 201
    {
      const f_antes = await consulta(semeado, "8f-conferir-201");
      assert.equal(linha(f_antes, "DEFAULT").vivo, "AUSENTE");
      const f_depois = await consulta(cheio, "8f-conferir-201");
      assert.deepEqual(reprovadas(f_depois), []);
      const db = await clone(cheio, "ip_j_8f");
      await usar(db, (c) =>
        c.query(
          "ALTER TABLE public.order_refunds ALTER COLUMN criada_sob_autorizacao DROP DEFAULT",
        ),
      );
      const f_sem = await consulta(db, "8f-conferir-201");
      assert.equal(linha(f_sem, "DEFAULT").vivo, "sem default");
      assert.equal(linha(f_sem, "DEFAULT").ok, false);
      ok(
        "(j) 8f: pré-96 → coluna AUSENTE (a consulta parseia); com a 201 → default true ok; DROP DEFAULT → 'sem default' reprova",
      );
    }

    // 8g: cron (o stub local não tem job_run_details nem `active`: fixture com a forma do pg_cron real)
    {
      const db = await clone(semeado, "ip_j_8g");
      await usar(db, async (c) => {
        await c.query(
          "ALTER TABLE cron.job ADD COLUMN active boolean NOT NULL DEFAULT true",
        );
        await c.query(`CREATE TABLE cron.job_run_details (
          jobid bigint, runid bigserial PRIMARY KEY, job_pid int, database text, username text,
          command text, status text, return_message text, start_time timestamptz, end_time timestamptz)`);
        await c.query(
          `SELECT cron.schedule('reconciliar-pagamentos', '*/10 * * * *', 'SELECT 1')`,
        );
        await c.query(
          `INSERT INTO cron.job_run_details (jobid, status, command, return_message, start_time, end_time)
           SELECT jobid, 'succeeded', 'SEGREDO-NO-COMMAND', 'SEGREDO-NA-MENSAGEM',
                  now() - interval '12 minutes', now() - interval '12 minutes' + interval '1 second'
             FROM cron.job WHERE jobname = 'reconciliar-pagamentos'`,
        );
      });
      const g0 = await consulta(db, "8g-cron-reconciliar");
      assert.deepEqual(
        reprovadas(g0),
        [],
        "8g: job ativo com execução succeeded → tudo ok",
      );
      assert.ok(
        !JSON.stringify(g0).includes("SEGREDO"),
        "8g nunca devolve command nem return_message",
      );
      assert.match(linha(g0, "minutos desde o inicio").vivo, /^1[23]$/);
      await usar(db, (c) =>
        c.query(`UPDATE cron.job_run_details SET status = 'failed'`),
      );
      assert.equal(
        linha(
          await consulta(db, "8g-cron-reconciliar"),
          "ultima execucao: status",
        ).vivo,
        "failed",
      );
      await usar(db, async (c) => {
        await c.query("DELETE FROM cron.job_run_details");
        await c.query("UPDATE cron.job SET active = false");
      });
      const g2 = await consulta(db, "8g-cron-reconciliar");
      assert.equal(linha(g2, "ultima execucao: status").vivo, "NENHUMA");
      assert.equal(linha(g2, "job reconciliar-pagamentos ativo").vivo, "false");
      // RLS como no pg_cron real (só o dono do job vê): o papel só-leitura fica cego
      const cego = await clone(semeado, "ip_j_8g_cego");
      await usar(cego, async (c) => {
        await c.query(
          "ALTER TABLE cron.job ADD COLUMN active boolean NOT NULL DEFAULT true",
        );
        await c.query(
          "CREATE TABLE cron.job_run_details (jobid bigint, status text, start_time timestamptz, end_time timestamptz)",
        );
        await c.query(
          `SELECT cron.schedule('reconciliar-pagamentos', '*/10 * * * *', 'SELECT 1')`,
        );
        await c.query("ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY");
      });
      const g3 = await consulta(cego, "8g-cron-reconciliar", PAPEL_CEGO);
      assert.equal(
        linha(g3, "controle: jobs visiveis").ok,
        false,
        "RLS esconde cron.job → o controle reprova",
      );
      assert.equal(
        linha(g3, "job reconciliar-pagamentos existe").vivo,
        "0",
        "sem o controle, este 0 seria lido como 'o job sumiu'",
      );
      ok(
        "(j) 8g: job ativo+succeeded → ok sem vazar command/return_message; failed/NENHUMA/inativo reprovam; RLS cega (como o pg_cron real) → controle reprova. LIMITE: o pg_cron local é stub — cron.job_run_details tem a forma documentada, não a do banco vivo",
      );
    }
  }

  console.log(`\n[impressao-digital-viva] ${resultados} provas OK.`);
}

main()
  .catch((erro) => {
    console.error("\n[FALHOU]", erro?.stack ? erro.stack : erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const n of clones) {
      await usar("template1", (a) =>
        a.query(`DROP DATABASE IF EXISTS "${n}"`),
      ).catch(() => {});
    }
    // o papel só-leitura da prova (j) é do CLUSTER; não fica para trás
    await usar("template1", (a) =>
      a.query(`DROP ROLE IF EXISTS ${PAPEL_RO}, ${PAPEL_CEGO}`),
    ).catch(() => {});
  });

// `falhar` fica importado para o caso de a trava de efemero recusar antes.
void falhar;
