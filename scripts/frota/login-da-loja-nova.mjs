#!/usr/bin/env node
/**
 * login-da-loja-nova.mjs — o login (Supabase Auth) da loja NOVA pela Management
 * API (plano nova-loja, B4, 26/11/2026). Quem chama é o dono (ou o orquestrador
 * nova-loja.mjs), com o access token OAuth da conta da LOJISTA:
 *
 *   node scripts/frota/login-da-loja-nova.mjs --projeto <ref> --loja <slug> --dominio https://<host> [--aplicar]
 *
 * Sem --aplicar: lê, mostra o plano e o veredito, 0 escritas.
 *
 * O QUE GRAVA (e nada além; a lista é CHAVES_DO_PATCH):
 *  - os endereços do login, com as MESMAS regras das lojas que já vendem
 *    (`planejarPatchUrls` de scripts/publicacao/login-da-loja-regras.cjs):
 *    site_url = https://<host>, `https://<host>/**` acrescentado à
 *    uri_allow_list (que é UM texto separado por vírgula: as URLs que já estão
 *    lá ficam, na ordem, e o padrão não se repete) e o limite de 30 e-mails/h
 *    só com remetente próprio, num PATCH à parte (o Supabase pode recusar o
 *    limite sem SMTP, e isso não pode derrubar os endereços);
 *  - o Send Email Hook apontando para a function auth-send-email DESTA loja,
 *    preparado DESLIGADO — igual ao `preparar` de ativar-email-do-login.cjs:
 *    ligar antes do Gmail da loja faria todo e-mail de login falhar (a function
 *    responde 500 sem remetente), inclusive a confirmação da conta da lojista
 *    (plano, L2). Quem liga é o ativar-email-do-login.yml (acao=ativar),
 *    depois que a lojista cadastra o Gmail no painel.
 *  Nunca liga o Google (passo da lojista), nunca mexe em SMTP nem em mailer.
 *
 * O SEGREDO DO GANCHO: `v1,whsec_<base64 de 32 bytes aleatórios>` (doc
 * auth-hooks; a function tira o prefixo, supabase/functions/auth-send-email),
 * gerado aqui e gravado com o MESMO valor nas duas pontas, NESTA ORDEM:
 *   1. POST /secrets com SEND_EMAIL_HOOK_SECRET (e releitura: tem de aparecer);
 *   2. PATCH /config/auth com o hook (e os endereços);
 *   3. conferência: relê as duas pontas. O GET /config/auth devolve o segredo
 *      como HMAC-SHA256(chave = ref) em hex, nunca em texto (lição de
 *      21/10/2026): a igualdade só se prova nesta execução, que tem o texto
 *      puro em memória; nas outras, a comparação é por PRESENÇA.
 * Os dois passos não são uma transação: se o PATCH falhar depois do secret, o
 * relatório diz o estado relido e o que fazer (o segredo não fica guardado em
 * lugar nenhum, então não há como reaproveitá-lo).
 *
 * NUNCA SUBSTITUI: gancho já ligado, secret já existente ou qualquer resto do
 * hook no Auth, sem as DUAS pontas presentes (secret na função + endereço
 * desta loja e hash no Auth), é "meia configuração": NÃO, e 0 escritas (nem
 * dos endereços) — quem decide a recuperação é uma pessoa. Com as duas pontas
 * presentes: não toca no gancho (SIM se os endereços também estão certos).
 *
 * VEREDITO: SIM (tudo conferido por releitura), NÃO (falta algo, ou foi
 * recusado) ou INCERTO (não deu para medir, ou uma escrita respondeu erro).
 * INCERTO nunca vira SIM: escrita que falhou não dá SIM nem com a releitura
 * certa — rode de novo sem --aplicar para confirmar. Saída: SIM 0, NÃO 1,
 * uso errado 2, INCERTO 3.
 *
 * SEGREDOS: nenhum valor de segredo, hash do hook ou token vai para linha,
 * erro ou arquivo. O token sai do cofre local da loja (--loja → cofre-local +
 * acesso-oauth `renovar`), só em memória. Mensagens de erro: só as nossas
 * (Parada, UsoErrado) e as do cliente da gestão, que nunca carregam token nem
 * corpo de resposta. Testado por tests/frota_login_da_loja_nova_test.ts.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { ErroDaGestao, criarClienteGestao } from "./supabase-gestao.mjs";

const require = createRequire(import.meta.url);
const regras = require("../publicacao/login-da-loja-regras.cjs");
const { RE_PROJETO, RE_REF } = require("./lojas.cjs");

const { Parada, parar } = regras;

export const NOME_SEGREDO = "SEND_EMAIL_HOOK_SECRET";
const CAMPOS_HOOK = Object.freeze([
  "hook_send_email_enabled",
  "hook_send_email_uri",
  "hook_send_email_secrets",
]);
/** As ÚNICAS chaves que este script manda no PATCH de /config/auth. */
export const CHAVES_DO_PATCH = Object.freeze([
  ...regras.CAMPOS_URLS,
  ...CAMPOS_HOOK,
]);
/** Ordem dos PATCHes: endereços + gancho juntos; o limite sozinho, depois. */
const PARTES_DO_PATCH = Object.freeze([
  Object.freeze(["site_url", "uri_allow_list", ...CAMPOS_HOOK]),
  Object.freeze(["rate_limit_email_sent"]),
]);
/** Os itens do `diagnosticar` das lojas reais que valem para a loja nova (o
 * resto depende do Gmail, que a lojista cadastra depois). */
