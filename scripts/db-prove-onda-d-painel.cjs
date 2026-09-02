#!/usr/bin/env node
/**
 * FICHA DA ONDA D (varredura profunda #2) — a porta manual de estorno e o
 * selo que não conta pedido morto. Rodar DEPOIS do db-apply (estado vivo).
 *
 * Em transação com ROLLBACK (resíduo zero):
 *   1. catálogo: `registrar_estorno_manual(uuid)` existe como ASSINATURA
 *      ÚNICA (sem par ambíguo — a bomba de sobrecarga da casa);
 *   2. corpo: guarda is_admin + gravação de 'estornado' presentes;
 *   3. PORTA REAL: como authenticated SEM ser admin, a chamada leva o erro
 *      esperado "somente a loja registra o estorno" (guarda interna fala
 *      antes de tocar no pedido);
 *   4. funções do selo (20261073): os portões de status estão nos corpos
 *      vivos (`pg_get_functiondef`).
 *
 * USO: node scripts/db-prove-onda-d-painel.cjs   (DATABASE_URL do .env)
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

async function tenta(client, sql) {
  await client.query("SAVEPOINT sp_tenta");
  let ok = true;
  let msg = "";
  try {
    await client.query(sql);
  } catch (e) {
    ok = false;
    msg = String(e.message);
  }
  await client.query("ROLLBACK TO SAVEPOINT sp_tenta");
  return { ok, msg };
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
    await client.query("RESET ALL");

    // ---- 1. catálogo: assinatura única -------------------------------------
    const assinaturas = (
      await client.query(
        `SELECT count(*)::int AS n FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'registrar_estorno_manual'`,
      )
    ).rows[0].n;
    asserir(
      assinaturas === 1,
      `registrar_estorno_manual tem exatamente 1 assinatura (${assinaturas})`,
    );

    // ---- 2. corpo: guarda e escrita ----------------------------------------
    const corpo = (
      await client.query(
        `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'registrar_estorno_manual'`,
      )
    ).rows[0].def;
    asserir(
      corpo.includes("IF NOT public.is_admin() THEN") &&
        corpo.includes("SET payment_status = 'estornado'"),
      "corpo da RPC: guarda is_admin + gravação de 'estornado' presentes",
    );
    asserir(
      corpo.includes("SECURITY DEFINER") && corpo.includes("search_path"),
      "corpo da RPC: SECURITY DEFINER e search_path declarados por extenso",
    );

    // ---- 3. porta real: authenticated não-admin é recusado com a mensagem ---
    const resultado = await tenta(
      client,
      "SET LOCAL ROLE authenticated; SELECT public.registrar_estorno_manual('00000000-0000-0000-0000-000000000000')",
    );
    asserir(
      !resultado.ok &&
        resultado.msg.includes("somente a loja registra o estorno"),
      `chamada como authenticated não-admin é recusada pela guarda (${
        resultado.ok ? "EXECUTOU — buraco!" : resultado.msg
      })`,
    );

    // ---- 4. funções do selo com o portão de status --------------------------
    const selos = (
      await client.query(
        `SELECT p.proname, pg_get_functiondef(p.oid) AS def
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN (
              'marca_avaliacao_nasce_verificada',
              'marca_avaliacoes_do_pedido_verificadas')`,
      )
    ).rows;
    asserir(
      selos.length === 2,
      `as duas funções do selo existem (${selos.length})`,
    );
    for (const s of selos) {
      const comPortaoNovo = s.def.includes(
        s.proname === "marca_avaliacao_nasce_verificada"
          ? "AND o.status NOT IN ('cancelled', 'returned')"
          : "AND NEW.status NOT IN ('cancelled', 'returned')",
      );
      asserir(
        comPortaoNovo,
        `${s.proname}: portão de status presente no corpo vivo`,
      );
    }
  } finally {
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
