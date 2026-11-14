#!/usr/bin/env node
/**
 * instalar-chave-da-loja.cjs — instala, no banco de UMA loja real, o HASH da
 * chave de envio do app de gestão (14/11/2026). Roda dentro de
 * .github/workflows/instalar-chave-da-loja.yml.
 *
 * CONTEXTO: a migration 20261399998000 criou em cada loja a porta única do plano
 * (`assinatura_da_loja_gravar`, que o app de gestão chama com uma chave PRÓPRIA da
 * loja) e a função `assinatura_da_loja_definir_chave(p_hash, p_substituir)`, que
 * guarda só o SHA-256 (64 hex minúsculos) dessa chave em `assinatura_da_loja_chave`:
 * só service_role executa; sem p_substituir recusa com `chave_ja_definida` se já há
 * chave; com p_substituir = true troca (rotação). O app de gestão gera a chave
 * dentro dele e mostra só o HASH; este script leva o hash até a loja. A CHAVE em
 * texto puro nunca passa por aqui.
 *
 * O RISCO É PERMISSÃO + SEGREDO DE INFRAESTRUTURA: o token de gestão vale para a
 * conta inteira, e quem instala o hash decide qual chave abre a porta de escrita
 * do plano da loja. Por isso:
 *  - A ÚNICA ESCRITA é uma SQL fixa, montada só DEPOIS de provar o hash (64 hex
 *    minúsculos): select public.assinatura_da_loja_definir_chave('<hash>', <true|false>).
 *    Hash provado hex não tem aspas nem nada a escapar; o booleano sai de um
 *    literal. As outras duas consultas são leituras fixas que devolvem UM booleano.
 *  - PROJETO FECHADO em "ikcous-publicada" | "savy" (`ALVOS`, `Object.hasOwn`); o
 *    ref vem de `resolverRef` (o mesmo de conferir-banco.cjs), nunca de texto livre.
 *  - CADA ALVO ENXERGA SÓ O SEU SEGREDO (SUPABASE_ACCESS_TOKEN_IKCOUS para a CAF,
 *    SUPABASE_ACCESS_TOKEN_SAVY para a Savy). Sem ele, PARA; 401/403 também PARAM,
 *    sem tentar outro segredo nem outro alvo.
 *  - TUDO PELO ENDPOINT DE CONSULTA COMUM da Management API (POST
 *    /v1/projects/{ref}/database/query, que roda como dono do banco): a tabela da
 *    chave é selada (REVOKE ALL até do service_role), e o papel somente-leitura do
 *    endpoint dedicado não tem garantia de enxergá-la. A leitura de conferência é
 *    um SELECT fixo; a única escrita continua sendo a função.
 *  - O CORPO CRU E O TOKEN NUNCA VÃO PARA O LOG, nem em erro (só o status HTTP e o
 *    nome do tipo do erro de rede). O hash inteiro também não é impresso: o resumo
 *    mostra só os 8 primeiros caracteres.
 *
 * O QUE ACONTECE, EM ORDEM (nada é gravado antes do passo 3):
 *  1. valida projeto, hash, `substituir` e sha — antes de qualquer rede;
 *  2. LEITURA prévia: já existe chave nesta loja? (só para o veredito dizer a
 *     verdade sobre `substituiu`; quem recusa ou aceita é a função, no banco);
 *  3. ESCRITA: a função, numa única instrução (atômica por construção);
 *  4. CONFERÊNCIA por leitura: exatamente 1 linha na tabela e o hash guardado
 *     confere com o enviado (devolve só `bate`, um booleano).
 *
 * ESTADO INCERTO (rede caindo, timeout, 5xx na escrita): o servidor pode ter
 * gravado. Não há retry nem veredito; a mensagem manda reconciliar. Repetir com
 * substituir=true é seguro: é a mesma gravação (o hash fica igual; só `criada_em`
 * é renovada).
 *
 * VEREDITO: a última linha do run, `VEREDITO-INSTALAR-CHAVE projeto=<x> sha=<y>
 * definida=<true|false> substituiu=<true|false>`, só sai com o estado CONHECIDO:
 * definida=true quando a conferência bateu; definida=false quando o banco recusou
 * por `chave_ja_definida` (nada mudou). `substituiu` é verdadeiro só se havia chave
 * antes E o pedido foi de substituição.
 *
 * Testado por tests/ci_instalar_chave_da_loja_test.ts.
 */
