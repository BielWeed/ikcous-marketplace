#!/usr/bin/env node
/* eslint-disable security/detect-object-injection -- as chaves indexadas aqui passam antes por `Object.hasOwn` sobre o cadastro validado (lojaDoProjeto) ou vêm de listas fechadas deste arquivo; nenhuma chave escolhida por quem chama chega a um efeito sem essa checagem. */
/**
 * O CADASTRO DE LOJAS como DADO (scripts/frota/lojas.json) e o único código que o
 * lê. Antes, a lista de lojas (`ikcous-publicada`, `savy`, `loja`, `sandbox`), o
 * ref de cada uma e o NOME do segredo de cada uma estavam escritos à mão em 7
 * workflows e em 5 scripts; cada loja nova pedia ~16 edições. Agora:
 *
 *  - os scripts de scripts/publicacao tiram refs, alvos e nomes de segredo daqui
 *    (`refsPorProjeto`, `alvosDasAssinantes`);
 *  - nos workflows, o menu `projeto` (choice) é GERADO deste cadastro por
 *    scripts/frota/lojas-nos-workflows.cjs (o GitHub recusa no disparo um valor
 *    fora do menu) e, de novo, um passo antes de qualquer segredo roda
 *    `node scripts/frota/lojas.cjs validar "$PROJETO"` — recusa com "loja
 *    desconhecida" ANTES de qualquer segredo ser lido (só o último passo vê segredo);
 *  - o NOME do segredo de cada loja mora em `segredoDoToken`, validado por regex;
 *  - `acesso: "oauth"` (só assinante) marca a loja cujo token é renovado no
 *    cofre do PC do dono e gravado no GitHub só durante a sessão de publicação;
 *    sem o campo, `acesso` normaliza para "cli". O gerador de workflows não lê
 *    este campo (os YAML não mudam com ele).
 *
 * O QUE ESTE ARQUIVO NÃO FAZ (de propósito): imprimir o valor de nenhum segredo
 * (`exigir-segredo` só confere que o da loja pedida não está vazio), nem montar
 * nome de segredo a partir de texto de quem dispara o workflow. O token
 * continua chegando ao script por `env:` do passo final, escrito por extenso no
 * YAML (bloco gerado por scripts/frota/lojas-nos-workflows.cjs a partir deste
 * mesmo cadastro). Motivo medido na documentação: `secrets[format(...)]` (nome
 * montado em tempo de execução) obriga o GitHub a entregar TODOS os segredos do
 * repositório ao job — a própria regra de CodeQL `actions-excessive-secrets-
 * exposure` diz "the workflow will need to receive all secrets to decide at
 * runtime which one needs to be used". Com nomes por extenso só chegam ao job
 * os segredos que o arquivo cita, e a regra da casa ("cada alvo enxerga SÓ o
 * seu segredo") fica de pé.
 *
 * Uso (workflows): node scripts/frota/lojas.cjs validar <projeto> [--assinante]
 *                  node scripts/frota/lojas.cjs ref <projeto> [--functions]
 *                  node scripts/frota/lojas.cjs campo <projeto> <classe|segredoDoToken|functionsNomeadas>
 *                  node scripts/frota/lojas.cjs exigir-segredo <projeto>   (só confere que o token da loja chegou; nunca o imprime)
 * Saída de erro: uma linha `::error::`, com o texto de quem chamou SANEADO (só
 * [A-Za-z0-9._-], até 40 caracteres): uma quebra de linha no input não pode forjar
 * comando de workflow no log.
 */
const fs = require("node:fs");
const path = require("node:path");

const CAMINHO_LOJAS = path.join(__dirname, "lojas.json");

const RE_PROJETO = /^[a-z][a-z0-9-]{1,39}$/;
const RE_REF = /^[a-z]{20}$/;
/** O segredo legado (`loja`/`sandbox`) ou `SUPABASE_ACCESS_TOKEN_<SUFIXO>` com o
 * sufixo em maiúsculas/dígitos separados por `_` — nada que sirva de nome de outro
 * tipo de segredo (Vercel, Google, Mercado Pago…). */
