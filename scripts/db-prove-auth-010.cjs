#!/usr/bin/env node
/**
 * Prova a correção do AUTH-010 (issue #118) ANTES de aplicar em produção.
 *
 * Tudo numa transação terminada em ROLLBACK. O pedido de teste, o OTP e as
 * alterações de schema somem no fim.
 *
 * SOBRE O TRIGGER QUE MANDA E-MAIL:
 *   Inserir em otp_verifications dispara on_otp_created_send_email, que faz
 *   net.http_post para o segundo projeto Supabase. O pg_net enfileira em tabela,
 *   então o ROLLBACK desfaz o enfileiramento e nenhum e-mail sai. Mesmo assim os
 *   cenários usam um endereço obviamente falso (@exemplo-prova-auth010.invalid),
 *   para que um envio acidental nao chegue em ninguem de verdade.
 *
 * OS CENÁRIOS:
 *   Antes
 *     1. atacante gera OTP com o e-mail DELE + WhatsApp da vitima + fragmento
 *        vazio -> PASSA, e a linha sai com o e-mail do atacante  (o furo)
 *     2. e o resgate devolve o pedido da vitima                  (o furo)
 *   Depois
 *     3. mesma chamada, fragmento vazio            -> FALSE, e NADA inserido
 *     4. WhatsApp certo + e-mail que nao e do pedido -> FALSE, e NADA inserido
 *     5. convidado legitimo (os dois canais + fragmento) -> TRUE, com order_id
 *     6. resgate com o codigo certo -> ok:true, EXATAMENTE 1 pedido, e o certo
 *     7. codigo errado 5x -> attempts persiste e o 6o vem bloqueado
 *        (é isto que prova que RETURN em vez de RAISE era necessario)
 *     8. ACL das duas RPCs preservado, anon incluso
 *     9. o trigger continua apontando para o segundo projeto (nao foi tocado)
 *
 * USO:  node scripts/db-prove-auth-010.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const { resolverCaminhoMigration } = require("./ler-migration");
const NOME_DA_MIGRATION = "20260805010000_bind_guest_otp_to_single_order.sql";
const MIGRATION = resolverCaminhoMigration(NOME_DA_MIGRATION);

const EMAIL_VITIMA = "vitima@exemplo-prova-auth010.invalid";
const EMAIL_ATACANTE = "atacante@exemplo-prova-auth010.invalid";
const WHATSAPP_VITIMA = "34999887766";

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

async function acls(client) {
  const { rows } = await client.query(`
    SELECT p.proname, COALESCE(p.proacl::text,'(sem ACL)') AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('generate_order_otp_v1','get_orders_by_otp_v1')
     ORDER BY p.proname`);
  return Object.fromEntries(rows.map((r) => [r.proname, r.acl]));
}

async function alvoDoTrigger(client) {
  const { rows } = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='handle_new_otp_verification'`);
  const m = rows[0]?.def.match(
    /https:\/\/([a-z0-9]+)\.functions\.supabase\.co/,
  );
  return m ? m[1] : "(nao encontrado)";
}

/** Roda um SQL isolado num savepoint; devolve linhas ou o erro. */
async function tentar(client, sql, params = []) {
  await client.query("SAVEPOINT s");
  try {
    const r = await client.query(sql, params);
    return {
      ok: true,
      rows: r.rows,
      liberar: () => client.query("RELEASE SAVEPOINT s"),
    };
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT s").catch(() => {});
    return { ok: false, erro: e.message, liberar: async () => {} };
  }
}

async function contarOtp(client) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM public.otp_verifications",
  );
  return rows[0].n;
}

