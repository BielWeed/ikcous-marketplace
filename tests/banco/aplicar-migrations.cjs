"use strict";

/**
 * Aplica a RAIZ INTEIRA de supabase/migrations no Postgres efêmero do job,
 * em ordem de nome de arquivo — a mesma mecânica da frente ci-banco (PR
 * #585): um arquivo = uma query (o Postgres roda tudo num bloco só), sem
 * ledger nem rollback (o banco morre no fim do job).
 *
 * Única intervenção de texto, com aviso por arquivo: as duas linhas
 *   CREATE EXTENSION IF NOT EXISTS pg_cron;
 *   CREATE EXTENSION IF NOT EXISTS pg_net;
 * viram comentário — o provisionar.cjs já deixou o stub do cron de pé e o
 * pg_net só é referenciado DENTRO do comando agendado (nunca avaliado no
 * apply). Nada mais no arquivo é tocado.
 *
 * USO: node tests/banco/aplicar-migrations.cjs supabase/migrations
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera, anexarAoSummary } = require("./efemero.cjs");

// Substituições controladas: o que o Supabase provisiona e o image oficial
// não tem. Qualquer erro SQL FORA destas duas linhas falha o job.
const NEUTRALIZACOES = [
  {
    padrao: /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_cron\s*;/gi,
    aviso: "pg_cron emulado por stub (tests/banco/provisionar.cjs)",
  },
  {
    padrao: /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_net\s*;/gi,
    aviso: "pg_net só vive dentro de comando agendado — sem instância aqui",
  },
];

function listarMigrations(diretorio) {
  return fs
    .readdirSync(diretorio, { withFileTypes: true })
    .filter((entrada) => entrada.isFile())
    .map((entrada) => entrada.name)
    .filter((nome) => nome.endsWith(".sql"))
    // Rollback-manual mora ao lado das migrations na raiz e NÃO é migration.
    .filter((nome) => !nome.startsWith("rollback-"))
    .sort();
}

async function main() {
  const diretorio = process.argv[2];
  if (!diretorio || !fs.existsSync(diretorio)) {
    falhar("INDETERMINADO", "Uso: node tests/banco/aplicar-migrations.cjs supabase/migrations");
  }

  const arquivos = listarMigrations(diretorio);
  if (arquivos.length === 0) {
    falhar("FALHOU", `Nenhuma migration encontrada em ${diretorio}`);
  }

  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }

  const aplicados = [];
  const avisos = [];
  try {
    console.log(`[aplicar] arquivos na raiz (ordem de apply): ${arquivos.length}`);
    for (const nome of arquivos) {
      let conteudo = fs.readFileSync(path.join(diretorio, nome), "utf8");
      for (const { padrao, aviso } of NEUTRALIZACOES) {
        if (padrao.test(conteudo)) {
          conteudo = conteudo.replace(padrao, `-- [rpc-ci] ${aviso}`);
          avisos.push(`${nome}: ${aviso}`);
        }
        padrao.lastIndex = 0;
      }
      try {
        // O baseline (pg_dump) seta search_path vazio PARA A SESSÃO no 1º
        // statement (`set_config('search_path', '', false)`). Sem este
        // reset, todo arquivo seguinte herda search_path vazio e a primeira
        // referência não-qualificada explode ("relation does not exist") —
        // medido no CI em 14/09. Mesma receita da ci-banco.
        await cliente.query("RESET ALL");
        await cliente.query(conteudo);
        aplicados.push(nome);
        console.log(`[aplicar] ok ${aplicados.length}/${arquivos.length} ${nome}`);
      } catch (erro) {
        const onde = erro.position
          ? ` (offset ${erro.position} → linha ~${String(conteudo.slice(0, erro.position).split("\n").length)} do arquivo)`
          : "";
        falhar(
          "FALHOU",
          `Migration ${nome} falhou no efêmero: ${erro.message}${onde}\n${erro.detail || ""}\n${erro.where || ""}`,
        );
      }
    }

    // Sentinela de sanidade: objetos que as provas de dinheiro vão tocar
    // precisam existir após a raiz inteira. Falhar aqui aponta o apply (e
    // não as provas) como o lado quebrado.
    for (const objeto of [
      "public.store_config",
      "public.marketplace_orders",
      "public.coupons",
      "public.frota_lojas",
    ]) {
      const existe = await cliente.query("SELECT to_regclass($1) AS reg", [objeto]);
      if (!existe.rows[0].reg) {
        falhar("FALHOU", `Objeto ${objeto} NÃO existe após aplicar a raiz inteira.`);
      }
    }
    console.log("[aplicar] sentinela de objetos pós-apply: OK");
  } finally {
    await cliente.end().catch(() => {});
  }

  const resumo = `${aplicados.length}/${arquivos.length} migrations aplicadas do zero sem erro.`;
  console.log(`[aplicar] ${resumo}`);
  if (avisos.length) {
    console.log(`[aplicar] avisos de emulação:\n  - ${avisos.join("\n  - ")}`);
  }
  anexarAoSummary(
    "Migrations aplicadas no efêmero (1ª passada)",
    `**${resumo}**` +
      (avisos.length
        ? `\n\n<details><summary>Emulações (${avisos.length})</summary>\n\n\`\`\`\n${avisos.join("\n")}\n\`\`\`\n\n</details>`
        : ""),
  );
}

main();