// eslint-disable-next-line security/detect-unsafe-regex -- ancorada, um único grupo opcional com classe e teto fixos ({1,24}), sem repetição aninhada: tempo linear; só lê nomes do lojas.json versionado.
const RE_SEGREDO = /^SUPABASE_ACCESS_TOKEN(?:_[A-Z0-9_]{1,24})?$/;
const SEGREDO_LEGADO = "SUPABASE_ACCESS_TOKEN";
const CLASSES = Object.freeze(["assinante", "legado"]);
const CAMPOS_DE_LOJA = Object.freeze([
  "ref",
  "classe",
  "apelido",
  "segredoDoToken",
  "functionsNomeadas",
  "refDasFunctions",
  "acesso",
]);
/** De onde o portão lê a loja. Sem o campo no lojas.json, é "cli" (o login do
 * CLI do Supabase do dono, como sempre); "oauth" é a loja aberta pelo nova-loja,
 * cujo acesso mora no cofre do PC do dono e só vale dentro da sessão de
 * publicação. O único valor que se ESCREVE é "oauth": "cli" escrito à mão é
 * recusado, para o padrão nunca ter duas grafias. */
const ACESSO_OAUTH = "oauth";
const ACESSO_PADRAO = "cli";
const CAMPOS_LEGIVEIS_NO_CLI = Object.freeze([
  "classe",
  "segredoDoToken",
  "functionsNomeadas",
]);

/** Texto de fora (input do workflow) que vai para o log: só caracteres seguros. */
function textoSeguro(valor, max = 40) {
  const s = typeof valor === "string" ? valor : String(valor ?? "");
  const limpo = s.replace(/[^A-Za-z0-9._-]/g, "?").slice(0, max);
  return limpo === "" ? "(vazio)" : limpo;
}

/** "a, b ou c" — a lista de projetos que as mensagens de recusa mostram. */
function listaLegivel(nomes) {
  return nomes.length > 1
    ? `${nomes.slice(0, -1).join(", ")} ou ${nomes.at(-1)}`
    : nomes.join("");
}

function erroDoCadastro(msg) {
  return new Error(`lojas.json inválido: ${msg}`);
}

/**
 * Valida o conteúdo do cadastro e devolve a versão congelada. Qualquer desvio
 * LANÇA (falha fechada): um cadastro torto nunca vira "lista vazia" nem "aceita
 * tudo".
 */
