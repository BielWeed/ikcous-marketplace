"use strict";

// Executado apenas por workflow_dispatch. O alvo é fechado e o SQL é fixo:
// nenhum nome de arquivo, projeto_ref ou comando SQL vem do operador.
const fs = require("node:fs");

const REFS = Object.freeze({
  loja: "dekxabvqdsuukijblazl",
  savy: "gnjsrucsmjkajijrakzr",
  sandbox: "lofznuxcvezrhxsgjqyg",
});

async function main() {
  const projeto = process.env.PROJETO;
  const expected = process.env.EXPECTED_SHA || "";
  const actual = process.env.GITHUB_SHA || "";
  if (!Object.hasOwn(REFS, projeto))
    throw new Error("RECUSADO: projeto desconhecido");
  if (process.env.CONFIRMACAO !== "ROLLBACK_PIX_84_85") {
    throw new Error("RECUSADO: confirmação incorreta");
  }
  if (
    !/^[a-f0-9]{40}$/i.test(expected) ||
    expected.toLowerCase() !== actual.toLowerCase()
  ) {
    throw new Error("RECUSADO: expected_sha deve ser o SHA completo deste run");
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("RECUSADO: token do projeto ausente");
  const ref =
    projeto === "loja"
      ? REFS.loja
      : projeto === "savy"
        ? REFS.savy
        : REFS.sandbox;

  async function sql(titulo, query) {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${ref}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`${titulo}: resposta não JSON (HTTP ${response.status})`);
    }
    if (!response.ok || !Array.isArray(result)) {
      throw new Error(
        `${titulo}: API recusou a query (HTTP ${response.status}); verificar logs do projeto`,
      );
    }
    return result;
  }

  const body = fs.readFileSync("scripts/sql/pix-84-85-revert.sql", "utf8");
  console.log(
    `ROLLBACK PIX 84/85: alvo ${projeto}; commit ${actual}; SQL fixo pix-84-85-revert.sql`,
  );
  // BEGIN, guarda, DDL e DELETE do ledger chegam à API como UMA query.
  await sql("rollback", `BEGIN;\n${body}\nCOMMIT;`);
  const rows = await sql(
    "verificação",
    `SELECT
    NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version IN ('20261184000000', '20261185000000')) AS ledger_limpo,
    to_regprocedure('public.iniciar_venda_presencial_pix(jsonb,uuid,uuid,text,text,numeric,text)') IS NULL AS rpc_84_ausente,
    to_regprocedure('public.anular_venda_presencial(uuid,text)') IS NULL AS rpc_85_ausente,
    NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.marketplace_orders'::regclass
      AND tgname IN ('tr_venda_do_balcao_paga_e_entregue', 'tr_venda_do_balcao_guarda_o_status')
      AND NOT tgisinternal) AS gatilhos_ausentes`,
  );
  if (
    rows.length !== 1 ||
    Object.values(rows[0]).some((value) => value !== true)
  ) {
    throw new Error(
      "Rollback executado, mas verificação final falhou; inspecionar banco antes de qualquer nova ação",
    );
  }
  console.log("ROLLBACK PIX 84/85: verificado, ledger e objetos ausentes");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