const ITENS_DOS_ENDERECOS = Object.freeze([
  "domínio público da loja",
  "endereço do site (site_url)",
  "endereço de volta aceito",
]);
const OK = "OK";
const FALTA = "FALTA";
const ATENCAO = "ATENÇÃO";
const NAO_MEDIDO = "NÃO MEDIDO";
const EXPLICACAO = Object.freeze({
  SIM: "o login da loja nova está configurado",
  NÃO: "o login da loja nova NÃO está configurado: veja o que FALTA acima",
  INCERTO:
    "não deu para confirmar: rode de novo sem --aplicar antes de qualquer outra coisa",
});
const CODIGO = Object.freeze({ SIM: 0, NÃO: 1, INCERTO: 3 });

export class UsoErrado extends Error {}

const objeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const vazio = (v) => v === null || v === undefined || v === "";
const formatoHash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

/** Só mensagens que nascem seguras (nossas e do cliente da gestão). */
function mensagemSegura(e) {
  if (
    e instanceof Parada ||
    e instanceof UsoErrado ||
    e instanceof ErroDaGestao
  )
    return e.message;
  const nome = e?.name;
  return `erro sem detalhes (${typeof nome === "string" && /^[A-Za-z]{1,40}$/.test(nome) ? nome : "não impresso"})`;
}

// ---------------------------------------------------------------------------
// argumentos
// ---------------------------------------------------------------------------

const OPCOES = Object.freeze(["--projeto", "--loja", "--dominio"]);

/** `https://<host>` (barra final opcional) → host, pela regra do CHECK de
 * store_config.dominio_publico; sem porta, caminho, query, usuário, vírgula
 * (separador da uri_allow_list) ou IP. */
function hostDoDominio(texto) {
  const m = /^https:\/\/([a-z0-9.-]{1,253})\/?$/.exec(texto);
  const host = m?.[1];
  if (
    !host ||
    !regras.dominioValido(host) ||
    !/[a-z]/.test(host.slice(host.lastIndexOf(".") + 1))
  )
    throw new UsoErrado(
      "--dominio: https://<host> (minúsculo, com ponto, sem porta, caminho, vírgula nem IP)",
    );
  return host;
}

/** Lê e valida a FORMA dos argumentos. Erro aqui é uso errado (saída 2). */
export function lerArgumentos(argv) {
  if (!Array.isArray(argv)) throw new UsoErrado("argumentos ilegíveis");
  const v = new Map();
  let aplicar = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv.at(i);
    if (x === "--aplicar") {
      if (aplicar) throw new UsoErrado("--aplicar repetido");
      aplicar = true;
    } else if (OPCOES.includes(x)) {
      const valor = argv.at(++i);
      if (typeof valor !== "string" || valor.startsWith("--"))
        throw new UsoErrado(`${x} exige um valor`);
      if (v.has(x)) throw new UsoErrado(`${x} repetido`);
      v.set(x, valor);
    } else throw new UsoErrado("argumento desconhecido (não impresso)");
  }
  for (const o of OPCOES)
    if (!v.has(o)) throw new UsoErrado(`falta ${o} (obrigatório)`);
  const projeto = v.get("--projeto");
  const loja = v.get("--loja");
  if (!RE_REF.test(projeto))
    throw new UsoErrado("--projeto: 20 letras minúsculas (o ref do Supabase)");
  if (!RE_PROJETO.test(loja))
    throw new UsoErrado(
      "--loja: letra minúscula seguida de letras, números ou hífen (2 a 40)",
    );
  return { projeto, loja, dominio: hostDoDominio(v.get("--dominio")), aplicar };
}