function validarCadastro(bruto) {
  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto))
    throw erroDoCadastro("a raiz precisa ser um objeto");
  const lojasBrutas = bruto.lojas;
  if (
    lojasBrutas === null ||
    typeof lojasBrutas !== "object" ||
    Array.isArray(lojasBrutas)
  )
    throw erroDoCadastro("`lojas` precisa ser um objeto");
  const chaves = Object.keys(lojasBrutas);
  if (chaves.length === 0) throw erroDoCadastro("`lojas` está vazio");

  const lojas = {};
  const segredosVistos = new Map();
  const refsDeAssinantes = new Map();
  for (const projeto of chaves) {
    if (!RE_PROJETO.test(projeto))
      throw erroDoCadastro(
        `nome de loja fora do formato (${RE_PROJETO}): ${textoSeguro(projeto)}`,
      );
    const l = lojasBrutas[projeto];
    if (l === null || typeof l !== "object" || Array.isArray(l))
      throw erroDoCadastro(`${projeto}: precisa ser um objeto`);
    for (const campo of Object.keys(l)) {
      if (!CAMPOS_DE_LOJA.includes(campo))
        throw erroDoCadastro(`${projeto}: campo desconhecido ${campo}`);
    }
    if (typeof l.ref !== "string" || !RE_REF.test(l.ref))
      throw erroDoCadastro(`${projeto}: ref precisa casar ${RE_REF}`);
    if (!CLASSES.includes(l.classe))
      throw erroDoCadastro(
        `${projeto}: classe precisa ser ${CLASSES.join(" ou ")}`,
      );
    if (
      typeof l.apelido !== "string" ||
      !/^[A-Za-z][A-Za-z0-9 ._-]{0,29}$/.test(l.apelido)
    )
      throw erroDoCadastro(`${projeto}: apelido ausente ou fora do formato`);
    if (
      typeof l.segredoDoToken !== "string" ||
      !RE_SEGREDO.test(l.segredoDoToken)
    )
      throw erroDoCadastro(
        `${projeto}: segredoDoToken precisa casar ${RE_SEGREDO}`,
      );

    if (l.classe === "legado") {
      // Os alvos de teste antigos dividem o segredo legado; nenhuma loja nova
      // entra por aqui (ela nasce `assinante`, com segredo próprio).
      if (l.segredoDoToken !== SEGREDO_LEGADO)
        throw erroDoCadastro(
          `${projeto}: classe legado usa só o segredo ${SEGREDO_LEGADO}`,
        );
      if (Object.hasOwn(l, "functionsNomeadas"))
        throw erroDoCadastro(
          `${projeto}: functionsNomeadas só existe em assinante`,
        );
      if (Object.hasOwn(l, "acesso"))
        throw erroDoCadastro(`${projeto}: acesso só existe em assinante`);
    } else {
      if (l.segredoDoToken === SEGREDO_LEGADO)
        throw erroDoCadastro(
          `${projeto}: assinante precisa de segredo PRÓPRIO (SUPABASE_ACCESS_TOKEN_<LOJA>), nunca o legado`,
        );
      if (typeof l.functionsNomeadas !== "boolean")
        throw erroDoCadastro(
          `${projeto}: assinante precisa declarar functionsNomeadas (true/false)`,
        );
      if (Object.hasOwn(l, "refDasFunctions"))
        throw erroDoCadastro(`${projeto}: refDasFunctions só existe em legado`);
      if (Object.hasOwn(l, "acesso") && l.acesso !== ACESSO_OAUTH)
        throw erroDoCadastro(
          `${projeto}: acesso só aceita "${ACESSO_OAUTH}" (sem o campo, a loja é lida pelo CLI)`,
        );
      if (segredosVistos.has(l.segredoDoToken))
        throw erroDoCadastro(
          `${projeto}: o segredo ${l.segredoDoToken} já é de ${segredosVistos.get(l.segredoDoToken)} (um segredo por loja)`,
        );
      segredosVistos.set(l.segredoDoToken, projeto);
      if (refsDeAssinantes.has(l.ref))
        throw erroDoCadastro(
          `${projeto}: o ref já é de ${refsDeAssinantes.get(l.ref)} (um banco, uma loja)`,
        );
      refsDeAssinantes.set(l.ref, projeto);
    }
    if (Object.hasOwn(l, "refDasFunctions") && !RE_REF.test(l.refDasFunctions))
      throw erroDoCadastro(
        `${projeto}: refDasFunctions precisa casar ${RE_REF}`,
      );

    lojas[projeto] = Object.freeze({
      projeto,
      ref: l.ref,
      classe: l.classe,
      apelido: l.apelido,
      segredoDoToken: l.segredoDoToken,
      functionsNomeadas: l.classe === "assinante" ? l.functionsNomeadas : false,
      refDasFunctions: l.refDasFunctions ?? l.ref,
      acesso: l.acesso ?? ACESSO_PADRAO,
    });
  }
  return Object.freeze({ lojas: Object.freeze(lojas) });
}

function carregarLojas(caminho = CAMINHO_LOJAS) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- o padrão é a constante CAMINHO_LOJAS; só teste passa outro caminho local.
  const texto = fs.readFileSync(caminho, "utf8");
  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw erroDoCadastro("não é JSON");
  }
  return validarCadastro(bruto);
}

/** A loja do `projeto`, ou null. `Object.hasOwn` recusa `__proto__`/`constructor`. */
function lojaDoProjeto(projeto, cadastro = carregarLojas()) {
  if (typeof projeto !== "string") return null;
  return Object.hasOwn(cadastro.lojas, projeto)
    ? cadastro.lojas[projeto]
    : null;
}

const listaDe = (cadastro, filtro) =>
  Object.values(cadastro.lojas).filter(filtro);
const assinantes = (cadastro = carregarLojas()) =>
  listaDe(cadastro, (l) => l.classe === "assinante");
const legados = (cadastro = carregarLojas()) =>
  listaDe(cadastro, (l) => l.classe === "legado");

/** `{ projeto: ref }` — o que `REFS_POR_PROJETO` de conferir-banco.cjs sempre foi. */
function refsPorProjeto(cadastro = carregarLojas()) {
  const refs = {};
  for (const l of Object.values(cadastro.lojas)) refs[l.projeto] = l.ref;
  return refs;
}

