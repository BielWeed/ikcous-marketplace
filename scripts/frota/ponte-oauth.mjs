// Ponte A (T7 do PLANO-PORTAO-OAUTH-PONTE-A): a SESSÃO DE PUBLICAÇÃO das lojas
// OAuth. Cartão de quarto de hotel: vale enquanto o processo vive, e o fechar()
// é o check-out. Quem chama (publicar-release.mjs --sessao, T8) segura o laço,
// os sinais e o finally; este módulo só abre e fecha.
//
// ABRIR (abrirSessao), nesta ordem:
//   0. recusa SEM REDE: cadastro torto, nome de segredo fora do RE_SEGREDO, o
//      legado, nome que é de loja que não é OAuth (IKCOUS, Savy), loja pedida
//      que não é OAuth, repetida ou lista vazia; minimoMs torto;
//      matarTokenNoFechar ausente (é a decisão da prova P6b, nunca um padrão);
//   1. gh.entrar(): lê `gh auth token` UMA vez, só em memória (mudança 2: o
//      fechar não pode depender de processo filho, que a janela fechada mata);
//   2. recusa se alguém além do dono tem escrita no repositório (mudança 6:
//      quem escreve lê todo segredo por um workflow);
//   3. faxina: apaga todo segredo de loja OAuth DO CADASTRO que sobrou;
//   4. renova cada loja UMA vez (renovarComTravaLonga: a trava fica presa);
//      a loja cuja renovação falha (trava de outro comando, SemAcesso, 429,
//      rede) fica FORA desta sessão (`foraDaSessao`, com o erro) e as outras
//      seguem;
//   5. confere o prazo de cada uma antes de gravar QUALQUER segredo: sem prazo
//      ou curta, fica fora (a trava dela solta na hora);
//   6. grava cada segredo (gh secret set, valor pelo stdin).
//   Nenhuma loja sobrou, falha no canal do GitHub (passos 1-3 e 6) ou sinal:
//   apaga TODOS os nomes OAuth do cadastro (como a faxina: o gh pode ter
//   gravado e dito que falhou), solta todas as travas e o erro sobe com
//   `limpeza` e `foraDaSessao`. Sinal com uma renovação em voo: o erro leva
//   `renovacaoEmVoo`, que quem chama espera antes de sair do processo.
//
// FECHAR (fechar): apaga os segredos da sessão; com matarTokenNoFechar, renova
// cada loja de novo DEPOIS de apagar (se a P6b provar que renovar invalida o
// anterior, o token que esteve no GitHub morre) e solta a trava DELA logo em
// seguida, CONCORRENCIA_DO_FECHAR lojas por vez; esquece o token do gh. Só
// resolve com TODAS as renovações terminadas (nenhuma fica entre a resposta do
// Supabase e o cofre). Nunca lança; pode ser chamado de novo (devolve o mesmo
// resultado). O que não saiu volta com o comando exato.
//
// GITHUB: todo DELETE vai com no máximo CONCORRENCIA_DO_GITHUB ao mesmo tempo;
// recusado pelo limite de pedidos (403/429), espera o que ele pediu
// (retry-after, x-ratelimit-reset ou 1 min) e tenta de novo, até
// TENTATIVAS_NO_LIMITE e nunca mais que ESPERA_MAXIMA_NO_LIMITE_MS por vez.
//
// "APAGADO" só com prova: DELETE 204, ou um DELETE que falhou e a lista do
// repositório mostra que o nome não está lá. 404 sozinho não prova (é também
// a resposta do GitHub para quem não tem acesso).
//
// SEGREDOS: nenhum token (OAuth ou do gh) vai em mensagem, argumento, env de
// processo filho, arquivo ou resultado. O valor vai ao gh só pelo stdin.
import { spawn as spawnPadrao } from "node:child_process";
import { createRequire } from "node:module";
import { ErroDaGestao, buscarComPrazo } from "./supabase-gestao.mjs";

const require = createRequire(import.meta.url);
const {
  RE_PROJETO,
  RE_REF,
  RE_SEGREDO,
  SEGREDO_LEGADO,
} = require("./lojas.cjs");

export const MINIMO_PADRAO_MS = 2 * 60 * 60 * 1000;
export const API_GITHUB = "https://api.github.com";
/** Pedidos de segredo ao GitHub ao mesmo tempo. O limite secundário dele é
 * 100 simultâneos e 900 pontos/min (DELETE vale 5): 10 fica longe dos dois. */
export const CONCORRENCIA_DO_GITHUB = 10;
/** Lojas do fechar ao mesmo tempo (cada renovação abre o PowerShell 2×). */
export const CONCORRENCIA_DO_FECHAR = 4;
/** Tentativas de um DELETE que o GitHub recusou por limite (a 1ª conta). */
export const TENTATIVAS_NO_LIMITE = 3;
/** A espera mais longa que se aceita pelo limite do GitHub; acima dela não
 * se espera: o nome volta em naoApagados, com o comando da faxina. */
export const ESPERA_MAXIMA_NO_LIMITE_MS = 60_000;
const PRAZO_GH_MS = 30_000;
const POR_PAGINA = 100;
const TETO_PAGINAS = 10;
const RE_REPO = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;
const RE_LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export class ErroDaPonte extends ErroDaGestao {
  constructor(mensagem, extra = {}) {
    super(mensagem, extra);
    this.name = "ErroDaPonte";
  }
}