const fs = require("node:fs");
const { resolverRef, extrairLinhas } = require("./conferir-banco.cjs");

const API_BASE = "https://api.supabase.com";
const TEMPO_LIMITE_MS = 60_000;

/** Os ÚNICOS dois alvos, cada um com o NOME do seu segredo e a mensagem de parada
 * (mesmo texto de conferir-banco.cjs). Nunca uma chave escolhida por quem chama
 * chega a um efeito sem passar por `Object.hasOwn` + `resolverRef`. */
const ALVOS = Object.freeze({
  "ikcous-publicada": Object.freeze({
    segredo: "SUPABASE_ACCESS_TOKEN_IKCOUS",
    semAcesso:
      "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto",
  }),
  savy: Object.freeze({
    segredo: "SUPABASE_ACCESS_TOKEN_SAVY",
    semAcesso:
      "sem acesso legítimo à Savy por SUPABASE_ACCESS_TOKEN_SAVY — bloqueio concreto",
  }),
});

const HASH_VALIDO = /^[0-9a-f]{64}$/;
const SHA_VALIDO = /^[0-9a-f]{40}$/i;

const MSG_JA_DEFINIDA =
  "já existe chave nesta loja: use substituir=true para rotacionar";
const ESTADO_INCERTO =
  "ESTADO DESCONHECIDO: o banco pode ter gravado ou não. Reconcilie por leitura antes de repetir (repetir com substituir=true é seguro: é a mesma gravação).";

