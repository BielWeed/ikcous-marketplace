#!/usr/bin/env node
/**
 * Prova a migration 20260911000000_pedidos_em_aberto_filtram_no_banco.sql.
 *
 * TUDO roda em UMA transação terminada em ROLLBACK. Nada é gravado — nem o
 * CREATE OR REPLACE da função. Isso só é verdade porque a migration NÃO tem
 * BEGIN/COMMIT embutido: se alguém acrescentar um, este script passa a
 * gravar de verdade sem avisar.
 *
 * O QUE ESTE SCRIPT PROVA
 *   Hoje o botão padrão "Todos Ativos" manda p_status='all', e a função faz
 *   WHERE (p_status = 'all' OR o.status = p_status) — o padrão não filtra
 *   nada. O Gabriel aprovou trocar o padrão por "Em Aberto" (exclui
 *   cancelled E delivered), viajando pelo parâmetro que já existe:
 *   p_status='open'. A prova precisa mostrar três coisas:
 *     1. o comportamento de hoje (p_status='all') não muda;
 *     2. p_status='open' passa a bater com COUNT(*) WHERE status NOT IN
 *        ('cancelled','delivered'), calculado do banco, não cravado;
 *     3. a contagem (v_total_count) e as linhas devolvidas (v_data) NUNCA
 *        podem discordar — a cláusula de filtro aparece DUAS VEZES dentro da
 *        função (uma no COUNT, outra no SELECT que busca as linhas), e essa
 *        é a asserção que pega quem trocou só uma das duas.
 *
 * CONTROLE POSITIVO (obrigatório): ANTES de aplicar a migration, chamar a
 * função com p_status='open' também. Na versão viva hoje isso cai no
 * terceiro ramo do WHERE (o.status = p_status), e nenhum pedido tem
 * status='open' de verdade — a função devolve 0, que quase certamente NÃO
 * bate com o total "em aberto" calculado direto da tabela. Se bater (os dois
 * lados vierem iguais), o script para e avisa: ou o defeito já foi corrigido
 * por fora, ou a prova não está medindo o que promete.
 *
 * POR QUE `SET LOCAL ROLE authenticated` + `request.jwt.claims`: a função
 * exige is_admin() = true. is_admin() aceita de graça quando o papel da
 * SESSÃO já é 'postgres'/'service_role' — que é como a DATABASE_URL conecta,
 * então sem trocar de papel a checagem passaria sempre, com ou sem a
 * migration, e o teste não mediria nada. Trocando para 'authenticated' e
 * preenchendo request.jwt.claims com app_metadata.role='admin', a função
 * autoriza pelo caminho legítimo (claims do JWT) — não por bypass nem por
 * enfraquecer a checagem. O admin usado é um profile REAL do banco (só
 * leitura), mesmo raciocínio do db-prove-admin-080.cjs / db-prove-admin-090.cjs.
 *
 * A CONEXÃO PODE ABRIR EM MODO SOMENTE LEITURA (pooler): por isso
 * `BEGIN READ WRITE` em vez de `BEGIN` — este script precisa rodar
 * CREATE OR REPLACE FUNCTION dentro da transação. NUNCA `SET default_transaction_read_only
 * = off`: isso é SET SESSION por definição e a DATABASE_URL aponta para o
 * Supavisor (pooler, porta 6543), que reaproveita conexão entre programas —
 * o valor gruda na conexão para o PRÓXIMO script que a pegar. `BEGIN READ
 * WRITE` é escopo de TRANSAÇÃO e some sozinho no ROLLBACK. Pelo mesmo
 * motivo, `RESET ALL` logo após conectar, antes de qualquer SET, e SET LOCAL
 * (nunca SET SESSION) para o papel/claims.
 *
 * USO:  node scripts/db-prove-pedidos-em-aberto.cjs
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
  "20260911000000_pedidos_em_aberto_filtram_no_banco.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // O caminho vem de PROJECT_ROOT + uma das duas strings literais acima.
    // Nada aqui é entrada de usuário, então o alerta é falso positivo.
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

/** Só leitura: um admin de verdade — a checagem is_admin() ainda passaria
 * com um sub inventado (ela olha só o app_metadata.role do JWT), mas usar um
 * profile real evita depender desse detalhe de implementação. */
async function descobrirAdmin(client) {
  const { rows } = await client.query(`
    SELECT id FROM public.profiles WHERE role = 'admin' LIMIT 1`);
  if (rows.length === 0) {
    throw new Error(
      "Nenhum admin encontrado em public.profiles — o teste não tem com quem rodar.",
    );
  }
  return rows[0].id;
}

/** Roda `fn` com o papel/claims trocados para um admin autenticado, e
 * devolve o papel para o padrão da conexão (postgres) no fim. */
async function comoAdmin(client, adminId, fn) {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      sub: adminId,
      role: "authenticated",
      app_metadata: { role: "admin" },
    }),
  ]);
  const resultado = await fn();
  await client.query("RESET ROLE");
  return resultado;
}

/** Chama get_admin_orders_paged com a assinatura completa (6 args
 * posicionais) para não depender de nomes de parâmetro. Devolve o jsonb já
 * desserializado pelo driver ({ data: [...], total_count: N }). */