// ---------------------------------------------------------------------------
// leitura
// ---------------------------------------------------------------------------

async function lerConfig(cliente, ref) {
  const c = await cliente.pedir("configAuth", { ref });
  if (!objeto(c)) parar("configuração do Auth inesperada (não impressa)");
  const ligado = c.hook_send_email_enabled;
  if (typeof ligado !== "boolean" && ligado !== null && ligado !== undefined)
    parar("estado do gancho de e-mail inesperado (não impresso)");
  for (const v of [c.hook_send_email_uri, c.hook_send_email_secrets])
    if (v !== null && v !== undefined && typeof v !== "string")
      parar("configuração do gancho de e-mail inesperada (não impressa)");
  return c;
}

async function lerSegredos(cliente, ref) {
  const lista = await cliente.pedir("segredos", { ref });
  if (
    !Array.isArray(lista) ||
    !lista.every((s) => objeto(s) && typeof s.name === "string" && s.name)
  )
    parar("lista de secrets da função inesperada (não impressa)");
  const nomes = lista.map((s) => s.name);
  if (new Set(nomes).size !== nomes.length)
    parar("lista de secrets com nomes repetidos");
  return nomes;
}

// ---------------------------------------------------------------------------
// plano
// ---------------------------------------------------------------------------

/**
 * "pronto" (as duas pontas presentes: não toca), "novo" (nenhum resto do
 * gancho: prepara) ou "parcial" (qualquer outra coisa: não substitui).
 */
function estadoDoGancho(config, nomes, ref) {
  const secret = nomes.includes(NOME_SEGREDO);
  const noAuth =
    config.hook_send_email_uri === regras.uriDoHook(ref) &&
    formatoHash(config.hook_send_email_secrets);
  if (secret && noAuth) return { estado: "pronto" };
  const motivos = [];
  if (secret) motivos.push(`o secret ${NOME_SEGREDO} já existe na função`);
  if (config.hook_send_email_enabled === true)
    motivos.push("o gancho de e-mail já está LIGADO no Auth");
  if (!vazio(config.hook_send_email_uri))
    motivos.push(
      config.hook_send_email_uri === regras.uriDoHook(ref)
        ? "o Auth já tem o endereço do gancho desta loja"
        : "o Auth tem o gancho apontando para outro endereço (não impresso)",
    );
  if (!vazio(config.hook_send_email_secrets))
    motivos.push("o Auth já tem um segredo de gancho");
  return motivos.length === 0
    ? { estado: "novo" }
    : { estado: "parcial", motivos };
}

const textoDoValor = (campo, v) =>
  campo === "rate_limit_email_sent"
    ? v === null || v === undefined
      ? "(vazio)"
      : String(v)
    : regras.textoDeUrl(v);

const gerarSegredo = () => `v1,whsec_${randomBytes(32).toString("base64")}`;

/** As partes do PATCH, na ordem, só com chaves de CHAVES_DO_PATCH. */
function partesDoPatch(patchUrls, patchGancho) {
  const tudo = { ...patchUrls, ...patchGancho };
  const partes = [];
  for (const chaves of PARTES_DO_PATCH) {
    const parte = Object.fromEntries(
      Object.entries(tudo).filter(([k]) => chaves.includes(k)),
    );
    if (Object.keys(parte).length > 0) partes.push(parte);
  }
  for (const parte of partes)
    if (!Object.keys(parte).every((k) => CHAVES_DO_PATCH.includes(k)))
      parar("PATCH fora da lista branca");
  return partes;
}

// ---------------------------------------------------------------------------
// conferência
// ---------------------------------------------------------------------------

