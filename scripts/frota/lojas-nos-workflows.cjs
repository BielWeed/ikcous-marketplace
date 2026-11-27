#!/usr/bin/env node
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename -- as chaves de BLOCOS vêm do texto do marcador e passam por `Object.hasOwn` antes do acesso; os caminhos são os workflows de .github/workflows (diretório fixo deste repositório), nunca entrada externa. */
/**
 * Regrava, nos workflows por loja, SÓ os blocos marcados com LOJAS-SEGREDO*,
 * LOJAS-OPCOES* e LOJAS-GRUPO-DO-BANCO, a partir de scripts/frota/lojas.json. Loja assinante nova = uma entrada no JSON +
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
 *                                   e UMA linha só para o segredo da org central
 *                                   (ver abaixo), se alguma loja o usa
 *   LOJAS-SEGREDO-LEGADO-INICIO/FIM uma linha, o segredo legado, só para os alvos
 *                                   legado (loja, sandbox) — forma positiva: um
 *                                   projeto fora do cadastro nunca o recebe
 *   LOJAS-SEGREDO-UNICO-INICIO/FIM  uma linha SUPABASE_ACCESS_TOKEN com a cadeia
 *                                   `a && s1 || b && s2 || ''` (publicar-functions);
 *                                   o segredo da org central entra como UM elo
 *   LOJAS-OPCOES-INICIO/FIM         as `options:` do input `projeto` (choice):
 *                                   todas as lojas, na ordem do cadastro
 *   LOJAS-OPCOES-ASSINANTES-INICIO/FIM          só as assinantes
 *   LOJAS-OPCOES-ASSINANTES-PRIMEIRO-INICIO/FIM assinantes, depois as legado
 *   LOJAS-GRUPO-DO-BANCO-INICIO/FIM uma linha `group:` do `concurrency` dos jobs
 *                                   que gravam no banco (apply e ledger):
 *                                   `banco-da-loja-<nome canônico do banco>`
 *
 * POR QUE O GRUPO É POR BANCO (26/11/2026): o apply e o ledger só não podem
 * rodar ao mesmo tempo NO MESMO BANCO. Um grupo único para a frota punha todas
 * as lojas numa fila só, e a fila com `queue: max` tem teto: "Up to 100 jobs or
 * workflow runs can be `pending`" e, cheia, os seguintes são CANCELADOS
 * (documentação do GitHub, workflow-syntax, chave `queue`) — com lojas × lotes
 * > 101 um lote some no meio da fila de uma loja e o seguinte entra fora de
 * ordem. `loja` e `ikcous-publicada` são o MESMO banco (a CAF) e caem no MESMO
 * grupo.
 *
 * POR QUE O MAPA GUARDA SÓ A EXCEÇÃO (C2 da frota de 300, 26/11/2026): até
 * aqui a expressão era `fromJSON('{"<loja>":"<ref>",…}')[inputs.projeto]`,
 * uma entrada por loja NUMA expressão só — ~66 caracteres por loja, ~19,9 mil
 * com 300 lojas, perto do teto que o GitHub aplica a uma expressão ("Exceeded
 * max expression length 21000"). Agora a chave é o NOME da loja (único, como o
 * ref), e o mapa só liga ao nome canônico do banco as lojas que DIVIDEM banco
 * com outra (`mapaDoGrupoDoBanco`): `fromJSON('{"loja":"ikcous-publicada"}')
 * [inputs.projeto] || inputs.projeto`. Loja nova de banco próprio deixa a
 * linha byte a byte igual. tests/frota_expressoes_test.ts reprova qualquer
 * expressão que volte a crescer com loja. Nome fora do cadastro cai no grupo
 * com o próprio nome, que nunca é o de um banco real (o menu e o 1º passo já o
 * recusam de qualquer forma).
 *
 * O SEGREDO DA ORG CENTRAL (scripts/frota/org-central.json, modelo de
 * 01/12/2026): toda loja assinante da org usa o MESMO segredo. A guarda
 * `(inputs.projeto == 'a' || … ) && secrets.X` cresceria ~40-64 caracteres por
 * loja e quebraria a C2 acima (8.000 entre ~125 e ~220 lojas). Por isso a
 * linha dele é UMA, de tamanho fixo, e a guarda é POSITIVA pelo cadastro:
 *   NOME: ${{ steps.loja.outputs.segredo == 'NOME' && secrets.NOME || '' }}
 * `steps.loja.outputs.segredo` é o NOME do segredo da loja escolhida, gravado
 * pelo passo `id: loja` (`lojas.cjs validar "$PROJETO" … --saida-do-passo`),
 * que roda ANTES, no mesmo job, e recusa loja fora do cadastro; na cadeia de
 * publicar-functions o passo é o `alvo`, que grava o mesmo `segredo=`. Uma loja
 * com segredo próprio, legado ou fora do cadastro nunca casa o nome da org.
 * Segredo repetido que NÃO é o da org falha fechado (seria chave repetida).
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
const { carregarOrgCentral } = require("./org-central.cjs");

const DIR_WORKFLOWS = path.resolve(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
);

/**
 * O mapa do grupo POR BANCO, guardando só a EXCEÇÃO: as lojas que dividem banco
 * com outra apontam para o nome CANÔNICO daquele banco (a loja assinante dele;
 * sem assinante, a primeira do cadastro). Loja que não divide banco fica fora
 * do mapa e usa o próprio nome, que já é único como o ref. Hoje o mapa é
 * `{"loja":"ikcous-publicada"}`, e loja nova de banco próprio não o muda.
 *
 * Falha fechada se a chave que a expressão calcula não for um-para-um com o
 * banco (dois bancos na mesma chave = dois applies juntos no mesmo grupo
 * errado; um banco em duas chaves = dois applies juntos no mesmo banco). Com o
 * cadastro validado isso não acontece (o nome da loja é a chave do JSON); a
 * guarda pega um cadastro montado à mão fora de `validarCadastro`.
 */
