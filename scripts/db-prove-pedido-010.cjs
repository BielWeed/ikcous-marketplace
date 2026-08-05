#!/usr/bin/env node
/**
 * Prova a correção do PEDIDO-010 (issue #115) sem comitar nada no banco.
 *
 * Tudo — inclusive os pedidos de teste — roda dentro de UMA transação que
 * termina em ROLLBACK. Nenhum pedido fica criado, nenhum estoque muda, nenhuma
 * configuração da loja sobra alterada.
 *
 * ESTE SCRIPT RODA DEPOIS DA MIGRATION JÁ APLICADA.
 *   A funcao viva no banco ja esta corrigida, entao nao da para reproduzir o
 *   furo com ela. O script reinstala a definicao ANTIGA — a do arquivo de
 *   rollback que o db-apply.cjs gerou — dentro da transacao, demonstra o furo
 *   com ela, reaplica a migration e mede de novo. Mesmo padrao do
 *   db-prove-regression.cjs. Um teste que passa antes e depois nao prova nada.
 *
 * OS CINCO CENÁRIOS:
 *   Com a definicao ANTIGA reinstalada
 *     1. Usuário logado B cancela pedido de CONVIDADO -> tem de PASSAR (o furo)
 *   Com a migration reaplicada
 *     2. Mesmo caso 1 -> tem de ser barrado
 *     3. Chamador sem sessao contra pedido de convidado -> tem de ser barrado
 *     4. Dono cancela o PRÓPRIO pedido pendente -> tem de passar
 *     5. Admin muda o status de pedido de convidado -> tem de passar
 *   E o pg_proc.proacl tem de sair idêntico ao que entrou.
 *
 * SOBRE O CENÁRIO 3: o ACL vivo NAO concede EXECUTE para `anon`
 *   (`{postgres,authenticated,service_role}`), ao contrario do que o GRANT em
 *   20260707000000:94 sugere — o arquivo diverge do banco, como boa parte do
 *   ledger. Entao o cenario usa o papel `authenticated` SEM claims, que e o
 *   caso real de sessao expirada, e nao `anon`, que sequer consegue chamar.
 *
 * POR QUE CADA CENÁRIO TROCA O PAPEL DA SESSÃO:
 *   is_admin() começa com `IF current_setting('role') IN ('postgres',
 *   'service_role') THEN RETURN true`, e a DATABASE_URL conecta como
 *   `postgres`. Sem `SET LOCAL ROLE`, todo chamador seria admin e os cenários
 *   passariam sem medir nada.
 *
 * OS USUÁRIOS SÃO REAIS: marketplace_orders.user_id tem FK para auth.users,
 * entao UUID inventado nao serve. O script descobre dois usuarios existentes.
 *
 * USO:  node scripts/db-prove-pedido-010.cjs
 * Sai com código 0 só se os cinco cenários e a comparação de ACL passarem.
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

const ROLLBACK = path.join(
  PROJECT_ROOT,
  "rollback-20260804010000_fix_order_owner_check_null_safety.sql",
);

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

/**
 * marketplace_orders.user_id tem FK para auth.users, e marketplace_order_history
 * .created_by tambem aponta para la — entao tanto o dono quanto o chamador
 * precisam existir de verdade. Pega dois usuarios distintos do banco.
 */
async function descobrirUsuarios(client) {
  const { rows } = await client.query(
    `SELECT id, email, COALESCE(raw_app_meta_data ->> 'role', '') AS papel
       FROM auth.users ORDER BY created_at LIMIT 10`,
  );
  if (rows.length < 2) {
    throw new Error(
      `Preciso de 2 usuarios reais em auth.users para o teste, achei ${rows.length}.`,
    );
  }
  const dono = rows.find((u) => u.papel !== "admin") ?? rows[0];
  const atacante = rows.find((u) => u.id !== dono.id);
  const admin = rows.find((u) => u.papel === "admin") ?? atacante;
  return { dono, atacante, admin };
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

    const { dono, atacante, admin } = await descobrirUsuarios(client);
    console.log("Usuarios reais usados (FK para auth.users):");
    console.log(`  dono do pedido : ${dono.email}`);
    console.log(`  atacante       : ${atacante.email}`);
    console.log(`  admin          : ${admin.email}\n`);

    const pedidoConvidado = await criarPedido(client, null, produto, frete);
    const pedidoDoDono = await criarPedido(client, dono.id, produto, frete);
    console.log("Pedidos de teste criados (somem no ROLLBACK):");
    console.log(`  convidado (user_id NULL): ${pedidoConvidado}`);
    console.log(`  do dono                 : ${pedidoDoDono}\n`);

    // A funcao viva ja esta corrigida. Para demonstrar o furo é preciso
    // reinstalar a definicao antiga — a que o db-apply salvou antes de aplicar.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await client.query(fs.readFileSync(ROLLBACK, "utf8"));
    console.log("=== Definicao ANTIGA reinstalada na transacao ===");
    const conferindoAntiga = await fotografarFuncao(client);
    if (conferindoAntiga[0].tem_correcao) {
      throw new Error(
        "O rollback nao devolveu a definicao antiga — ele ainda tem IS DISTINCT FROM.",
      );
    }
    console.log("  confirmado: sem IS DISTINCT FROM no corpo\n");

    const c1 = await tentar(client, {
      papel: "authenticated",
      sub: atacante.id,
      orderId: pedidoConvidado,
      novoStatus: "cancelled",
    });
    registrar(
      "1. logado sem relacao cancela pedido de convidado (esperado: PASSA, é o furo)",
      c1.passou,
      c1.passou ? "cancelou o pedido alheio" : c1.mensagem,
    );

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await client.query(fs.readFileSync(MIGRATION, "utf8"));
    console.log("\n=== Migration reaplicada na transacao ===\n");

    const c2 = await tentar(client, {
      papel: "authenticated",
      sub: atacante.id,
      orderId: pedidoConvidado,
      novoStatus: "cancelled",
    });
    registrar(
      "2. mesmo chamador, mesmo pedido: BARRADO",
      !c2.passou,
      c2.mensagem,
    );

    // Sem claims: e o caso real de sessao expirada. `anon` nao entra aqui
    // porque o ACL vivo nao concede EXECUTE a ele.
    const c3 = await tentar(client, {
      papel: "authenticated",
      sub: null,
      orderId: pedidoConvidado,
      novoStatus: "cancelled",
    });
    registrar("3. chamador sem sessao: BARRADO", !c3.passou, c3.mensagem);

    const c4 = await tentar(client, {
      papel: "authenticated",
      sub: dono.id,
      orderId: pedidoDoDono,
      novoStatus: "cancelled",
    });
    registrar(
      "4. dono cancela o proprio pedido pendente: PASSA",
      c4.passou,
      c4.passou ? "cancelou" : c4.mensagem,
    );

    const c5 = await tentar(client, {
      papel: "authenticated",
      sub: admin.id,
      admin: true,
      orderId: pedidoConvidado,
      novoStatus: "shipped",
    });
    registrar(
      "5. admin muda status de pedido de convidado: PASSA",
      c5.passou,
      c5.passou ? "atualizou" : c5.mensagem,
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
      "TUDO PROVADO. Nada foi comitado — a correcao ja estava aplicada, isto so mede.",
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