function conferir({ config, nomes, ref, dominio, segredo }) {
  const d = regras.diagnosticar({ config, dominio, ref });
  const itens = d.itens.filter((i) => ITENS_DOS_ENDERECOS.includes(i.nome));
  if (itens.length !== ITENS_DOS_ENDERECOS.length)
    itens.push({
      nome: "endereços do login",
      estado: NAO_MEDIDO,
      detalhe: "conferência incompleta",
    });
  const item = (nome, estado, detalhe) => itens.push({ nome, estado, detalhe });

  const uriCerta = config.hook_send_email_uri === regras.uriDoHook(ref);
  const hashPresente = formatoHash(config.hook_send_email_secrets);
  item(
    "gancho de e-mail no Auth",
    uriCerta && hashPresente ? OK : FALTA,
    uriCerta && hashPresente
      ? "aponta para a auth-send-email desta loja, com segredo"
      : !uriCerta
        ? vazio(config.hook_send_email_uri)
          ? "sem endereço"
          : "endereço diferente do desta loja"
        : "sem segredo no Auth",
  );
  const secret = nomes.includes(NOME_SEGREDO);
  item(
    `secret ${NOME_SEGREDO} na função`,
    secret ? OK : FALTA,
    secret ? "presente" : "ausente",
  );
  if (segredo === undefined)
    item(
      "mesmo segredo nas duas pontas",
      OK,
      "conferido por presença (a leitura devolve só o HMAC)",
    );
  else {
    const esperado = createHmac("sha256", ref)
      .update(segredo, "utf8")
      .digest("hex");
    const igual =
      hashPresente &&
      timingSafeEqual(
        Buffer.from(config.hook_send_email_secrets, "hex"),
        Buffer.from(esperado, "hex"),
      );
    item(
      "mesmo segredo nas duas pontas",
      igual ? OK : FALTA,
      igual
        ? "confirmado nesta execução (HMAC da releitura)"
        : "o Auth não guardou o segredo gravado na função",
    );
  }
  item(
    "gancho de e-mail ligado",
    config.hook_send_email_enabled === true ? OK : ATENCAO,
    config.hook_send_email_enabled === true
      ? "sim"
      : "desligado até a lojista cadastrar o Gmail; depois, ativar-email-do-login.yml (acao=ativar)",
  );
  return itens;
}

function veredictoDe(itens) {
  if (itens.some((i) => i.estado === FALTA)) return "NÃO";
  if (itens.some((i) => i.estado === NAO_MEDIDO)) return "INCERTO";
  return "SIM";
}

// ---------------------------------------------------------------------------
// execução
// ---------------------------------------------------------------------------

/**
 * Lê, planeja e (com `aplicar`) grava. Devolve { veredito, linhas }; nenhuma
 * linha leva valor de segredo, hash do hook ou token.
 *
 * @param {{ cliente: ReturnType<typeof criarClienteGestao>, ref: string,
 *   dominio: string, aplicar: boolean }} p   dominio = host (sem https://)
 */