/** A mensagem de parada de uma loja assinante (a mesma que os scripts sempre
 * imprimiram: "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — …"). */
function semAcessoDaLoja(l) {
  return `sem acesso legítimo à ${l.apelido} por ${l.segredoDoToken} — bloqueio concreto`;
}

/** A parada do `exigir-segredo` de uma loja OAuth: o token dela só existe no
 * GitHub enquanto a sessão de publicação está aberta (ela grava e apaga). */
function semAcessoDaLojaOAuth(l) {
  return `${semAcessoDaLoja(l)} — loja OAuth: dispare dentro da sessão de publicação (publicar-release.mjs --sessao)`;
}

/** `{ projeto: {segredo, semAcesso} }` só das assinantes — o `ALVOS` dos scripts. */
function alvosDasAssinantes(cadastro = carregarLojas()) {
  const alvos = {};
  for (const l of assinantes(cadastro))
    alvos[l.projeto] = Object.freeze({
      segredo: l.segredoDoToken,
      semAcesso: semAcessoDaLoja(l),
    });
  return Object.freeze(alvos);
}

// ---------------------------------------------------------------------------
// CLI para os passos de workflow. Nunca lê segredo; nunca imprime o texto cru.
// ---------------------------------------------------------------------------
function cli(
  argv,
  {
    // `::error::` vai para a SAÍDA PADRÃO, como o `echo "::error::…"` que os passos
    // de workflow sempre usaram (o runner lê comando de workflow dos dois fluxos).
    saida = { out: console.log, err: console.log },
    cadastro,
    env = process.env,
  } = {},
) {
  const [comando, projeto, ...resto] = argv;
  const falhar = (msg) => {
    saida.err(`::error::${msg}`);
    return 1;
  };
  let cad = cadastro;
  try {
    cad ??= carregarLojas();
  } catch (e) {
    return falhar(e.message);
  }
  const l = lojaDoProjeto(projeto, cad);
  if (!l)
    return falhar(
      `loja desconhecida — projeto desconhecido: ${textoSeguro(projeto)} (não está em scripts/frota/lojas.json)`,
    );
  if (comando === "validar") {
    if (resto.includes("--assinante") && l.classe !== "assinante")
      return falhar(
        `${l.projeto} não é loja assinante (este workflow só aceita lojas assinantes)`,
      );
    saida.out(`loja ${l.projeto}: ${l.classe}`);
    return 0;
  }
  if (comando === "ref") {
    saida.out(resto.includes("--functions") ? l.refDasFunctions : l.ref);
    return 0;
  }
  if (comando === "exigir-segredo") {
    // Só confere se o token DESTA loja chegou ao passo (o env do passo traz só o
    // dela; o das outras vem vazio). Nunca imprime o valor.
    if (
      typeof env[l.segredoDoToken] === "string" &&
      env[l.segredoDoToken] !== ""
    ) {
      saida.out(`segredo ${l.segredoDoToken} presente`);
      return 0;
    }
    if (l.acesso === ACESSO_OAUTH) return falhar(semAcessoDaLojaOAuth(l));
    return falhar(
      l.classe === "assinante"
        ? semAcessoDaLoja(l)
        : `segredo ${l.segredoDoToken} ausente no repositório (Settings → Secrets and variables → Actions)`,
    );
  }
  if (comando === "campo") {
    const campo = resto[0];
    if (!CAMPOS_LEGIVEIS_NO_CLI.includes(campo))
      return falhar(`campo não consultável: ${textoSeguro(campo)}`);
    // `campo` passou pela lista fechada acima.
    saida.out(String(l[campo]));
    return 0;
  }
  return falhar(`comando desconhecido: ${textoSeguro(comando)}`);
}

if (require.main === module) {
  process.exitCode = cli(process.argv.slice(2));
}

module.exports = {
  CAMINHO_LOJAS,
  RE_PROJETO,
  RE_REF,
  RE_SEGREDO,
  SEGREDO_LEGADO,
  ACESSO_OAUTH,
  ACESSO_PADRAO,
  textoSeguro,
  listaLegivel,
  validarCadastro,
  carregarLojas,
  lojaDoProjeto,
  assinantes,
  legados,
  refsPorProjeto,
  semAcessoDaLoja,
  alvosDasAssinantes,
  cli,
};