/**
 * A GAVETA da loja (PLANO-AMBIENTE-POR-LOJA): o GitHub Environment que guarda
 * o segredo dela. O repositório só guarda 100 segredos; uma gaveta por loja
 * tira esse teto. Os workflows declaram a mesma gaveta (`loja-<projeto>`).
 */
export const ambienteDaLoja = (projeto) => `loja-${projeto}`;

/**
 * As lojas OAuth do cadastro, com o nome do segredo VINDO do cadastro, nunca
 * derivado, e a gaveta de cada uma. Qualquer desvio lança: um cadastro torto
 * nunca vira "nenhuma loja" nem deixa a ponte mexer no segredo de uma loja
 * pelo CLI.
 * @returns {Array<{ projeto: string, ref: string, nome: string, ambiente: string }>}
 */
export function lojasOAuthDo(cadastro) {
  const lojas = cadastro?.lojas;
  if (lojas === null || typeof lojas !== "object" || Array.isArray(lojas)) {
    throw new ErroDaPonte("Ponte: o cadastro de lojas não é um objeto.", {
      codigo: "CADASTRO_INVALIDO",
    });
  }
  const entradas = Object.entries(lojas);
  const nomesNaoOAuth = new Set(
    entradas
      .filter(([, l]) => l?.acesso !== "oauth")
      .map(([, l]) => l?.segredoDoToken),
  );
  const recusa = (msg) =>
    new ErroDaPonte(`Ponte: ${msg}`, { codigo: "CADASTRO_INVALIDO" });
  const vistos = new Set();
  const refs = new Set();
  const saida = [];
  for (const [projeto, l] of entradas) {
    if (l?.acesso !== "oauth") continue;
    if (!RE_PROJETO.test(projeto))
      throw recusa("nome de loja fora do formato.");
    if (l.classe !== "assinante") {
      throw recusa(`${projeto}: acesso oauth só existe em loja assinante.`);
    }
    if (typeof l.ref !== "string" || !RE_REF.test(l.ref)) {
      throw recusa(`${projeto}: ref fora do formato.`);
    }
    const nome = l.segredoDoToken;
    if (
      typeof nome !== "string" ||
      !RE_SEGREDO.test(nome) ||
      nome === SEGREDO_LEGADO
    ) {
      throw recusa(
        `${projeto}: o segredo precisa ser SUPABASE_ACCESS_TOKEN_<LOJA> (nunca o legado).`,
      );
    }
    if (nomesNaoOAuth.has(nome)) {
      throw recusa(
        `${projeto}: o segredo ${nome} é de uma loja que não é OAuth; a ponte nunca mexe nele.`,
      );
    }
    if (vistos.has(nome) || refs.has(l.ref)) {
      throw recusa(`${projeto}: segredo ou ref repetido entre lojas OAuth.`);
    }
    vistos.add(nome);
    refs.add(l.ref);
    saida.push(
      Object.freeze({
        projeto,
        ref: l.ref,
        nome,
        ambiente: ambienteDaLoja(projeto),
      }),
    );
  }
  return saida;
}

function escolherLojas(todas, pedidas) {
  if (pedidas === undefined) {
    if (todas.length === 0) {
      throw new ErroDaPonte(
        "Ponte: o cadastro não tem loja OAuth; a sessão não serve para nada (use o ensaio normal).",
        { codigo: "SEM_LOJA_OAUTH" },
      );
    }
    return todas;
  }
  if (!Array.isArray(pedidas) || pedidas.length === 0) {
    throw new ErroDaPonte("Ponte: a lista de lojas da sessão está vazia.", {
      codigo: "PEDIDO_INVALIDO",
    });
  }
  if (new Set(pedidas).size !== pedidas.length) {
    throw new ErroDaPonte("Ponte: loja repetida na lista da sessão.", {
      codigo: "PEDIDO_INVALIDO",
    });
  }
  return pedidas.map((p) => {
    const l = todas.find((x) => x.projeto === p);
    if (!l) {
      throw new ErroDaPonte(
        `Ponte: ${typeof p === "string" && RE_PROJETO.test(p) ? p : "a loja pedida"} não é uma loja OAuth do cadastro.`,
        { codigo: "LOJA_NAO_OAUTH" },
      );
    }
    return l;
  });
}

const comandoApagar = (gh, nome) =>
  `gh secret delete ${nome} --app actions --repo ${gh.repo}`;

const dormirDeVerdade = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Roda `fazer` em cada item, no máximo `limite` ao mesmo tempo, e espera
 * TODOS terminarem (nada fica no meio). Devolve os ÍNDICES dos itens que
 * falharam. Nunca lança.
 * @returns {Promise<Set<number>>}
 */