export async function configurarLoginNovo({ cliente, ref, dominio, aplicar }) {
  if (typeof ref !== "string" || !RE_REF.test(ref))
    throw new UsoErrado("ref inválido (20 letras minúsculas)");
  if (!regras.dominioValido(dominio))
    throw new UsoErrado("domínio inválido (host minúsculo, com ponto)");
  const linhas = [];
  const dizer = (l) => linhas.push(l);
  const relatarItens = (itens) => {
    for (const i of itens) dizer(`${i.estado} — ${i.nome}: ${i.detalhe}`);
  };
  const fim = (veredito) => {
    dizer(`veredito: ${veredito} (${Reflect.get(EXPLICACAO, veredito)})`);
    return { veredito, linhas };
  };

  // 1. o estado de agora
  let antes;
  let nomesAntes;
  try {
    antes = await lerConfig(cliente, ref);
    nomesAntes = await lerSegredos(cliente, ref);
  } catch (e) {
    dizer(`não consegui ler o estado atual: ${mensagemSegura(e)}`);
    dizer("nada foi gravado");
    return fim("INCERTO");
  }

  // 2. o plano (nada é gravado se qualquer parte recusar)
  const gancho = estadoDoGancho(antes, nomesAntes, ref);
  let plano = null;
  let recusaDosEnderecos = null;
  try {
    plano = regras.planejarPatchUrls(antes, dominio);
  } catch (e) {
    if (!(e instanceof Parada)) throw e;
    recusaDosEnderecos = e.message;
  }
  if (gancho.estado === "parcial" || recusaDosEnderecos !== null) {
    if (gancho.estado === "parcial") {
      dizer(
        `FALTA — gancho de e-mail: meia configuração (${gancho.motivos.join("; ")}); não substituo nem completo sozinho`,
      );
      dizer(
        `o que fazer: confira à mão no painel do Supabase da loja (Authentication > Hooks e Edge Functions > Secrets). Se foi uma tentativa anterior deste script que parou no meio, desligue e limpe o gancho, apague o secret ${NOME_SEGREDO} e rode de novo com --aplicar`,
      );
    }
    if (recusaDosEnderecos !== null)
      dizer(`FALTA — endereços do login: ${recusaDosEnderecos}`);
    dizer("nada foi gravado");
    return fim("NÃO");
  }

  for (const m of plano.mudancas)
    dizer(
      `plano — ${m.campo}: ${textoDoValor(m.campo, m.antes)} -> ${textoDoValor(m.campo, m.depois)}`,
    );
  dizer(
    gancho.estado === "novo"
      ? `plano — gancho de e-mail: preparar DESLIGADO apontando para ${regras.uriDoHook(ref)}, com um segredo novo gerado na hora (primeiro o secret ${NOME_SEGREDO} da função, depois o Auth)`
      : "plano — gancho de e-mail: as duas pontas já presentes (secret da função e gancho no Auth); não toco",
  );
  const semEscrita =
    gancho.estado === "pronto" && Object.keys(plano.patch).length === 0;

  if (semEscrita) {
    dizer("nada a gravar");
    const itens = conferir({ config: antes, nomes: nomesAntes, ref, dominio });
    relatarItens(itens);
    return fim(veredictoDe(itens));
  }
  if (!aplicar) {
    dizer("ENSAIO: nada foi gravado. Rode de novo com --aplicar para gravar.");
    return fim("NÃO");
  }

  // 3. gravar: secret primeiro, depois o Auth
  let segredo;
  let etapa = "";
  let falha = null;
  const enviadas = new Set();
  try {
    if (gancho.estado === "novo") {
      segredo = gerarSegredo();
      etapa = `gravar o secret ${NOME_SEGREDO} da função`;
      await cliente.pedir("segredos", {
        ref,
        metodo: "POST",
        corpo: [{ name: NOME_SEGREDO, value: segredo }],
      });
      etapa = `reler o secret ${NOME_SEGREDO} da função`;
      if (!(await lerSegredos(cliente, ref)).includes(NOME_SEGREDO))
        parar("o secret não apareceu na releitura da função");
    }
    const patchGancho =
      segredo === undefined
        ? {}
        : {
            hook_send_email_enabled: false,
            hook_send_email_uri: regras.uriDoHook(ref),
            hook_send_email_secrets: segredo,
          };
    for (const parte of partesDoPatch(plano.patch, patchGancho)) {
      const chaves = Object.keys(parte);
      etapa = `fazer o PATCH do Auth (${chaves.join(", ")})`;
      for (const k of chaves) enviadas.add(k);
      await cliente.pedir("configAuth", { ref, metodo: "PATCH", corpo: parte });
    }
  } catch (e) {
    falha = { etapa, mensagem: mensagemSegura(e) };
    dizer(`FALHOU ao ${etapa}: ${falha.mensagem}`);
  }

  // 4. conferir: relê as duas pontas
  let depois;
  let nomesDepois;
  try {
    depois = await lerConfig(cliente, ref);
    nomesDepois = await lerSegredos(cliente, ref);
  } catch (e) {
    dizer(`não consegui reler o estado depois de gravar: ${mensagemSegura(e)}`);
    dizer(
      "estado DESCONHECIDO: rode de novo sem --aplicar para ver o que ficou gravado; não repita --aplicar antes disso",
    );
    return fim("INCERTO");
  }
  const itens = conferir({
    config: depois,
    nomes: nomesDepois,
    ref,
    dominio,
    segredo,
  });
  const restantes = (c) =>
    Object.fromEntries(Object.entries(c).filter(([k]) => !enviadas.has(k)));
  if (!isDeepStrictEqual(restantes(antes), restantes(depois)))
    itens.push({
      nome: "resto da configuração do Auth",
      estado: NAO_MEDIDO,
      detalhe: "outro campo mudou durante a operação (não impresso)",
    });
  relatarItens(itens);
  let veredito = veredictoDe(itens);
  if (falha === null) return fim(veredito);

  // escrita com erro: diz o estado relido e o que fazer; nunca SIM
  const secretFicou = nomesDepois.includes(NOME_SEGREDO);
  const ganchoNoAuth =
    !vazio(depois.hook_send_email_uri) ||
    !vazio(depois.hook_send_email_secrets);
  if (veredito === "SIM") {
    veredito = "INCERTO";
    dizer(
      "a escrita respondeu erro, mas a releitura mostra tudo no lugar: rode de novo sem --aplicar para confirmar (com as duas pontas presentes, ele dá SIM sem gravar nada)",
    );
  } else if (segredo !== undefined && secretFicou && !ganchoNoAuth)
    dizer(
      `estado: o segredo ${NOME_SEGREDO} ficou só na função; o gancho NÃO foi gravado no Auth. O segredo não foi guardado em lugar nenhum e não é trocado sozinho: apague o secret ${NOME_SEGREDO} no painel do Supabase da loja (Edge Functions > Secrets) e rode de novo com --aplicar`,
    );
  else if (!secretFicou && !ganchoNoAuth)
    dizer(
      "estado: nada do gancho ficou gravado; pode rodar de novo com --aplicar",
    );
  else
    dizer(
      "estado: gravação parcial. Rode de novo sem --aplicar para ver o estado; não repita --aplicar antes disso",
    );
  return fim(veredito);
}