async function chamarFuncao(client, adminId, status, pageSize = 10) {
  return comoAdmin(client, adminId, async () => {
    const { rows } = await client.query(
      `SELECT public.get_admin_orders_paged($1, $2, $3, $4, $5, $6) AS resultado`,
      ["", status, "", "", 0, pageSize],
    );
    return rows[0].resultado;
  });
}

async function contar(client, whereSql) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM public.marketplace_orders WHERE ${whereSql}`,
  );
  return rows[0].n;
}

async function main() {
  // MIGRATION é constante de módulo, montada de __dirname. Falso positivo.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(MIGRATION))
    throw new Error(`Migration não encontrada: ${MIGRATION}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migrationSql = fs.readFileSync(MIGRATION, "utf8");

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
  await client.query("BEGIN READ WRITE");

  try {
    const adminId = await descobrirAdmin(client);

    // Números-verdade, calculados direto da tabela dentro da MESMA
    // transação — nunca cravados no código.
    const totalGeral = await contar(client, "TRUE");
    const totalAberto = await contar(
      client,
      "status NOT IN ('cancelled', 'delivered')",
    );
    const totalPending = await contar(client, "status = 'pending'");
    const totalCancelled = await contar(client, "status = 'cancelled'");

    console.log(
      `Números-verdade (calculados do banco agora): total=${totalGeral}, ` +
        `em aberto=${totalAberto}, pending=${totalPending}, cancelled=${totalCancelled}\n`,
    );

    console.log("=== ANTES da migration ===");
    const antesAll = await chamarFuncao(client, adminId, "all");
    conferir(
      "ANTES: p_status='all' devolve o total geral (comportamento de hoje)",
      antesAll.total_count === totalGeral,
      `esperado ${totalGeral}, veio ${antesAll.total_count}`,
    );

    const antesOpen = await chamarFuncao(client, adminId, "open");
    console.log(
      `  ANTES: p_status='open' -> total_count=${antesOpen.total_count} ` +
        `(o que a migration deve fazer isto virar: ${totalAberto})`,
    );
    conferir(
      "CONTROLE POSITIVO — ANTES da migration, p_status='open' NÃO bate com o total 'em aberto' (o defeito reproduz)",
      antesOpen.total_count !== totalAberto,
      `veio ${antesOpen.total_count}, igual ao esperado depois (${totalAberto}) — a prova não estaria medindo nada`,
    );
    if (antesOpen.total_count === totalAberto) {
      throw new Error(
        "O defeito não reproduziu ANTES da migration. Ou alguém já corrigiu por fora, ou o teste não está medindo o que promete — investigue antes de aplicar.",
      );
    }

    console.log("\n=== Migration aplicada (dentro da transação) ===");
    await client.query(migrationSql);

    console.log("\n=== DEPOIS da migration ===");
    const depoisAll = await chamarFuncao(client, adminId, "all");
    conferir(
      "DEPOIS: p_status='all' continua devolvendo o total geral (sem mudança de comportamento)",
      depoisAll.total_count === totalGeral,
      `esperado ${totalGeral}, veio ${depoisAll.total_count}`,
    );

    const depoisOpen = await chamarFuncao(client, adminId, "open");
    console.log(
      `  DEPOIS: p_status='open' -> total_count=${depoisOpen.total_count} ` +
        `(número absoluto medido do banco: ${totalAberto})`,
    );
    conferir(
      "DEPOIS: p_status='open' bate com COUNT(*) WHERE status NOT IN ('cancelled','delivered')",
      depoisOpen.total_count === totalAberto,
      `esperado ${totalAberto}, veio ${depoisOpen.total_count}`,
    );

    // p_page_size grande o bastante para caber todo mundo de uma vez.
    const depoisOpenPaginado = await chamarFuncao(
      client,
      adminId,
      "open",
      totalAberto + 100,
    );
    const linhas = Array.isArray(depoisOpenPaginado.data)
      ? depoisOpenPaginado.data.length
      : -1;
    conferir(
      "A CONTAGEM E AS LINHAS CONCORDAM — jsonb_array_length(data) === total_count com p_status='open' (esta é a asserção que pega a cláusula duplicada)",
      linhas === depoisOpenPaginado.total_count,
      `linhas=${linhas}, total_count=${depoisOpenPaginado.total_count}`,
    );

    const depoisPending = await chamarFuncao(client, adminId, "pending");
    console.log(
      `  DEPOIS: p_status='pending' -> total_count=${depoisPending.total_count} ` +
        `(número absoluto medido do banco: ${totalPending})`,
    );
    conferir(
      "Status individual 'pending' continua funcionando",
      depoisPending.total_count === totalPending,
      `esperado ${totalPending}, veio ${depoisPending.total_count}`,
    );

    const depoisCancelled = await chamarFuncao(client, adminId, "cancelled");
    console.log(
      `  DEPOIS: p_status='cancelled' -> total_count=${depoisCancelled.total_count} ` +
        `(número absoluto medido do banco: ${totalCancelled})`,
    );
    conferir(
      "Status individual 'cancelled' não foi contaminado pelo ramo 'open'",
      depoisCancelled.total_count === totalCancelled,
      `esperado ${totalCancelled}, veio ${depoisCancelled.total_count}`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