async function comLimite(itens, limite, fazer) {
  const fila = itens.map((item, i) => ({ item, i }));
  const falhos = new Set();
  const vaga = async () => {
    for (let t = fila.shift(); t !== undefined; t = fila.shift()) {
      try {
        await fazer(t.item);
      } catch {
        falhos.add(t.i);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, vaga),
  );
  return falhos;
}

/**
 * Um DELETE. Recusado pelo LIMITE de pedidos do GitHub (codigo
 * LIMITE_DO_GITHUB, com esperarMs), espera o que ele pediu e tenta de novo,
 * até TENTATIVAS_NO_LIMITE; espera acima de ESPERA_MAXIMA_NO_LIMITE_MS não se
 * faz (o erro sobe). Qualquer outro erro sobe na hora.
 */
async function apagarUm(gh, nome, dormir) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await gh.apagar(nome);
    } catch (e) {
      const ms = e?.codigo === "LIMITE_DO_GITHUB" ? e.esperarMs : undefined;
      if (
        tentativa >= TENTATIVAS_NO_LIMITE ||
        typeof ms !== "number" ||
        !Number.isFinite(ms) ||
        ms < 0 ||
        ms > ESPERA_MAXIMA_NO_LIMITE_MS
      ) {
        throw e;
      }
      await dormir(ms);
    }
  }
}

/**
 * Apaga os nomes, no máximo CONCORRENCIA_DO_GITHUB ao mesmo tempo (o GitHub
 * limita pedidos simultâneos e pontos por minuto). O que falhou é conferido
 * UMA vez na lista do repositório: ausente = apagado; presente ou lista que
 * falha = naoApagados. Nunca lança.
 */
async function apagarTodos(gh, nomes, dormir) {
  const falharam = await comLimite(nomes, CONCORRENCIA_DO_GITHUB, (n) =>
    apagarUm(gh, n, dormir),
  );
  let falhos = nomes.filter((_, i) => falharam.has(i));
  if (falhos.length > 0) {
    try {
      const existentes = new Set(await gh.listar());
      falhos = falhos.filter((n) => existentes.has(n));
    } catch {
      // sem lista, nada do que falhou se prova apagado
    }
  }
  return {
    apagados: nomes.filter((n) => !falhos.includes(n)),
    naoApagados: falhos.map((nome) => ({
      nome,
      comando: comandoApagar(gh, nome),
    })),
  };
}

/** A faxina com o gh já entrado: só os nomes OAuth que existem. */
async function faxinarEntrado(todas, gh, dormir) {
  const existentes = new Set(await gh.listar());
  return apagarTodos(
    gh,
    todas.map((l) => l.nome).filter((n) => existentes.has(n)),
    dormir,
  );
}

function exigirGh(gh) {
  const metodos = ["entrar", "comEscrita", "listar", "definir", "apagar"];
  if (
    gh === null ||
    typeof gh !== "object" ||
    typeof gh.entrar !== "function" ||
    typeof gh.comEscrita !== "function" ||
    typeof gh.listar !== "function" ||
    typeof gh.definir !== "function" ||
    typeof gh.apagar !== "function" ||
    typeof gh.repo !== "string" ||
    typeof gh.dono !== "string"
  ) {
    throw new ErroDaPonte(
      `Ponte: o gh precisa de repo, dono e ${metodos.join(", ")}.`,
      { codigo: "PEDIDO_INVALIDO" },
    );
  }
}

function exigirDormir(dormir) {
  if (typeof dormir !== "function") {
    throw new ErroDaPonte("Ponte: dormir precisa ser uma função (ms).", {
      codigo: "PEDIDO_INVALIDO",
    });
  }
}

async function esquecer(gh) {
  try {
    await gh.esquecer?.();
  } catch {
    // esquecer é limpeza de memória; nunca derruba o fechar
  }
}

/**
 * Faxina avulsa (`--faxina`): apaga os segredos de TODA loja OAuth do cadastro
 * que estiverem no GitHub. Nada renova. Sem loja OAuth, nem entra no gh.
 * @returns {Promise<{ apagados: string[], naoApagados: Array<{ nome: string, comando: string }> }>}
 */
export async function faxinar({ cadastro, gh, dormir = dormirDeVerdade } = {}) {
  const todas = lojasOAuthDo(cadastro);
  if (todas.length === 0) return { apagados: [], naoApagados: [] };
  exigirGh(gh);
  exigirDormir(dormir);
  await gh.entrar();
  try {
    return await faxinarEntrado(todas, gh, dormir);
  } finally {
    await esquecer(gh);
  }
}

function interrompida() {
  return new ErroDaPonte(
    "Ponte: a abertura da sessão foi interrompida; os segredos das lojas OAuth foram apagados.",
    { codigo: "ABERTURA_INTERROMPIDA" },
  );
}

/** Corrida de cada passo com o sinal: o sinal derruba a espera na hora. */
function criarEspera(sinal) {
  if (!sinal) return { esperar: (p) => p, conferir() {}, soltar() {} };
  let avisar;
  const caiu = new Promise((_ok, falha) => {
    avisar = () => falha(interrompida());
  });
  caiu.catch(() => {});
  sinal.addEventListener("abort", avisar, { once: true });
  return {
    esperar: (p) => Promise.race([p, caiu]),
    conferir() {
      if (sinal.aborted) throw interrompida();
    },
    soltar() {
      sinal.removeEventListener("abort", avisar);
    },
  };
}

/** As lojas de fora, na ordem da sessão, congeladas. */
function congelarFora(fora, daSessao) {
  const ordem = daSessao.map((l) => l.projeto);
  return Object.freeze(
    [...fora]
      .sort((a, b) => ordem.indexOf(a.projeto) - ordem.indexOf(b.projeto))
      .map((f) => Object.freeze({ ...f })),
  );
}