function mapaDoGrupoDoBanco(cad) {
  const lojas = Object.values(cad.lojas);
  const porRef = new Map();
  for (const l of lojas) {
    if (!porRef.has(l.ref)) porRef.set(l.ref, []);
    porRef.get(l.ref).push(l);
  }
  const mapa = {};
  for (const doBanco of porRef.values()) {
    const canonica = (
      doBanco.find((l) => l.classe === "assinante") ?? doBanco[0]
    ).projeto;
    for (const l of doBanco)
      if (l.projeto !== canonica) mapa[l.projeto] = canonica;
  }
  const bancoDaChave = new Map();
  const chaveDoBanco = new Map();
  for (const l of lojas) {
    const chave = Object.hasOwn(mapa, l.projeto) ? mapa[l.projeto] : l.projeto;
    if (
      (bancoDaChave.has(chave) && bancoDaChave.get(chave) !== l.ref) ||
      (chaveDoBanco.has(l.ref) && chaveDoBanco.get(l.ref) !== chave)
    )
      throw new Error(
        `grupo do banco ambíguo: a chave ${chave} não corresponde a um banco só`,
      );
    bancoDaChave.set(chave, l.ref);
    chaveDoBanco.set(l.ref, chave);
  }
  return mapa;
}

/**
 * As assinantes agrupadas pelo NOME do segredo, na ordem da 1ª loja de cada
 * nome. Só o segredo da org central pode ter mais de uma loja; outro nome
 * repetido LANÇA (o validador já o recusa; isto pega cadastro montado à mão).
 */
function segredosDasAssinantes(cad) {
  const segredoDaOrg = carregarOrgCentral().segredoDoGitHub;
  const grupos = new Map();
  for (const l of assinantes(cad)) {
    if (!grupos.has(l.segredoDoToken)) grupos.set(l.segredoDoToken, []);
    grupos.get(l.segredoDoToken).push(l);
  }
  return [...grupos].map(([nome, lojas]) => {
    if (lojas.length > 1 && nome !== segredoDaOrg)
      throw new Error(
        `segredo ${nome} repetido em ${lojas.map((l) => l.projeto).join(", ")} e não é o da org central (${segredoDaOrg})`,
      );
    return { nome, lojas, daOrg: nome === segredoDaOrg };
  });
}

/** A guarda de tamanho fixo do segredo da org: o nome que o passo `passo`
 * (o que validou a loja no cadastro) gravou é este? */
const guardaDaOrg = (passo, nome) =>
  `steps.${passo}.outputs.segredo == '${nome}'`;

const BLOCOS = Object.freeze({
  "LOJAS-SEGREDOS": (cad) =>
    segredosDasAssinantes(cad).map(({ nome, lojas, daOrg }) =>
      daOrg
        ? `${nome}: \${{ ${guardaDaOrg("loja", nome)} && secrets.${nome} || '' }}`
        : `${nome}: \${{ inputs.projeto == '${lojas[0].projeto}' && secrets.${nome} || '' }}`,
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
    const cadeia = segredosDasAssinantes(cad)
      .map(({ nome, lojas, daOrg }) =>
        daOrg
          ? `${guardaDaOrg("alvo", nome)} && secrets.${nome}`
          : `inputs.projeto == '${lojas[0].projeto}' && secrets.${nome}`,
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
  // O grupo de concorrência POR BANCO (ver o cabeçalho). Nomes já passaram
  // pelos regex do cadastro (sem aspas, sem `}`), então o JSON entra literal
  // na string da expressão; a checagem abaixo falha fechada se não.
  "LOJAS-GRUPO-DO-BANCO": (cad) => {
    const json = JSON.stringify(mapaDoGrupoDoBanco(cad));
    if (!/^[{}a-z0-9":,-]+$/.test(json))
      throw new Error("mapa do grupo do banco com caractere fora do cadastro");
    return [
      `group: banco-da-loja-\${{ fromJSON('${json}')[inputs.projeto] || inputs.projeto }}`,
    ];
  },
});

const RE_MARCADOR_INICIO =
  /^(\s*)# (LOJAS-(?:SEGREDO|OPCOES|GRUPO)[A-Z-]*)-INICIO\b/;

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
      /# LOJAS-(?:SEGREDO|OPCOES|GRUPO)/.test(fs.readFileSync(p, "utf8")),
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

module.exports = {
  BLOCOS,
  sincronizar,
  workflowsComBlocos,
  mapaDoGrupoDoBanco,
  DIR_WORKFLOWS,
};
