#!/usr/bin/env node
/**
 * PROVA A-2 — o admin apaga o carrinho do cliente (laudo varredura 01/09).
 *
 * O que prova, contra o banco VIVO de DEV, numa transação com ROLLBACK no
 * fim (resíduo zero — massa, itens e as DUAS versões da policy morrem junto):
 *
 *   CONTROLE NEGATIVO (o defeito, com a policy VELHA do baseline aplicada
 *   inline): admin tenta apagar item de outro usuário → 0 linhas afetadas.
 *   Sem este controle, uma prova cega para o defeito passaria verde nas duas
 *   policies.
 *
 *   Com a policy NOVA (a da migration 20261067000000, aplicada inline):
 *   (a) ADMIN apaga item de OUTRO usuário  → linhas afetadas > 0;
 *   (b) usuário comum NÃO apaga de outro   → 0 linhas afetadas;
 *   (c) usuário comum apaga o PRÓPRIO item → 1 linha afetada.
 *
 * Contexto de identidade: `SET LOCAL ROLE authenticated` + `request.jwt.
 * claims` (admin: app_metadata.role = 'admin' de um perfil admin real;
 * comum: usuário real NÃO-admin segundo auth.users.raw_app_meta_data — o
 * MESMO critério do fallback do is_admin(), que consultaria auth.users e
 * NÃO acharia admin). Mesmo padrão do db-prove-push-log-honesto.cjs.
 *
 * `cart_items.user_id` TEM FK para auth.users (`cart_items_user_id_fkey`) e
 * `product_id` é text — a massa descartável não cria usuários nem produtos:
 * os donos são usuários reais pegos emprestados SÓ como valor de FK (nada
 * deles é lido, alterado ou apagado).
 *
 * USO: node scripts/db-prove-cart-items-admin-apaga.cjs   (DATABASE_URL do .env)
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.join(__dirname, "..");

let falhas = 0;
function asserir(condicao, rotulo) {
  if (condicao) {
    console.log(`  ok  ${rotulo}`);
  } else {
    falhas += 1;
    console.error(`  FALHOU  ${rotulo}`);
  }
}

async function main() {
  const envPath = path.join(RAIZ, ".env");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
  const env = fs.readFileSync(envPath, "utf8");
  const linha = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  const dbUrl = linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    // ---- massa descartável: 1 item do dono A, 2 do dono B ---------------
    // `cart_items_user_id_fkey` (banco vivo) aponta para auth.users, então
    // os donos são DOIS usuários reais não-admin pegos emprestados só como
    // valor de FK — nenhuma linha deles é lida, alterada ou apagada, e as
    // linhas de carrinho nascem e morrem no ROLLBACK.
    const adminId = (
      await client.query("SELECT id FROM profiles WHERE role = 'admin' LIMIT 1")
    ).rows[0].id;
    const naoAdmins = (
      await client.query(
        `SELECT id FROM auth.users
          WHERE coalesce(raw_app_meta_data ->> 'role', '') <> 'admin'
          ORDER BY created_at LIMIT 2`,
      )
    ).rows;
    if (naoAdmins.length < 2) {
      throw new Error("dev sem dois usuários não-admin para a prova");
    }
    const idA = naoAdmins[0].id;
    const idB = naoAdmins[1].id;

    await client.query(
      `INSERT INTO cart_items (user_id, product_id, quantity) VALUES
        ($1, 'SONDA PROVA A-2 item do A', 1),
        ($2, 'SONDA PROVA A-2 item do B 1', 1),
        ($2, 'SONDA PROVA A-2 item do B 2', 2)`,
      [idA, idB],
    );
    // Contagens ANTES de trocar de identidade (como postgres, que vê tudo —
    // autenticado só vê o próprio carrinho pela SELECT policy).
    const itensDeB = (
      await client.query(
        "SELECT count(*)::int AS n FROM cart_items WHERE user_id = $1",
        [idB],
      )
    ).rows[0].n;

    // ---- troca de identidade ---------------------------------------------
    const virarAdmin = async () => {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: adminId,
          role: "authenticated",
          app_metadata: { role: "admin" },
        }),
      ]);
    };
    const virarUsuarioComum = async (id) => {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: id,
          role: "authenticated",
          app_metadata: { role: "user" },
        }),
      ]);
    };
    const virarPostgres = async () => {
      await client.query("SET LOCAL ROLE postgres");
      await client.query("SELECT set_config('request.jwt.claims', '', true)");
    };

    const apagarDe = async (userId) =>
      (
        await client.query("DELETE FROM cart_items WHERE user_id = $1", [
          userId,
        ])
      ).rowCount;

    // ---- as DUAS policies, aplicadas inline (morrem no ROLLBACK) ---------
    const policyVelha = `
      DROP POLICY IF EXISTS cart_items_delete_policy ON public.cart_items;
      CREATE POLICY cart_items_delete_policy
        ON public.cart_items FOR DELETE TO authenticated
        USING ((( SELECT auth.uid()) = user_id));`;
    const policyNova = `
      DROP POLICY IF EXISTS cart_items_delete_policy ON public.cart_items;
      CREATE POLICY cart_items_delete_policy
        ON public.cart_items FOR DELETE TO authenticated
        USING ((SELECT auth.uid()) = user_id OR (SELECT is_admin()));`;

    // ---- CONTROLE NEGATIVO: policy VELHA barra o admin (o defeito A-2) ---
    await virarPostgres();
    await client.query(policyVelha);
    await virarAdmin();
    asserir(
      (await apagarDe(idB)) === 0,
      "controle negativo (policy VELHA): admin apagando de outro usuário → 0 linhas (o defeito está presente na prova)",
    );

    // ---- policy NOVA: os três casos do laudo -----------------------------
    await virarPostgres();
    await client.query(policyNova);

    await virarUsuarioComum(idA);
    asserir(
      (await apagarDe(idB)) === 0,
      "(b) usuário comum NÃO apaga item de outro usuário → 0 linhas afetadas",
    );
    // O dev pode já ter itens desse usuário (o usuário de teste do banco tem
    // os dele) — a asserção é "apagou TODOS os seus, e tinha ao menos o
    // nosso", nunca "apagou exatamente 1".
    const meusAntes = (
      await client.query(
        "SELECT count(*)::int AS n FROM cart_items WHERE user_id = $1",
        [idA],
      )
    ).rows[0].n;
    asserir(
      meusAntes >= 1 && (await apagarDe(idA)) === meusAntes,
      `(c) usuário comum apaga o PRÓPRIO carrinho → ${meusAntes} linha(s) afetada(s) (todas as dele)`,
    );

    const doBDantes = itensDeB;
    await virarAdmin();
    asserir(
      doBDantes >= 2 && (await apagarDe(idB)) === doBDantes,
      `(a) admin apaga item de OUTRO usuário → ${doBDantes} linha(s) afetadas (as ${doBDantes} dele)`,
    );

    await virarPostgres();
  } finally {
    // Transação descartável: nem a massa, nem as policies aplicadas inline
    // sobrevivem — o banco fica exatamente como estava.
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(
    falhas === 0
      ? "\nPROVA COMPLETA: todas as asserções passaram. Nada foi gravado (ROLLBACK)."
      : `\nPROVA REPROVADA: ${falhas} asserção(ões) falharam. NADA foi gravado (ROLLBACK).`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("[PROVA FALHOU]", e.message);
  process.exit(1);
});
