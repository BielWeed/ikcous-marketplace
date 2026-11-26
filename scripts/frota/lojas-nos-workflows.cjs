#!/usr/bin/env node
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename -- as chaves de BLOCOS vêm do texto do marcador e passam por `Object.hasOwn` antes do acesso; os caminhos são os workflows de .github/workflows (diretório fixo deste repositório), nunca entrada externa. */
/**
 * Regrava, nos workflows por loja, SÓ os blocos marcados com LOJAS-SEGREDO* e
 * LOJAS-OPCOES*, a partir de scripts/frota/lojas.json. Loja assinante nova = uma entrada no JSON +
 * `node scripts/frota/lojas-nos-workflows.cjs --escrever`; nenhuma edição à mão.
 *
 * POR QUE GERAR, e não ler o nome do segredo em tempo de execução
 * (`secrets[format('SUPABASE_ACCESS_TOKEN_{0}', ...)]`): a documentação do
 * contexto `secrets` do GitHub Actions não diz como o runner recebe os segredos, e
 * a regra de CodeQL `actions-excessive-secrets-exposure` (GitHub Security Lab)
 * afirma que, quando o nome é dinâmico, "the workflow will need to receive all
 * secrets to decide at runtime which one needs to be used" — isto é, o job
 * recebe TODOS os segredos do repositório (Vercel, Google, Mercado Pago, todos os
 * tokens de loja…), não só o da loja pedida. A regra da casa é a oposta: cada
 * passo alcança só o token da loja pedida. Por isso o nome fica ESCRITO POR EXTENSO
 * no YAML, com a guarda `inputs.projeto == '<loja>' && secrets.<NOME> || ''` ao
 * lado, e o YAML é gerado do cadastro (a mão não escreve nem esquece nenhum).
 * tests/frota_lojas_test.ts falha se o YAML sair de sincronia com o JSON, e
 * proíbe `secrets[`, `toJSON(secrets)` e `secrets: inherit` em qualquer workflow.
 *
 * Blocos (o recuo da linha do marcador é o recuo das linhas geradas):
 *   LOJAS-SEGREDOS-INICIO/FIM       uma linha de env por loja assinante:
 *                                   NOME: ${{ inputs.projeto == 'x' && secrets.NOME || '' }}
 *   LOJAS-SEGREDO-LEGADO-INICIO/FIM uma linha, o segredo legado, só para os alvos
 *                                   legado (loja, sandbox) — forma positiva: um
 *                                   projeto fora do cadastro nunca o recebe
 *   LOJAS-SEGREDO-UNICO-INICIO/FIM  uma linha SUPABASE_ACCESS_TOKEN com a cadeia
 *                                   `a && s1 || b && s2 || ''` (publicar-functions)
 *   LOJAS-OPCOES-INICIO/FIM         as `options:` do input `projeto` (choice):
 *                                   todas as lojas, na ordem do cadastro
 *   LOJAS-OPCOES-ASSINANTES-INICIO/FIM          só as assinantes
 *   LOJAS-OPCOES-ASSINANTES-PRIMEIRO-INICIO/FIM assinantes, depois as legado
 *
 * POR QUE O MENU CONTINUA `choice` (e não texto livre): o GitHub recusa no
 * disparo um valor fora de `options` ("Provided value ... not in the list of
 * allowed values"), antes de existir runner — a trava que a rodada 2 da revisão
 * pôs no lugar do `projeto_ref` livre. A lista não pode vir do JSON em tempo de
 * execução (o GitHub não lê arquivo para montar o formulário), então ela é
 * GERADA daqui, como as linhas de segredo; o passo "Confere a loja no cadastro"
 * dos workflows continua como 2ª trava.
 *
 * Uso: node scripts/frota/lojas-nos-workflows.cjs [--conferir|--escrever]
 * `--conferir` (padrão) sai 1 se algum workflow estiver fora de sincronia.
 */
const fs = require("node:fs");
const path = require("node:path");
const { carregarLojas, assinantes, legados } = require("./lojas.cjs");

const DIR_WORKFLOWS = path.resolve(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
);