/**
 * Loja por loja, no máximo CONCORRENCIA_DO_FECHAR ao mesmo tempo: renova de
 * novo (P6b: se renovar invalida o anterior, o token que esteve no GitHub
 * morre) quando `matar([loja, handle])`, e LOGO DEPOIS solta a trava DELA,
 * nunca no fim de todas. Espera cada uma terminar: nenhuma renovação fica no
 * meio (entre a resposta do Supabase e o cofre). Nunca lança.
 */
async function matarESoltar(pares, matar) {
  const naoMortos = new Set();
  const presas = new Set();
  await comLimite(pares, CONCORRENCIA_DO_FECHAR, async ([l, h]) => {
    if (matar([l, h])) {
      try {
        await h.renovarDeNovo();
      } catch {
        naoMortos.add(l.projeto);
      }
    }
    try {
      await h.liberar();
    } catch {
      presas.add(l.projeto);
    }
  });
  const ordem = pares.map(([l]) => l.projeto);
  return {
    tokensNaoMortos: ordem.filter((p) => naoMortos.has(p)),
    travasPresas: ordem.filter((p) => presas.has(p)),
  };
}

/**
 * @param {{
 *   cadastro: { lojas: object },
 *   acesso: { renovarComTravaLonga: Function },
 *   gh: { repo: string, dono: string, entrar: Function, comEscrita: Function,
 *         listar: Function, definir: Function, apagar: Function, esquecer?: Function },
 *   lojas?: string[],          projetos; padrão: todas as lojas OAuth
 *   agora?: () => number,
 *   minimoMs?: number,
 *   matarTokenNoFechar: boolean,   resultado da P6b (renovar invalida o anterior?)
 *   sinal?: AbortSignal,       interrompe a abertura (Ctrl+C antes de abrir)
 *   dormir?: (ms: number) => Promise<void>,  a espera pelo limite do GitHub
 * }} opcoes
 * @returns {Promise<{
 *   lojas: ReadonlyArray<{ projeto: string, ref: string, nome: string }>,
 *   foraDaSessao: ReadonlyArray<{ projeto: string, ref: string, nome: string,
 *     erro: Error, travaPresa: boolean }>,
 *   validaAte: number,
 *   readonly estado: "aberta" | "fechando" | "fechada",
 *   tokenDe: (ref: string) => string,
 *   fechar: () => Promise<{ apagados: string[],
 *     naoApagados: Array<{ nome: string, comando: string }>,
 *     tokensNaoMortos: string[], travasPresas: string[] }>,
 * }>}
 */
