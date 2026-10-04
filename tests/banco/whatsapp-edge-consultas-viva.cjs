"use strict";

/**
 * Prova viva: as consultas da edge `send-order-whatsapp` EXECUTAM no schema
 * real (as migrations aplicadas do zero no Postgres efêmero), não só num dublê.
 *
 * Por quê: a edge lia `store_config.whatsapp_api_url/_key/_instance`, colunas
 * removidas em 01/06/2026 (migration 20260601000001, arquivada). Um teste com
 * dublê de banco aceitava a leitura; o banco real recusa com 42703
 * (coluna inexistente) e a função devolvia 500 em toda chamada. Aqui cada
 * `.from('tabela').select('colunas')` do código-fonte da edge é extraído do
 * texto e executado de verdade (`SELECT colunas FROM tabela LIMIT 0`): coluna
 * ou tabela que não existe mais no schema reprova a prova.
 *
 * USO: node tests/banco/whatsapp-edge-consultas-viva.cjs [caminho/do/index.ts]
 * (DATABASE_URL do efêmero + CI_BANCO_EFEMERO=1 — ver efemero.cjs; o caminho é
 * opcional e serve para apontar a prova para outra versão do arquivo.)
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho vem de argumento de linha de comando ou do próprio repositório,
 * nunca de entrada de rede nem de terceiro. */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const PADRAO_DA_EDGE = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "functions",
  "send-order-whatsapp",
  "index.ts",
);

const CONSULTA =
  /\.from\(\s*['"]([a-z_]+)['"]\s*\)\s*\.select\(\s*['"]([^'"]+)['"]\s*\)/g;

async function main() {
  const arquivo = process.argv[2] || PADRAO_DA_EDGE;
  const fonte = fs.readFileSync(arquivo, "utf8");
  const consultas = [...fonte.matchAll(CONSULTA)].map((m) => ({
    tabela: m[1],
    colunas: m[2],
  }));

  console.log(
    `[whatsapp-edge] fonte: ${path.relative(process.cwd(), arquivo)}`,
  );
  console.log(`[whatsapp-edge] consultas encontradas: ${consultas.length}`);
  // A trava contra o vácuo: extrator que não acha nada "passa" sem provar nada.
  if (!consultas.some((c) => c.tabela === "marketplace_orders")) {
    falhar(
      "VAZIO",
      "o extrator não achou a leitura de marketplace_orders — a prova mediria nada.",
    );
  }

  const cliente = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await cliente.connect();
  const falhas = [];
  try {
    for (const { tabela, colunas } of consultas) {
      const sql = `SELECT ${colunas} FROM public.${tabela} LIMIT 0`;
      try {
        const r = await cliente.query(sql);
        console.log(
          `[whatsapp-edge] ok   ${sql}  -> colunas: ${r.fields.map((f) => f.name).join(", ")}`,
        );
      } catch (erro) {
        console.log(
          `[whatsapp-edge] FALHOU ${sql}  -> ${erro.code} ${erro.message}`,
        );
        falhas.push(`${tabela}: ${erro.code} ${erro.message}`);
      }
    }

    // Informativo: onde a configuração da Evolution morava. Se um dia as
    // colunas voltarem, quem religar a edge precisa decidir de onde ler.
    const cfg = await cliente.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'store_config'
          AND column_name LIKE 'whatsapp\\_api\\_%'`,
    );
    console.log(
      `[whatsapp-edge] store_config.whatsapp_api_* no schema: ${cfg.rowCount === 0 ? "AUSENTES (a edge responde 'não configurada')" : cfg.rows.map((r) => r.column_name).join(", ")}`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }

  if (falhas.length > 0) {
    falhar(
      "REPROVADO",
      `a edge consulta o que o schema real não tem:\n  - ${falhas.join("\n  - ")}`,
    );
  }
  console.log(
    `\n[whatsapp-edge] ${consultas.length}/${consultas.length} consultas executam no schema real.`,
  );
}

main().catch((erro) => falhar("ERRO", erro.stack || String(erro)));
