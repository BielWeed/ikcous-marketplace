#!/usr/bin/env node
/**
 * Prova a correção do PEDIDO-010 (issue #115) sem comitar nada no banco.
 *
 * Tudo — inclusive os pedidos de teste — roda dentro de UMA transação que
 * termina em ROLLBACK. Nenhum pedido fica criado, nenhum estoque muda, nenhuma
 * configuração da loja sobra alterada.
 *
 * OS SEIS CENÁRIOS, nesta ordem:
 *   ANTES da migration
 *     1. Usuário logado B cancela pedido de CONVIDADO  -> hoje passa (o bug)
 *     2. Visitante ANÔNIMO cancela pedido do usuário A -> hoje passa (o bug,
 *        mais amplo do que a issue descreve: `<uuid> != NULL` também dá NULL)
 *   DEPOIS da migration
 *     3. Mesmo caso 1 -> tem de ser barrado
 *     4. Mesmo caso 2 -> tem de ser barrado
 *     5. Dono (usuário A) cancela o PRÓPRIO pedido pendente -> tem de passar
 *     6. Admin muda o status de pedido de convidado -> tem de passar
 *   E o pg_proc.proacl tem de sair idêntico ao que entrou.
 *
 * POR QUE CADA CENÁRIO TROCA O PAPEL DA SESSÃO:
 *   is_admin() começa com `IF current_setting('role') IN ('postgres',
 *   'service_role') THEN RETURN true`, e a DATABASE_URL conecta como
 *   `postgres`. Sem `SET LOCAL ROLE`, todo chamador seria admin e os seis
 *   cenários passariam sem medir nada.
 *
 * USO:  node scripts/db-prove-pedido-010.cjs
 * Sai com código 0 só se os seis cenários e a comparação de ACL passarem.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260804010000_fix_order_owner_check_null_safety.sql",
);

const USUARIO_A = "00000000-0000-4000-8000-00000000000a"; // dono do pedido
const USUARIO_B = "00000000-0000-4000-8000-00000000000b"; // logado, sem relação
const ADMIN = "00000000-0000-4000-8000-00000000000d";

const claims = (sub, admin) =>
  sub === null
    ? ""
    : JSON.stringify({
        sub,
        role: "authenticated",
        app_metadata: { role: admin ? "admin" : "authenticated" },
      });

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

async function fotografarFuncao(client) {
  const { rows } = await client.query(`
    SELECT p.oid::regprocedure::text AS assinatura,
           p.prosecdef,
           COALESCE(p.proacl::text, '(sem ACL explícita)') AS acl,
           pg_get_functiondef(p.oid) LIKE '%IS DISTINCT FROM%' AS tem_correcao
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'update_order_status_atomic'
     ORDER BY p.oid`);
  return rows;
}

/** Cria um pedido real dentro da transação. sub = null cria pedido de convidado. */
async function criarPedido(client, sub, produto, freteFixo) {
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    claims(sub, false),
  ]);
  const subtotal = Number(produto.preco_venda) * 1;
  const { rows } = await client.query(
    `SELECT public.create_marketplace_order_v23(
       $1::jsonb, $2::numeric, $3::numeric, 'whatsapp', NULL, NULL,
       'Prova PEDIDO-010', '5534999999999', 'ROLLBACK - teste',
       NULL, NULL, NULL) AS id`,
    [
      JSON.stringify([
        { product_id: produto.id, variant_id: null, quantity: 1 },
      ]),
      subtotal + freteFixo,
      freteFixo,
    ],
  );
  await client.query("SELECT set_config('request.jwt.claims', '', true)");
  return rows[0].id;
}

/**
 * Tenta mudar o status de um pedido como um chamador específico, isolado num
 * savepoint — a exceção esperada aborta a transação e o savepoint a recupera.
 */
async function tentar(client, { papel, sub, admin, orderId, novoStatus }) {
  await client.query("SAVEPOINT cenario");
  try {
    await client.query(`SET LOCAL ROLE ${papel}`);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      claims(sub, admin),
    ]);
    await client.query(
      "SELECT public.update_order_status_atomic($1::uuid, $2::text, NULL, TRUE)",
      [orderId, novoStatus],
    );
    await client.query("ROLLBACK TO SAVEPOINT cenario");
    await client.query("RESET ROLE");
    return { passou: true };
  } catch (erro) {
    await client.query("ROLLBACK TO SAVEPOINT cenario").catch(() => {});
    await client.query("RESET ROLE").catch(() => {});
    return { passou: false, mensagem: erro.message };
  }
}