const BLOCOS = Object.freeze({
  "LOJAS-SEGREDOS": (cad) =>
    assinantes(cad).map(
      (l) =>
        `${l.segredoDoToken}: \${{ inputs.projeto == '${l.projeto}' && secrets.${l.segredoDoToken} || '' }}`,
    ),
  "LOJAS-SEGREDO-LEGADO": (cad) => {
    const ls = legados(cad);
    if (ls.length === 0) return [];
    // Todos os legados dividem UM segredo (o validador garante).
    const nome = ls[0].segredoDoToken;
    const cond = ls.map((l) => `inputs.projeto == '${l.projeto}'`).join(" || ");
    return [`${nome}: \${{ (${cond}) && secrets.${nome} || '' }}`];
  },
  "LOJAS-SEGREDO-UNICO": (cad) => {
    const cadeia = assinantes(cad)
      .map(
        (l) =>
          `inputs.projeto == '${l.projeto}' && secrets.${l.segredoDoToken}`,
      )
      .join(" || ");
    return [`SUPABASE_ACCESS_TOKEN: \${{ ${cadeia} || '' }}`];
  },
  // As opções do menu `projeto` (`type: choice`). O GitHub recusa no disparo
  // (antes de qualquer runner) um valor fora de `options` — é a 1ª trava, a
  // mesma de antes do cadastro; o passo "Confere a loja no cadastro" é a 2ª.
  "LOJAS-OPCOES": (cad) =>
    Object.values(cad.lojas).map((l) => `- ${l.projeto}`),
  "LOJAS-OPCOES-ASSINANTES": (cad) =>
    assinantes(cad).map((l) => `- ${l.projeto}`),
  // publicar-functions: as lojas no ar primeiro (o padrão é a mais travada).
  "LOJAS-OPCOES-ASSINANTES-PRIMEIRO": (cad) =>
    [...assinantes(cad), ...legados(cad)].map((l) => `- ${l.projeto}`),
});

const RE_MARCADOR_INICIO = /^(\s*)# (LOJAS-(?:SEGREDO|OPCOES)[A-Z-]*)-INICIO\b/;

/** Reescreve todos os blocos marcados de UM texto de workflow. */
function sincronizar(texto, cadastro) {
  const fimDeLinha = texto.includes("\r\n") ? "\r\n" : "\n";
  const linhas = texto.split(/\r?\n/);
  const saida = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const m = linha.match(RE_MARCADOR_INICIO);
    saida.push(linha);
    if (!m) continue;
    const [, recuo, nome] = m;
    if (!Object.hasOwn(BLOCOS, nome))
      throw new Error(`bloco desconhecido: ${nome}`);
    const fim = linhas.findIndex(
      (l, j) => j > i && l.trim() === `# ${nome}-FIM`,
    );
    if (fim < 0) throw new Error(`falta o marcador ${nome}-FIM`);
    for (const nova of BLOCOS[nome](cadastro)) saida.push(`${recuo}${nova}`);
    i = fim - 1; // a próxima volta empilha o marcador FIM
  }
  return saida.join(fimDeLinha);
}

function workflowsComBlocos(dir = DIR_WORKFLOWS) {
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".yml"))
    .map((n) => path.join(dir, n))
    .filter((p) =>
      /# LOJAS-(?:SEGREDO|OPCOES)/.test(fs.readFileSync(p, "utf8")),
    );
}

function main(argv) {
  const escrever = argv.includes("--escrever");
  const cadastro = carregarLojas();
  let fora = 0;
  for (const arq of workflowsComBlocos()) {
    const atual = fs.readFileSync(arq, "utf8");
    const novo = sincronizar(atual, cadastro);
    if (novo === atual) continue;
    if (escrever) {
      fs.writeFileSync(arq, novo);
      console.log(`regravado: ${path.basename(arq)}`);
    } else {
      fora++;
      console.error(`fora de sincronia com lojas.json: ${path.basename(arq)}`);
    }
  }
  if (fora > 0) {
    console.error(
      "rode: node scripts/frota/lojas-nos-workflows.cjs --escrever",
    );
    return 1;
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { BLOCOS, sincronizar, workflowsComBlocos, DIR_WORKFLOWS };
