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
 *     Supabase ausentes no image oficial do postgres): NATIVO primeiro; se o
 *     erro é exatamente o de provisionamento, o arquivo é REAPLICADO com as
 *     linhas `CREATE EXTENSION IF NOT EXISTS pg_cron|pg_net;` comentadas
 *     (o schema `cron` é stub do provisionar-efemero.cjs) e contado como
 *     "aplicado com emulação" — o corpo das funções que ele redefine entra
 *     no banco, como em toda loja (PR 766: a 20260901 pulada deixava
 *     `confirmar_pagamento` no corpo da 20260810). Só PULA se a reaplicação
 *     ainda esbarrar em erro de provisionamento; erro de SQL real, em
 *     qualquer das tentativas, continua FALHOU (mesma lista do util.cjs);
 *   • contenção: o banco É o descartável (service do job) — não há CREATE/
 *     DROP DATABASE aqui.
 *
 * DIFERENÇA DELIBERADA em relação ao db-apply.cjs: não registra ledger
 * (supabase_migrations.schema_migrations) e não gera rollback — este banco
 * morre no fim do job; a prova é o resultado, não o estado.
 *
 * SAÍDA: 0 = raiz inteira aplicou (emulados e pulados por provisionamento
 * contados no resumo); 1 = erro de SQL real (o arquivo e o código de erro saem no log);
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
  aplicarComProvisionamento,
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
  const emulados = [];
  const pulados = [];
  let falha = null;
  try {
    for (const arquivo of arquivos) {
      const nome = path.basename(arquivo);
      const texto = fs.readFileSync(arquivo, "utf8");
      const r = await aplicarComProvisionamento(cliente, nome, texto);
      if (r.estado === "nativo") {
        aplicados += 1;
      } else if (r.estado === "emulado") {
        aplicados += 1;
        emulados.push(`${nome} → ${r.avisos.join("; ")}`);
        console.log(
          `[${ROTULO}/1ª] aplicado com emulação: ${nome} (${r.avisos.join("; ")})`,
        );
      } else if (r.estado === "pulado") {
        pulados.push(`${nome} → ${r.erro.message}`);
      } else {
        falha = {
          nome,
          codigo: r.erro.code || "(sem código)",
          mensagem: r.erro.message,
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
    emulados.length
      ? ` · ${emulados.length} deles com pg_cron/pg_net emulado (corpo aplicado de verdade, agendamento não)`
      : ""
  }${
    pulados.length
      ? ` · ${pulados.length} pulados por provisionamento (ver aviso)`
      : ""
  }.`;
  anexarAoSummaryDoJob(
    "CI Banco — 1ª passada (aplica do zero)",
    `${resumo}${
      emulados.length
        ? `\n\n<details><summary>Aplicados com pg_cron/pg_net emulado</summary>\n\n\`\`\`\n${emulados.join("\n")}\n\`\`\`\n\n</details>`
        : ""
    }${
      pulados.length
        ? `\n\n<details><summary>Pulados por provisionamento</summary>\n\n\`\`\`\n${pulados.join("\n")}\n\`\`\`\n\n</details>`
        : ""
    }`,
  );
  sair(
    "OK",
    `A raiz inteira aplicou num banco zerado (${aplicados} aplicados, ${emulados.length} deles com pg_cron/pg_net emulado, ${pulados.length} pulados por provisionamento).`,
  );
}

main().catch((erro) =>
  sair("INDETERMINADO", erro?.stack ? erro.stack : String(erro)),
);
