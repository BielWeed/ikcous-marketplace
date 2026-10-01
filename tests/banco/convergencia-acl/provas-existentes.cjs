"use strict";

/**
 * Uma PROVA VIVA que já existe em tests/banco, rodada contra o banco DEPOIS do
 * pacote — com o estado de ANTES como controle.
 *
 * Por que o controle: o banco de produção reproduzido tem TODAS as tabelas
 * abertas para anon e authenticated (7 privilégios nas 55 relações), e algumas
 * provas vivas afirmam "permission denied" em tabela. Rodar só "depois" não
 * separaria o que o PACOTE quebrou do que já falha nesse estado. Então cada
 * prova roda duas vezes, cada uma num clone próprio (rodar-isolado.cjs):
 *   1. no `acl_antes` (controle);
 *   2. no banco com o pacote aplicado;
 * e o veredito é por DIFERENÇA (compararAntesDepois): passa depois -> OK;
 * passava antes e deixou de passar -> FALHA (regressão); falha igual nos dois
 * -> INFO (pré-existente, não é do pacote).
 *
 * USO: PACOTE_ACL=seis|amplo node tests/banco/convergencia-acl/provas-existentes.cjs <prova>
 *   <prova> = devolucoes-viva | cartao-online-viva | financeiro-viva |
 *             crm-inicio-viva | crm-todos-viva | cpf-da-janela-viva |
 *             invariantes-dinheiro
 */

const path = require("node:path");
const {
  compararAntesDepois,
  criarRelator,
  falhar,
  nomeDoBancoBase,
  pacoteDoJob,
  resumir,
  rodarNode,
} = require("./comum.cjs");

const PROVAS = [
  "devolucoes-viva",
  "cartao-online-viva",
  "financeiro-viva",
  "crm-inicio-viva",
  "crm-todos-viva",
  "cpf-da-janela-viva",
  "invariantes-dinheiro",
];

async function main() {
  const prova = process.argv[2];
  if (!PROVAS.includes(prova)) {
    falhar(
      "USO",
      `Prova desconhecida '${prova}'. Válidas: ${PROVAS.join(", ")}`,
    );
  }
  const pacote = pacoteDoJob();
  const relator = criarRelator();
  const bancoBase = path.join(__dirname, "..");
  const rodar = (banco) =>
    rodarNode(
      [
        path.join(bancoBase, "rodar-isolado.cjs"),
        path.join(bancoBase, `${prova}.cjs`),
      ],
      banco,
    );

  await compararAntesDepois(
    relator,
    "PROVA_EXISTENTE",
    prova,
    rodar,
    nomeDoBancoBase(),
  );

  resumir(`Permissões (${pacote.id}) — ${prova}`, relator.resultado);
  console.log(
    `\n${relator.resultado.ok} OK · ${relator.resultado.falhas} FALHA · ${relator.resultado.infos} INFO`,
  );
  if (relator.resultado.falhas > 0) process.exit(1);
}

main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));