export async function abrirSessao({
  cadastro,
  acesso,
  gh,
  lojas: pedidas,
  agora = Date.now,
  minimoMs = MINIMO_PADRAO_MS,
  matarTokenNoFechar,
  sinal,
  dormir = dormirDeVerdade,
} = {}) {
  // ---- 0. tudo que se recusa sem rede
  const todas = lojasOAuthDo(cadastro);
  const daSessao = escolherLojas(todas, pedidas);
  exigirGh(gh);
  if (typeof acesso?.renovarComTravaLonga !== "function") {
    throw new ErroDaPonte(
      "Ponte: falta o acesso OAuth (renovarComTravaLonga).",
      {
        codigo: "PEDIDO_INVALIDO",
      },
    );
  }
  if (
    typeof minimoMs !== "number" ||
    !Number.isFinite(minimoMs) ||
    minimoMs <= 0
  ) {
    throw new ErroDaPonte(
      "Ponte: minimoMs precisa ser positivo, em milissegundos.",
      {
        codigo: "PEDIDO_INVALIDO",
      },
    );
  }
  if (typeof matarTokenNoFechar !== "boolean") {
    throw new ErroDaPonte(
      "Ponte: matarTokenNoFechar precisa ser true ou false (o resultado da prova P6b: renovar invalida o token anterior?).",
      { codigo: "PEDIDO_INVALIDO" },
    );
  }
  if (sinal !== undefined && !(sinal instanceof AbortSignal)) {
    throw new ErroDaPonte("Ponte: sinal precisa ser um AbortSignal.", {
      codigo: "PEDIDO_INVALIDO",
    });
  }
  exigirDormir(dormir);
  if (sinal?.aborted) throw interrompida();

  const espera = criarEspera(sinal);
  /** @type {Array<[object, any]>} as lojas com a trava PRESA: [loja, handle] */
  let presas = [];
  /** as lojas que ficaram fora desta sessão, com o erro de cada uma */
  const fora = [];
  const tentados = new Set();
  let entrou = false;
  let renovacaoEmVoo;
  try {
    // ---- 1. o token do gh, uma vez
    await espera.esperar(gh.entrar());
    entrou = true;
    // ---- 2. ninguém além do dono escreve no repositório
    const comEscrita = await espera.esperar(gh.comEscrita());
    const dono = gh.dono.toLowerCase();
    const terceiros = comEscrita.filter(
      (l) => String(l).toLowerCase() !== dono,
    );
    if (terceiros.length > 0) {
      throw new ErroDaPonte(
        `Ponte: além do dono, têm escrita no repositório: ${terceiros.filter((l) => RE_LOGIN.test(l)).join(", ") || "(login ilegível)"}. Quem escreve lê todo segredo por um workflow; a sessão não abre.`,
        { codigo: "ESCRITA_DE_TERCEIROS" },
      );
    }
    // ---- 3. faxina de toda loja OAuth do cadastro
    const fax = await espera.esperar(faxinarEntrado(todas, gh, dormir));
    if (fax.naoApagados.length > 0) {
      throw new ErroDaPonte(
        `Ponte: a faxina não conseguiu apagar ${fax.naoApagados.map((x) => x.nome).join(", ")}; a sessão não abre.`,
        { codigo: "FAXINA_INCOMPLETA" },
      );
    }
    // ---- 4. uma renovação por loja, com a trava presa. A que falha (trava
    // de outro comando, SemAcesso, 429, rede) fica FORA desta sessão e as
    // outras seguem; a renovarComTravaLonga já soltou a trava dela.
    for (const l of daSessao) {
      espera.conferir();
      const p = acesso.renovarComTravaLonga({ slug: l.projeto });
      try {
        presas.push([l, await espera.esperar(p)]);
      } catch (e) {
        if (!sinal?.aborted) {
          fora.push({ ...l, erro: e, travaPresa: false });
          continue;
        }
        // sinal no meio: a renovação ainda pode chegar; quando chegar, solta.
        // Quem chama espera esta promessa antes de sair do processo: matar o
        // processo entre a resposta do Supabase e o cofre perde o acesso.
        renovacaoEmVoo = p
          .then(
            (h) => h.liberar(),
            () => {},
          )
          .catch(() => {});
        throw e;
      }
    }
    // ---- 5. o prazo, antes de gravar qualquer um: a loja sem prazo ou com
    // prazo curto fica fora (o token dela não foi a lugar nenhum: só solta)
    const t = agora();
    const curtas = [];
    presas = presas.filter(([l, h]) => {
      let erro = null;
      if (typeof h.expiraEm !== "number" || !Number.isFinite(h.expiraEm)) {
        erro = new ErroDaPonte(
          `Ponte: o Supabase não disse quando o acesso da loja ${l.projeto} vence; sem prazo, ela fica fora da sessão.`,
          { codigo: "TOKEN_SEM_PRAZO" },
        );
      } else if (h.expiraEm - t < minimoMs) {
        erro = new ErroDaPonte(
          `Ponte: o acesso da loja ${l.projeto} dura menos que o mínimo da sessão (${Math.round(minimoMs / 60_000)} min); ela fica fora da sessão.`,
          { codigo: "TOKEN_CURTO" },
        );
      }
      if (erro) curtas.push([l, h, erro]);
      return erro === null;
    });
    const { travasPresas: curtasPresas } = await matarESoltar(
      curtas.map(([l, h]) => [l, h]),
      () => false,
    );
    for (const [l, , erro] of curtas) {
      fora.push({ ...l, erro, travaPresa: curtasPresas.includes(l.projeto) });
    }
    if (presas.length === 0) {
      throw new ErroDaPonte(
        `Ponte: nenhuma loja OAuth abriu (${fora.map((f) => f.projeto).join(", ")}); a sessão não abre.`,
        { codigo: "NENHUMA_LOJA_ABRIU" },
      );
    }
    // ---- 6. grava (o definir recebe o sinal e mata o gh em voo). A falha
    // aqui é do canal do GitHub, o mesmo para todas: a sessão inteira cai.
    for (const [l, h] of presas) {
      espera.conferir();
      tentados.add(l.nome);
      await gh.definir(l.nome, h.accessToken, { sinal });
    }
    espera.conferir();
  } catch (e) {
    const apagou = entrou
      ? await apagarTodos(
          gh,
          todas.map((l) => l.nome),
          dormir,
        )
      : { apagados: [], naoApagados: [] };
    // só o token que foi ao GitHub (segredo tentado) é renovado de novo
    const { tokensNaoMortos, travasPresas } = await matarESoltar(
      presas,
      ([l]) => matarTokenNoFechar && tentados.has(l.nome),
    );
    await esquecer(gh);
    const limpeza = Object.freeze({
      ...apagou,
      tokensNaoMortos,
      travasPresas,
    });
    // com o sinal dado, a causa é a interrupção (o gh morto falha por ela)
    const erro = sinal?.aborted ? interrompida() : e;
    if (erro !== null && typeof erro === "object") {
      try {
        erro.limpeza = limpeza;
        erro.foraDaSessao = congelarFora(fora, daSessao);
        if (renovacaoEmVoo) erro.renovacaoEmVoo = renovacaoEmVoo;
      } catch {
        // erro congelado: sobe sem a limpeza anexada
      }
    }
    throw erro;
  } finally {
    espera.soltar();
  }

  // ---- a sessão aberta (só as lojas que renovaram com prazo)
  const tokens = new Map(presas.map(([l, h]) => [l.ref, h.accessToken]));
  const validaAte = Math.min(...presas.map(([, h]) => h.expiraEm));
  const nomes = presas.map(([l]) => l.nome);
  const foraDaSessao = congelarFora(fora, daSessao);
  let estado = "aberta";
  let fechando = null;

  async function encerrar() {
    estado = "fechando";
    tokens.clear();
    let apagou = {
      apagados: [],
      naoApagados: nomes.map((nome) => ({
        nome,
        comando: comandoApagar(gh, nome),
      })),
    };
    try {
      apagou = await apagarTodos(gh, nomes, dormir);
    } catch {
      // nunca lança: o valor pessimista acima (nada apagado) é o que vale, e
      // o dono recebe os comandos para apagar à mão
    }
    // DEPOIS de apagar: renova de novo (P6b) e solta a trava, loja por loja,
    // esperando cada uma (nenhuma renovação fica no meio)
    const { tokensNaoMortos, travasPresas } = await matarESoltar(
      presas,
      () => matarTokenNoFechar,
    );
    await esquecer(gh);
    estado = "fechada";
    return Object.freeze({ ...apagou, tokensNaoMortos, travasPresas });
  }

  return Object.freeze({
    lojas: Object.freeze(presas.map(([l]) => l)),
    foraDaSessao,
    validaAte,
    get estado() {
      return estado;
    },
    /** O token gravado no segredo da loja `ref`. Nunca renova. */
    tokenDe(ref) {
      if (estado !== "aberta") {
        throw new ErroDaPonte("Ponte: a sessão já foi fechada.", {
          codigo: "SESSAO_FECHADA",
        });
      }
      const t = tokens.get(ref);
      if (t === undefined) {
        throw new ErroDaPonte("Ponte: esta loja não está na sessão OAuth.", {
          codigo: "FORA_DA_SESSAO",
        });
      }
      return t;
    },
    fechar() {
      fechando ??= encerrar();
      return fechando;
    },
  });
}

