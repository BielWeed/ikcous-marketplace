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
// Papéis da prova 8j (visibilidade das tabelas): dono das tabelas, membro que
// HERDA o dono, sem nenhum SELECT, com SELECT em cinco das seis, e com SELECT de
// tabela inteira em cinco e só de UMA COLUNA na sexta.
const PAPEL_DONO_8J = "ip_8j_dono";
const PAPEL_MEMBRO_8J = "ip_8j_membro";
const PAPEL_SEMSEL_8J = "ip_8j_semsel";
const PAPEL_PARCIAL_8J = "ip_8j_parcial";
const PAPEL_COLUNA_8J = "ip_8j_coluna";
// Papéis da prova 8i (papel e visibilidade no mesmo snapshot): o papel REAL do
// endpoint somente leitura (BYPASSRLS + pg_read_all_data, como o repositório
// supabase/postgres o cria) e um papel DONO das tabelas, de que o primeiro HERDA
// em um caso. A prova os cria e os remove (e recusa rodar se já existirem).
const PAPEL_8I = "supabase_read_only_user";
const PAPEL_DONO_8I = "ip_8i_dono";
let criouPapel8i = false;
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

    // 8h: PERFIL dos divergentes da 8c (diagnóstico, saída secao/chave/pedidos)
    {
      const NOME_8H = "8h-perfil-dos-pedidos-divergentes";
      const perfil = async (db, papel = PAPEL_RO) => {
        const sql = fs.readFileSync(
          path.join(
            REPO,
            "scripts",
            "publicacao",
            "consultas",
            `${NOME_8H}.sql`,
          ),
          "utf8",
        );
        assert.equal(CONF.contarStatements(sql), 1, "8h: 1 statement");
        return usar(db, async (c) => {
          await c.query(`SET ROLE ${papel}`);
          await c.query("SET default_transaction_read_only = on");
          try {
            const r = await c.query(sql);
            assert.deepEqual(
              r.fields.map((f) => f.name),
              ["secao", "chave", "pedidos"],
              "8h: colunas secao/chave/pedidos",
            );
            return r.rows;
          } finally {
            await c.query("RESET ROLE");
          }
        });
      };
      const valor = (rows, secao, chave) => {
        const l = rows.filter((r) => r.secao === secao && r.chave === chave);
        assert.equal(
          l.length,
          1,
          `8h: esperava 1 linha ${secao}/${chave}, achei ${l.length}`,
        );
        return l[0].pedidos;
      };
      const secao = (rows, s) =>
        Object.fromEntries(
          rows.filter((r) => r.secao === s).map((r) => [r.chave, r.pedidos]),
        );

      // fixture limpa: 0 divergentes, controles >0, nenhuma linha de perfil
      const h0 = await perfil(semeado);
      assert.equal(valor(h0, "controle", "pedidos visiveis"), ">0");
      assert.equal(valor(h0, "controle", "itens de pedido visiveis"), ">0");
      assert.equal(valor(h0, "total", "divergentes (mesma regra da 8c)"), "0");
      assert.equal(valor(h0, "total", "dos quais sem nenhum item"), "0");
      assert.deepEqual(
        secao(h0, "status"),
        {},
        "8h: sem divergente não há perfil de status",
      );

      // os MESMOS 3 plantados da 8c, mais um id de cobrança no pedido sem item
      const GATEWAY_8H = "MP-NAO-PODE-SAIR-8H-0001";
      const db = await clone(semeado, "ip_j_8h");
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
        await c.query(
          "UPDATE public.marketplace_orders SET gateway_payment_id = $2 WHERE id = $1",
          [O3, GATEWAY_8H],
        );
      });
      const h1 = await perfil(db);
      const mes = (
        await usar(db, (c) =>
          c.query("SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') AS m"),
        )
      ).rows[0].m;
      assert.equal(valor(h1, "total", "divergentes (mesma regra da 8c)"), "3");
      assert.equal(valor(h1, "total", "dos quais sem nenhum item"), "1");
      assert.deepEqual(secao(h1, "status"), {
        delivered: "1",
        pending: "1",
        processing: "1",
      });
      assert.deepEqual(secao(h1, "payment_status"), {
        aguardando: "1",
        pago: "2",
      });
      assert.deepEqual(secao(h1, "payment_method"), { online: "3" });
      assert.deepEqual(secao(h1, "metodo_online"), {
        "(nulo)": "1",
        credito: "1",
        pix: "1",
      });
      assert.deepEqual(secao(h1, "canal"), { online: "3" });
      assert.deepEqual(secao(h1, "mes de criacao (UTC)"), { [mes]: "3" });
      assert.deepEqual(secao(h1, "faixa de subtotal"), {
        "(10, 100]": "2",
        "(100, 1000]": "1",
      });
      assert.deepEqual(secao(h1, "controle"), {
        "pedidos visiveis": ">0",
        "itens de pedido visiveis": ">0",
        "historico de status visivel": ">0",
        "registros de pagamento visiveis": ">0",
        "estornos visiveis": ">0",
        "devolucoes visiveis": ">0",
      });
      assert.deepEqual(secao(h1, "historico de status"), {
        "com algum evento": "3",
        "com evento para processing, shipping ou delivered": "2",
      });
      assert.deepEqual(secao(h1, "sinais de cobranca"), {
        "com id de cobranca no gateway (so a presenca)": "1",
        "payment_status pago, pago_apos_expirar ou recebido_na_entrega": "2",
        "payment_status estornado": "0",
        "com registro em marketplace_order_payment_history": "1",
        "com estorno em order_refunds": "2",
        "com devolucao": "1",
      });
      const texto = JSON.stringify(h1);
      for (const proibido of [
        GATEWAY_8H,
        "Cliente FP",
        "@fp.teste",
        O1,
        O2,
        O3,
        U_CLIENTE,
      ]) {
        assert(!texto.includes(proibido), `8h: a saída vazou ${proibido}`);
      }

      // CANÁRIO: texto arbitrário em todo campo agrupado (com os CHECK
      // derrubados SÓ neste clone, gatilhos desligados) e subtotal nulo (NOT
      // NULL derrubado só aqui) — nada disso pode sair cru na saída.
      const CANARIO = "CANARIO-8H joana.canario@exemplo.com";
      const canario = await clone(db, "ip_j_8h_canario");
      await usar(canario, async (c) => {
        await c.query("SET session_replication_role = replica");
        const cks = await c.query(
          "SELECT conname FROM pg_constraint WHERE conrelid = 'public.marketplace_orders'::regclass AND contype = 'c'",
        );
        for (const { conname } of cks.rows) {
          await c.query(
            `ALTER TABLE public.marketplace_orders DROP CONSTRAINT "${conname}"`,
          );
        }
        await c.query(
          "ALTER TABLE public.marketplace_orders ALTER COLUMN subtotal DROP NOT NULL",
        );
        await c.query(
          `UPDATE public.marketplace_orders
              SET status = $2 || ' st', payment_status = $2 || ' ps', payment_method = $2 || ' pm',
                  metodo_online = $2 || ' mo', canal = $2 || ' ca'
            WHERE id = $1`,
          [O1, CANARIO],
        );
        await c.query(
          "UPDATE public.marketplace_orders SET subtotal = NULL, payment_status = 'estornado' WHERE id = $1",
          [O2],
        );
      });
      const FORA = "(fora da lista, nao impresso)";
      const h3 = await perfil(canario);
      assert.equal(valor(h3, "total", "divergentes (mesma regra da 8c)"), "3");
      assert.deepEqual(secao(h3, "status"), {
        [FORA]: "1",
        delivered: "1",
        pending: "1",
      });
      assert.deepEqual(secao(h3, "payment_status"), {
        [FORA]: "1",
        aguardando: "1",
        estornado: "1",
      });
      assert.deepEqual(secao(h3, "payment_method"), {
        [FORA]: "1",
        online: "2",
      });
      assert.deepEqual(secao(h3, "metodo_online"), {
        [FORA]: "1",
        "(nulo)": "1",
        pix: "1",
      });
      assert.deepEqual(secao(h3, "canal"), { [FORA]: "1", online: "2" });
      assert.deepEqual(
        secao(h3, "faixa de subtotal"),
        { "(nulo)": "1", "(10, 100]": "2" },
        "8h: subtotal nulo cai em (nulo), nunca em > 1000",
      );
      assert.equal(
        valor(h3, "sinais de cobranca", "payment_status estornado"),
        "1",
      );
      assert.equal(
        valor(
          h3,
          "sinais de cobranca",
          "payment_status pago, pago_apos_expirar ou recebido_na_entrega",
        ),
        "0",
      );
      const texto3 = JSON.stringify(h3);
      for (const proibido of [
        "CANARIO",
        "canario",
        "exemplo.com",
        GATEWAY_8H,
        O1,
        O2,
        O3,
      ]) {
        assert(
          !texto3.includes(proibido),
          `8h: a saída vazou o canário ${proibido}`,
        );
      }

      // RLS cega nos PEDIDOS (papel sem BYPASSRLS): a política TO public de
      // marketplace_order_payment_history chama is_admin() sem EXECUTE para o
      // papel — a consulta FALHA alto em vez de devolver um 0 que engana.
      const cego = await clone(semeado, "ip_j_8h_cego");
      await usar(cego, (c) =>
        c.query(
          "ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY",
        ),
      );
      await assert.rejects(
        perfil(cego, PAPEL_CEGO),
        /permission denied for function (is_admin|rls_admin_atual)/,
        "cego: falha alta, nunca 0 silencioso",
      );
      // RLS cega só nas tabelas AUXILIARES (o caminho de falha alta desligado
      // neste clone): o sinal sai 0, MAS o controle da tabela denuncia 0 —
      // um 0 de sinal com controle 0 é inconclusivo, não "nenhum".
      const cegoAux = await clone(db, "ip_j_8h_cego_aux");
      await usar(cegoAux, async (c) => {
        for (const t of [
          "marketplace_orders",
          "marketplace_order_items",
          "marketplace_order_payment_history",
        ]) {
          await c.query(`ALTER TABLE public.${t} DISABLE ROW LEVEL SECURITY`);
        }
        for (const t of [
          "order_refunds",
          "devolucoes",
          "marketplace_order_history",
        ]) {
          await c.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
        }
      });
      const h4 = await perfil(cegoAux, PAPEL_CEGO);
      assert.equal(valor(h4, "total", "divergentes (mesma regra da 8c)"), "3");
      assert.equal(
        valor(h4, "sinais de cobranca", "com estorno em order_refunds"),
        "0",
        "cego aux: o 0 engana",
      );
      assert.equal(
        valor(h4, "controle", "estornos visiveis"),
        "0",
        "...mas o controle denuncia",
      );
      assert.equal(valor(h4, "sinais de cobranca", "com devolucao"), "0");
      assert.equal(valor(h4, "controle", "devolucoes visiveis"), "0");
      assert.equal(valor(h4, "historico de status", "com algum evento"), "0");
      assert.equal(valor(h4, "controle", "historico de status visivel"), "0");
      assert.equal(
        valor(h4, "controle", "registros de pagamento visiveis"),
        ">0",
      );
      ok(
        "(j) 8h: fixture → 0 divergentes e sem perfil; os 3 plantados da 8c → perfil exato e 6 controles >0; canário em todo campo agrupado + subtotal nulo → só '(fora da lista…)' e '(nulo)', nenhum texto do canário, id, nome, e-mail ou id de gateway na saída; RLS cega nos pedidos → falha alta 42501; RLS cega nas auxiliares → sinal 0 COM controle 0",
      );
    }

    // 8i: os divergentes da 8c contra a BASE ATESTADA (3 cancelled, sem item, sem
    // sinal de cobrança) presa por uma IMPRESSÃO DE INTEGRIDADE do conjunto e do
    // estado (sha256, 64 hex). Formato da 8c. A impressão muda se qualquer campo
    // coberto mudar; não diz origem; não substitui auditoria.
    {
      const NOME_8I = "8i-divergentes-contra-base-atestada";
      const SQL_8I = fs.readFileSync(
        path.join(REPO, "scripts", "publicacao", "consultas", `${NOME_8I}.sql`),
        "utf8",
      );
      assert.equal(CONF.contarStatements(SQL_8I), 1, "8i: 1 statement");
      // O papel REAL do endpoint (nome exato: a 8i confere o nome). Cluster novo:
      // se já existir, a prova não mexe em papel alheio.
      await usar("template1", async (a) => {
        const ja = await a.query(
          "SELECT rolname FROM pg_roles WHERE rolname = ANY($1)",
          [[PAPEL_8I, PAPEL_DONO_8I]],
        );
        assert.equal(
          ja.rows.length,
          0,
          `8i: o papel ${ja.rows.map((r) => r.rolname).join(", ")} já existe no cluster; esta prova cria e remove o SEU papel, não mexe no alheio`,
        );
        criouPapel8i = true;
        await a.query(`CREATE ROLE ${PAPEL_8I} NOLOGIN BYPASSRLS`);
        await a.query(`CREATE ROLE ${PAPEL_DONO_8I} NOLOGIN`);
        await a.query(`GRANT pg_read_all_data TO ${PAPEL_8I}`);
      });
      const saidas8i = [];
      const CONSTANTE = "'A_ATESTAR'";
      assert.equal(
        SQL_8I.split(CONSTANTE).length - 1,
        1,
        "8i: o literal 'A_ATESTAR' tem de aparecer uma vez só (é ele que o teste troca, EM MEMÓRIA)",
      );
      // O teste troca a constante pela impressão da fixture EM MEMÓRIA: o arquivo
      // commitado nunca leva uma base presumida nem calculada.
      const atestando = (impressao) =>
        SQL_8I.replace(CONSTANTE, `'${impressao}'`);
      // ORÁCULO em JS, independente do SQL no que decide o hash: a ordem das
      // linhas, a ordem dos campos, o <comprimento>:<texto>, o N do NULL e o
      // sha256. Só os TEXTOS dos campos vêm do banco (numeric já em (12,2) e o
      // instante em UTC ISO), lidos do pedido pelo dono do banco.
      const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
      const impressaoDe = async (db, ids) =>
        usar(db, async (c) => {
          const r = await c.query(
            `SELECT o.id::text AS id,
                    to_char(o.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at,
                    to_char(o.updated_at AT TIME ZONE 'UTC', ${ISO}) AS updated_at,
                    o.status, o.payment_status, o.payment_method, o.metodo_online, o.canal,
                    o.subtotal::numeric(12,2)::text AS subtotal,
                    o.total::numeric(12,2)::text AS total,
                    o.shipping::numeric(12,2)::text AS shipping,
                    o.discount::numeric(12,2)::text AS discount,
                    o.valor_estornado::numeric(12,2)::text AS valor_estornado,
                    to_char(o.paid_at AT TIME ZONE 'UTC', ${ISO}) AS paid_at,
                    (o.gateway_payment_id IS NOT NULL)::text AS gateway,
                    (SELECT count(*) FROM public.marketplace_order_items i WHERE i.order_id = o.id)::text AS n_itens,
                    COALESCE((SELECT sum(i.quantity * i.price) FROM public.marketplace_order_items i WHERE i.order_id = o.id), 0)::numeric(12,2)::text AS soma_itens,
                    o.total_amount::text AS total_amount,
                    o.shipping_cost::text AS shipping_cost
               FROM public.marketplace_orders o WHERE o.id = ANY($1::uuid[])`,
            [ids],
          );
          // total_amount e shipping_cost são numeric SEM escala: o oráculo tira os
          // zeros à direita EM JS (100.000 -> 100; 100.001 fica), sem passar por
          // trim_scale nem por numeric(12,2) (que arredondaria a 3ª casa).
          const semEscala = (t) =>
            t === null || !t.includes(".")
              ? t
              : t.replace(/0+$/, "").replace(/\.$/, "");
          const campos = [
            "id",
            "created_at",
            "updated_at",
            "status",
            "payment_status",
            "payment_method",
            "metodo_online",
            "canal",
            "subtotal",
            "total",
            "shipping",
            "discount",
            "valor_estornado",
            "paid_at",
            "gateway",
            "n_itens",
            "soma_itens",
            "total_amount",
            "shipping_cost",
          ];
          const enc = (v) => (v === null ? "N" : `${v.length}:${v}`);
          const linhas = [...r.rows]
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map((row) => {
              const porCampo = new Map(Object.entries(row));
              for (const k of ["total_amount", "shipping_cost"])
                porCampo.set(k, semEscala(porCampo.get(k)));
              return campos.map((k) => enc(porCampo.get(k))).join(";");
            });
          return require("node:crypto")
            .createHash("sha256")
            .update(linhas.join("#"), "utf8")
            .digest("hex");
        });
      const rodar8i = async (
        db,
        { sql = SQL_8I, papel = PAPEL_8I, fuso = null, pre = [] } = {},
      ) =>
        usar(db, async (c) => {
          if (papel) await c.query(`SET ROLE ${papel}`);
          await c.query("SET default_transaction_read_only = on");
          if (fuso) await c.query(`SET TIME ZONE '${fuso}'`);
          for (const p of pre) await c.query(p);
          try {
            const r = await c.query(sql);
            assert.deepEqual(
              r.fields.map((f) => f.name),
              ["item", "esperado", "vivo", "ok"],
              "8i: colunas item/esperado/vivo/ok",
            );
            saidas8i.push(r.rows);
            return r.rows;
          } finally {
            if (papel) await c.query("RESET ROLE");
          }
        });
      const nomes = (rows) => reprovadas(rows).map((r) => r.item.trim());
      const IMP_ITEM =
        "impressao de integridade do conjunto e do estado (sha256, 64 hex)";
      const IMP = "impressao de integridade";
      const LINHAS_DA_8I = 19;
      const HEX64 = /^[0-9a-f]{64}$/;

      // Os 3 atestados (cancelled, pix, sem payment_status, sem item, com
      // histórico) e um pedido cancelled NORMAL (N1, com itens, que não diverge).
      const DA = "00000008-0000-4000-8000-00000000000a";
      const DB = "00000008-0000-4000-8000-00000000000b";
      const DC = "00000008-0000-4000-8000-00000000000c";
      const N1 = "00000008-0000-4000-8000-00000000000d";
      const A4 = "00000008-0000-4000-8000-00000000000e";
      const ATESTADOS = [DA, DB, DC];
      const SUBTOTAL = new Map([
        [DA, 50],
        [DB, 200],
        [DC, 500],
      ]);
      const novoPedido = (c, id, subtotal, status, pagamento = null) =>
        c.query(
          `INSERT INTO public.marketplace_orders
             (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
              payment_method, payment_status, metodo_online)
           VALUES ($1, $2, 'Cliente FP', '{}'::jsonb, $3, $3, $4, 'online', 'pix', $5, NULL)`,
          [id, U_CLIENTE, subtotal, status, pagamento],
        );
      const historico = (c, id, para) =>
        c.query(
          `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, created_at)
           VALUES ($1, 'pending', $2, now())`,
          [id, para],
        );
      const comItem = (c, id, quantidade, preco) =>
        c.query(
          `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
           VALUES ($1, $2, 'Produto A', $3, $4)`,
          [id, P_A, quantidade, preco],
        );
      // Os instantes ficam FIXOS (o que o dono mediu não muda sozinho com o relógio).
      const fixarInstantes = (c) =>
        c.query(
          `UPDATE public.marketplace_orders
              SET created_at = '2026-03-10T12:00:00.123456Z', updated_at = '2026-03-10T12:30:00.654321Z'
            WHERE id = ANY($1::uuid[])`,
          [[DA, DB, DC, N1, A4]],
        );
      const plantar = async (db, ordem = ATESTADOS) => {
        await usar(db, async (c) => {
          for (const id of ordem)
            await novoPedido(c, id, SUBTOTAL.get(id), "cancelled");
          for (const id of ordem) await historico(c, id, "cancelled");
          // N1: cancelled, com item que BATE com o subtotal (80 = 2 x 40)
          await novoPedido(c, N1, 80, "cancelled");
          await comItem(c, N1, 2, 40);
          await historico(c, N1, "cancelled");
          await fixarInstantes(c);
        });
      };
      const base = await clone(semeado, "ip_j_8i_base");
      await plantar(base);
      const IMPRESSAO = await impressaoDe(base, ATESTADOS);
      assert.match(IMPRESSAO, HEX64);

      // (vi) MODO MEDIR: constante A_ATESTAR → só a impressão reprova, e o vivo é
      // a impressão de agora (64 hex), igual à calculada FORA do banco.
      const m0 = await rodar8i(base);
      assert.equal(m0.length, LINHAS_DA_8I, "8i: 19 linhas");
      assert.deepEqual(
        nomes(m0),
        [IMP_ITEM],
        "8i modo medir: só a impressão reprova",
      );
      assert.equal(linha(m0, IMP).esperado, "A_ATESTAR");
      assert.match(linha(m0, IMP).vivo, HEX64);
      assert.equal(
        linha(m0, IMP).vivo,
        IMPRESSAO,
        "8i: a impressão do SQL é o sha256 da serialização canônica calculado fora do banco",
      );
      assert.equal(linha(m0, "pedidos divergentes").vivo, "3");

      // (i) com a constante atestada (em memória): TUDO ok (19 de 19).
      const SQL_ATESTADO = atestando(IMPRESSAO);
      const a0 = await rodar8i(base, { sql: SQL_ATESTADO });
      assert.equal(a0.length, LINHAS_DA_8I);
      assert.deepEqual(
        reprovadas(a0),
        [],
        "8i: 3 cancelled sem item → tudo ok",
      );
      for (const c of [
        "controle: pedidos visiveis",
        "controle: itens de pedido visiveis",
      ])
        assert.equal(linha(a0, c).vivo, ">0");
      // os três controles '>0' de tabela auxiliar SAÍRAM: a visibilidade os substitui
      for (const c of [
        "controle: registros de pagamento visiveis",
        "controle: estornos visiveis",
        "controle: devolucoes visiveis",
      ])
        assert.equal(
          a0.filter((r) => r.item === c).length,
          0,
          `8i: o controle '${c}' exigia linha e saiu`,
        );

      // (vi-b) sem NENHUM divergente (a fixture limpa): a contagem E a impressão
      // reprovam — "0 divergentes" nunca passa por "o conjunto".
      const limpa = await rodar8i(semeado, { sql: SQL_ATESTADO });
      assert.deepEqual(
        nomes(limpa).sort(),
        [
          IMP_ITEM,
          "pedidos divergentes (mesma regra da 8c; base atestada)",
        ].sort(),
      );
      assert.equal(linha(limpa, IMP).vivo, "(sem divergentes)");

      // (ii) um 4º divergente ATIVO (pending/aguardando, sem item): reprova a
      // contagem, o "fora de cancelled" e a impressão — e SÓ elas.
      const ativo = await clone(base, "ip_j_8i_ativo");
      await usar(ativo, async (c) => {
        await novoPedido(c, A4, 70, "pending", "aguardando");
        await fixarInstantes(c);
      });
      const r2 = await rodar8i(ativo, { sql: SQL_ATESTADO });
      assert.equal(linha(r2, "pedidos divergentes").vivo, "4");
      assert.equal(linha(r2, "fora de cancelled").vivo, "1");
      assert.deepEqual(
        nomes(r2).sort(),
        [
          IMP_ITEM,
          "dos quais fora de cancelled",
          "pedidos divergentes (mesma regra da 8c; base atestada)",
        ].sort(),
      );
      assert.equal(
        linha(r2, IMP).vivo,
        await impressaoDe(ativo, [...ATESTADOS, A4]),
      );

      // (iii) TROCA: um dos 3 volta a ter item (deixa de divergir) e OUTRO pedido
      // cancelled perde os itens (passa a divergir). A CONTAGEM continua 3, todos
      // cancelled, sem item e sem sinal — SÓ a impressão acusa a troca.
      const troca = await clone(base, "ip_j_8i_troca");
      await usar(troca, async (c) => {
        await comItem(c, DA, 2, 25); // 2 x 25 = 50 = subtotal de DA
        await c.query(
          "DELETE FROM public.marketplace_order_items WHERE order_id = $1",
          [N1],
        );
      });
      const r3 = await rodar8i(troca, { sql: SQL_ATESTADO });
      assert.equal(linha(r3, "pedidos divergentes").vivo, "3");
      assert.equal(linha(r3, "pedidos divergentes").ok, true);
      assert.deepEqual(
        nomes(r3),
        [IMP_ITEM],
        "8i: a troca mantém a contagem em 3; só a impressão reprova",
      );
      assert.equal(linha(r3, IMP).vivo, await impressaoDe(troca, [DB, DC, N1]));
      assert.notEqual(linha(r3, IMP).vivo, IMPRESSAO);

      // (viii) MESMO CONJUNTO, ESTADO MONETÁRIO diferente: subtotal de UM dos 3
      // alterado (continua divergente, sem item, cancelled). Contagem e sinais
      // seguem ok; SÓ a impressão acusa. (Um hash só dos ids NÃO pegaria isto.)
      const subt = await clone(base, "ip_j_8i_subtotal");
      await usar(subt, (c) =>
        c.query(
          "UPDATE public.marketplace_orders SET subtotal = 51 WHERE id = $1",
          [DA],
        ),
      );
      const r8 = await rodar8i(subt, { sql: SQL_ATESTADO });
      assert.equal(linha(r8, "pedidos divergentes").vivo, "3");
      assert.deepEqual(
        nomes(r8),
        [IMP_ITEM],
        "8i (viii): só a impressão reprova",
      );
      assert.equal(linha(r8, IMP).vivo, await impressaoDe(subt, ATESTADOS));
      assert.notEqual(linha(r8, IMP).vivo, IMPRESSAO);

      // (ix) MESMO CONJUNTO, STATUS / PAYMENT_STATUS diferentes.
      //   status cancelled → new: reprova o "fora de cancelled" E a impressão;
      //   payment_status NULL → aguardando (fora da lista de sinais): SÓ a impressão;
      //   payment_status NULL → pago: o sinal E a impressão.
      for (const [rotulo, sqlMuda, esperados] of [
        [
          "status new",
          "UPDATE public.marketplace_orders SET status = 'new' WHERE id = $1",
          [IMP_ITEM, "dos quais fora de cancelled"],
        ],
        [
          "payment_status aguardando",
          "UPDATE public.marketplace_orders SET payment_status = 'aguardando' WHERE id = $1",
          [IMP_ITEM],
        ],
        [
          "payment_status pago",
          "UPDATE public.marketplace_orders SET payment_status = 'pago', paid_at = now() WHERE id = $1",
          [
            IMP_ITEM,
            "dos quais com payment_status pago, pago_apos_expirar, recebido_na_entrega ou estornado",
          ],
        ],
      ]) {
        const dbx = await clone(
          base,
          `ip_j_8i_ix_${rotulo.replace(/[^a-z]/gi, "_")}`,
        );
        await usar(dbx, (c) => c.query(sqlMuda, [DB]));
        const rx = await rodar8i(dbx, { sql: SQL_ATESTADO });
        assert.deepEqual(
          nomes(rx).sort(),
          [...esperados].sort(),
          `8i (ix) ${rotulo}: reprova a impressão (e o sinal, se for o caso)`,
        );
        assert.equal(linha(rx, IMP).vivo, await impressaoDe(dbx, ATESTADOS));
      }

      // (x) MESMO VALOR gravado com OUTRA ESCALA → a impressão NÃO muda. Na coluna
      // numeric(10,2) o banco já normaliza; para provar a CANONIZAÇÃO do SQL, a
      // coluna vira numeric sem escala SÓ neste clone e o mesmo valor é regravado
      // como 50.0000 (o ::text cru muda: 50.0000 x 50.00; o hash não).
      const escala = await clone(base, "ip_j_8i_escala");
      await usar(escala, async (c) => {
        await c.query(
          "ALTER TABLE public.marketplace_orders ALTER COLUMN subtotal TYPE numeric",
        );
        await c.query(
          "UPDATE public.marketplace_orders SET subtotal = 50.0000 WHERE id = $1",
          [DA],
        );
      });
      const cru = await usar(escala, (c) =>
        c.query(
          "SELECT subtotal::text AS t FROM public.marketplace_orders WHERE id = $1",
          [DA],
        ),
      );
      assert.equal(
        cru.rows[0].t,
        "50.0000",
        "8i (x): o texto cru MUDOU de escala",
      );
      assert.notEqual(cru.rows[0].t, "50.00");
      const rEsc = await rodar8i(escala, { sql: SQL_ATESTADO });
      assert.deepEqual(
        reprovadas(rEsc),
        [],
        "8i (x): outra escala, mesma impressão, tudo ok",
      );
      assert.equal(linha(rEsc, IMP).vivo, IMPRESSAO);
      // ...e o mesmo instante lido em OUTRO fuso da sessão dá a mesma impressão.
      const rFuso = await rodar8i(base, { fuso: "America/Sao_Paulo" });
      assert.equal(
        linha(rFuso, IMP).vivo,
        IMPRESSAO,
        "8i (x): fuso da sessão não muda a impressão",
      );
      // ...e uma escala que muda o VALOR (50.0000 → 50.0100) muda a impressão.
      await usar(escala, (c) =>
        c.query(
          "UPDATE public.marketplace_orders SET subtotal = 50.0100 WHERE id = $1",
          [DA],
        ),
      );
      assert.notEqual(
        linha(await rodar8i(escala, { sql: SQL_ATESTADO }), IMP).vivo,
        IMPRESSAO,
      );

      // (xi) CADA campo coberto, mudado sozinho, muda a impressão — e ela bate com
      // a calculada fora do banco. (Os campos NÃO cobertos ficam de fora de
      // propósito: nome, contato, endereço, user_id e o id do gateway.)
      const CAMPOS = [
        [
          "created_at",
          "UPDATE public.marketplace_orders SET created_at = created_at + interval '1 day' WHERE id = $1",
        ],
        [
          "updated_at",
          "UPDATE public.marketplace_orders SET updated_at = updated_at + interval '1 second' WHERE id = $1",
        ],
        [
          "status",
          "UPDATE public.marketplace_orders SET status = 'new' WHERE id = $1",
        ],
        [
          "payment_status",
          "UPDATE public.marketplace_orders SET payment_status = 'aguardando' WHERE id = $1",
        ],
        [
          "payment_method",
          "UPDATE public.marketplace_orders SET payment_method = 'card' WHERE id = $1",
        ],
        [
          "metodo_online",
          "UPDATE public.marketplace_orders SET metodo_online = 'pix' WHERE id = $1",
        ],
        [
          "canal",
          "UPDATE public.marketplace_orders SET canal = 'presencial' WHERE id = $1",
        ],
        [
          "subtotal",
          "UPDATE public.marketplace_orders SET subtotal = subtotal + 1 WHERE id = $1",
        ],
        [
          "total",
          "UPDATE public.marketplace_orders SET total = total + 1 WHERE id = $1",
        ],
        [
          "shipping",
          "UPDATE public.marketplace_orders SET shipping = 7 WHERE id = $1",
        ],
        [
          "discount",
          "UPDATE public.marketplace_orders SET discount = 3 WHERE id = $1",
        ],
        [
          "valor_estornado",
          "UPDATE public.marketplace_orders SET valor_estornado = 1 WHERE id = $1",
        ],
        [
          "paid_at",
          "UPDATE public.marketplace_orders SET paid_at = '2026-03-11T00:00:00Z' WHERE id = $1",
        ],
        [
          "gateway (so a presenca)",
          "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-8I-NAO-PODE-SAIR' WHERE id = $1",
        ],
        [
          "total_amount (numeric sem escala)",
          "UPDATE public.marketplace_orders SET total_amount = 55.5 WHERE id = $1",
        ],
        [
          "shipping_cost (numeric sem escala)",
          "UPDATE public.marketplace_orders SET shipping_cost = 4.25 WHERE id = $1",
        ],
        [
          "n_itens e soma_itens",
          `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, '${P_A}', 'Produto A', 1, 10)`,
        ],
      ];
      const vistosNoLoop = [];
      for (const [rotulo, sqlMuda] of CAMPOS) {
        const dbx = await clone(
          base,
          `ip_j_8i_xi_${rotulo.replace(/[^a-z]/gi, "_").slice(0, 20)}`,
        );
        await usar(dbx, (c) => c.query(sqlMuda, [DB]));
        const rx = await rodar8i(dbx, { sql: SQL_ATESTADO });
        assert.notEqual(
          linha(rx, IMP).vivo,
          IMPRESSAO,
          `8i (xi) ${rotulo}: a impressão NÃO mudou`,
        );
        assert.equal(
          linha(rx, IMP).vivo,
          await impressaoDe(dbx, ATESTADOS),
          `8i (xi) ${rotulo}: a impressão difere da calculada fora do banco`,
        );
        assert.equal(linha(rx, IMP).ok, false);
        vistosNoLoop.push(rx);
      }

      // (xiii) total_amount e shipping_cost são numeric SEM escala: a 3ª casa
      // MUDA a impressão (::numeric(12,2) a esconderia: 100.001 vira 100.00), e a
      // MESMA grandeza com outra escala (100 x 100.000) NÃO muda.
      const trap = await usar(base, (c) =>
        c.query("SELECT 100.001::numeric(12,2)::text AS t"),
      );
      assert.equal(
        trap.rows[0].t,
        "100.00",
        "8i (xiii): a armadilha existe: numeric(12,2) arredonda a 3ª casa",
      );
      for (const col of ["total_amount", "shipping_cost"]) {
        const dbt = await clone(base, `ip_j_8i_xiii_${col}`);
        const poe = (valor) =>
          usar(dbt, (c) =>
            c.query(
              `UPDATE public.marketplace_orders SET ${col} = ${valor} WHERE id = $1`,
              [DB],
            ),
          );
        const imp = async (rotulo) => {
          const r = await rodar8i(dbt);
          const h = linha(r, IMP).vivo;
          assert.equal(
            h,
            await impressaoDe(dbt, ATESTADOS),
            `8i (xiii) ${col} = ${rotulo}: difere da calculada fora do banco`,
          );
          vistosNoLoop.push(r);
          return h;
        };
        const hNulo = await imp("NULL");
        assert.equal(hNulo, IMPRESSAO, "8i (xiii): NULL é o estado da base");
        await poe("100");
        const h100 = await imp("100");
        assert.notEqual(h100, hNulo, `8i (xiii) ${col}: NULL -> 100 muda`);
        await poe("100.000");
        assert.equal(
          (
            await usar(dbt, (c) =>
              c.query(
                `SELECT ${col}::text AS t FROM public.marketplace_orders WHERE id = $1`,
                [DB],
              ),
            )
          ).rows[0].t,
          "100.000",
          `8i (xiii) ${col}: o texto cru MUDOU de escala`,
        );
        assert.equal(
          await imp("100.000"),
          h100,
          `8i (xiii) ${col}: 100 x 100.000 NÃO muda a impressão`,
        );
        await poe("100.001");
        const h3 = await imp("100.001");
        assert.notEqual(
          h3,
          h100,
          `8i (xiii) ${col}: a 3ª casa MUDA a impressão (numeric(12,2) a esconderia)`,
        );
        await poe("0");
        assert.notEqual(
          await imp("0"),
          hNulo,
          `8i (xiii) ${col}: 0 não se confunde com NULL`,
        );
      }

      // (xii) A ORDEM faz parte da impressão: os MESMOS 3 pedidos inseridos em
      // ordem diferente dão a MESMA impressão (a serialização ordena por id); sem
      // o ORDER BY a ordem física decidiria. Mutante em memória: tira o ORDER BY.
      const ordemA = await clone(semeado, "ip_j_8i_ordem_a");
      const ordemB = await clone(semeado, "ip_j_8i_ordem_b");
      await plantar(ordemA, [DA, DB, DC]);
      await plantar(ordemB, [DC, DB, DA]);
      const hA = linha(await rodar8i(ordemA), IMP).vivo;
      const hB = linha(await rodar8i(ordemB), IMP).vivo;
      assert.equal(
        hA,
        hB,
        "8i (xii): inserir em outra ordem NÃO muda a impressão",
      );
      assert.equal(hA, IMPRESSAO);
      // Mutante A (em memória): ORDEM INVERSA (ORDER BY id DESC). A impressão
      // deixa de ser a calculada fora do banco: a ordem faz parte do hash e o
      // oráculo a pega.
      const ORDEM_INVERSA = SQL_8I.replace(
        "string_agg(linha, '#' ORDER BY id)",
        "string_agg(linha, '#' ORDER BY id DESC)",
      );
      assert.notEqual(ORDEM_INVERSA, SQL_8I, "8i (xii): o mutante A entrou");
      assert.notEqual(
        linha(await rodar8i(ordemA, { sql: ORDEM_INVERSA }), IMP).vivo,
        IMPRESSAO,
        "8i (xii) mutante A: a ordem invertida tem de mudar a impressão",
      );
      // Mutante B (em memória): SEM o ORDER BY. Este PG ordena o GROUP BY d.id
      // pelo plano, então a ordem de inserção pode NÃO mudar o hash aqui (mutante
      // equivalente sob o plano de hoje): o resultado é REGISTRADO, não afirmado.
      // O ORDER BY é a GARANTIA que não depende do plano.
      const SEM_ORDER_BY = SQL_8I.replace(
        "string_agg(linha, '#' ORDER BY id)",
        "string_agg(linha, '#')",
      );
      assert.notEqual(SEM_ORDER_BY, SQL_8I, "8i (xii): o mutante B entrou");
      const resultadosB = [];
      for (const pre of [[], ["SET enable_sort = off"]]) {
        const mA = linha(
          await rodar8i(ordemA, { sql: SEM_ORDER_BY, pre }),
          IMP,
        ).vivo;
        const mB = linha(
          await rodar8i(ordemB, { sql: SEM_ORDER_BY, pre }),
          IMP,
        ).vivo;
        resultadosB.push(
          `${pre.length ? "enable_sort=off" : "plano padrao"}: A ${mA === IMPRESSAO ? "=" : "!="} calculada, B ${mB === IMPRESSAO ? "=" : "!="} calculada, A ${mA === mB ? "=" : "!="} B`,
        );
      }
      console.log(
        `    8i (xii) mutante B (sem ORDER BY) — ${resultadosB.join(" | ")}`,
      );

      // (iv) UM sinal de cobrança em UM dos 3 (cada um num clone): reprova o sinal
      // dele — e a impressão SÓ quando o sinal mexe num campo coberto (gateway,
      // payment_status); registro de pagamento, estorno e devolução vivem em
      // OUTRA tabela e só reprovam a própria linha.
      const SINAIS = [
        [
          "gateway",
          "com id de cobranca no gateway",
          true,
          (c) =>
            c.query(
              "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-8I-NAO-PODE-SAIR' WHERE id = $1",
              [DB],
            ),
        ],
        [
          "pago",
          "com payment_status pago",
          true,
          (c) =>
            c.query(
              "UPDATE public.marketplace_orders SET payment_status = 'pago', paid_at = now() WHERE id = $1",
              [DC],
            ),
        ],
        [
          "pago_apos_expirar",
          "com payment_status pago",
          true,
          (c) =>
            c.query(
              "UPDATE public.marketplace_orders SET payment_status = 'pago_apos_expirar', paid_at = now() WHERE id = $1",
              [DA],
            ),
        ],
        [
          "recebido_na_entrega",
          "com payment_status pago",
          true,
          (c) =>
            c.query(
              "UPDATE public.marketplace_orders SET payment_status = 'recebido_na_entrega', paid_at = now() WHERE id = $1",
              [DA],
            ),
        ],
        [
          "estornado",
          "com payment_status pago",
          true,
          (c) =>
            c.query(
              "UPDATE public.marketplace_orders SET payment_status = 'estornado' WHERE id = $1",
              [DB],
            ),
        ],
        [
          "registro de pagamento",
          "com registro em marketplace_order_payment_history",
          false,
          (c) =>
            c.query(
              "INSERT INTO public.marketplace_order_payment_history (order_id, acao) VALUES ($1, 'recebido')",
              [DA],
            ),
        ],
        [
          "estorno",
          "com estorno em order_refunds",
          false,
          (c) =>
            c.query(
              `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, concluido_em) VALUES ($1, 10, 'lojista', 'solicitado', NULL)`,
              [DC],
            ),
        ],
        [
          "devolucao",
          "com devolucao",
          false,
          (c) =>
            c.query(
              `INSERT INTO public.devolucoes (
                 id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
                 modalidade, metodo_retorno, status, valor_itens, valor_reembolso, reembolso_manual,
                 prazo_ate, politica, concluida_em
               ) VALUES (
                 gen_random_uuid(), 'DV-8I-TESTE', $1, $2, 'arrependimento', 'desisti', 'reembolso', 'reembolso',
                 'local', 'entrega_na_loja', 'concluida', 30, 30, true,
                 current_date + 7, '{}'::jsonb, now()
               )`,
              [DB, U_CLIENTE],
            ),
        ],
      ];
      for (const [rotulo, trecho, mudaImpressao, plantarSinal] of SINAIS) {
        const nomeDb = `ip_j_8i_sinal_${rotulo.replace(/[^a-z]/gi, "_")}`;
        const sinal = await clone(base, nomeDb);
        await usar(sinal, plantarSinal);
        const rs = await rodar8i(sinal, { sql: SQL_ATESTADO });
        assert.equal(
          linha(rs, trecho).vivo,
          "1",
          `8i sinal ${rotulo}: esperava 1 divergente com o sinal`,
        );
        assert.deepEqual(
          nomes(rs).sort(),
          [
            linha(rs, trecho).item.trim(),
            ...(mudaImpressao ? [IMP_ITEM] : []),
          ].sort(),
          `8i sinal ${rotulo}: reprova a linha do sinal${mudaImpressao ? " e a impressão (campo coberto)" : " e SÓ ela (tabela fora da impressão)"}`,
        );
        assert.equal(linha(rs, IMP).ok, !mudaImpressao);
        vistosNoLoop.push(rs);
      }

      // ======================================================================
      // VISIBILIDADE E PAPEL NO MESMO SNAPSHOT (a 8i prova papel e visibilidade
      // das seis tabelas no MESMO statement que calcula o hash e os sinais).
      // Cada fixture é um clone da `base` (3 cancelled sem item + N1), e o papel
      // é o REAL (supabase_read_only_user: BYPASSRLS + pg_read_all_data); os casos
      // que mudam o papel mexem nele só dentro de try/finally e o restauram.
      // ======================================================================
      const T6 = [
        "marketplace_orders",
        "marketplace_order_items",
        "marketplace_order_history",
        "marketplace_order_payment_history",
        "order_refunds",
        "devolucoes",
      ];
      const [T6_ORD, T6_ITE, T6_HIS, T6_PAG, T6_REF, T6_DEV] = T6;
      const VAZIA = "VISIVEL_VAZIA";
      const COM = "VISIVEL_COM_LINHAS";
      const INC = "RLS_ATIVA_INCONCLUSIVO";
      const BLQ = "BLOQUEIA";
      const S_PAG =
        "dos quais com registro em marketplace_order_payment_history";
      const S_REF = "dos quais com estorno em order_refunds";
      const S_DEV = "dos quais com devolucao";
      const V = (t) => `${t}: visibilidade`;
      const vivoDe = (rows, t) => linha(rows, V(t)).vivo;
      const vereditos8i = (rows) =>
        Object.fromEntries(T6.map((t) => [t, linha(rows, V(t)).vivo]));
      const VISTO_TUDO = {
        [T6_ORD]: COM,
        [T6_ITE]: COM,
        [T6_HIS]: COM,
        [T6_PAG]: COM,
        [T6_REF]: COM,
        [T6_DEV]: COM,
      };
      const alterarPapel = (sqlPapel) =>
        usar("template1", (a) => a.query(sqlPapel));
      const semBypass = async (fn) => {
        await alterarPapel(`ALTER ROLE ${PAPEL_8I} NOBYPASSRLS`);
        try {
          return await fn();
        } finally {
          await alterarPapel(`ALTER ROLE ${PAPEL_8I} BYPASSRLS`);
        }
      };
      const semLeituraGeral = async (fn) => {
        await alterarPapel(`REVOKE pg_read_all_data FROM ${PAPEL_8I}`);
        try {
          return await fn();
        } finally {
          await alterarPapel(`GRANT pg_read_all_data TO ${PAPEL_8I}`);
        }
      };
      // derruba toda política e desliga a RLS nas seis (só neste clone): o que
      // esconde linha é só o que o caso liga depois
      const neutralizar = async (c) => {
        await c.query("SET session_replication_role = replica");
        for (const t of T6) {
          const pol = await c.query(
            "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1",
            [t],
          );
          for (const { policyname } of pol.rows)
            await c.query(`DROP POLICY "${policyname}" ON public.${t}`);
          await c.query(`ALTER TABLE public.${t} DISABLE ROW LEVEL SECURITY`);
          await c.query(`ALTER TABLE public.${t} NO FORCE ROW LEVEL SECURITY`);
        }
      };
      const esvaziar = async (c, tabelas) => {
        await c.query("SET session_replication_role = replica");
        for (const t of tabelas) {
          if (t === T6_DEV) await c.query("DELETE FROM public.devolucao_itens");
          await c.query(`DELETE FROM public.${t}`);
        }
      };
      const estornoDe = (c, id) =>
        c.query(
          `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, concluido_em) VALUES ($1, 10, 'lojista', 'solicitado', NULL)`,
          [id],
        );
      const devolucaoDe = (c, id) =>
        c.query(
          `INSERT INTO public.devolucoes (
             id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
             modalidade, metodo_retorno, status, valor_itens, valor_reembolso, reembolso_manual,
             prazo_ate, politica, concluida_em
           ) VALUES (
             gen_random_uuid(), 'DV-8I-TESTE', $1, $2, 'arrependimento', 'desisti', 'reembolso', 'reembolso',
             'local', 'entrega_na_loja', 'concluida', 30, 30, true,
             current_date + 7, '{}'::jsonb, now()
           )`,
          [id, U_CLIENTE],
        );
      const pagamentoDe = (c, id) =>
        c.query(
          "INSERT INTO public.marketplace_order_payment_history (order_id, acao) VALUES ($1, 'recebido')",
          [id],
        );
      const contarComo = (db, papel) =>
        usar(db, async (c) => {
          await c.query(`SET ROLE ${papel}`);
          const pares = [];
          for (const t of T6)
            pares.push([
              t,
              (await c.query(`SELECT count(*)::int AS n FROM public.${t}`))
                .rows[0].n,
            ]);
          return Object.fromEntries(pares);
        });

      // (a) a LOJA REAL (CAF): papel com BYPASSRLS, as políticas do app LIGADAS,
      // order_refunds e devolucoes VAZIAS (e visíveis). Era o falso inconclusivo.
      const fCaf = await clone(base, "ip_j_8i_caf");
      await usar(fCaf, (c) => esvaziar(c, [T6_REF, T6_DEV]));
      const rlsDoApp = await usar(
        fCaf,
        async (c) =>
          new Map(
            (
              await c.query(
                "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)",
                [T6],
              )
            ).rows.map((r) => [r.relname, r.relrowsecurity]),
          ),
      );
      assert.equal(
        [...rlsDoApp.values()].filter(Boolean).length > 0,
        true,
        "8i (a): a fixture tem RLS ligada em alguma das seis (o caso real tem política E bypass)",
      );
      const fCafTudo = await clone(fCaf, "ip_j_8i_caf_tudo");
      await usar(fCafTudo, (c) => esvaziar(c, [T6_PAG]));
      const fCafEstorno = await clone(fCaf, "ip_j_8i_caf_estorno");
      await usar(fCafEstorno, (c) => estornoDe(c, DC));
      const fCafDev = await clone(fCaf, "ip_j_8i_caf_dev");
      await usar(fCafDev, (c) => devolucaoDe(c, DB));
      const fCafPag = await clone(fCaf, "ip_j_8i_caf_pag");
      await usar(fCafPag, (c) => pagamentoDe(c, DA));

      // (c) o papel que PERDE o bypass (mesmo nome, NOBYPASSRLS) com RLS ligada e
      // política: order_refunds tem linhas ESCONDIDAS (inclusive um estorno do DB),
      // devolucoes está vazia sob RLS. Todo o resto visível.
      const fRls = await clone(base, "ip_j_8i_rls");
      await usar(fRls, async (c) => {
        await neutralizar(c);
        await estornoDe(c, DB);
        await esvaziar(c, [T6_DEV]);
        for (const t of [T6_REF, T6_DEV]) {
          await c.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
          await c.query(
            `CREATE POLICY nunca_casa ON public.${t} FOR SELECT TO public USING (false)`,
          );
        }
      });
      // (d) RLS PARCIAL: a política deixa ver só o registro de O2; o de DA (um dos
      // 3 atestados) fica escondido.
      const fParcial = await clone(base, "ip_j_8i_parcial");
      await usar(fParcial, async (c) => {
        await neutralizar(c);
        await pagamentoDe(c, DA);
        await c.query(`ALTER TABLE public.${T6_PAG} ENABLE ROW LEVEL SECURITY`);
        await c.query(
          `CREATE POLICY casa_um ON public.${T6_PAG} FOR SELECT TO public USING (order_id = '${O2}'::uuid)`,
        );
      });
      // (k) RLS PARCIAL nos PEDIDOS: a política esconde UM dos 3 atestados (DA).
      // A população vira 2 e a visibilidade de marketplace_orders reprova.
      const fPedidosRls = await clone(base, "ip_j_8i_pedidos_rls");
      await usar(fPedidosRls, async (c) => {
        await neutralizar(c);
        await c.query(`ALTER TABLE public.${T6_ORD} ENABLE ROW LEVEL SECURITY`);
        await c.query(
          `CREATE POLICY sem_da ON public.${T6_ORD} FOR SELECT TO public USING (id <> '${DA}'::uuid)`,
        );
      });
      // (f)(g) papel SEM pg_read_all_data: SELECT concedido tabela a tabela
      const concederLeitura = async (c, { inteiras, colunas = {} }) => {
        await c.query(`GRANT USAGE ON SCHEMA extensions TO ${PAPEL_8I}`);
        for (const t of inteiras)
          await c.query(`GRANT SELECT ON public.${t} TO ${PAPEL_8I}`);
        for (const [t, cols] of Object.entries(colunas))
          await c.query(
            `GRANT SELECT (${cols.join(", ")}) ON public.${t} TO ${PAPEL_8I}`,
          );
      };
      const fSemSel = await clone(base, "ip_j_8i_semsel");
      await usar(fSemSel, (c) =>
        c.query(`GRANT USAGE ON SCHEMA extensions TO ${PAPEL_8I}`),
      );
      const fCincoDeSeis = await clone(base, "ip_j_8i_cinco");
      await usar(fCincoDeSeis, (c) =>
        concederLeitura(c, {
          inteiras: [T6_ORD, T6_ITE, T6_HIS, T6_PAG, T6_REF],
        }),
      );
      const fColDev = new Map();
      for (const [rotulo, vazia] of [
        ["vazia", true],
        ["cheia", false],
      ]) {
        const d = await clone(base, `ip_j_8i_coldev_${rotulo}`);
        await usar(d, async (c) => {
          if (vazia) await esvaziar(c, [T6_DEV]);
          await concederLeitura(c, {
            inteiras: [T6_ORD, T6_ITE, T6_HIS, T6_PAG, T6_REF],
            colunas: { [T6_DEV]: ["order_id"] },
          });
        });
        fColDev.set(rotulo, d);
      }
      const fColId = await clone(base, "ip_j_8i_colid");
      await usar(fColId, (c) =>
        concederLeitura(c, {
          inteiras: [T6_ORD, T6_ITE, T6_HIS, T6_PAG, T6_REF],
          colunas: { [T6_DEV]: ["id"] },
        }),
      );
      const fColHis = await clone(base, "ip_j_8i_colhis");
      await usar(fColHis, (c) =>
        concederLeitura(c, {
          inteiras: [T6_ORD, T6_ITE, T6_PAG, T6_REF, T6_DEV],
          colunas: { [T6_HIS]: ["id"] },
        }),
      );
      // (h) o papel é DONO das tabelas (direto ou por herança), sem e com FORCE
      const montarDono = async (nome, dono, forcar) => {
        const d = await clone(base, nome);
        await usar(d, async (c) => {
          await neutralizar(c);
          for (const t of T6)
            await c.query(`ALTER TABLE public.${t} OWNER TO ${dono}`);
          for (const t of [T6_HIS, T6_PAG, T6_REF, T6_DEV]) {
            await c.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
            await c.query(
              `CREATE POLICY nunca_casa ON public.${t} FOR SELECT TO public USING (false)`,
            );
          }
          for (const t of forcar)
            await c.query(`ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY`);
        });
        return d;
      };
      const fDono = await montarDono("ip_j_8i_dono", PAPEL_8I, []);
      const fDonoForce = await montarDono("ip_j_8i_dono_force", PAPEL_8I, [
        T6_REF,
        T6_DEV,
      ]);
      const fHerda = await montarDono("ip_j_8i_herda", PAPEL_DONO_8I, []);
      const fHerdaForce = await montarDono(
        "ip_j_8i_herda_force",
        PAPEL_DONO_8I,
        [T6_REF, T6_DEV],
      );

      // A verdade de fora: o que o papel SEM bypass enxerga de fato nos clones
      // plantados (para provar que a RLS esconde, e não que a tabela está vazia).
      await semBypass(async () => {
        assert.deepEqual(
          await contarComo(fRls, PAPEL_8I),
          {
            [T6_ORD]: 7,
            [T6_ITE]: 4,
            [T6_HIS]: 7,
            [T6_PAG]: 1,
            [T6_REF]: 0,
            [T6_DEV]: 0,
          },
          "8i (c): sem bypass, refunds some (tem 3 de verdade) e devolucoes está vazia",
        );
        assert.deepEqual(
          await contarComo(fParcial, PAPEL_8I),
          {
            [T6_ORD]: 7,
            [T6_ITE]: 4,
            [T6_HIS]: 7,
            [T6_PAG]: 1,
            [T6_REF]: 2,
            [T6_DEV]: 1,
          },
          "8i (d): sem bypass, vê 1 dos 2 registros de pagamento (RLS parcial)",
        );
      });
      assert.deepEqual(
        await usar(
          fRls,
          async (c) =>
            (await c.query(`SELECT count(*)::int AS n FROM public.${T6_REF}`))
              .rows[0],
        ),
        { n: 3 },
        "8i (c): a verdade de fora de order_refunds é 3 linhas (2 da fixture e 1 do DB)",
      );
      assert.deepEqual(
        await usar(
          fParcial,
          async (c) =>
            (await c.query(`SELECT count(*)::int AS n FROM public.${T6_PAG}`))
              .rows[0],
        ),
        { n: 2 },
        "8i (d): a verdade de fora de payment_history é 2 linhas",
      );

      const MUTANTES_NOMES = [];
      // atesta (em memória) QUALQUER texto de SQL: o oráculo é a impressão da base
      const atestarSql = (texto) =>
        texto.replace(CONSTANTE, () => `'${IMPRESSAO}'`);
      const SUPER = await usar(
        "template1",
        async (c) => (await c.query("SELECT current_user AS u")).rows[0].u,
      );
      // A BATERIA: roda os casos (a) a (h) + as duas injeções contra um SQL. Com o
      // SQL de verdade tudo passa; com cada mutante ALGUMA asserção tem de falhar.
      const provar8i = async (sqlBase) => {
        const sql = atestarSql(sqlBase);
        const R = (db, o = {}) => rodar8i(db, { sql, ...o });
        const papelOk = (r, rotulo) => {
          assert.equal(linha(r, "papel efetivo").vivo, PAPEL_8I, rotulo);
          assert.equal(linha(r, "papel efetivo").ok, true, rotulo);
        };
        // (a) CAF: tudo ok no modo atestado; só a impressão reprova no modo medir
        const a = await R(fCaf);
        assert.equal(a.length, LINHAS_DA_8I, "8i (a): 19 linhas");
        assert.deepEqual(
          nomes(a),
          [],
          "8i (a) CAF: refunds/devolucoes vazias e visíveis → tudo ok",
        );
        assert.deepEqual(
          vereditos8i(a),
          { ...VISTO_TUDO, [T6_REF]: VAZIA, [T6_DEV]: VAZIA },
          "8i (a): VISIVEL_VAZIA nas duas tabelas vazias, mesmo com RLS ligada (o papel tem bypass)",
        );
        assert.equal(
          linha(a, S_REF).vivo,
          "0",
          "8i (a): 0 numa tabela VISIVEL_VAZIA é conclusivo",
        );
        assert.equal(linha(a, S_DEV).vivo, "0");
        assert.equal(linha(a, S_REF).ok, true);
        assert.equal(linha(a, S_DEV).ok, true);
        papelOk(a, "8i (a): papel");
        assert.equal(
          linha(a, "atributos do papel").vivo,
          "rolbypassrls=true; rolsuper=false",
        );
        assert.equal(linha(a, "atributos do papel").ok, true);
        const aMedir = await rodar8i(fCaf, { sql: sqlBase });
        assert.deepEqual(
          nomes(aMedir),
          [IMP_ITEM],
          "8i (a) modo medir: só a impressão reprova",
        );
        assert.equal(linha(aMedir, IMP).vivo, IMPRESSAO);
        const a2 = await R(fCafTudo);
        assert.deepEqual(
          nomes(a2),
          [],
          "8i (a2): as TRÊS auxiliares vazias → tudo ok",
        );
        assert.equal(vivoDe(a2, T6_PAG), VAZIA);
        assert.equal(linha(a2, S_PAG).vivo, "0");
        // (b) com linhas de OUTROS pedidos → ok; com sinal num dos 3 → reprova com a contagem
        assert.deepEqual(vereditos8i(await R(base)), VISTO_TUDO);
        assert.deepEqual(
          nomes(await R(base)),
          [],
          "8i (b): auxiliares com linhas de outros pedidos → ok",
        );
        for (const [rotulo, db, sinal] of [
          ["estorno no ÚNICO registro", fCafEstorno, S_REF],
          ["devolução no ÚNICO registro", fCafDev, S_DEV],
          [
            "registro de pagamento (tabela com 1 linha de outro pedido)",
            fCafPag,
            S_PAG,
          ],
        ]) {
          const b = await R(db);
          assert.deepEqual(
            nomes(b),
            [sinal],
            `8i (b) ${rotulo}: reprova só o 'dos quais'`,
          );
          assert.equal(
            linha(b, sinal).vivo,
            "1",
            `8i (b) ${rotulo}: a contagem`,
          );
        }
        // (c) papel sem bypass + RLS ligada + política: INCONCLUSIVO reprova e os sinais viram INCONCLUSIVO
        const c3 = await semBypass(() => R(fRls));
        assert.deepEqual(
          vereditos8i(c3),
          { ...VISTO_TUDO, [T6_REF]: INC, [T6_DEV]: INC },
          "8i (c): RLS ativa → RLS_ATIVA_INCONCLUSIVO (nunca VISIVEL_VAZIA, nem para a tabela vazia)",
        );
        assert.deepEqual(
          nomes(c3).sort(),
          [V(T6_REF), V(T6_DEV), S_REF, S_DEV].sort(),
          "8i (c): reprovam as duas visibilidades E os dois sinais",
        );
        assert.match(
          linha(c3, S_REF).vivo,
          /^INCONCLUSIVO \(/,
          "8i (c): o sinal NÃO é 0",
        );
        assert.match(linha(c3, S_DEV).vivo, /^INCONCLUSIVO \(/);
        assert.equal(linha(c3, V(T6_REF)).ok, false);
        assert.equal(
          linha(c3, "atributos do papel").vivo,
          "rolbypassrls=false; rolsuper=false",
        );
        assert.equal(
          linha(c3, IMP).ok,
          true,
          "8i (c): a impressão não depende das auxiliares",
        );
        // ...e o MESMO banco com o papel de bypass mostra o que a RLS escondia
        const c3b = await R(fRls);
        assert.deepEqual(
          nomes(c3b),
          [S_REF],
          "8i (c): com bypass o estorno plantado aparece",
        );
        assert.equal(linha(c3b, S_REF).vivo, "1");
        // (d) RLS PARCIAL: vê 1 de 2 → continua INCONCLUSIVO, nunca ok
        const d = await semBypass(() => R(fParcial));
        assert.equal(
          vivoDe(d, T6_PAG),
          INC,
          "8i (d): RLS parcial → inconclusivo",
        );
        assert.deepEqual(
          nomes(d).sort(),
          [V(T6_PAG), S_PAG].sort(),
          "8i (d): reprova a visibilidade e o sinal (o registro de DA está escondido)",
        );
        assert.match(linha(d, S_PAG).vivo, /^INCONCLUSIVO \(/);
        const d2 = await R(fParcial);
        assert.equal(
          linha(d2, S_PAG).vivo,
          "1",
          "8i (d): com bypass o registro de DA aparece",
        );
        // (e) papel com OUTRO nome (e superuser) reprova o papel efetivo
        const e1 = await R(base, { papel: PAPEL_RO });
        assert.deepEqual(
          nomes(e1),
          ["papel efetivo"],
          "8i (e): outro nome reprova SÓ o papel",
        );
        assert.equal(linha(e1, "papel efetivo").vivo, PAPEL_RO);
        const e2 = await R(base, { papel: null });
        assert.deepEqual(
          nomes(e2),
          ["papel efetivo"],
          "8i (e): superuser também reprova o papel",
        );
        assert.equal(linha(e2, "papel efetivo").vivo, SUPER);
        assert.equal(
          linha(e2, "atributos do papel").vivo,
          "rolbypassrls=true; rolsuper=true",
        );
        // (f) SEM SELECT: a consulta INTEIRA falha alto (42501), nunca zero silencioso
        const falhou42501 = (re) => (e) => {
          assert.equal(e.code, "42501", `8i (f): ${e.message}`);
          assert.match(e.message, re);
          return true;
        };
        await semLeituraGeral(async () => {
          await assert.rejects(
            R(fSemSel),
            falhou42501(/permission denied for table/),
            "8i (f): sem SELECT nenhum → falha alta",
          );
          await assert.rejects(
            R(fCincoDeSeis),
            falhou42501(/permission denied for table devolucoes/),
            "8i (f): SELECT em cinco das seis → falha alta citando a que falta",
          );
          // SELECT só da coluna `id` de devolucoes: a 8i lê order_id → 42501 também
          await assert.rejects(
            R(fColId),
            falhou42501(/permission denied for table devolucoes/),
            "8i (f): SELECT só de OUTRA coluna → falha alta",
          );
        });
        // (g) SELECT parcial (só de coluna) numa tabela: roda, e a linha é BLOQUEIA
        for (const rotulo of ["vazia", "cheia"]) {
          const g = await semLeituraGeral(() => R(fColDev.get(rotulo)));
          assert.equal(
            vivoDe(g, T6_DEV),
            BLQ,
            `8i (g) devolucoes ${rotulo}: SELECT de coluna → BLOQUEIA`,
          );
          assert.deepEqual(
            nomes(g).sort(),
            [V(T6_DEV), S_DEV].sort(),
            `8i (g) devolucoes ${rotulo}: reprova a visibilidade e o sinal`,
          );
          assert.match(linha(g, S_DEV).vivo, /^INCONCLUSIVO \(/);
          assert.equal(linha(g, V(T6_DEV)).ok, false);
          assert.equal(
            vivoDe(g, T6_ORD),
            COM,
            "8i (g): as outras cinco seguem o veredito normal",
          );
        }
        const g2 = await semLeituraGeral(() => R(fColHis));
        assert.equal(
          vivoDe(g2, T6_HIS),
          BLQ,
          "8i (g): history com SELECT só de coluna → BLOQUEIA",
        );
        assert.deepEqual(
          nomes(g2),
          [V(T6_HIS)],
          "8i (g): só a visibilidade de history reprova",
        );
        // (h) o papel é DONO (sem FORCE ignora a RLS; com FORCE, não)
        for (const [rotulo, db, papelNome, comForce] of [
          ["dono direto", fDono, PAPEL_8I, false],
          ["dono direto + FORCE", fDonoForce, PAPEL_8I, true],
          ["herda o dono", fHerda, PAPEL_DONO_8I, false],
          ["herda o dono + FORCE", fHerdaForce, PAPEL_DONO_8I, true],
        ]) {
          const h = await semBypass(async () => {
            if (papelNome === PAPEL_8I) return R(db);
            await alterarPapel(`GRANT ${papelNome} TO ${PAPEL_8I}`);
            try {
              return await R(db);
            } finally {
              await alterarPapel(`REVOKE ${papelNome} FROM ${PAPEL_8I}`);
            }
          });
          if (!comForce) {
            assert.deepEqual(
              nomes(h),
              [],
              `8i (h) ${rotulo}: o dono sem FORCE ignora a RLS → tudo ok`,
            );
            assert.deepEqual(vereditos8i(h), VISTO_TUDO, `8i (h) ${rotulo}`);
          } else {
            assert.deepEqual(
              vereditos8i(h),
              { ...VISTO_TUDO, [T6_REF]: INC, [T6_DEV]: INC },
              `8i (h) ${rotulo}: FORCE sujeita o dono à RLS`,
            );
            assert.deepEqual(
              nomes(h).sort(),
              [V(T6_REF), V(T6_DEV), S_REF, S_DEV].sort(),
              `8i (h) ${rotulo}: reprovam as duas visibilidades e os dois sinais`,
            );
          }
        }
        // (k) RLS parcial nos pedidos: o conjunto fica errado E a visibilidade reprova
        const k = await semBypass(() => R(fPedidosRls));
        assert.equal(
          vivoDe(k, T6_ORD),
          INC,
          "8i (k): RLS parcial nos pedidos → RLS_ATIVA_INCONCLUSIVO",
        );
        assert.equal(linha(k, V(T6_ORD)).ok, false);
        assert.equal(
          linha(k, "pedidos divergentes").vivo,
          "2",
          "8i (k): a RLS escondeu um dos 3 divergentes",
        );
        assert.deepEqual(
          nomes(k).sort(),
          [
            V(T6_ORD),
            IMP_ITEM,
            "pedidos divergentes (mesma regra da 8c; base atestada)",
          ].sort(),
          "8i (k): reprovam a visibilidade, a contagem e a impressão",
        );
        // (inj-1) row_security_active que DISCORDA da derivação → as seis BLOQUEIAM
        const DIVERGE = sqlBase.replace(
          "row_security_active(c.oid) AS rls_ativa",
          "(NOT row_security_active(c.oid)) AS rls_ativa",
        );
        assert.notEqual(
          DIVERGE,
          sqlBase,
          "8i (inj): a simulação de divergência entrou",
        );
        const dv = await rodar8i(fCaf, { sql: atestarSql(DIVERGE) });
        assert.deepEqual(
          Object.values(vereditos8i(dv)),
          Array(6).fill(BLQ),
          "8i (inj): row_security_active que discorda da derivação → BLOQUEIA as seis",
        );
        for (const s of [S_PAG, S_REF, S_DEV])
          assert.match(
            linha(dv, s).vivo,
            /^INCONCLUSIVO \(/,
            "8i (inj): os sinais ficam INCONCLUSIVO",
          );
        // (inj-2) bypass desconhecido (NULL) → BLOQUEIA onde a RLS está ligada
        const SEM_BYPASS = sqlBase.replace(
          "r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user",
          "r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = 'papel_inexistente_8i'",
        );
        assert.notEqual(
          SEM_BYPASS,
          sqlBase,
          "8i (inj): a simulação de bypass NULL entrou",
        );
        const sb = await rodar8i(fCaf, { sql: atestarSql(SEM_BYPASS) });
        assert.deepEqual(
          vereditos8i(sb),
          Object.fromEntries(
            T6.map((t) => [
              t,
              rlsDoApp.get(t)
                ? BLQ
                : t === T6_REF || t === T6_DEV
                  ? VAZIA
                  : COM,
            ]),
          ),
          "8i (inj): rolbypassrls NULL → BLOQUEIA exatamente onde a RLS está ligada",
        );
        assert.equal(
          linha(sb, "atributos do papel").vivo,
          "rolbypassrls=?; rolsuper=false",
        );
        return { a, a2, c3, c3b, d, e1, e2, dv, sb };
      };

      // O SQL de verdade: tudo passa.
      const saidasMatriz = await provar8i(SQL_8I);
      for (const [rotulo, rows] of Object.entries(saidasMatriz))
        console.log(
          `  [8i] ${rotulo}: ${T6.map((t) => `${t.replace("marketplace_", "")}=${linha(rows, V(t)).vivo}`).join(" | ")}`,
        );

      // MUTANTES (em memória): cada um tem de MORRER por uma ASSERÇÃO (não por erro
      // de SQL). O restaurado (SQL_8I) acabou de passar acima.
      const MUTANTES = [
        [
          "M-a veredito de visibilidade por EXISTS (volta ao antigo: vazia = inconclusiva)",
          (s) =>
            s.replace(
              "WHEN j.apto AND NOT j.rls_ativa AND NOT j.tem_linha THEN 'VISIVEL_VAZIA'",
              "WHEN j.apto AND NOT j.rls_ativa AND NOT j.tem_linha THEN 'RLS_ATIVA_INCONCLUSIVO'",
            ),
        ],
        [
          "M-b sem a conferência do papel (o nome é sempre o esperado)",
          (s) =>
            s.replace(
              "current_user::text AS nome",
              "'supabase_read_only_user'::text AS nome",
            ),
        ],
        [
          "M-c aceita RLS_ATIVA_INCONCLUSIVO como conclusivo (ok)",
          (s) =>
            s.replace(
              "(v.resultado IN ('VISIVEL_VAZIA', 'VISIVEL_COM_LINHAS')) AS conclusivo",
              "(v.resultado IN ('VISIVEL_VAZIA', 'VISIVEL_COM_LINHAS', 'RLS_ATIVA_INCONCLUSIVO')) AS conclusivo",
            ),
        ],
        [
          "M-d sem o `apto` (row_security_active não é conferido contra a derivação)",
          (s) =>
            s.replace(
              /\n\s+AND m\.rls_ativa = \(m\.rls_ligada\n\s+AND NOT \(p\.bypass OR p\.super\)\n\s+AND NOT \(m\.dono AND NOT m\.rls_forcada\)\),/,
              ",",
            ),
        ],
        [
          "M-e calcula o sinal mesmo sem visibilidade",
          (s) =>
            s.replace(
              /\(SELECT lt\.conclusivo FROM leitura lt WHERE lt\.tabela = '[a-z_]+'\)/g,
              "true",
            ),
        ],
        [
          "M-f sem `pode_ler` (SELECT só de coluna passa por visível)",
          (s) => s.replace("\n                  AND m.pode_ler", ""),
        ],
        [
          "M-g sem o termo do dono na derivação",
          (s) =>
            s.replace(
              "\n                                     AND NOT (m.dono AND NOT m.rls_forcada)",
              "",
            ),
        ],
        [
          "M-h sem o termo do bypass na derivação",
          (s) =>
            s.replace(
              "\n                                     AND NOT (p.bypass OR p.super)",
              "",
            ),
        ],
      ];
      for (const [rotulo, muta] of MUTANTES) {
        const mutado = muta(SQL_8I);
        assert.notEqual(mutado, SQL_8I, `8i: o mutante entrou (${rotulo})`);
        let morte = null;
        try {
          await provar8i(mutado);
        } catch (e) {
          morte = e;
        }
        assert.ok(morte, `8i: o mutante SOBREVIVEU: ${rotulo}`);
        assert.ok(
          morte instanceof assert.AssertionError,
          `8i: o mutante morreu por erro que NÃO é asserção (${morte?.message}): ${rotulo}`,
        );
        MUTANTES_NOMES.push(rotulo);
        console.log(
          `    8i mutante ${rotulo}: MORREU — ${String(morte.message).split("\n")[0].slice(0, 170)}`,
        );
      }
      // o restaurado volta a passar
      await provar8i(SQL_8I);

      // (i) PRESERVAÇÃO: o hash sai IGUAL ao da 084c52dc, no MESMO banco, em
      // vários estados (a referência congelada é o SQL de 084c52dc byte a byte).
      const REF_8I = fs.readFileSync(
        path.join(REPO, "tests", "banco", "referencia", "8i-084c52dc.sql"),
        "utf8",
      );
      assert.equal(
        require("node:crypto")
          .createHash("sha256")
          .update(REF_8I)
          .digest("hex"),
        "d9585cdf8534f778761b01f51d0803057a8db3a2538c4eb3a0a0da7c9c8ea48a",
        "8i (i): a referência congelada é a de 084c52dc",
      );
      assert.equal(CONF.contarStatements(REF_8I), 1);
      const igualAoAntigo = async (db, rotulo, opcoes = {}) => {
        const antigo = linha(
          await rodar8i(db, { sql: REF_8I, ...opcoes }),
          IMP,
        );
        const novo = linha(await rodar8i(db, opcoes), IMP);
        assert.equal(
          novo.vivo,
          antigo.vivo,
          `8i (i) ${rotulo}: a impressão da 8i nova difere da de 084c52dc`,
        );
        return novo.vivo;
      };
      const hashesComparados = [];
      for (const [rotulo, db] of [
        ["base", base],
        ["fixture limpa (sem divergentes)", semeado],
        ["4º divergente ativo", ativo],
        ["troca de pedido", troca],
        ["subtotal alterado", subt],
        ["outra escala", escala],
        ["ordem de inserção A", ordemA],
        ["ordem de inserção B", ordemB],
      ])
        hashesComparados.push([rotulo, await igualAoAntigo(db, rotulo)]);
      hashesComparados.push([
        "outro fuso",
        await igualAoAntigo(base, "outro fuso", { fuso: "America/Sao_Paulo" }),
      ]);
      assert.equal(
        hashesComparados[0][1],
        IMPRESSAO,
        "8i (i): a base dá a impressão atestável",
      );
      assert.equal(hashesComparados[1][1], "(sem divergentes)");
      assert.equal(
        new Set(hashesComparados.map((h) => h[1])).size >= 5,
        true,
        "8i (i): os estados comparados dão impressões diferentes (a comparação não é trivial)",
      );
      console.log(
        `  [8i] (i) a impressão é IDÊNTICA à de 084c52dc em ${hashesComparados.length} estados: ${hashesComparados.map(([r, h]) => `${r}=${h.slice(0, 8)}`).join(", ")}`,
      );

      // (v) RLS cega nos PEDIDOS, papel REAL sem BYPASSRLS, com as políticas do
      // app: a política TO public do histórico de pagamento chama
      // is_admin()/rls_admin_atual() sem EXECUTE para o papel → FALHA ALTA
      // (42501), nunca um zero que engana.
      const cego = await clone(base, "ip_j_8i_cego");
      await usar(cego, (c) =>
        c.query(
          "ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY",
        ),
      );
      await assert.rejects(
        semBypass(() => rodar8i(cego, { sql: SQL_ATESTADO })),
        /permission denied for function (is_admin|rls_admin_atual)/,
        "8i cego: falha alta, nunca 0 silencioso",
      );

      // (vii) NENHUM id (nem sem hífen), nome, e-mail ou id de gateway na saída
      // — de NENHUMA das execuções desta seção (modo medir, atestado, troca, cada
      // campo, cada papel e cada fixture de visibilidade).
      const vistos = JSON.stringify(saidas8i);
      assert.ok(
        saidas8i.length > 100,
        `8i: poucas saídas vistas (${saidas8i.length})`,
      );
      assert(
        !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(vistos),
        "8i: a saída vazou algo com forma de id",
      );
      for (const proibido of [...ATESTADOS, N1, A4, O1, O2, O3, U_CLIENTE]) {
        assert(!vistos.includes(proibido), `8i: a saída vazou ${proibido}`);
        assert(
          !vistos.includes(proibido.replace(/-/g, "")),
          `8i: a saída vazou ${proibido} sem hífen`,
        );
      }
      for (const proibido of [
        "Cliente FP",
        "@fp.teste",
        "MP-8I-NAO-PODE-SAIR",
        "DV-8I-TESTE",
      ])
        assert(!vistos.includes(proibido), `8i: a saída vazou ${proibido}`);
      ok(
        "(j) 8i: 3 cancelled sem item + impressão atestada (em memória) → 19/19 ok; modo medir (A_ATESTAR) → só a impressão reprova e o vivo são 64 hex iguais ao sha256 calculado em JS; 4º divergente ativo → contagem, 'fora de cancelled' e impressão; TROCA → contagem 3 ok MAS a impressão reprova; subtotal / status / payment_status alterados → a impressão reprova; outra escala e outro fuso → a impressão NÃO muda; cada um dos 17 grupos de campos cobertos muda a impressão; 3ª casa de total_amount/shipping_cost muda e 100 x 100.000 não; outra ordem de inserção → mesma impressão; 8 sinais → reprova a linha do sinal; PAPEL E VISIBILIDADE NO MESMO SNAPSHOT: (a) loja real (bypass, refunds/devolucoes vazias, RLS do app ligada) → 19/19 ok; (b) com linhas de outros pedidos → ok, com sinal num dos 3 → reprova com a contagem; (c) papel sem bypass + RLS+política → RLS_ATIVA_INCONCLUSIVO e os sinais INCONCLUSIVO (nunca 0); (d) RLS parcial → inconclusivo; (e) outro papel/superuser → papel efetivo reprova; (f) sem SELECT / cinco de seis / outra coluna → 42501; (g) SELECT de coluna → BLOQUEIA; (h) dono e herdeiro do dono, sem/com FORCE → coerente com a derivação; row_security_active divergente ou bypass NULL → BLOQUEIA; 8 mutantes mortos por asserção; impressão IDÊNTICA à de 084c52dc em 9 estados; nenhum id, nome, e-mail, gateway ou devolução na saída",
      );
    }

    // 8j: a VISIBILIDADE das seis tabelas que a 8h/8i leem. Separa "tabela vazia"
    // de "tabela com linhas que a RLS esconde do papel que leu". Diagnóstico: não
    // substitui a 8c/8h/8i e não atesta a impressão da 8i. Formato da 8c.
    {
      const NOME_8J = "8j-visibilidade-das-tabelas-auxiliares";
      const SQL_8J = fs.readFileSync(
        path.join(REPO, "scripts", "publicacao", "consultas", `${NOME_8J}.sql`),
        "utf8",
      );
      assert.equal(CONF.contarStatements(SQL_8J), 1, "8j: 1 statement");
      const T8J = [
        "marketplace_orders",
        "marketplace_order_items",
        "marketplace_order_history",
        "marketplace_order_payment_history",
        "order_refunds",
        "devolucoes",
      ];
      const [T_ORD, T_ITE, T_HIS, T_PAG, T_REF, T_DEV] = T8J;
      // Papéis NOVOS (cluster; a limpeza está no `finally` do arquivo): o dono das
      // tabelas, um membro que HERDA o dono, um sem nenhum SELECT e um com SELECT
      // em cinco das seis.
      await usar("template1", async (a) => {
        for (const p of [
          PAPEL_DONO_8J,
          PAPEL_MEMBRO_8J,
          PAPEL_SEMSEL_8J,
          PAPEL_PARCIAL_8J,
          PAPEL_COLUNA_8J,
        ])
          await a.query(
            `DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${p}') THEN CREATE ROLE ${p} NOLOGIN; END IF; END $r$`,
          );
        await a.query(`GRANT ${PAPEL_DONO_8J} TO ${PAPEL_MEMBRO_8J}`);
      });
      const rodar8j = async (
        db,
        { papel = PAPEL_RO, sql = SQL_8J, pre = [] } = {},
      ) =>
        usar(db, async (c) => {
          if (papel) await c.query(`SET ROLE ${papel}`);
          await c.query("SET default_transaction_read_only = on");
          for (const p of pre) await c.query(p);
          try {
            const r = await c.query(sql);
            assert.deepEqual(
              r.fields.map((f) => f.name),
              ["item", "esperado", "vivo", "ok"],
              "8j: colunas item/esperado/vivo/ok",
            );
            return r.rows;
          } finally {
            if (papel) await c.query("RESET ROLE");
          }
        });
      const doVeredito = (rows, t) => {
        const l = rows.filter((r) => r.item === `${t}: veredito`);
        assert.equal(l.length, 1, `8j: esperava 1 veredito de ${t}`);
        return l[0];
      };
      const metadados = (rows, t) => {
        const l = rows.filter(
          (r) => r.item === `${t}: metadados do papel efetivo`,
        );
        assert.equal(l.length, 1, `8j: esperava 1 linha de metadados de ${t}`);
        return Object.fromEntries(
          l[0].vivo.split("; ").map((kv) => {
            const i = kv.indexOf("=");
            return [kv.slice(0, i), kv.slice(i + 1)];
          }),
        );
      };
      const vereditos = (rows) =>
        Object.fromEntries(T8J.map((t) => [t, doVeredito(rows, t).vivo]));
      const papelEfetivo = (rows) => {
        const l = rows.filter((r) => r.item === "papel efetivo");
        assert.equal(l.length, 1);
        return Object.fromEntries(
          l[0].vivo.split("; ").map((kv) => {
            const i = kv.indexOf("=");
            return [kv.slice(0, i), kv.slice(i + 1)];
          }),
        );
      };
      const mostra = (rotulo, rows) => {
        const celulas = T8J.map((t) => {
          const m = metadados(rows, t);
          return `${t}=${doVeredito(rows, t).vivo}(rls_ativa=${m.row_security_active},linhas=${m.linhas})`;
        });
        console.log(`  [8j] ${rotulo}: ${celulas.join(" | ")}`);
      };
      const VAZIA = "VISIVEL_VAZIA";
      const COM = "VISIVEL_COM_LINHAS";
      const INC = "RLS_ATIVA_INCONCLUSIVO";
      const BLQ = "BLOQUEIA";
      const saidas8j = [];

      // A MATRIZ: cada tabela num estado diferente, para uma única leitura provar
      // vários casos. Todas as políticas existentes caem (só neste clone) para que
      // nenhuma chame is_admin() sem EXECUTE: o que esconde linha aqui é a RLS.
      //   orders    RLS desligada, 3 linhas                       -> visível com linhas
      //   items     RLS desligada, VAZIA                          -> (a) visível e vazia
      //   history   RLS ligada, política que nunca casa, 3 linhas -> (b)/(c)
      //   payment   RLS ligada, política que casa 1 de 2 linhas   -> (f) parcial
      //   refunds   RLS ligada, política que nunca casa, VAZIA    -> vazia de verdade
      //   devolucoes RLS desligada, 1 linha                       -> visível com linhas
      const matriz = await clone(semeado, "ip_j_8j_matriz");
      await usar(matriz, async (c) => {
        await c.query("SET session_replication_role = replica");
        for (const t of T8J) {
          const pol = await c.query(
            "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1",
            [t],
          );
          for (const { policyname } of pol.rows)
            await c.query(`DROP POLICY "${policyname}" ON public.${t}`);
          await c.query(`ALTER TABLE public.${t} DISABLE ROW LEVEL SECURITY`);
          await c.query(`ALTER TABLE public.${t} NO FORCE ROW LEVEL SECURITY`);
        }
        await c.query(`DELETE FROM public.${T_ITE}`);
        await c.query(`DELETE FROM public.${T_REF}`);
        await c.query(
          `INSERT INTO public.${T_PAG} (order_id, acao) VALUES ($1, 'recebido')`,
          [O1],
        );
        for (const t of [T_HIS, T_PAG, T_REF])
          await c.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
        for (const t of [T_HIS, T_REF])
          await c.query(
            `CREATE POLICY nunca_casa ON public.${t} FOR SELECT TO public USING (false)`,
          );
        await c.query(
          `CREATE POLICY casa_um ON public.${T_PAG} FOR SELECT TO public USING (order_id = '${O1}'::uuid)`,
        );
      });
      // A verdade de fora (superuser) e o que o papel sem BYPASSRLS ENXERGA de fato.
      const contar = (db, papel) =>
        usar(db, async (c) => {
          if (papel) await c.query(`SET ROLE ${papel}`);
          const o = {};
          for (const t of T8J) {
            // eslint-disable-next-line security/detect-object-injection -- `t` vem só do array literal T8J (seis nomes de tabela fixos), nunca de entrada externa.
            o[t] = (
              await c.query(`SELECT count(*)::int AS n FROM public.${t}`)
            ).rows[0].n;
          }
          return o;
        });
      assert.deepEqual(
        await contar(matriz, null),
        {
          [T_ORD]: 3,
          [T_ITE]: 0,
          [T_HIS]: 3,
          [T_PAG]: 2,
          [T_REF]: 0,
          [T_DEV]: 1,
        },
        "8j: a verdade de fora da matriz (3, 0, 3, 2, 0, 1)",
      );
      assert.deepEqual(
        await contar(matriz, PAPEL_CEGO),
        {
          [T_ORD]: 3,
          [T_ITE]: 0,
          [T_HIS]: 0,
          [T_PAG]: 1,
          [T_REF]: 0,
          [T_DEV]: 1,
        },
        "8j: o papel sem BYPASSRLS vê 0 de 3 em history e 1 de 2 em payment (a RLS esconde)",
      );

      // (a)(b)(f) papel SEM BYPASSRLS (PAPEL_CEGO)
      const rc = await rodar8j(matriz, { papel: PAPEL_CEGO });
      saidas8j.push(rc);
      mostra("(a)(b)(f) PAPEL_CEGO (sem BYPASSRLS)", rc);
      assert.equal(rc.length, 13, "8j: 1 papel + 6 metadados + 6 vereditos");
      assert.deepEqual(
        rc.map((r) => r.ok),
        [...rc.map((r) => r.ok)].sort((a, b) => Number(a) - Number(b)),
        "8j: ok = false primeiro",
      );
      assert.deepEqual(vereditos(rc), {
        [T_ORD]: COM,
        [T_ITE]: VAZIA, // (a) vazia E plenamente visível (RLS desligada)
        [T_HIS]: INC, // (b) cheia, RLS esconde tudo: o 0 NÃO prova vazio
        [T_PAG]: INC, // (f) RLS parcial: vê 1 de 2, ainda inconclusivo
        [T_REF]: INC, // vazia de verdade, mas sob RLS ativa não dá para afirmar
        [T_DEV]: COM,
      });
      assert.deepEqual(
        reprovadas(rc)
          .map((r) => r.item)
          .sort(),
        [`${T_HIS}: veredito`, `${T_PAG}: veredito`, `${T_REF}: veredito`],
        "8j: só o INCONCLUSIVO reprova (INCONCLUSIVO não é ok)",
      );
      assert.deepEqual(
        { ...metadados(rc, T_HIS) },
        {
          relkind: "r",
          select: "true",
          rls_ligada: "true",
          rls_forcada: "false",
          dono: "false",
          row_security_active: "true",
          linhas: "0", // (b) a contagem vista é 0, embora a tabela tenha 3 linhas
        },
      );
      assert.equal(metadados(rc, T_PAG).linhas, ">0", "(f) vê algumas linhas");
      assert.equal(doVeredito(rc, T_PAG).ok, false, "(f) parcial: não ok");
      assert.deepEqual(metadados(rc, T_ITE), {
        relkind: "r",
        select: "true",
        rls_ligada: "false",
        rls_forcada: "false",
        dono: "false",
        row_security_active: "false",
        linhas: "0",
      });
      assert.deepEqual(papelEfetivo(rc), {
        current_user: PAPEL_CEGO,
        rolbypassrls: "false",
        rolsuper: "false",
        row_security: "on",
        server_version_num: papelEfetivo(rc).server_version_num,
      });
      assert.match(papelEfetivo(rc).server_version_num, /^\d{5,6}$/);

      // (c) o MESMO cenário com papel BYPASSRLS (PAPEL_RO): a RLS não se aplica
      const rr = await rodar8j(matriz, { papel: PAPEL_RO });
      saidas8j.push(rr);
      mostra("(c) PAPEL_RO (BYPASSRLS), mesma matriz", rr);
      assert.deepEqual(vereditos(rr), {
        [T_ORD]: COM,
        [T_ITE]: VAZIA,
        [T_HIS]: COM, // (c) as 3 linhas aparecem
        [T_PAG]: COM,
        [T_REF]: VAZIA, // RLS ligada MAS bypass: vazia e conclusiva
        [T_DEV]: COM,
      });
      assert.deepEqual(
        reprovadas(rr),
        [],
        "8j (c): nada reprova com BYPASSRLS",
      );
      assert.equal(papelEfetivo(rr).rolbypassrls, "true");
      assert.deepEqual(
        [
          metadados(rr, T_HIS).rls_ligada,
          metadados(rr, T_HIS).row_security_active,
        ],
        ["true", "false"],
        "8j (c): relrowsecurity=true, mas row_security_active=false (é por isso que não se usa relrowsecurity puro)",
      );
      // superuser: também ignora a RLS (rolsuper)
      const rs = await rodar8j(matriz, { papel: null });
      saidas8j.push(rs);
      mostra("superuser (rolsuper)", rs);
      assert.equal(papelEfetivo(rs).rolsuper, "true");
      assert.deepEqual(vereditos(rs), vereditos(rr));

      // (d) o DONO da tabela, com e sem FORCE ROW LEVEL SECURITY
      const dono = await clone(matriz, "ip_j_8j_dono");
      await usar(dono, async (c) => {
        for (const t of T8J)
          await c.query(`ALTER TABLE public.${t} OWNER TO ${PAPEL_DONO_8J}`);
        // Medido: o dono (que não é BYPASSRLS nem tem pg_read_all_data) esbarra em
        // "permission denied for schema extensions" ao planejar (inlining de
        // f_unaccent, em índice de uma destas tabelas). É da fixture, não da 8j.
        await c.query(
          `GRANT USAGE ON SCHEMA extensions TO ${PAPEL_DONO_8J}, ${PAPEL_MEMBRO_8J}`,
        );
      });
      const SEM_FORCE = {
        [T_ORD]: COM,
        [T_ITE]: VAZIA,
        [T_HIS]: COM,
        [T_PAG]: COM,
        [T_REF]: VAZIA,
        [T_DEV]: COM,
      };
      for (const [papel, rotulo] of [
        [PAPEL_DONO_8J, "dono"],
        [PAPEL_MEMBRO_8J, "membro que herda o dono"],
      ]) {
        const rd = await rodar8j(dono, { papel });
        saidas8j.push(rd);
        mostra(`(d) ${rotulo}, SEM FORCE`, rd);
        assert.deepEqual(
          vereditos(rd),
          SEM_FORCE,
          `8j (d) ${rotulo} sem FORCE`,
        );
        assert.equal(papelEfetivo(rd).rolbypassrls, "false");
        const m = metadados(rd, T_HIS);
        assert.deepEqual(
          [m.dono, m.rls_ligada, m.rls_forcada, m.row_security_active],
          ["true", "true", "false", "false"],
          `8j (d) ${rotulo}: dono sem FORCE ignora a RLS (row_security_active=false)`,
        );
      }
      const force = await clone(dono, "ip_j_8j_dono_force");
      await usar(force, async (c) => {
        for (const t of [T_HIS, T_PAG, T_REF])
          await c.query(`ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY`);
      });
      for (const [papel, rotulo] of [
        [PAPEL_DONO_8J, "dono"],
        [PAPEL_MEMBRO_8J, "membro que herda o dono"],
      ]) {
        const rf = await rodar8j(force, { papel });
        saidas8j.push(rf);
        mostra(`(d) ${rotulo}, COM FORCE`, rf);
        assert.deepEqual(
          vereditos(rf),
          {
            [T_ORD]: COM,
            [T_ITE]: VAZIA,
            [T_HIS]: INC,
            [T_PAG]: INC,
            [T_REF]: INC,
            [T_DEV]: COM,
          },
          `8j (d) ${rotulo} com FORCE`,
        );
        const m = metadados(rf, T_HIS);
        assert.deepEqual(
          [m.dono, m.rls_forcada, m.row_security_active, m.linhas],
          ["true", "true", "true", "0"],
          `8j (d) ${rotulo}: FORCE sujeita o dono à RLS (row_security_active=true)`,
        );
        assert.equal(metadados(rf, T_PAG).linhas, ">0");
      }

      // (e) SEM privilégio: falha ALTA (42501), nunca um zero que engana
      const semsel = await clone(matriz, "ip_j_8j_semsel");
      await usar(semsel, async (c) => {
        // (o mesmo USAGE da fixture: sem ele o erro seria o do schema, não o da tabela)
        await c.query(
          `GRANT USAGE ON SCHEMA extensions TO ${PAPEL_SEMSEL_8J}, ${PAPEL_PARCIAL_8J}`,
        );
        for (const t of [T_ORD, T_ITE, T_HIS, T_PAG, T_REF])
          await c.query(`GRANT SELECT ON public.${t} TO ${PAPEL_PARCIAL_8J}`);
      });
      const falhou = (re) => (e) => {
        assert.equal(e.code, "42501", `8j (e): ${e.message}`);
        assert.match(e.message, re);
        return true;
      };
      await assert.rejects(
        rodar8j(semsel, { papel: PAPEL_SEMSEL_8J }),
        falhou(/permission denied for table/),
        "8j (e): sem SELECT nenhum → falha alta",
      );
      await assert.rejects(
        rodar8j(semsel, { papel: PAPEL_PARCIAL_8J }),
        falhou(/permission denied for table devolucoes/),
        "8j (e): SELECT em cinco das seis → a consulta INTEIRA falha e cita a tabela que falta",
      );
      console.log(
        "  [8j] (e) sem SELECT: 42501 permission denied for table (falha alta; o SELECT de cinco das seis também falha, citando devolucoes)",
      );

      // (e2) SELECT só de COLUNA numa das seis: NÃO falha (o EXISTS só exige algum
      // privilégio de SELECT, ainda que de uma coluna), mas has_table_privilege
      // (tabela inteira) dá false → a linha dessa tabela é BLOQUEIA. Sem o
      // `AND m.pode_ler` de "julga" ela sairia VISIVEL_VAZIA (vazia, o cenário mais
      // perigoso: o 0 passaria por conclusivo) ou VISIVEL_COM_LINHAS (mutante RV-M5
      // da revisão, que sobreviveu à suíte antes deste teste).
      for (const [rotulo, vazia] of [
        ["devolucoes VAZIA", true],
        ["devolucoes com 1 linha", false],
      ]) {
        const colunas = await clone(
          matriz,
          `ip_j_8j_coluna_${vazia ? "vazia" : "cheia"}`,
        );
        await usar(colunas, async (c) => {
          if (vazia) {
            await c.query("SET session_replication_role = replica");
            await c.query(`DELETE FROM public.${T_DEV}`);
          }
          await c.query(
            `GRANT USAGE ON SCHEMA extensions TO ${PAPEL_COLUNA_8J}`,
          );
          for (const t of [T_ORD, T_ITE, T_HIS, T_PAG, T_REF])
            await c.query(`GRANT SELECT ON public.${t} TO ${PAPEL_COLUNA_8J}`);
          await c.query(
            `GRANT SELECT (id) ON public.${T_DEV} TO ${PAPEL_COLUNA_8J}`,
          );
        });
        const sonda = await usar(colunas, async (c) => {
          await c.query(`SET ROLE ${PAPEL_COLUNA_8J}`);
          try {
            const o = {};
            // (a) o SELECT/EXISTS que a 8j faz roda sem erro com SELECT só de coluna
            o.exists = (
              await c.query(
                `SELECT EXISTS (SELECT 1 FROM public.${T_DEV}) AS tem`,
              )
            ).rows[0].tem;
            // (b) mas a tabela INTEIRA não é legível (a coluna sim)
            const p = (
              await c.query(
                `SELECT has_table_privilege(current_user, 'public.${T_DEV}', 'SELECT') AS tabela,
                        has_column_privilege(current_user, 'public.${T_DEV}', 'id', 'SELECT') AS coluna,
                        rolbypassrls AS bypass, rolsuper AS super
                   FROM pg_catalog.pg_roles WHERE rolname = current_user`,
              )
            ).rows[0];
            Object.assign(o, p);
            // controle: de fato é privilégio de COLUNA (outra coluna é negada)
            await c.query(`SELECT protocolo FROM public.${T_DEV} LIMIT 1`).then(
              () => {
                o.outraColuna = "LEU";
              },
              (e) => {
                o.outraColuna = e.code;
              },
            );
            return o;
          } finally {
            await c.query("RESET ROLE");
          }
        });
        assert.equal(
          sonda.exists,
          !vazia,
          `8j (e2) ${rotulo}: o EXISTS roda sem erro com SELECT só de coluna`,
        );
        assert.equal(
          sonda.tabela,
          false,
          `8j (e2) ${rotulo}: has_table_privilege(SELECT) é false`,
        );
        assert.equal(sonda.coluna, true, "8j (e2): a coluna id é legível");
        assert.equal(
          sonda.outraColuna,
          "42501",
          "8j (e2): é privilégio de coluna (outra coluna é negada)",
        );
        assert.deepEqual(
          [sonda.bypass, sonda.super],
          [false, false],
          "8j (e2): o papel não tem BYPASSRLS nem é superuser",
        );
        // (c) a 8j original roda sem erro e a linha da tabela é BLOQUEIA
        const rcol = await rodar8j(colunas, { papel: PAPEL_COLUNA_8J });
        saidas8j.push(rcol);
        mostra(`(e2) SELECT só de coluna, ${rotulo}`, rcol);
        assert.equal(
          rcol.length,
          13,
          "8j (e2): 1 papel + 6 metadados + 6 vereditos",
        );
        const vd = doVeredito(rcol, T_DEV);
        assert.equal(
          vd.vivo,
          BLQ,
          `8j (e2) ${rotulo}: SELECT só de coluna → BLOQUEIA`,
        );
        assert.notEqual(vd.vivo, VAZIA, "8j (e2): nunca VISIVEL_VAZIA");
        assert.notEqual(vd.vivo, COM, "8j (e2): nunca VISIVEL_COM_LINHAS");
        assert.equal(vd.ok, false, "8j (e2): BLOQUEIA reprova (ok = false)");
        const md = metadados(rcol, T_DEV);
        assert.equal(md.select, "false", "8j (e2): select=false no metadado");
        assert.equal(md.relkind, "r");
        assert.equal(md.linhas, vazia ? "0" : ">0", "8j (e2): o EXISTS leu");
        assert.deepEqual(
          vereditos(rcol),
          {
            [T_ORD]: COM,
            [T_ITE]: VAZIA,
            [T_HIS]: INC,
            [T_PAG]: INC,
            [T_REF]: INC,
            [T_DEV]: BLQ,
          },
          `8j (e2) ${rotulo}: só a tabela de SELECT por coluna vira BLOQUEIA; as outras cinco seguem o veredito normal`,
        );
      }
      console.log(
        "  [8j] (e2) SELECT só de coluna: a consulta roda (sem 42501), has_table_privilege=false e a linha da tabela é BLOQUEIA (select=false), nunca VISIVEL_VAZIA",
      );

      // (g) erro ou formato desconhecido BLOQUEIA
      //  g1: a "tabela" é VIEW (relkind v) e a outra é PARTICIONADA (relkind p)
      const formato = await clone(matriz, "ip_j_8j_formato");
      await usar(formato, async (c) => {
        await c.query("SET session_replication_role = replica");
        await c.query(`ALTER TABLE public.${T_DEV} RENAME TO ${T_DEV}_t`);
        await c.query(
          `CREATE VIEW public.${T_DEV} AS SELECT * FROM public.${T_DEV}_t`,
        );
        await c.query(`ALTER TABLE public.${T_REF} RENAME TO ${T_REF}_t`);
        await c.query(
          `CREATE TABLE public.${T_REF} (id int, order_id uuid) PARTITION BY RANGE (id)`,
        );
        await c.query(
          `CREATE TABLE public.${T_REF}_p1 PARTITION OF public.${T_REF} FOR VALUES FROM (0) TO (1000)`,
        );
      });
      for (const papel of [PAPEL_CEGO, PAPEL_RO]) {
        const rg = await rodar8j(formato, { papel });
        saidas8j.push(rg);
        mostra(`(g) view e particionada, ${papel}`, rg);
        assert.equal(doVeredito(rg, T_DEV).vivo, BLQ);
        assert.equal(metadados(rg, T_DEV).relkind, "v");
        assert.equal(doVeredito(rg, T_REF).vivo, BLQ);
        assert.equal(metadados(rg, T_REF).relkind, "p");
        assert.equal(doVeredito(rg, T_DEV).ok, false);
        assert.equal(doVeredito(rg, T_REF).ok, false);
      }
      //  g2: tabela AUSENTE de public → falha alta (42P01), não um zero
      const ausente = await clone(matriz, "ip_j_8j_ausente");
      await usar(ausente, (c) =>
        c.query(`ALTER TABLE public.${T_DEV} RENAME TO ${T_DEV}_t`),
      );
      await assert.rejects(
        rodar8j(ausente, { papel: PAPEL_CEGO }),
        (e) => {
          assert.equal(e.code, "42P01");
          assert.match(
            e.message,
            /relation "public\.devolucoes" does not exist/,
          );
          return true;
        },
        "8j (g): tabela ausente → falha alta",
      );
      //  g3: row_security = off com RLS aplicável → o SELECT falha (42501) e
      //  row_security_active CONTINUA true (o GUC não entra no resultado)
      await assert.rejects(
        rodar8j(matriz, { papel: PAPEL_CEGO, pre: ["SET row_security = off"] }),
        (e) => {
          assert.equal(e.code, "42501");
          assert.match(
            e.message,
            /query would be affected by row-level security policy/,
          );
          return true;
        },
        "8j (g): row_security=off + RLS aplicável → falha alta, nunca linhas em silêncio",
      );
      const gucOff = await usar(matriz, async (c) => {
        await c.query(`SET ROLE ${PAPEL_CEGO}`);
        await c.query("SET row_security = off");
        const r = await c.query(
          `SELECT row_security_active('public.${T_HIS}'::regclass) AS ativa, current_setting('row_security') AS guc`,
        );
        return r.rows[0];
      });
      assert.deepEqual(
        gucOff,
        { ativa: true, guc: "off" },
        "8j: row_security_active NÃO considera o GUC row_security (devolve true com ele off)",
      );
      console.log(
        `  [8j] row_security=off: row_security_active=${gucOff.ativa} (o GUC não entra); o SELECT de verdade falha com 42501`,
      );
      //  g4: formato/metadado desconhecido (simulado EM MEMÓRIA): a derivação
      //  independente DISCORDA de row_security_active, ou o bypass vem NULL →
      //  as seis BLOQUEIAM
      const DIVERGE = SQL_8J.replace(
        "row_security_active(c.oid) AS rls_ativa",
        "(NOT row_security_active(c.oid)) AS rls_ativa",
      );
      assert.notEqual(
        DIVERGE,
        SQL_8J,
        "8j (g): a simulação de divergência entrou",
      );
      const rdiv = await rodar8j(matriz, { papel: PAPEL_CEGO, sql: DIVERGE });
      saidas8j.push(rdiv);
      assert.deepEqual(
        Object.values(vereditos(rdiv)),
        Array(6).fill(BLQ),
        "8j (g): row_security_active que discorda da derivação → BLOQUEIA",
      );
      const SEM_BYPASS = SQL_8J.replace(
        "r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user",
        "r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = 'papel_inexistente_8j'",
      );
      assert.notEqual(
        SEM_BYPASS,
        SQL_8J,
        "8j (g): a simulação de bypass NULL entrou",
      );
      const rnul = await rodar8j(matriz, {
        papel: PAPEL_CEGO,
        sql: SEM_BYPASS,
      });
      saidas8j.push(rnul);
      // Só onde a RLS está LIGADA o bypass desconhecido importa (RLS desligada
      // dispensa saber do bypass: a conta é falsa de qualquer jeito); ali BLOQUEIA.
      assert.deepEqual(
        vereditos(rnul),
        {
          [T_ORD]: COM,
          [T_ITE]: VAZIA,
          [T_HIS]: BLQ,
          [T_PAG]: BLQ,
          [T_REF]: BLQ,
          [T_DEV]: COM,
        },
        "8j (g): rolbypassrls desconhecido (NULL) → BLOQUEIA onde a RLS está ligada",
      );

      // só metadado e 0/>0: nenhum id (com ou sem hífen), nome, e-mail, gateway ou valor
      const vistos = JSON.stringify(saidas8j);
      assert(
        !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(vistos),
        "8j: a saída vazou algo com forma de id",
      );
      for (const proibido of [O1, O2, O3, U_CLIENTE, P_A])
        for (const forma of [proibido, proibido.replace(/-/g, "")])
          assert(!vistos.includes(forma), `8j: a saída vazou ${forma}`);
      for (const proibido of [
        "Cliente FP",
        "@fp.teste",
        "Produto A",
        "DV-FP-TESTE",
      ])
        assert(!vistos.includes(proibido), `8j: a saída vazou ${proibido}`);
      ok(
        "(j) 8j: matriz (RLS off/vazia, RLS que esconde tudo, RLS parcial, RLS+vazia) → papel sem BYPASSRLS: VISIVEL_VAZIA só onde a RLS não se aplica, RLS_ATIVA_INCONCLUSIVO (não ok) com contagem vista 0 ou parcial; mesmo cenário com BYPASSRLS/superuser → VISIVEL_COM_LINHAS e VISIVEL_VAZIA; dono (e membro que herda) sem FORCE → row_security_active=false, com FORCE → true; sem SELECT → 42501 citando a tabela; SELECT só de COLUNA numa tabela (vazia ou com linha) → a consulta roda, has_table_privilege=false e a linha dela é BLOQUEIA (nunca VISIVEL_VAZIA); view e particionada → BLOQUEIA; tabela ausente → 42P01; row_security=off → 42501 e row_security_active segue true; row_security_active divergente da derivação ou bypass NULL → as seis BLOQUEIAM; nenhuma forma de id, nome, e-mail ou valor na saída",
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
      a.query(
        `DROP ROLE IF EXISTS ${PAPEL_RO}, ${PAPEL_CEGO}, ${PAPEL_MEMBRO_8J}, ${PAPEL_DONO_8J}, ${PAPEL_SEMSEL_8J}, ${PAPEL_PARCIAL_8J}, ${PAPEL_COLUNA_8J}`,
      ),
    ).catch(() => {});
    // os papéis da 8i (só se ESTA prova os criou: nunca derruba papel alheio)
    if (criouPapel8i)
      await usar("template1", (a) =>
        a.query(`DROP ROLE IF EXISTS ${PAPEL_8I}, ${PAPEL_DONO_8I}`),
      ).catch(() => {});
  });

// `falhar` fica importado para o caso de a trava de efemero recusar antes.
void falhar;