// ---------------------------------------------------------------------------
// linha de comando
// ---------------------------------------------------------------------------

const USO =
  "Uso: node scripts/frota/login-da-loja-nova.mjs --projeto <ref> --loja <slug> --dominio https://<host> [--aplicar]";

/** O access token da LOJISTA: o refresh do cofre local da loja vira um
 * access token novo (acesso-oauth `renovar`). Só em memória. */
async function tokenDoCofre(loja) {
  const { criarCofreDpapi } = await import("./cofre-local.mjs");
  const { criarAcessoOAuth } = await import("./acesso-oauth.mjs");
  const acesso = criarAcessoOAuth({ cofre: criarCofreDpapi() });
  return (await acesso.renovar({ slug: loja })).accessToken;
}

/**
 * @param {string[]} argv
 * @param {{ obterToken?: (loja: string) => Promise<string>,
 *   fetch?: typeof fetch,
 *   saida?: { log: (l: string) => void, erro: (l: string) => void } }} deps
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const saida = deps.saida ?? {
    log: (l) => console.log(l),
    erro: (l) => console.error(l),
  };
  let args;
  try {
    args = lerArgumentos(argv);
  } catch (e) {
    saida.erro(`USO ERRADO: ${mensagemSegura(e)}`);
    saida.erro(USO);
    return 2;
  }
  saida.log(
    `login da loja nova ${args.loja} (${args.projeto}), domínio ${args.dominio}: ${args.aplicar ? "APLICANDO" : "ENSAIO (sem --aplicar, nada é gravado)"}`,
  );
  let token;
  try {
    token = await (deps.obterToken ?? tokenDoCofre)(args.loja);
  } catch (e) {
    saida.erro(`sem acesso à conta da lojista: ${mensagemSegura(e)}`);
    saida.log(`veredito: INCERTO (${EXPLICACAO.INCERTO})`);
    return CODIGO.INCERTO;
  }
  try {
    const r = await configurarLoginNovo({
      cliente: criarClienteGestao({
        token,
        fetch: deps.fetch ?? globalThis.fetch,
      }),
      ref: args.projeto,
      dominio: args.dominio,
      aplicar: args.aplicar,
    });
    for (const l of r.linhas) saida.log(l);
    return Reflect.get(CODIGO, r.veredito);
  } catch (e) {
    saida.erro(`FALHOU: ${mensagemSegura(e)}`);
    saida.log(`veredito: INCERTO (${EXPLICACAO.INCERTO})`);
    return CODIGO.INCERTO;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().then(
    (c) => {
      process.exitCode = c;
    },
    () => {
      console.error("erro inesperado (detalhes não impressos)");
      process.exitCode = 1;
    },
  );
}