// ------------------------------------------------------------ o gh real --

/** Sem cabeçalho que diga quanto esperar, a regra do GitHub é 1 minuto. */
const ESPERA_SEM_CABECALHO_MS = 60_000;

/**
 * Quanto esperar quando o GitHub recusa pelo LIMITE de pedidos (403 ou 429,
 * docs "Rate limits for the REST API"): `retry-after` (segundos ou data);
 * senão, com `x-ratelimit-remaining: 0`, até o `x-ratelimit-reset` (segundos
 * UTC); senão 1 minuto. Devolve null quando a recusa NÃO é de limite (um 403
 * de permissão não se repete). O corpo só é testado, nunca vai em mensagem.
 */
function esperaDoLimite(status, headers, texto, agora) {
  if (status !== 403 && status !== 429) return null;
  const ler = (nome) => {
    const v = headers?.get?.(nome);
    return typeof v === "string" ? v.trim() : null;
  };
  const depois = ler("retry-after");
  const restam = ler("x-ratelimit-remaining");
  const reset = ler("x-ratelimit-reset");
  const secundario = /secondary rate limit/i.test(String(texto ?? ""));
  if (status === 403 && depois === null && restam !== "0" && !secundario) {
    return null;
  }
  if (depois !== null) {
    if (/^\d{1,6}$/.test(depois)) return Number(depois) * 1000;
    const quando = Date.parse(depois);
    if (Number.isFinite(quando)) return Math.max(0, quando - agora());
  }
  if (restam === "0" && reset !== null && /^\d{1,12}$/.test(reset)) {
    return Math.max(0, Number(reset) * 1000 - agora());
  }
  return ESPERA_SEM_CABECALHO_MS;
}