async function main() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(MIGRATION))
    throw new Error(`Migration não encontrada: ${MIGRATION}`);

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  const falhas = [];
  const registrar = (titulo, ok, detalhe) => {
    console.log(
      `  ${ok ? "OK     " : "FALHOU "} ${titulo}${detalhe ? ` — ${detalhe}` : ""}`,
    );
    if (!ok) falhas.push(titulo);
  };

  await client.query("BEGIN");
  try {
    const antes = await fotografarFuncao(client);
    if (antes.length !== 1) {
      throw new Error(
        `Esperava 1 sobrecarga de update_order_status_atomic, achei ${antes.length}.`,
      );
    }
    console.log("=== Estado atual no banco ===");
    console.log(`  assinatura   : ${antes[0].assinatura}`);
    console.log(`  secdef       : ${antes[0].prosecdef}`);
    console.log(`  acl          : ${antes[0].acl}`);
    console.log(`  ja corrigida : ${antes[0].tem_correcao}\n`);

    // Frete alto o bastante para nunca cair na regra de grátis, senão o total
    // enviado divergiria do calculado e a v23 recusaria o pedido.
    await client.query(
      "UPDATE public.store_config SET free_shipping_min = 999999 WHERE id = 1",
    );
    const { rows: cfg } = await client.query(
      "SELECT shipping_fee FROM public.store_config WHERE id = 1",
    );
    const frete = Number(cfg[0].shipping_fee);

    const { rows: prod } = await client.query(
      `SELECT id, nome, preco_venda FROM public.produtos
        WHERE ativo = true AND deleted_at IS NULL
          AND COALESCE(frete_gratis, false) = false AND estoque >= 2
        ORDER BY preco_venda DESC LIMIT 1`,
    );
    if (prod.length === 0)
      throw new Error("Nenhum produto elegível para o teste.");
    const produto = prod[0];
    console.log(
      `Produto de teste: ${produto.nome} (R$ ${produto.preco_venda})\n`,
    );

    const pedidoConvidado = await criarPedido(client, null, produto, frete);
    const pedidoUsuarioA = await criarPedido(client, USUARIO_A, produto, frete);
    console.log("Pedidos de teste criados (some no ROLLBACK):");
    console.log(`  convidado (user_id NULL): ${pedidoConvidado}`);
    console.log(`  usuario A               : ${pedidoUsuarioA}\n`);

    console.log("=== ANTES da migration: o furo existe? ===");
    const c1 = await tentar(client, {
      papel: "authenticated",
      sub: USUARIO_B,
      orderId: pedidoConvidado,
      novoStatus: "cancelled",
    });
    registrar(
      "1. logado B cancela pedido de convidado (esperado: PASSA, é o bug)",
      c1.passou,
      c1.passou ? "cancelou" : c1.mensagem,
    );

    const c2 = await tentar(client, {
      papel: "anon",
      sub: null,
      orderId: pedidoUsuarioA,
      novoStatus: "cancelled",
    });
    registrar(
      "2. anonimo cancela pedido de cliente cadastrado (esperado: PASSA, é o bug)",
      c2.passou,
      c2.passou ? "cancelou" : c2.mensagem,
    );

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await client.query(fs.readFileSync(MIGRATION, "utf8"));
    console.log("\n=== Migration aplicada (dentro da transação) ===\n");

    console.log("=== DEPOIS da migration ===");
    const c3 = await tentar(client, {
      papel: "authenticated",
      sub: USUARIO_B,
      orderId: pedidoConvidado,
      novoStatus: "cancelled",
    });
    registrar(
      "3. logado B contra pedido de convidado: BARRADO",
      !c3.passou,
      c3.mensagem,
    );

    const c4 = await tentar(client, {
      papel: "anon",
      sub: null,
      orderId: pedidoUsuarioA,
      novoStatus: "cancelled",
    });
    registrar(
      "4. anonimo contra pedido alheio: BARRADO",
      !c4.passou,
      c4.mensagem,
    );

    const c5 = await tentar(client, {
      papel: "authenticated",
      sub: USUARIO_A,
      orderId: pedidoUsuarioA,
      novoStatus: "cancelled",
    });
    registrar(
      "5. dono cancela o proprio pedido pendente: PASSA",
      c5.passou,
      c5.passou ? "cancelou" : c5.mensagem,
    );

    const c6 = await tentar(client, {
      papel: "authenticated",
      sub: ADMIN,
      admin: true,
      orderId: pedidoConvidado,
      novoStatus: "shipped",
    });
    registrar(
      "6. admin muda status de pedido de convidado: PASSA",
      c6.passou,
      c6.passou ? "atualizou" : c6.mensagem,
    );

    const depois = await fotografarFuncao(client);
    const aclIgual = depois[0]?.acl === antes[0].acl;
    const secdefIgual = depois[0]?.prosecdef === antes[0].prosecdef;
    console.log("\n=== ACL e SECURITY DEFINER preservados? ===");
    console.log(`  acl    antes: ${antes[0].acl}`);
    console.log(`  acl   depois: ${depois[0]?.acl}`);
    registrar("ACL e SECURITY DEFINER identicos", aclIgual && secdefIgual);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }

  console.log(`\n${"=".repeat(64)}`);
  if (falhas.length === 0) {
    console.log(
      "TUDO PROVADO. Nada foi comitado — rode o db-apply.cjs para valer.",
    );
    process.exit(0);
  }
  console.log("NÃO PROVADO:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
