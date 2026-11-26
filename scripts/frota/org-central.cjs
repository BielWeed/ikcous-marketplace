#!/usr/bin/env node
/**
 * A ORGANIZAÇÃO CENTRAL DO SUPABASE como DADO (scripts/frota/org-central.json) e
 * o único código que a lê. Modelo de 01/12/2026: a IKCOUS é dona de todos os
 * bancos das lojas assinantes numa org Pro só ("IKCOUS Lojas"), e a lojista
 * nunca tem conta técnica.
 *
 * É um contrato de CREDENCIAL, lido por três lados:
 *  - o nova-loja guarda no cofre local UMA autorização OAuth da org, sob
 *    `chaveDoCofre` (antes era uma por loja);
 *  - o cadastro da loja nova grava `segredoDoGitHub` como o `segredoDoToken`
 *    dela no lojas.json;
 *  - o lojas.cjs só aceita um segredo REPETIDO entre lojas assinantes se for
 *    `segredoDoGitHub` (qualquer outro continua "um segredo por loja"), e o
 *    gerador de workflows o entrega a toda loja da org — por isso ele nunca é
 *    o legado nem o segredo PRÓPRIO de uma loja (SEGREDOS_PROPRIOS).
 *
 * Por isso a validação falha FECHADA: um arquivo torto LANÇA, nunca vira
 * "org nenhuma" nem "aceita qualquer segredo". Os formatos de `chaveDoCofre` e
 * `segredoDoGitHub` são os MESMOS regex do lojas.cjs (importados, não copiados).
 *
 * O QUE ESTE ARQUIVO NÃO FAZ: guardar ou ler valor de segredo. Aqui só mora o
 * NOME do segredo do GitHub e a chave do cofre; o token nunca passa por aqui.
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  RE_PROJETO,
  RE_SEGREDO,
  SEGREDO_LEGADO,
  textoSeguro,
} = require("./lojas.cjs");

const CAMINHO_ORG_CENTRAL = path.join(__dirname, "org-central.json");

/** O slug que a API de gestão do Supabase dá a uma organização. */
const RE_SLUG_DA_ORG = /^[a-z]{20}$/;
/** Como a org aparece no painel: texto curto, sem quebra de linha. */
const RE_NOME_DA_ORG = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
/**
 * Os segredos PRÓPRIOS das lojas (o `segredoDoToken` de quem não está na org),
 * que o segredo da org NUNCA pode ser. Hoje são os da IKCOUS e da Savy, tokens
 * de acesso TOTAL à conta do dono: se o nome da org virasse um deles, o lojas.cjs
 * aceitaria esse nome repetido e o gerador o entregaria a toda loja da org. Só
 * pelo dado não dá para separar "a loja entrou na org" de "o nome da org virou o
 * da loja", por isso a lista é FECHADA; tests/frota_org_central_test.ts reprova
 * se uma loja do lojas.json tiver segredo próprio fora dela. Loja nova nasce no
 * segredo da org, então a lista não cresce com a frota.
 */
const SEGREDOS_PROPRIOS = Object.freeze([
  "SUPABASE_ACCESS_TOKEN_IKCOUS",
  "SUPABASE_ACCESS_TOKEN_SAVY",
]);
const CAMPOS = Object.freeze([
  "_comentario",
  "slug",
  "nome",
  "chaveDoCofre",
  "segredoDoGitHub",
]);

function erroDaOrg(msg) {
  return new Error(`org-central.json inválido: ${msg}`);
}

/**
 * Valida o conteúdo e devolve a versão congelada (sem `_comentario`). Qualquer
 * desvio LANÇA. `slug` é obrigatório: `null` diz "a org ainda não foi criada",
 * e ausente não é o mesmo que `null`. Com `slugsDasLojas` (os nomes do
 * lojas.json), recusa a `chaveDoCofre` que seja o nome de uma loja: o cofre
 * local guarda a autorização da org sob ela e a de cada loja sob o nome da
 * loja, e uma loja com esse nome leria e gravaria a autorização da ORG.
 */