/** Tira do texto do gh o que pode ser segredo e devolve uma linha curta. */
function redigir(texto, segredos) {
  let t = String(texto ?? "");
  for (const s of segredos) if (s) t = t.split(s).join("[redigido]");
  return t
    .replace(/\b(?:gh[opsur]_|github_pat_|sbp_)[A-Za-z0-9_]+/g, "[redigido]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * O gh de verdade. Grava com `gh secret set` (o gh cifra com a chave pública
 * do repositório), o valor pelo stdin. Apaga, lista e confere colaboradores
 * com fetch DENTRO do processo, com o token lido uma vez de `gh auth token`:
 * fechar a janela mata os filhos do console, e o apagar não pode depender de
 * um. Só mexe em segredo de loja OAuth do cadastro.
 * @param {{ repo: string, cadastro: object, spawn?: Function, fetch?: typeof fetch,
 *   executavel?: string, prazoMs?: number, env?: object }} opcoes
 */
export function criarGhReal({
  repo,
  cadastro,
  spawn = spawnPadrao,
  fetch: fetchFn = globalThis.fetch,
  executavel = "gh",
  prazoMs = PRAZO_GH_MS,
  env = process.env,
  agora = Date.now,
} = {}) {
  const m = RE_REPO.exec(typeof repo === "string" ? repo : "");
  if (!m || m[2] === "." || m[2] === "..") {
    throw new ErroDaPonte(
      "Ponte: o repositório precisa ser OWNER/REPO do GitHub.",
      {
        codigo: "PEDIDO_INVALIDO",
      },
    );
  }
  const oauth = lojasOAuthDo(cadastro);
  const permitidos = new Set(oauth.map((l) => l.nome));
  const gavetas = new Set(oauth.map((l) => l.ambiente));
  let emMemoria = null;
  let entrando = null;

  function exigirNome(nome) {
    if (typeof nome !== "string" || !permitidos.has(nome)) {
      throw new ErroDaPonte(
        "Ponte: o gh só mexe em segredo de loja OAuth do cadastro.",
        { codigo: "NOME_RECUSADO" },
      );
    }
  }

  function exigirAmbiente(ambiente) {
    if (typeof ambiente !== "string" || !gavetas.has(ambiente)) {
      throw new ErroDaPonte(
        "Ponte: o gh só mexe na gaveta (environment) de loja OAuth do cadastro.",
        { codigo: "NOME_RECUSADO" },
      );
    }
  }

  const caminhoDaGaveta = (ambiente) =>
    `/repos/${repo}/environments/${encodeURIComponent(ambiente)}`;

  function exigirToken() {
    if (emMemoria === null) {
      throw new ErroDaPonte("Ponte: o gh não entrou (chame entrar antes).", {
        codigo: "GH_SEM_LOGIN",
      });
    }
    return emMemoria;
  }

  /** spawn sem shell; o stdin leva `entrada` (ou nada). */
  function rodar(args, { entrada, sinal } = {}) {
    return new Promise((resolve, reject) => {
      let filho;
      try {
        filho = spawn(executavel, args, {
          env,
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        reject(
          new ErroDaPonte("Ponte: não consegui rodar o gh.", {
            codigo: "GH_AUSENTE",
          }),
        );
        return;
      }
      const saida = [];
      const erro = [];
      let estourou = false;
      let abortado = false;
      const matar = () => {
        try {
          filho.kill();
        } catch {
          // já morreu
        }
      };
      const relogio = setTimeout(() => {
        estourou = true;
        matar();
      }, prazoMs);
      const aoAbortar = () => {
        abortado = true;
        matar();
      };
      sinal?.addEventListener("abort", aoAbortar, { once: true });
      const fim = () => {
        clearTimeout(relogio);
        sinal?.removeEventListener("abort", aoAbortar);
      };
      filho.stdout.on("data", (b) => saida.push(Buffer.from(b)));
      filho.stderr.on("data", (b) => erro.push(Buffer.from(b)));
      filho.on("error", () => {
        fim();
        reject(
          new ErroDaPonte(
            "Ponte: o gh não foi encontrado ou não rodou (ele está instalado?).",
            { codigo: "GH_AUSENTE" },
          ),
        );
      });
      filho.on("close", (codigo) => {
        fim();
        resolve({
          codigo,
          estourou,
          abortado,
          saida: Buffer.concat(saida).toString("utf8"),
          erro: Buffer.concat(erro).toString("utf8"),
        });
      });
      filho.stdin.on("error", () => {}); // gh que morre cedo não derruba o Node
      if (sinal?.aborted) aoAbortar();
      if (entrada === undefined) filho.stdin.end();
      else filho.stdin.end(entrada, "utf8");
    });
  }

  /** GET/PUT/DELETE na API do GitHub com o token em memória. `corpo` vai
   * em JSON (só o PUT da gaveta usa). */
  async function api(metodo, caminho, onde, corpo) {
    const t = exigirToken();
    let r;
    try {
      r = await buscarComPrazo(
        fetchFn,
        `${API_GITHUB}${caminho}`,
        {
          method: metodo,
          redirect: "manual",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${t}`,
            "x-github-api-version": "2022-11-28",
            ...(corpo === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
        },
        prazoMs,
        onde,
      );
    } catch (e) {
      throw new ErroDaPonte(
        `Ponte: ${onde}: ${e instanceof ErroDaGestao ? e.message : "a conexão falhou"}`,
        {
          codigo: e?.codigo ?? "REDE",
        },
      );
    }
    return r;
  }

  /** O erro de uma resposta que não é a esperada: recusa pelo LIMITE de
   * pedidos sobe com codigo LIMITE_DO_GITHUB e `esperarMs` (quanto o GitHub
   * pediu); qualquer outra, com codigo HTTP. */
  function erroDaResposta(onde, { status, headers, texto }) {
    const esperarMs = esperaDoLimite(status, headers, texto, agora);
    if (esperarMs === null) {
      return new ErroDaPonte(`Ponte: ${onde} respondeu HTTP ${status}.`, {
        codigo: "HTTP",
        status,
      });
    }
    const e = new ErroDaPonte(
      `Ponte: ${onde} respondeu HTTP ${status}: limite de pedidos do GitHub (pediu ${Math.ceil(esperarMs / 1000)} s).`,
      { codigo: "LIMITE_DO_GITHUB", status },
    );
    e.esperarMs = esperarMs;
    return e;
  }

  /** A gaveta da loja existe depois disto: GET 200 não faz nada; GET 404
   * cria com PUT {} (o `gh secret set --env` NÃO cria: falha com 404,
   * medido em 26/11). Só gaveta de loja OAuth do cadastro, conferida antes
   * da rede. */
  async function garantirAmbiente(ambiente) {
    exigirAmbiente(ambiente);
    exigirToken();
    const caminho = caminhoDaGaveta(ambiente);
    const onde = `GitHub GET gaveta ${ambiente}`;
    const r = await api("GET", caminho, onde);
    if (r.status === 200) return;
    if (r.status !== 404) throw erroDaResposta(onde, r);
    const ondePut = `GitHub PUT gaveta ${ambiente}`;
    const p = await api("PUT", caminho, ondePut, {});
    if (p.status !== 200) throw erroDaResposta(ondePut, p);
  }

  function jsonOuNull(texto) {
    try {
      return JSON.parse(texto);
    } catch {
      return null;
    }
  }

  async function paginas(caminho, onde, extrair) {
    const itens = [];
    for (let pagina = 1; pagina <= TETO_PAGINAS; pagina++) {
      const sep = caminho.includes("?") ? "&" : "?";
      const { status, texto } = await api(
        "GET",
        `${caminho}${sep}per_page=${POR_PAGINA}&page=${pagina}`,
        onde,
      );
      if (status !== 200) {
        throw new ErroDaPonte(`Ponte: ${onde} respondeu HTTP ${status}.`, {
          codigo: "HTTP",
          status,
        });
      }
      const lote = extrair(jsonOuNull(texto));
      if (lote === null) {
        throw new ErroDaPonte(
          `Ponte: ${onde} respondeu num formato que eu não reconheço.`,
          {
            codigo: "RESPOSTA_INVALIDA",
          },
        );
      }
      itens.push(...lote.itens);
      if (
        lote.itens.length < POR_PAGINA ||
        (lote.total !== undefined && itens.length >= lote.total)
      ) {
        return itens;
      }
    }
    throw new ErroDaPonte(`Ponte: ${onde} passou de ${TETO_PAGINAS} páginas.`, {
      codigo: "RESPOSTA_INVALIDA",
    });
  }

  return {
    repo,
    dono: m[1],

    /** Lê `gh auth token` uma vez; o token fica só nesta memória. */
    entrar() {
      if (emMemoria !== null) return Promise.resolve();
      entrando ??= (async () => {
        const r = await rodar(["auth", "token", "--hostname", "github.com"]);
        const t = r.saida.trim();
        if (r.codigo !== 0 || !/^[\x21-\x7e]{1,4096}$/.test(t)) {
          throw new ErroDaPonte(
            "Ponte: o gh não devolveu um token (rode `gh auth login` nesta máquina).",
            { codigo: "GH_SEM_LOGIN" },
          );
        }
        emMemoria = t;
      })().finally(() => {
        entrando = null;
      });
      return entrando;
    },

    esquecer() {
      emMemoria = null;
    },

    garantirAmbiente,

    /** Quem tem push, maintain ou admin, em todas as afiliações. */
    async comEscrita() {
      exigirToken();
      const onde = "GitHub GET colaboradores";
      const lista = await paginas(
        `/repos/${repo}/collaborators?affiliation=all`,
        onde,
        (c) => (Array.isArray(c) ? { itens: c } : null),
      );
      return lista
        .map((c) => {
          const p = c?.permissions;
          if (
            typeof c?.login !== "string" ||
            p === null ||
            typeof p !== "object"
          ) {
            throw new ErroDaPonte(
              `Ponte: ${onde}: colaborador sem login ou sem permissões.`,
              {
                codigo: "RESPOSTA_INVALIDA",
              },
            );
          }
          return p.admin === true || p.maintain === true || p.push === true
            ? c.login
            : null;
        })
        .filter((l) => l !== null);
    },

    /** Os NOMES dos segredos de Actions do repositório. */
    async listar() {
      exigirToken();
      return paginas(
        `/repos/${repo}/actions/secrets`,
        "GitHub GET segredos",
        (c) =>
          c !== null &&
          typeof c === "object" &&
          Array.isArray(c.secrets) &&
          Number.isInteger(c.total_count) &&
          c.secrets.every((s) => typeof s?.name === "string")
            ? { itens: c.secrets.map((s) => s.name), total: c.total_count }
            : null,
      );
    },

    /** DELETE; só 204 é sucesso. Recusa pelo limite de pedidos sobe com
     * codigo LIMITE_DO_GITHUB e `esperarMs` (quanto o GitHub pediu). */
    async apagar(nome) {
      exigirNome(nome);
      exigirToken();
      const onde = `GitHub DELETE ${nome}`;
      const r = await api(
        "DELETE",
        `/repos/${repo}/actions/secrets/${nome}`,
        onde,
      );
      if (r.status !== 204) throw erroDaResposta(onde, r);
    },

    /** `gh secret set NOME --app actions --repo R`, valor pelo stdin sem quebra de linha. */
    async definir(nome, valor, { sinal } = {}) {
      exigirNome(nome);
      if (typeof valor !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(valor)) {
        throw new ErroDaPonte(
          "Ponte: valor de segredo vazio ou com caractere proibido.",
          {
            codigo: "PEDIDO_INVALIDO",
          },
        );
      }
      const r = await rodar(
        ["secret", "set", nome, "--app", "actions", "--repo", repo],
        {
          entrada: valor,
          sinal,
        },
      );
      if (r.abortado || r.estourou || r.codigo !== 0) {
        const motivo = r.abortado
          ? "interrompido"
          : r.estourou
            ? `sem resposta em ${prazoMs} ms`
            : `saiu com código ${r.codigo}`;
        const detalhe = redigir(r.erro, [valor, emMemoria]);
        throw new ErroDaPonte(
          `Ponte: gh secret set ${nome} ${motivo}${detalhe ? ` (${detalhe})` : ""}. O segredo PODE ter sido gravado.`,
          { codigo: r.abortado ? "ABERTURA_INTERROMPIDA" : "GH_FALHOU" },
        );
      }
    },
  };
}
