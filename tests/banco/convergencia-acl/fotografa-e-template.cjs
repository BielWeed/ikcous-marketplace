"use strict";

/**
 * PASSO 3 — tira a FOTOGRAFIA do privilégio efetivo ("antes") do banco no
 * estado de produção e congela esse estado num TEMPLATE (`acl_antes`).
 *
 * A fotografia é a lista ordenada de (função × grantee), (relação × papel ×
 * privilégios) e (coluna × papel × privilégio), lida do catálogo — inclui o
 * PUBLIC (aclexplode com grantee 0) e o dono. Ela é a verdade de comparação do
 * ROLLBACK: depois de convergir e desfazer, a fotografia tem de voltar IDÊNTICA.
 *
 * O template serve a dois testes: o CONTROLE (o mesmo teste de bloqueio, rodado
 * no estado de antes, tem de PASSAR sem 42501 — prova que o teste distingue os
 * estados) e o ROLLBACK (clone do antes → convergência → rollback).
 *
 * USO: node tests/banco/convergencia-acl/fotografa-e-template.cjs
 */

const {
  BANCO_ANTES,
  clonarBanco,
  conectar,
  criarRelator,
  diferencas,
  falhar,
  fotografar,
  gravarFotografia,
  imprimirLista,
  nomeDoBancoBase,
  resumir,
} = require("./comum.cjs");

const GRUPO = "FOTOGRAFIA_ANTES";

async function fotografiaDe(banco) {
  const cliente = await conectar(banco);
  try {
    return await fotografar(cliente);
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function main() {
  const relator = criarRelator();

  const antes = await fotografiaDe(undefined);
  gravarFotografia("antes", antes);
  const por = (prefixo) =>
    antes.filter((l) => l.startsWith(`${prefixo}|`)).length;
  console.log(
    `[${GRUPO}] ${antes.length} linhas: FN=${por("FN")} FN_EFETIVO=${por("FN_EFETIVO")} REL=${por("REL")} REL_EFETIVO=${por("REL_EFETIVO")} COL=${por("COL")}`,
  );
  // Fotografia vazia seria prova vazia: tem de ter o que se espera ver.
  if (
    por("FN_EFETIVO") !== 160 ||
    por("REL_EFETIVO") !== 55 * 3 ||
    por("COL") === 0
  ) {
    relator.falha(GRUPO, "fotografia_tem_conteudo", {
      code: "ASSERT",
      message: `fotografia incompleta: FN_EFETIVO=${por("FN_EFETIVO")} (160), REL_EFETIVO=${por("REL_EFETIVO")} (165), COL=${por("COL")} (>0)`,
    });
  } else {
    relator.ok(
      GRUPO,
      "fotografia_tem_conteudo",
      `${antes.length} linhas gravadas`,
    );
  }

  // Nenhuma conexão aberta no molde enquanto ele é clonado (já fechada acima).
  await clonarBanco(nomeDoBancoBase(), BANCO_ANTES);

  // O template é fiel? (um clone que não reproduz o molde invalidaria o
  // CONTROLE e o ROLLBACK sem ninguém ver.)
  const doTemplate = await fotografiaDe(BANCO_ANTES);
  const { soNoA, soNoB } = diferencas(antes, doTemplate);
  imprimirLista("só na fotografia do banco base", soNoA);
  imprimirLista("só na fotografia do template", soNoB);
  if (soNoA.length || soNoB.length) {
    relator.falha(GRUPO, "template_fiel_ao_antes", {
      code: "ASSERT",
      message: `o template ${BANCO_ANTES} difere do banco de onde saiu (${soNoA.length + soNoB.length} linhas)`,
    });
  } else {
    relator.ok(GRUPO, "template_fiel_ao_antes", `${BANCO_ANTES} == antes`);
  }

  resumir(
    "Convergência de permissões — fotografia do antes",
    relator.resultado,
  );
  if (relator.resultado.falhas > 0) {
    falhar("FALHOU", "fotografia do antes ou template inválidos — veja acima.");
  }
}

main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));
