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
 *     1. Cliente comum cancela pedido de CONVIDADO -> tem de PASSAR (o furo)
 *   Com a migration reaplicada
 *     2. Mesmo caso 1 -> tem de ser barrado
 *     3. Chamador sem sessao contra pedido de convidado -> tem de ser barrado
 *     4. O mesmo cliente cancela o PRÓPRIO pedido pendente -> tem de passar
 *     5. Admin muda o status de pedido de convidado -> tem de passar
 *   E o pg_proc.proacl tem de sair idêntico ao que entrou.
 *
 * O CLIENTE COMUM PRECISA MESMO SER COMUM, e isso e conferido contra o banco
 *   antes de qualquer cenario. A primeira versao deste script elegeu como
 *   atacante um usuario que era admin: is_admin() cai no fallback de auth.users
 *   quando a claim nao diz admin, entao ele passava em tudo. O cenario 1 ficou
 *   verde sem provar o furo e o 2 ficou vermelho sem haver defeito. Por isso
 *   `conferirNaoAdmin` pergunta `SELECT public.is_admin()` com o papel e as
 *   claims reais, e aborta se vier true.
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
 * OS USUÁRIOS SÃO REAIS: marketplace_orders.user_id tem FK para auth.users e
 * marketplace_order_history.created_by tambem, entao UUID inventado nao serve —
 * a primeira versao deste script morria na constraint antes de medir qualquer
 * coisa. O script descobre um cliente comum e um admin no proprio banco.
 *
 * USO:  node scripts/db-prove-pedido-010.cjs
 * Sai com código 0 só se os cinco cenários e a comparação de ACL passarem.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const { resolverCaminhoMigration } = require("./ler-migration");
const NOME_DA_MIGRATION =
  "20260804010000_fix_order_owner_check_null_safety.sql";
const MIGRATION = resolverCaminhoMigration(NOME_DA_MIGRATION);

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
       FROM auth.users ORDER BY created_at LIMIT 50`,
  );
  const comuns = rows.filter((u) => u.papel !== "admin");
  const admins = rows.filter((u) => u.papel === "admin");
  if (comuns.length === 0) {
    throw new Error(
      "Nenhum usuario NAO admin em auth.users. O teste inteiro precisa de um: com admin, tudo passa e a prova vira teatro.",
    );
  }
  if (admins.length === 0) {
    throw new Error("Nenhum usuario admin em auth.users para o cenario 5.");
  }
  return { cliente: comuns[0], admin: admins[0] };
}

/**
 * Guarda contra o erro que já aconteceu neste script: a primeira versao elegeu
 * como "atacante" um usuario que era admin, e `is_admin()` cai no fallback de
 * auth.users quando a claim nao diz admin. Resultado: o furo "reproduzia" e a
 * correcao "falhava", os dois pelo mesmo motivo errado. Aqui a gente pergunta
 * ao banco, com o papel e as claims reais do cenario.
 */
async function conferirNaoAdmin(client, sub, email) {
  await client.query("SAVEPOINT chk_admin");
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    claims(sub, false),
  ]);
  const { rows } = await client.query("SELECT public.is_admin() AS eh");
  await client.query("ROLLBACK TO SAVEPOINT chk_admin");
  await client.query("RESET ROLE");
  if (rows[0].eh) {
    throw new Error(
      `${email} resolve is_admin() = true. Ele nao serve como cliente comum — os cenarios passariam sem medir nada.`,
    );
  }
}

/** Le do banco um status valido diferente de pending/cancelled, para o cenario do admin. */
async function statusValidoParaAdmin(client) {
  const { rows } = await client.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'marketplace_orders_status_check'`,
  );
  if (rows.length === 0) {
    throw new Error(
      "Constraint marketplace_orders_status_check nao encontrada.",
    );
  }
  const valores = [...rows[0].def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const escolhido = valores.find((v) => v !== "pending" && v !== "cancelled");
  if (!escolhido) {
    throw new Error(`Nenhum status utilizavel na constraint: ${rows[0].def}`);
  }
  return escolhido;
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
  if (!MIGRATION)
    throw new Error(
      `Migration não encontrada (raiz nem _arquivadas): ${NOME_DA_MIGRATION}`,
    );

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

    const { cliente, admin } = await descobrirUsuarios(client);
    await conferirNaoAdmin(client, cliente.id, cliente.email);
    const statusDoAdmin = await statusValidoParaAdmin(client);
    console.log("Usuarios reais usados (FK para auth.users):");
    console.log(
      `  cliente comum : ${cliente.email} (is_admin() = false, conferido)`,
    );
    console.log(`  admin         : ${admin.email}`);
    console.log(
      `  status do cenario 5: '${statusDoAdmin}' (lido da constraint)\n`,
    );

    // O cliente comum é dono de um pedido e ESTRANHO ao pedido de convidado.
    // É exatamente o cenário da issue: logado de posse do id de um pedido alheio.
    const pedidoConvidado = await criarPedido(client, null, produto, frete);
    const pedidoDoCliente = await criarPedido(
      client,
      cliente.id,
      produto,
      frete,
    );
    console.log("Pedidos de teste criados (somem no ROLLBACK):");
    console.log(`  convidado (user_id NULL): ${pedidoConvidado}`);
    console.log(`  do cliente comum        : ${pedidoDoCliente}\n`);

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
      sub: cliente.id,
      orderId: pedidoConvidado,
      novoStatus: "cancelled",
    });
    registrar(
      "1. cliente comum cancela pedido de convidado (esperado: PASSA, é o furo)",
      c1.passou,
      c1.passou ? "cancelou o pedido alheio" : c1.mensagem,
    );

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await client.query(fs.readFileSync(MIGRATION, "utf8"));
    console.log("\n=== Migration reaplicada na transacao ===\n");

    const c2 = await tentar(client, {
      papel: "authenticated",
      sub: cliente.id,
      orderId: pedidoConvidado,
      novoStatus: "cancelled",
    });
    registrar(
      "2. mesmo cliente, mesmo pedido de convidado: BARRADO",
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
      sub: cliente.id,
      orderId: pedidoDoCliente,
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
      novoStatus: statusDoAdmin,
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
