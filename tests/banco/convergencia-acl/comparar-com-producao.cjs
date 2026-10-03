"use strict";

/**
 * PASSO 1 — o banco que nasceu das migrations tem os MESMOS objetos que a
 * produção medida em 01/10/2026?
 *
 * Sem esta checagem, o resto do teste prova a convergência num banco que não
 * é o da loja: função que só existe lá escaparia do pacote, função que só
 * existe aqui entraria na conta sem existir na produção.
 *
 *   - FUNÇÕES de `public`: nomes (com a lista de tipos) contra
 *     fixtures/convergencia-acl/principal-acl.txt;
 *   - RELAÇÕES de `public` (tabelas e views): nomes contra
 *     fixtures/convergencia-acl/savy-tab-priv.txt.
 *
 * Qualquer diferença FALHA o job, listando NOME POR NOME de que lado está.
 * (SECURITY DEFINER é só aviso: a fonte é a medição da Savy, não a da
 * principal, e o código é o mesmo.)
 *
 * USO: node tests/banco/convergencia-acl/comparar-com-producao.cjs
 */

const {
  conectar,
  criarRelator,
  diferencas,
  falhar,
  imprimirLista,
  lerPrincipalAcl,
  lerSavyAcl,
  lerSavyTabPriv,
  medirFuncoes,
  resumir,
} = require("./comum.cjs");

const GRUPO = "COMPARACAO";

async function main() {
  const relator = criarRelator();
  const principal = lerPrincipalAcl();
  const savy = lerSavyAcl();
  const relacoesSavy = lerSavyTabPriv();

  // 0. As próprias fixtures concordam entre si? (principal e Savy têm o mesmo
  //    conjunto de 160 funções; senão o resto do teste compara maçã com pera.)
  try {
    const nomesPrincipal = principal.map((item) => item.fn);
    const nomesSavy = savy.map((linha) => linha.fn);
    const { soNoA, soNoB } = diferencas(nomesPrincipal, nomesSavy);
    imprimirLista("só no principal-acl.txt", soNoA);
    imprimirLista("só no savy-acl.json", soNoB);
    if (soNoA.length || soNoB.length || nomesPrincipal.length !== 160) {
      throw new Error(
        `fixtures divergentes (principal=${nomesPrincipal.length}, savy=${nomesSavy.length}, esperado 160 e conjuntos iguais)`,
      );
    }
    relator.ok(GRUPO, "fixtures_concordam", "160 funções nos dois arquivos");
    if (relacoesSavy.size !== 55) {
      throw new Error(
        `savy-tab-priv.txt tem ${relacoesSavy.size} relações (esperado 55)`,
      );
    }
    relator.ok(
      GRUPO,
      "fixtures_55_relacoes",
      "55 relações em savy-tab-priv.txt",
    );
  } catch (erro) {
    relator.falha(GRUPO, "fixtures", erro);
  }

  const cliente = await conectar();
  let funcoes;
  let relacoes;
  try {
    funcoes = await medirFuncoes(cliente);
    relacoes = (
      await cliente.query(`
        SELECT c.relname
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
      `)
    ).rows.map((linha) => linha.relname);
  } finally {
    await cliente.end().catch(() => {});
  }

  // 1. Funções.
  try {
    const nomesBanco = funcoes.map((linha) => linha.fn);
    const { soNoA: faltam, soNoB: sobram } = diferencas(
      principal.map((item) => item.fn),
      nomesBanco,
    );
    imprimirLista("FALTAM no banco migrado (existem na produção)", faltam);
    imprimirLista("SOBRAM no banco migrado (não existem na produção)", sobram);
    if (faltam.length || sobram.length) {
      throw new Error(
        `funções: ${faltam.length} faltam e ${sobram.length} sobram contra a produção (banco migrado tem ${nomesBanco.length}, produção 160)`,
      );
    }
    relator.ok(
      GRUPO,
      "funcoes_iguais_a_producao",
      "160 de 160 pelo nome e tipos",
    );
  } catch (erro) {
    relator.falha(GRUPO, "funcoes_iguais_a_producao", erro);
  }

  // 2. Relações.
  try {
    const { soNoA: faltam, soNoB: sobram } = diferencas(
      [...relacoesSavy.keys()],
      relacoes,
    );
    imprimirLista("RELAÇÕES que FALTAM no banco migrado", faltam);
    imprimirLista("RELAÇÕES que SOBRAM no banco migrado", sobram);
    if (faltam.length || sobram.length) {
      throw new Error(
        `relações: ${faltam.length} faltam e ${sobram.length} sobram contra a produção (banco migrado tem ${relacoes.length}, produção 55)`,
      );
    }
    relator.ok(GRUPO, "relacoes_iguais_a_producao", "55 de 55 pelo nome");
  } catch (erro) {
    relator.falha(GRUPO, "relacoes_iguais_a_producao", erro);
  }

  // 3. Aviso (não falha): SECURITY DEFINER divergente da medição da Savy.
  const secdefProducao = new Map(savy.map((linha) => [linha.fn, linha.secdef]));
  const divergentes = funcoes
    .filter(
      (linha) =>
        secdefProducao.has(linha.fn) &&
        secdefProducao.get(linha.fn) !== linha.secdef,
    )
    .map(
      (linha) =>
        `${linha.fn}: Savy secdef=${secdefProducao.get(linha.fn)} · migrado secdef=${linha.secdef}`,
    );
  if (divergentes.length) {
    relator.aviso(
      GRUPO,
      "secdef_diverge_da_savy",
      `${divergentes.length} função(ões) com SECURITY DEFINER diferente da medição da Savy (informativo)`,
      divergentes,
    );
  }

  resumir(
    "Convergência de permissões — comparação migrado × produção",
    relator.resultado,
  );
  if (relator.resultado.falhas > 0) {
    falhar(
      "FALHOU",
      `${relator.resultado.falhas} comparação(ões) com diferença — o banco migrado NÃO é o da produção; veja as listas acima.`,
    );
  }
  console.log(
    `[${GRUPO}] banco migrado == produção (160 funções, 55 relações).`,
  );
}

main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));