async function main() {
  if (!MIGRATION)
    throw new Error(`Nao achei (raiz nem _arquivadas): ${NOME_DA_MIGRATION}`);

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log("Nada sera comitado: transacao terminada em ROLLBACK.\n");

  const falhas = [];
  const reg = (t, ok, det) => {
    console.log(
      `  ${ok ? "OK     " : "FALHOU "} ${t}${det ? ` — ${det}` : ""}`,
    );
    if (!ok) falhas.push(t);
  };

  await client.query("BEGIN");
  try {
    const aclAntes = await acls(client);
    const triggerAntes = await alvoDoTrigger(client);
    console.log(`ACL antes  : ${JSON.stringify(aclAntes)}`);
    console.log(`Trigger posta para: ${triggerAntes}\n`);

    // Pedido de convidado com e-mail e WhatsApp conhecidos.
    await client.query(
      "UPDATE public.store_config SET free_shipping_min = 999999 WHERE id = 1",
    );
    const { rows: cfg } = await client.query(
      "SELECT shipping_fee FROM public.store_config WHERE id = 1",
    );
    const frete = Number(cfg[0].shipping_fee);
    const { rows: prod } = await client.query(
      `SELECT id, preco_venda FROM public.produtos
        WHERE ativo = true AND deleted_at IS NULL
          AND COALESCE(frete_gratis,false) = false AND estoque >= 1
        ORDER BY preco_venda DESC LIMIT 1`,
    );
    if (prod.length === 0) throw new Error("Nenhum produto elegivel.");
    await client.query("SELECT set_config('request.jwt.claims', '', true)");
    const { rows: novo } = await client.query(
      `SELECT public.create_marketplace_order_v23(
         $1::jsonb, $2::numeric, $3::numeric, 'whatsapp', NULL, NULL,
         'Prova AUTH-010', $4::text, 'ROLLBACK - teste', NULL, NULL, NULL) AS id`,
      [
        JSON.stringify([
          { product_id: prod[0].id, variant_id: null, quantity: 1 },
        ]),
        Number(prod[0].preco_venda) + frete,
        frete,
        WHATSAPP_VITIMA,
      ],
    );
    const pedido = novo[0].id;
    await client.query(
      `UPDATE public.marketplace_orders
          SET customer_data = COALESCE(customer_data,'{}'::jsonb)
                              || jsonb_build_object('email',$2::text,'whatsapp',$3::text)
        WHERE id = $1`,
      [pedido, EMAIL_VITIMA, WHATSAPP_VITIMA],
    );
    const fragmento = pedido.slice(-6);
    console.log(`Pedido de teste: ${pedido} (fragmento "${fragmento}")\n`);

    console.log("=== ANTES da migration ===");
    const antesN = await contarOtp(client);
    const c1 = await tentar(
      client,
      "SELECT public.generate_order_otp_v1($1,$2,$3) AS r",
      [EMAIL_ATACANTE, WHATSAPP_VITIMA, ""],
    );
    if (c1.ok) await c1.liberar();
    const inseriu = (await contarOtp(client)) > antesN;
    reg(
      "1. atacante gera OTP com e-mail dele e fragmento vazio (esperado: PASSA)",
      c1.ok && c1.rows[0].r === true && inseriu,
      c1.ok ? `retornou ${c1.rows[0].r}, linha inserida = ${inseriu}` : c1.erro,
    );

    if (inseriu) {
      const { rows: cod } = await client.query(
        "SELECT otp_code FROM public.otp_verifications WHERE email = $1 ORDER BY created_at DESC LIMIT 1",
        [EMAIL_ATACANTE],
      );
      const c2 = await tentar(
        client,
        "SELECT public.get_orders_by_otp_v1($1,$2) AS r",
        [EMAIL_ATACANTE, cod[0].otp_code],
      );
      if (c2.ok) await c2.liberar();
      const qtd =
        c2.ok && Array.isArray(c2.rows[0].r) ? c2.rows[0].r.length : 0;
      reg(
        "2. resgate devolve pedido da vitima para o atacante (esperado: PASSA)",
        qtd > 0,
        c2.ok ? `${qtd} pedido(s) entregue(s)` : c2.erro,
      );
    } else {
      reg(
        "2. resgate devolve pedido da vitima",
        false,
        "cenario 1 nao inseriu",
      );
    }

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await client.query(fs.readFileSync(MIGRATION, "utf8"));
    console.log("\n=== Migration aplicada na transacao ===\n");

    const nDepois = await contarOtp(client);
    const c3 = await tentar(
      client,
      "SELECT public.generate_order_otp_v1($1,$2,$3) AS r",
      [EMAIL_ATACANTE, WHATSAPP_VITIMA, ""],
    );
    if (c3.ok) await c3.liberar();
    reg(
      "3. fragmento vazio: FALSE e nada inserido",
      c3.ok && c3.rows[0].r === false && (await contarOtp(client)) === nDepois,
      c3.ok ? `retornou ${c3.rows[0].r}` : c3.erro,
    );

    const c4 = await tentar(
      client,
      "SELECT public.generate_order_otp_v1($1,$2,$3) AS r",
      [EMAIL_ATACANTE, WHATSAPP_VITIMA, fragmento],
    );
    if (c4.ok) await c4.liberar();
    reg(
      "4. WhatsApp certo + e-mail que nao e do pedido: FALSE e nada inserido",
      c4.ok && c4.rows[0].r === false && (await contarOtp(client)) === nDepois,
      c4.ok ? `retornou ${c4.rows[0].r}` : c4.erro,
    );

    const c5 = await tentar(
      client,
      "SELECT public.generate_order_otp_v1($1,$2,$3) AS r",
      [EMAIL_VITIMA, WHATSAPP_VITIMA, fragmento],
    );
    if (c5.ok) await c5.liberar();
    const { rows: linha } = await client.query(
      "SELECT otp_code, order_id, attempts FROM public.otp_verifications WHERE email=$1 ORDER BY created_at DESC LIMIT 1",
      [EMAIL_VITIMA],
    );
    reg(
      "5. convidado legitimo: TRUE, com order_id preenchido",
      c5.ok && c5.rows[0].r === true && linha[0]?.order_id === pedido,
      c5.ok ? `order_id = ${linha[0]?.order_id}` : c5.erro,
    );

    const c6 = await tentar(
      client,
      "SELECT public.get_orders_by_otp_v1($1,$2) AS r",
      [EMAIL_VITIMA, linha[0].otp_code],
    );
    if (c6.ok) await c6.liberar();
    const r6 = c6.ok ? c6.rows[0].r : null;
    reg(
      "6. resgate com codigo certo: ok:true e EXATAMENTE 1 pedido, o certo",
      Boolean(r6?.ok) && r6.orders?.length === 1 && r6.orders[0].id === pedido,
      c6.ok ? `ok=${r6?.ok}, ${r6?.orders?.length} pedido(s)` : c6.erro,
    );

    // 7. Cinco erros: o contador tem de PERSISTIR entre chamadas.
    const c7gen = await tentar(
      client,
      "SELECT public.generate_order_otp_v1($1,$2,$3) AS r",
      [EMAIL_VITIMA, WHATSAPP_VITIMA, fragmento],
    );
    if (c7gen.ok) await c7gen.liberar();
    let ultimo = null;
    for (let i = 0; i < 6; i++) {
      const t = await tentar(
        client,
        "SELECT public.get_orders_by_otp_v1($1,$2) AS r",
        [EMAIL_VITIMA, "000000"],
      );
      if (t.ok) await t.liberar();
      ultimo = t.ok ? t.rows[0].r : { erro: t.erro };
    }
    const { rows: cont } = await client.query(
      "SELECT attempts FROM public.otp_verifications WHERE email=$1 AND verified=false ORDER BY created_at DESC LIMIT 1",
      [EMAIL_VITIMA],
    );
    reg(
      "7. contador persiste e o 6o vem bloqueado (prova o RETURN no lugar do RAISE)",
      cont[0]?.attempts >= 5 && /bloqueado/i.test(ultimo?.error || ""),
      `attempts = ${cont[0]?.attempts}, ultima resposta: ${ultimo?.error}`,
    );

    const aclDepois = await acls(client);
    reg(
      "8. ACL das duas RPCs preservado, anon incluso",
      JSON.stringify(aclAntes) === JSON.stringify(aclDepois) &&
        /anon=X/.test(aclDepois.generate_order_otp_v1 || ""),
      JSON.stringify(aclDepois),
    );

    const triggerDepois = await alvoDoTrigger(client);
    reg(
      "9. trigger continua apontando para o mesmo projeto (nao foi tocado)",
      triggerDepois === triggerAntes,
      `${triggerAntes} -> ${triggerDepois}`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }

  console.log(`\n${"=".repeat(64)}`);
  if (falhas.length === 0) {
    console.log(
      "TUDO PROVADO. Nada foi comitado — agora sim rode o db-apply.cjs.",
    );
    process.exit(0);
  }
  console.log("NAO PROVADO — nao aplique:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
