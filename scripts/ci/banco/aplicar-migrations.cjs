#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename --
 * Caminhos vêm de argumento de linha de comando ou são resolvidos contra o
 * projeto, mesma convenção de scripts/db-apply.cjs e db-prove-banco-zerado.cjs.
 * Nunca há entrada de rede nem payload de terceiro. */

/**
 * CI-BANCO, 1ª passada: aplica a RAIZ de supabase/migrations/ inteira, em
 * ordem de timestamp, num banco EFÊMERO do CI nascido limpo — a prova (a) da
 * frente ("a sequência inteira aplica sem erro num banco do zero").
 *
 * RECEITA (herdada, não reinventada) — scripts/db-prove-banco-zerado.cjs,
 * ADR 0003:
 *   • AUTOCOMMIT, arquivo a arquivo, pelo parser do SERVIDOR (simple query,
 *     que entende $$...$$ e divide corretamente);
 *   • search_path re-setado ANTES de cada arquivo (o pg_dump moderno deixa
 *     `search_path = ''` na sessão; o CLI real aplica em sessão limpa por
 *     migration — aqui cada arquivo é query nova, mas a re-setada é barata e
 *     idêntica à receita);
 *   • arquivos que só conseguem rodar com pg_cron/pg_net (extensões do
 *     Supabase ausentes no image oficial do postgres) são PULADOS COM AVISO
 *     quando o erro é exatamente o de provisionamento — erro qualquer outro
 *     continua FALHOU (mesma lista e ressalva do util.cjs);
 *   • contenção: o banco É o descartável (service do job) — não há CREATE/
 *     DROP DATABASE aqui.
 *
 * DIFERENÇA DELIBERADA em relação ao db-apply.cjs: não registra ledger
 * (supabase_migrations.schema_migrations) e não gera rollback — este banco
 * morre no fim do job; a prova é o resultado, não o estado.
 *
 * SAÍDA: 0 = raiz inteira aplicou (pulados por provisionamento contados no
 * resumo); 1 = erro de SQL real (o arquivo e o código de erro saem no log);
 * 2/5 = recusa de alvo/falha de ferramenta (ver util.cjs).
 *
 * USO: node scripts/ci/banco/aplicar-migrations.cjs <pasta-de-migrations>
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  ROTULO,
  sair,
  lerDatabaseUrlEfemero,
  listarMigrations,
  excecaoDeProvisionamento,
  anexarAoSummaryDoJob,
} = require("./util.cjs");

async function main() {
  const pasta = process.argv[2];
  if (!pasta || !fs.existsSync(pasta)) {
    sair(
      "INDETERMINADO",
      `Uso: node ${path.basename(process.argv[1])} <pasta-de-migrations>`,
    );
  }
  const url = lerDatabaseUrlEfemero();
  const arquivos = listarMigrations(pasta);
  if (!arquivos.length) {
    sair("INDETERMINADO", `Nenhum .sql na raiz de ${pasta}`);
  }
  console.log(
    `[${ROTULO}/1ª] arquivos na raiz (ordem de apply): ${arquivos.length}`,
  );

  const { Client } = require("pg");
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    sair("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }

  await cliente.query("RESET ALL");

  let aplicados = 0;
  const pulados = [];
  let falha = null;
  try {
    for (const arquivo of arquivos) {
      const nome = path.basename(arquivo);
      const texto = fs.readFileSync(arquivo, "utf8");
      try {
        await cliente.query('SET search_path = "$user", public, extensions');
        await cliente.query(texto);
        aplicados += 1;
      } catch (erro) {
        await cliente.query("ROLLBACK").catch(() => {});
        if (excecaoDeProvisionamento(nome, erro.message)) {
          pulados.push(`${nome} → ${erro.message}`);
          continue;
        }
        falha = {
          nome,
          codigo: erro.code || "(sem código)",
          mensagem: erro.message,
          aplicados,
        };
        break;
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }

  if (falha) {
    anexarAoSummaryDoJob(
      "CI Banco — 1ª passada (aplica do zero)",
      `**FALHOU em \`${falha.nome}\`** (após ${falha.aplicados} arquivos aplicados): \`${falha.codigo}\` — ${falha.mensagem.split("\n")[0].slice(0, 200)}\n\nA sequência inteira NÃO aplica num banco do zero. Isto é o defeito que esta frente existe para achar num PR.`,
    );
    sair(
      "FALHOU",
      [
        `arquivo:  ${falha.nome} (após ${falha.aplicados} aplicados com sucesso)`,
        `código:   ${falha.codigo}`,
        `mensagem: ${falha.mensagem}`,
        "",
        "A sequência inteira NÃO aplica num banco do zero. Isto é o defeito que esta frente existe para achar num PR — veja o arquivo e a dependência que faltou.",
      ].join("\n"),
    );
  }

  const resumo = `**${aplicados}/${arquivos.length} arquivos aplicados** do zero sem erro de SQL${
    pulados.length
      ? ` · ${pulados.length} pulados por provisionamento (pg_cron/pg_net, ver aviso)`
      : ""
  }.`;
  anexarAoSummaryDoJob(
    "CI Banco — 1ª passada (aplica do zero)",
    `${resumo}${
      pulados.length
        ? `\n\n<details><summary>Pulados por provisionamento</summary>\n\n\`\`\`\n${pulados.join("\n")}\n\`\`\`\n\n</details>`
        : ""
    }`,
  );
  sair(
    "OK",
    `A raiz inteira aplicou num banco zerado (${aplicados} aplicados, ${pulados.length} pulados por provisionamento).`,
  );
}

main().catch((erro) =>
  sair("INDETERMINADO", erro?.stack ? erro.stack : String(erro)),
);