function validarOrgCentral(bruto, { slugsDasLojas } = {}) {
  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto))
    throw erroDaOrg("a raiz precisa ser um objeto");
  // `Object.keys` vê `__proto__` vindo de JSON.parse (é propriedade própria).
  for (const campo of Object.keys(bruto)) {
    if (!CAMPOS.includes(campo))
      throw erroDaOrg(`campo desconhecido ${textoSeguro(campo)}`);
  }
  if (
    Object.hasOwn(bruto, "_comentario") &&
    typeof bruto._comentario !== "string"
  )
    throw erroDaOrg("_comentario precisa ser texto");
  if (
    !Object.hasOwn(bruto, "slug") ||
    (bruto.slug !== null &&
      (typeof bruto.slug !== "string" || !RE_SLUG_DA_ORG.test(bruto.slug)))
  )
    throw erroDaOrg(`slug precisa ser null ou casar ${RE_SLUG_DA_ORG}`);
  if (typeof bruto.nome !== "string" || !RE_NOME_DA_ORG.test(bruto.nome))
    throw erroDaOrg(`nome ausente ou fora do formato (${RE_NOME_DA_ORG})`);
  if (
    typeof bruto.chaveDoCofre !== "string" ||
    !RE_PROJETO.test(bruto.chaveDoCofre)
  )
    throw erroDaOrg(`chaveDoCofre precisa casar ${RE_PROJETO}`);
  if (
    typeof bruto.segredoDoGitHub !== "string" ||
    !RE_SEGREDO.test(bruto.segredoDoGitHub)
  )
    throw erroDaOrg(`segredoDoGitHub precisa casar ${RE_SEGREDO}`);
  if (bruto.segredoDoGitHub === SEGREDO_LEGADO)
    throw erroDaOrg(
      `segredoDoGitHub nunca é o segredo legado ${SEGREDO_LEGADO} (o dos alvos de teste antigos)`,
    );
  if (
    Array.isArray(slugsDasLojas) &&
    slugsDasLojas.includes(bruto.chaveDoCofre)
  )
    throw erroDaOrg(
      `chaveDoCofre ${bruto.chaveDoCofre} é o nome de uma loja do lojas.json: a loja leria e gravaria a autorização da org inteira`,
    );
  if (SEGREDOS_PROPRIOS.includes(bruto.segredoDoGitHub))
    throw erroDaOrg(
      `segredoDoGitHub nunca é o segredo próprio de uma loja (${bruto.segredoDoGitHub}): o da org é entregue a toda loja da org`,
    );
  return Object.freeze({
    slug: bruto.slug,
    nome: bruto.nome,
    chaveDoCofre: bruto.chaveDoCofre,
    segredoDoGitHub: bruto.segredoDoGitHub,
  });
}

/**
 * Os NOMES das lojas do lojas.json ao lado do org-central.json. Lê o JSON cru,
 * sem `validarCadastro`: o lojas.cjs chama este arquivo de dentro da validação
 * dele, e validar aqui seria uma volta sem fim. Ausente ou torto LANÇA.
 */
function slugsDoLojasJson(caminhoLojas) {
  let bruto;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- o lojas.json ao lado do org-central.json (diretório fixo deste repositório; só teste passa outro).
    bruto = JSON.parse(fs.readFileSync(caminhoLojas, "utf8"));
  } catch {
    throw erroDaOrg(
      "não deu para ler o lojas.json ao lado (ausente ou não é JSON)",
    );
  }
  const lojas = bruto?.lojas;
  if (lojas === null || typeof lojas !== "object" || Array.isArray(lojas))
    throw erroDaOrg("o lojas.json ao lado não tem o objeto `lojas`");
  return Object.keys(lojas);
}

function carregarOrgCentral(caminho = CAMINHO_ORG_CENTRAL) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- o padrão é a constante CAMINHO_ORG_CENTRAL; só teste passa outro caminho local.
  const texto = fs.readFileSync(caminho, "utf8");
  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw erroDaOrg("não é JSON");
  }
  return validarOrgCentral(bruto, {
    slugsDasLojas: slugsDoLojasJson(
      path.join(path.dirname(caminho), "lojas.json"),
    ),
  });
}

module.exports = {
  CAMINHO_ORG_CENTRAL,
  RE_SLUG_DA_ORG,
  SEGREDOS_PROPRIOS,
  validarOrgCentral,
  carregarOrgCentral,
};
