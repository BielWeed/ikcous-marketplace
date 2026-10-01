"use strict";

/**
 * Aplica (ou desfaz) o PACOTE do job (PACOTE_ACL = seis | amplo) e prova, de
 * uma conexão NOVA, que a transação COMMITOU.
 *
 *   PACOTE_ACL=seis node tests/banco/convergencia-acl/aplica-sql.cjs aplicar
 *   PACOTE_ACL=seis node tests/banco/convergencia-acl/aplica-sql.cjs desfazer [banco]
 *
 * O arquivo traz o próprio BEGIN … COMMIT e as próprias conferências (que
 * levantam exceção). Se qualquer comando abortar, a transação inteira é
 * desfeita e este passo FALHA com a mensagem do Postgres; se rodar sem erro
 * mas o efeito não aparecer de uma conexão nova (COMMIT que não valeu), também
 * FALHA. A sentinela do COMMIT é o EXECUTE de anon numa função que o pacote
 * fecha (e o desfazer reabre).
 *
 * Mesma trava de sempre: só roda com CI_BANCO_EFEMERO=1 em localhost.
 */

const { aplicarSql, falhar, pacoteDoJob } = require("./comum.cjs");

async function main() {
  const [acao, banco] = process.argv.slice(2);
  if (acao !== "aplicar" && acao !== "desfazer") {
    falhar("USO", "node aplica-sql.cjs <aplicar|desfazer> [banco]");
  }
  const pacote = pacoteDoJob();
  const arquivo = acao === "aplicar" ? pacote.aplica : pacote.desfaz;
  await aplicarSql(banco, arquivo, pacote.sentinela, acao === "desfazer");
  console.log(
    `[APLICA] ${arquivo} COMMITOU em ${banco || "banco base"} (conferido de conexão nova).`,
  );
}

main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));