/** Só letras, números, espaço e `.,_@&'()-`: nada que vire comando de workflow. */
function textoSeguro(valor, maximo = 80) {
  const limpo = String(valor)
    .replace(/[^\p{L}\p{N} .,_@&'()-]/gu, "?")
    .trim();
  return limpo.length > maximo ? `${limpo.slice(0, maximo)}…` : limpo;
}

/** Só o nome do erro, só se for um identificador — nunca a mensagem (que pode
 * carregar URL, cabeçalho ou pedaço do corpo). */
function nomeSeguro(erro) {
  const nome = erro && typeof erro.name === "string" ? erro.name : "";
  return /^[A-Za-z]{1,40}$/.test(nome) ? nome : "Error";
}

// As três SQLs. As de leitura são fixas; a de escrita e a de conferência só
// existem para um hash JÁ provado (a prova é repetida aqui, em profundidade).

const SQL_EXISTIA =
  "select exists (select 1 from public.assinatura_da_loja_chave) as existia";

function provarHash(hash) {
  if (typeof hash !== "string" || !HASH_VALIDO.test(hash)) {
    throw new Error("hash fora do formato (64 hex minúsculos)");
  }
  return hash;
}

function sqlDefinir(hash, substituir) {
  provarHash(hash);
  return `select public.assinatura_da_loja_definir_chave('${hash}', ${substituir ? "true" : "false"})`;
}

function sqlConferir(hash) {
  provarHash(hash);
  return `select coalesce(count(*) = 1 and bool_or(chave_hash = '${hash}'), false) as bate from public.assinatura_da_loja_chave`;
}

/** A linha única de uma leitura de UM booleano. Qualquer outra forma é falha. */
function lerBooleano(resposta, campo) {
  if (resposta.tipo !== "ok") return { ok: false, resposta };
  let linhas;
  try {
    linhas = extrairLinhas(resposta.corpo);
  } catch {
    return { ok: false, resposta: { tipo: "formato" } };
  }
  const linha = Array.isArray(linhas) && linhas.length === 1 ? linhas[0] : null;
  if (!linha || typeof linha !== "object" || Array.isArray(linha)) {
    return { ok: false, resposta: { tipo: "formato" } };
  }
  // eslint-disable-next-line security/detect-object-injection -- `campo` é um literal fixo deste arquivo ("existia" ou "bate"), nunca entrada externa.
  const valor = linha[campo];
  if (typeof valor !== "boolean") {
    return { ok: false, resposta: { tipo: "formato" } };
  }
  return { ok: true, valor };
}

/** O texto de falha de uma LEITURA (nada foi escrito por ela). */
function textoDaFalhaDeLeitura(alvo, passo, resposta) {
  switch (resposta.tipo) {
    case "acesso":
      return `FALHOU: ${alvo.semAcesso} (HTTP ${resposta.status})`;
    case "rede":
      return `FALHOU: ${passo}: a chamada à Management API não completou (${resposta.nome})`;
    case "http":
      return `FALHOU: ${passo}: a Management API respondeu HTTP ${resposta.status} (corpo não impresso)`;
    default:
      return `FALHOU: ${passo}: a resposta não tem a forma esperada (corpo não impresso)`;
  }
}

function veredito({ projeto, sha, definida, substituiu }) {
  return `VEREDITO-INSTALAR-CHAVE projeto=${projeto} sha=${sha} definida=${definida} substituiu=${substituiu}`;
}

/**
 * Faz a instalação. Devolve o código de saída (0 = instalada e conferida; 1 =
 * parou), sem chamar `process.exit` — o teste injeta `fetchImpl` e `saida`.
 * `substituir` chega como TEXTO ("true" | "false"), como o workflow o entrega.
 */
async function instalar({
  projeto,
  hash,
  substituir,
  sha,
  env,
  fetchImpl,
  saida,
}) {
  // eslint-disable-next-line security/detect-object-injection -- `Object.hasOwn` na mesma expressão: só as duas chaves de ALVOS passam.
  const alvo = Object.hasOwn(ALVOS, projeto) ? ALVOS[projeto] : null;
  if (!alvo) {
    saida.erro(
      `FALHOU: projeto desconhecido: "${textoSeguro(projeto, 40)}" (use ikcous-publicada ou savy)`,
    );
    return 1;
  }
  // O valor recusado NUNCA é ecoado: quem errou o campo pode ter colado a chave.
  if (typeof hash !== "string" || !HASH_VALIDO.test(hash)) {
    saida.erro(
      "FALHOU: hash inválido: precisa ter exatamente 64 caracteres hexadecimais minúsculos (0-9 e a-f)",
    );
    return 1;
  }
  if (substituir !== "true" && substituir !== "false") {
    saida.erro("FALHOU: substituir precisa ser true ou false");
    return 1;
  }
  if (typeof sha !== "string" || !SHA_VALIDO.test(sha)) {
    saida.erro("FALHOU: o sha do run (GITHUB_SHA, 40 hex) é obrigatório");
    return 1;
  }
  // SÓ o segredo do próprio alvo; sem ele PARA (nunca tenta o do vizinho).
  const token = env[alvo.segredo];
  if (!token) {
    saida.erro(alvo.semAcesso);
    return 1;
  }
  let ref;
  try {
    ref = resolverRef(projeto);
  } catch (erro) {
    saida.erro(`FALHOU: ${textoSeguro(erro.message, 120)}`);
    return 1;
  }
  const trocar = substituir === "true";
  const shaDoRun = sha.toLowerCase();

  /** Uma consulta ao banco da loja, devolvida já classificada. Nunca lança, e o
   * corpo só sai daqui dentro do objeto de resposta (para o chamador procurar o
   * código do erro), nunca para a saída. */
  const rodar = async (sql) => {
    let r;
    try {
      r = await fetchImpl(`${API_BASE}/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
        redirect: "error",
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
    } catch (erro) {
      return { tipo: "rede", nome: nomeSeguro(erro) };
    }
    const status = Number.isInteger(r.status) ? r.status : 0;
    if (status === 401 || status === 403) return { tipo: "acesso", status };
    let corpo = "";
    try {
      corpo = await r.text();
    } catch {
      return { tipo: "http", status, corpo: "" };
    }
    // Sucesso = 201 (o documentado) ou 200 (tolerado); corpo com erro não é sucesso.
    const aceito = status === 201 || status === 200;
    if (!aceito || corpo.includes('"error"') || corpo.includes('"message":"')) {
      return { tipo: "http", status, corpo };
    }
    return { tipo: "ok", corpo };
  };

  // 2. leitura prévia: só para o veredito dizer a verdade sobre `substituiu`
  const previa = lerBooleano(await rodar(SQL_EXISTIA), "existia");
  if (!previa.ok) {
    saida.erro(textoDaFalhaDeLeitura(alvo, "leitura prévia", previa.resposta));
    return 1;
  }

  // 3. a ÚNICA escrita: a função, numa instrução só
  const escrita = await rodar(sqlDefinir(hash, trocar));
  if (escrita.tipo === "acesso") {
    saida.erro(`FALHOU: ${alvo.semAcesso} (HTTP ${escrita.status})`);
    return 1;
  }
  if (escrita.tipo === "http" && escrita.corpo.includes("chave_ja_definida")) {
    if (trocar) {
      saida.erro(
        "FALHOU: o banco respondeu chave_ja_definida mesmo com substituir=true (inesperado); nada foi confirmado",
      );
      return 1;
    }
    saida.erro(`FALHOU: ${MSG_JA_DEFINIDA}`);
    saida.log(
      veredito({
        projeto,
        sha: shaDoRun,
        definida: false,
        substituiu: false,
      }),
    );
    return 1;
  }
  if (escrita.tipo !== "ok") {
    const motivo =
      escrita.tipo === "rede"
        ? `a chamada não completou (${escrita.nome})`
        : `a Management API respondeu HTTP ${escrita.status} (corpo não impresso)`;
    saida.erro(`FALHOU: a gravação do hash: ${motivo}. ${ESTADO_INCERTO}`);
    return 1;
  }

  // 4. conferência por leitura: 1 linha só e o hash guardado é o enviado
  const conferencia = lerBooleano(await rodar(sqlConferir(hash)), "bate");
  if (!conferencia.ok) {
    saida.erro(
      `${textoDaFalhaDeLeitura(alvo, "conferência por leitura", conferencia.resposta)} A gravação foi aceita, mas não foi possível confirmá-la. ${ESTADO_INCERTO}`,
    );
    return 1;
  }
  if (conferencia.valor !== true) {
    saida.erro(
      "FALHOU: a conferência por leitura não confirmou o hash (a tabela não tem exatamente 1 linha com o hash enviado). Alguém pode ter gravado outro hash ao mesmo tempo; reconcilie por leitura antes de repetir.",
    );
    return 1;
  }

  const resumoDoRun = [
    "### Chave da loja instalada",
    "",
    "| campo | valor |",
    "| --- | --- |",
    `| projeto | ${projeto} |`,
    `| sha | ${shaDoRun} |`,
    `| hash (8 primeiros) | ${hash.slice(0, 8)} |`,
    "| definida | true |",
    `| substituiu | ${trocar && previa.valor === true} |`,
    "",
  ].join("\n");
  saida.resumo(resumoDoRun);
  saida.log(
    veredito({
      projeto,
      sha: shaDoRun,
      definida: true,
      substituiu: trocar && previa.valor === true,
    }),
  );
  return 0;
}

/** A saída real: stdout/stderr do job e o resumo do run (GITHUB_STEP_SUMMARY). */
function saidaDoProcesso() {
  return {
    log: (linha) => console.log(linha),
    erro: (linha) => console.error(linha),
    resumo: (markdown) => {
      const destino = process.env.GITHUB_STEP_SUMMARY;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem do runner do GitHub Actions (GITHUB_STEP_SUMMARY), não de entrada de usuário.
      if (destino) fs.appendFileSync(destino, `${markdown}\n`);
    },
  };
}

async function main() {
  process.exitCode = await instalar({
    projeto: process.env.PROJETO,
    hash: process.env.HASH,
    substituir: process.env.SUBSTITUIR,
    sha: process.env.GITHUB_SHA,
    env: process.env,
    fetchImpl: globalThis.fetch,
    saida: saidaDoProcesso(),
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  ALVOS,
  API_BASE,
  instalar,
  main,
};
