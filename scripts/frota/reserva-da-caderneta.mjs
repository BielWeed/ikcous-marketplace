#!/usr/bin/env node
/* eslint-disable security/detect-object-injection -- as chaves vêm do inventário que este script monta (hosts já conferidos), de canais-de-backend.json/politica.json versionados e de mapas fechados; nenhuma vem de quem chama. */
/* eslint-disable security/detect-non-literal-fs-filename -- lê só canais-de-backend.json ao lado do script; não há entrada remota. */
// A RESERVA DA CADERNETA (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`, T8):
// monta, compara e grava na Global Config da Vercel o documento que o
// porteiro lê quando a caderneta central falha e não há ficha
// (`src/hospedagem/reservaDaCaderneta.ts` define o formato e o confere na
// leitura).
//
// O QUE ENTRA: só o endereço cuja ficha o porteiro serviu ESTÁVEL, HTTP 200,
// caderneta `hit` e UM ref (`refDaLojaSondada`, a mesma régua do inventário
// do publicar-release). Nunca `reserva`, `miss`, `erro` nem loja fora do ar.
// Cada entrada leva só `u` (https://<ref>.supabase.co) e `k` (a chave
// PUBLICÁVEL da ficha, `conexao.publishableKey`, que todo visitante já
// recebe): nunca segredo, hash, nome nem estado.
//
// QUANDO GRAVA: só se a LISTA DE LOJAS (`hosts`) mudou. `sha` e `gerada_em`
// não contam (decisão do sócio, 26/11: o plano grátis dá 100 gravações por
// mês e ~25 releases por semana as estourariam). Gravar = UM PATCH com
// `upsert` da chave, o corpo pelo stdin (`vercel api ... --input -`, nunca
// no argv), e depois relê o item e confere campo a campo (a ordem das chaves
// que a store devolve não conta: `canonico`).
//
// ENDEREÇO QUE NÃO ENTRA: só sai em silêncio o que é DEFINITIVO (política,
// preview, adormecida/encerrada provada, `miss`, redirecionamento para loja da
// frota). Resultado INDETERMINADO (sonda sem resposta, instável, `erro`,
// `reserva`, 2+ refs, 3xx para outro destino) recusa o --gravar com o
// endereço no motivo (`classificarEndereco`); o --conferir só avisa.
//
// 3xx (ANOTADO da revisão Opus da T8, feito na T10): só é definitivo quando
// TODA amostra traz Location https, sem porta, para um host que ENTRA nesta
// mesma reserva (ficha estável 200 hit de um ref no mesmo inventário): a loja
// para onde o endereço encaminha está coberta. O 308 do porteiro não traz o
// ref, então "a própria loja" se prova assim, pelo destino. 3xx para outro
// host, para o login da Vercel (proteção de deployment) ou sem Location =
// INDETERMINADO, que bloqueia; nunca sai calado. LIMITE CONHECIDO (revisão
// Opus da T10, só anotado): um alias que encaminha para OUTRA loja da frota
// conta como definitivo e fica sem entrada na reserva; não vaza dado (com a
// caderneta fora, ele só deixa de abrir).
//
// RECUSA (sem falar com a Vercel): reserva vazia; falta loja obrigatória
// (todo canal de canais-de-backend.json, menos politica.json
// lojasSemBackendGerenciado — a mesma lista do publicar-release); mais de
// LIMITE_DE_BYTES; entrada que o porteiro recusaria (`validarReserva`, cuja
// régua `entradaInvalida` repete; o teste
// tests/front/reserva-da-caderneta-script-e-porteiro-concordam.test.ts trava
// a concordância: este arquivo é Node puro e não importa TypeScript).
//
// SEM STORE CONFIGURADA: politica.json reservaDaCaderneta.globalConfigId
// null (o dono ainda não criou a Global Config) = nada é lido nem gravado, e a
// saída diz isso.
//
// USO:
//   node scripts/frota/reserva-da-caderneta.mjs --conferir --sha <40hex>
//   node scripts/frota/reserva-da-caderneta.mjs --gravar   --sha <40hex>
//
//   --conferir  monta a reserva pelo inventário oficial (--vercel), lê a
//               atual e imprime a diferença. Nunca grava.
//   --gravar    o mesmo, e grava se a lista de lojas mudou. Inventário
//               PARCIAL recusa (faltaria loja na reserva).
//   --sha       a release que vai no documento (texto informativo).
//
// SAÍDA: 0 = conferida sem recusa / gravada / igual (nada a gravar);
//        1 = recusada, não configurada, cota ou falha; 2 = uso errado.
// No Git Bash, rodar à mão com MSYS_NO_PATHCONV=1 (o caminho da API começa
// com "/"); daqui o CLI é chamado sem shell e isso não importa.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  criarExecutorVercel,
  inventariar,
  lerPolitica,
  lojaForaDoAr,
  refDaLojaSondada,
  resolverCliVercel,
} from "./conferir-frota.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RE_SHA = /^[0-9a-f]{40}$/;
const RE_REF = /^[a-z]{20}$/;
const RE_ID_DA_STORE = /^ecfg_[A-Za-z0-9]+$/;
const RE_CHAVE_DO_ITEM = /^[A-Za-z0-9_-]{1,256}$/;
/** Igual a ENDERECO_DA_RESERVA_REGEX de src/hospedagem/reservaDaCaderneta.ts. */
const RE_ENDERECO = /^https:\/\/[a-z]{20}\.supabase\.co$/;
const ROTULO_DE_HOST = /^[a-z0-9-]{1,63}$/;

/** Teto do documento: a store inteira tem 1 MB no plano grátis. */
export const LIMITE_DE_BYTES = 900 * 1000;

const ehObjeto = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// ------------------------------------------------------------------ formato (espelho do porteiro)

function rotuloValido(rotulo) {
  return (
    ROTULO_DE_HOST.test(rotulo) &&
    !rotulo.startsWith("-") &&
    !rotulo.endsWith("-")
  );
}

/** Mesma régua de `hostNormalizado` em reservaDaCaderneta.ts. */
function hostNormalizado(host) {
  if (typeof host !== "string") return false;
  if (host.length === 0 || host.length > 253) return false;
  const rotulos = host.split(".");
  if (rotulos.length < 2 || !rotulos.every(rotuloValido)) return false;
  try {
    return new URL(`https://${host}`).hostname === host;
  } catch {
    return false;
  }
}

/** Mesma régua de `classifyPublicSupabaseKey` (src/lib/publicSupabaseKey.ts). */
function chaveEhPublica(chave) {
  if (typeof chave !== "string") return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(chave)) return true;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(chave))
    return false;
  try {
    const segmento = chave
      .split(".")[1]
      .replaceAll("-", "+")
      .replaceAll("_", "/");
    const payload = JSON.parse(
      atob(segmento.padEnd(Math.ceil(segmento.length / 4) * 4, "=")),
    );
    return ehObjeto(payload) && payload.role === "anon";
  } catch {
    return false;
  }
}

/**
 * Por que o porteiro recusaria esta entrada (`validarReserva`), ou null se
 * ela vale. Nunca cita a chave.
 */
export function entradaInvalida(host, entrada) {
  if (!hostNormalizado(host))
    return "host fora da forma normalizada (minúsculo, sem porta, 2+ rótulos)";
  if (!ehObjeto(entrada)) return "entrada não é um objeto";
  const campos = Object.keys(entrada);
  if (
    campos.length !== 2 ||
    !Object.hasOwn(entrada, "u") ||
    !Object.hasOwn(entrada, "k")
  )
    return "entrada tem de ter só os campos u e k";
  if (typeof entrada.u !== "string" || !RE_ENDERECO.test(entrada.u))
    return "endereço fora do padrão https://<ref de 20 letras>.supabase.co";
  if (!chaveEhPublica(entrada.k))
    return "a chave não é pública (sb_publishable_ ou JWT de papel anon)";
  return null;
}

// ------------------------------------------------------------------ montar e comparar

const STATUS_DE_REDIRECIONAMENTO = new Set([301, 302, 307, 308]);

/**
 * Por que o 3xx destas amostras NÃO prova encaminhamento para loja coberta
 * pela reserva, ou null se prova. `hostsDeLoja` = hosts que entram na reserva
 * no mesmo inventário. Cada amostra precisa de Location absoluto https, sem
 * porta, cujo host esteja em `hostsDeLoja`. Nunca devolve o Location inteiro
 * (a query pode ser longa): só o host.
 */
function destinoDoRedirecionamentoRecusado(amostras, hostsDeLoja) {
  for (const a of amostras) {
    const location = a?.location;
    if (typeof location !== "string" || location.length === 0)
      return `redirecionamento (HTTP ${a?.status ?? "-"}) sem Location`;
    let u;
    try {
      u = new URL(location);
    } catch {
      return `redirecionamento (HTTP ${a?.status ?? "-"}) com Location que não é um endereço absoluto`;
    }
    if (u.protocol !== "https:" || u.port !== "")
      return `redirecionamento (HTTP ${a?.status ?? "-"}) para ${u.protocol}//${u.host}: só https, sem porta, conta como loja`;
    if (!hostsDeLoja.has(u.hostname))
      return `redirecionamento (HTTP ${a?.status ?? "-"}) para ${u.hostname}, que não é endereço de loja nesta reserva (outro host ou login da Vercel)`;
  }
  return null;
}

/**
 * O que a sonda de UM endereço diz para a reserva:
 *   { tipo: "entra", ref }                — ficha estável 200 hit de UM ref;
 *   { tipo: "definitivo", motivo }        — o endereço não é loja no ar, e
 *     isso é CERTO: declarado na política (enderecosEsperados), alias de
 *     preview, loja adormecida/encerrada provada pelo contrato do porteiro
 *     (`lojaForaDoAr`), `miss` estável (sem-loja) ou redirecionamento estável
 *     cujo Location (em TODA amostra) é https para um host de
 *     `contexto.hostsDeLoja` (os que entram na reserva; sem o contexto, nenhum
 *     3xx é definitivo: falha fechada);
 *   { tipo: "indeterminado", motivo }     — qualquer outra coisa: sem ficha
 *     (a sonda não respondeu), amostras divergentes, `erro`, `reserva`, mais
 *     de um ref, HTTP inesperado.
 * Só o definitivo sai da reserva em silêncio. O indeterminado recusa o
 * --gravar: a reserva não pode encolher justamente quando a caderneta (ou a
 * rede) começa a falhar.
 */
export function classificarEndereco(sonda, politica = {}, contexto = {}) {
  const hostsDeLoja =
    contexto?.hostsDeLoja instanceof Set ? contexto.hostsDeLoja : new Set();
  const dominio = String(sonda?.dominio ?? "");
  const esperados = new Set(
    (politica?.enderecosEsperados ?? []).map((e) => e?.dominio),
  );
  if (esperados.has(dominio))
    return {
      tipo: "definitivo",
      motivo: "declarado em politica.json enderecosEsperados (não é loja)",
    };
  for (const padrao of politica?.aliasesDePreview ?? []) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- padrões da política versionada no repositório (aliasesDePreview), revisados por PR.
    if (new RegExp(padrao).test(dominio))
      return { tipo: "definitivo", motivo: "alias de preview" };
  }
  const fora = lojaForaDoAr(sonda);
  if (fora)
    return { tipo: "definitivo", motivo: `loja ${fora.estado} (${fora.ref})` };
  const ficha = sonda?.ficha;
  if (!ficha)
    return {
      tipo: "indeterminado",
      motivo: "a sonda não respondeu (nenhuma amostra da página)",
    };
  if (ficha.estavel !== true)
    return {
      tipo: "indeterminado",
      motivo: "amostras divergentes (ficha instável)",
    };
  const ref = refDaLojaSondada(ficha);
  if (ref !== null && RE_REF.test(ref)) return { tipo: "entra", ref };
  const caderneta = ficha.caderneta ?? "(sem cabeçalho)";
  if (caderneta === "miss")
    return { tipo: "definitivo", motivo: "caderneta miss (sem-loja)" };
  if (
    STATUS_DE_REDIRECIONAMENTO.has(ficha.status) &&
    caderneta !== "erro" &&
    caderneta !== "reserva"
  ) {
    const amostras =
      Array.isArray(sonda.amostras) && sonda.amostras.length
        ? sonda.amostras
        : [ficha];
    const recusa = destinoDoRedirecionamentoRecusado(amostras, hostsDeLoja);
    if (recusa) return { tipo: "indeterminado", motivo: recusa };
    return {
      tipo: "definitivo",
      motivo: `redirecionamento (HTTP ${ficha.status}) para loja desta reserva`,
    };
  }
  const refs = Array.isArray(ficha.refs) ? ficha.refs : [];
  if (caderneta === "hit" && refs.length !== 1)
    return {
      tipo: "indeterminado",
      motivo: `caderneta hit com ${refs.length} refs (esperado um só)`,
    };
  return {
    tipo: "indeterminado",
    motivo: `HTTP ${ficha.status ?? "-"}, caderneta ${caderneta}`,
  };
}

/**
 * Os hosts do inventário que ENTRAM na reserva (ficha estável 200 hit de um
 * ref): os únicos destinos de 3xx que contam como definitivo. A decisão de
 * "entra" não depende do contexto, então não há volta circular.
 */
export function hostsDeLojaDoInventario(inventario, politica = {}) {
  return new Set(
    (inventario?.sondas ?? [])
      .filter((s) => classificarEndereco(s, politica).tipo === "entra")
      .map((s) => s.dominio),
  );
}

/** Os endereços do inventário com resultado indeterminado: [{dominio, motivo}]. */
export function enderecosIndeterminados(inventario, politica = {}) {
  const contexto = {
    hostsDeLoja: hostsDeLojaDoInventario(inventario, politica),
  };
  return (inventario?.sondas ?? [])
    .map((s) => ({
      dominio: s?.dominio,
      ...classificarEndereco(s, politica, contexto),
    }))
    .filter((c) => c.tipo === "indeterminado")
    .map(({ dominio, motivo }) => ({ dominio, motivo }))
    .sort((a, b) =>
      a.dominio < b.dominio ? -1 : a.dominio > b.dominio ? 1 : 0,
    );
}

/**
 * O documento v1 a partir do inventário do conferir-frota (`inventariar`).
 * Hosts em ordem alfabética: frota igual = texto igual. Uma loja `hit` cuja
 * ficha não trouxe chave pública ENTRA com `k: null`, para a recusa dizer o
 * host em voz alta em vez de a loja sumir da reserva calada. Quem grava
 * confere ANTES `enderecosIndeterminados` (o documento só leva o que entra).
 */
export function montarReserva(inventario, { sha, agora, politica = {} }) {
  if (typeof sha !== "string" || !RE_SHA.test(sha))
    throw new Error(
      "montarReserva: sha precisa ter 40 caracteres hexadecimais",
    );
  if (typeof agora !== "number" || !Number.isFinite(agora))
    throw new Error("montarReserva: agora precisa ser um instante (ms)");
  const pares = [];
  const vistos = new Set();
  for (const sonda of inventario?.sondas ?? []) {
    const c = classificarEndereco(sonda, politica);
    if (c.tipo !== "entra") continue;
    const ref = c.ref;
    if (vistos.has(sonda.dominio)) continue;
    vistos.add(sonda.dominio);
    pares.push([
      sonda.dominio,
      { u: `https://${ref}.supabase.co`, k: sonda.chavePublica ?? null },
    ]);
  }
  pares.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    v: 1,
    gerada_em: new Date(agora).toISOString(),
    sha,
    hosts: Object.fromEntries(pares),
  };
}

const hostsDe = (doc) => (ehObjeto(doc?.hosts) ? doc.hosts : {});
const mesmaEntrada = (a, b) =>
  ehObjeto(a) && ehObjeto(b) && a.u === b.u && a.k === b.k;

/** Hosts que entram, saem e mudam (`u` ou `k`), cada lista em ordem. */
export function diferenca(atual, nova) {
  const antes = hostsDe(atual);
  const depois = hostsDe(nova);
  const ordenar = (l) => l.sort();
  return {
    entram: ordenar(
      Object.keys(depois).filter((h) => !Object.hasOwn(antes, h)),
    ),
    saem: ordenar(Object.keys(antes).filter((h) => !Object.hasOwn(depois, h))),
    mudam: ordenar(
      Object.keys(depois).filter(
        (h) => Object.hasOwn(antes, h) && !mesmaEntrada(antes[h], depois[h]),
      ),
    ),
  };
}

function cabecalhoValido(doc) {
  return (
    ehObjeto(doc) &&
    doc.v === 1 &&
    typeof doc.gerada_em === "string" &&
    doc.gerada_em.length > 0 &&
    typeof doc.sha === "string" &&
    doc.sha.length > 0 &&
    ehObjeto(doc.hosts)
  );
}

/**
 * A reserva atual já serve? Só a LISTA DE LOJAS conta (sha e gerada_em
 * não). Atual ausente, com cabeçalho fora do formato ou com qualquer entrada
 * que o porteiro recusaria = diferente (regravar conserta).
 */
export function mesmaListaDeLojas(atual, nova) {
  if (!cabecalhoValido(atual)) return false;
  const a = Object.entries(atual.hosts);
  if (a.some(([h, e]) => entradaInvalida(h, e) !== null)) return false;
  const d = diferenca(atual, nova);
  return (
    d.entram.length === 0 &&
    d.saem.length === 0 &&
    d.mudam.length === 0 &&
    a.length === Object.keys(nova.hosts).length
  );
}

export function descreverDiferenca(d) {
  const linhas = [
    ...d.entram.map((h) => `- entra: ${h}`),
    ...d.saem.map((h) => `- sai: ${h}`),
    ...d.mudam.map((h) => `- muda (banco ou chave): ${h}`),
  ];
  return linhas.length ? linhas : ["- nenhuma loja entra, sai ou muda"];
}

const bytesDe = (doc) => Buffer.byteLength(JSON.stringify(doc), "utf8");

/** As lojas que a reserva TEM de levar: a mesma lista do publicar-release. */
export function lojasObrigatoriasDosCanais(canais, politica) {
  const semBackend = new Set(
    (politica?.lojasSemBackendGerenciado ?? []).map((l) => l.ref),
  );
  return Object.entries(canais?.canais ?? {})
    .filter(([ref]) => !semBackend.has(ref))
    .map(([ref, canal]) => ({ ref, nome: canal.nome }));
}

/** Os motivos de recusa (vazio = pode gravar). Nenhum cita chave. */
export function problemasDaReserva(nova, { lojasObrigatorias = [] } = {}) {
  const problemas = [];
  if (!cabecalhoValido(nova))
    return ["reserva fora do formato v1 (v, gerada_em, sha, hosts)"];
  const hosts = Object.entries(nova.hosts);
  if (hosts.length === 0)
    problemas.push(
      "reserva vazia: nenhuma loja com ficha hit estável no inventário",
    );
  const refs = new Set();
  for (const [host, e] of hosts) {
    const motivo = entradaInvalida(host, e);
    if (motivo) problemas.push(`entrada de ${host} recusada: ${motivo}`);
    else refs.add(e.u.slice("https://".length, -".supabase.co".length));
  }
  for (const { ref, nome } of lojasObrigatorias)
    if (!refs.has(ref))
      problemas.push(
        `falta a loja obrigatória ${nome ?? ref} (${ref}, canais-de-backend.json): nenhum endereço dela com ficha hit estável`,
      );
  const bytes = bytesDe(nova);
  if (bytes > LIMITE_DE_BYTES)
    problemas.push(
      `reserva com ${bytes} bytes passa do teto de 900 KB (${LIMITE_DE_BYTES} bytes; a store inteira tem 1 MB)`,
    );
  return problemas;
}

// ------------------------------------------------------------------ política

/** O bloco `reservaDaCaderneta` da política, conferido. */
export function configDaReserva(politica) {
  const bloco = politica?.reservaDaCaderneta;
  const time = politica?.projetoVercel?.time ?? null;
  const base = {
    configurada: false,
    globalConfigId: bloco?.globalConfigId ?? null,
    chave: bloco?.chave ?? null,
    time,
  };
  if (!ehObjeto(bloco))
    return {
      ...base,
      motivo:
        "a reserva da caderneta não está configurada: politica.json não tem o bloco reservaDaCaderneta",
    };
  if (typeof bloco.chave !== "string" || !RE_CHAVE_DO_ITEM.test(bloco.chave))
    return {
      ...base,
      motivo: "politica.json reservaDaCaderneta.chave fora do formato",
    };
  if (bloco.globalConfigId === null)
    return {
      ...base,
      motivo:
        "a reserva da caderneta não está configurada: politica.json reservaDaCaderneta.globalConfigId é null (a Global Config ainda não foi criada e conectada ao projeto). Nada foi lido nem gravado.",
    };
  if (
    typeof bloco.globalConfigId !== "string" ||
    !RE_ID_DA_STORE.test(bloco.globalConfigId)
  )
    return {
      ...base,
      motivo:
        "politica.json reservaDaCaderneta.globalConfigId fora do formato (esperado ecfg_...)",
    };
  if (typeof time !== "string" || !/^team_[A-Za-z0-9]+$/.test(time))
    return { ...base, motivo: "politica.json projetoVercel.time ausente" };
  return { ...base, configurada: true, motivo: null };
}

// ------------------------------------------------------------------ vercel api

/** Rodar um processo sem shell, com o texto `entrada` no stdin. */
export function rodarProcesso(comando, args, { entrada = "", env } = {}) {
  return new Promise((resolve) => {
    const filho = execFile(
      comando,
      args,
      {
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: env ?? process.env,
      },
      (erro, stdout, stderr) =>
        resolve({
          codigo: erro ? (typeof erro.code === "number" ? erro.code : 1) : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        }),
    );
    filho.stdin?.on("error", () => {});
    filho.stdin?.end(entrada);
  });
}

// Sem código documentado pela Vercel para a cota (26/11/2026): 402 e os
// textos de limite de gravação/pagamento. Falso negativo cai em "falhou",
// que também não promove; só a mensagem muda.
const RE_COTA =
  /\b402\b|payment|quota|writes?\b[^\n]{0,40}\b(limit|exceed)|\b(limit|exceed)[^\n]{0,40}\bwrites?\b/i;

const primeiraLinha = (texto) =>
  String(texto ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !/^<claude-code-hint\b/.test(l)) ?? "";

/**
 * `vercel api` com o login da CLI do dono. `get(caminho)` devolve o JSON
 * lido, ou null se a resposta veio vazia (204: item ausente). `patch` manda o
 * corpo SÓ pelo stdin (`--input -`). Falha lança Error com `cota: true` quando
 * a recusa é pelo limite de gravações.
 */
export function criarVercelApi({
  rodar = rodarProcesso,
  cli = null,
  env = process.env,
} = {}) {
  const { comando, prefixo } = cli ?? resolverCliVercel({ env });
  const chamar = async (caminho, metodo, corpo) => {
    const args = [...prefixo, "api", caminho, "-X", metodo];
    if (corpo !== undefined) args.push("--input", "-");
    args.push("--raw");
    const r = await rodar(comando, args, {
      entrada: corpo === undefined ? "" : JSON.stringify(corpo),
      env,
    });
    const limpo = String(r.stdout ?? "")
      .split("\n")
      .filter((l) => !/^<claude-code-hint\b/.test(l))
      .join("\n")
      .trim();
    if (r.codigo !== 0) {
      let codigoDaApi = "";
      try {
        const e = JSON.parse(limpo)?.error;
        codigoDaApi = [e?.code, e?.message].filter(Boolean).join(": ");
      } catch {
        /* resposta de erro sem JSON: fica só o stderr */
      }
      const texto = [primeiraLinha(r.stderr), codigoDaApi]
        .filter(Boolean)
        .join(" / ")
        .slice(0, 300);
      const erro = new Error(`vercel api falhou${texto ? `: ${texto}` : ""}`);
      erro.cota = RE_COTA.test(`${r.stderr}\n${limpo}`);
      throw erro;
    }
    if (limpo === "") return null;
    try {
      return JSON.parse(limpo);
    } catch {
      // Mensagem fixa de propósito: o erro do JSON.parse cita um pedaço do texto.
      throw new Error("vercel api respondeu algo que não é JSON");
    }
  };
  return {
    get: (caminho) => chamar(caminho, "GET"),
    patch: (caminho, corpo) => chamar(caminho, "PATCH", corpo),
  };
}

const caminhoDoItem = (c) =>
  `/v1/global-config/${encodeURIComponent(c.globalConfigId)}/item/${encodeURIComponent(c.chave)}?teamId=${encodeURIComponent(c.time)}`;
const caminhoDosItens = (c) =>
  `/v1/global-config/${encodeURIComponent(c.globalConfigId)}/items?teamId=${encodeURIComponent(c.time)}`;

/** O valor gravado hoje (null = a store não tem a chave). Lança se não leu. */
export async function lerReservaAtual(api, config) {
  const r = await api.get(caminhoDoItem(config));
  if (r === null) return null;
  if (!ehObjeto(r) || r.key !== config.chave || !Object.hasOwn(r, "value"))
    throw new Error("item da Global Config fora do contrato ({key, value})");
  return r.value;
}

/**
 * JSON com as chaves dos objetos em ordem, em toda a profundidade: a store
 * pode devolver as chaves em outra ordem e o conteúdo continuar o mesmo.
 * Arrays mantêm a ordem (nela a ordem é conteúdo).
 */
export function canonico(valor) {
  const ordenar = (v) => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (!ehObjeto(v)) return v;
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, ordenar(v[k])]),
    );
  };
  return JSON.stringify(ordenar(valor));
}

/** Recusas pelos endereços indeterminados (lista ausente também recusa). */
export function problemasDosIndeterminados(indeterminados) {
  if (!Array.isArray(indeterminados))
    return [
      "lista de endereços indeterminados não informada (enderecosIndeterminados): sem ela não há como provar que nenhum endereço sumiu da reserva calado",
    ];
  return indeterminados.map(
    ({ dominio, motivo }) =>
      `o endereço ${dominio} deu resultado indeterminado (${motivo}): gravar agora o tiraria da reserva; repetir a conferência`,
  );
}

const MENSAGEM_DE_COTA =
  "limite de gravações do plano grátis da Vercel atingido (Global Config: 100 gravações por mês): a reserva NÃO foi gravada; a que está na store continua valendo até o mês virar";

/**
 * Grava a reserva se a lista de lojas mudou. Nunca lança: devolve
 * { ok, estado, motivos, diferenca }, com estado
 *   igual | gravada              (ok)
 *   nao-configurada | recusada | cota | falhou   (não ok).
 * Recusa e não-configurada não falam com a Vercel. `indeterminados`
 * (de `enderecosIndeterminados`) é OBRIGATÓRIO: sem a lista, ou com algum
 * endereço nela, recusa — o endereço sumiria da reserva calado.
 */
export async function gravarReserva({
  nova,
  api,
  config,
  lojasObrigatorias = [],
  indeterminados,
}) {
  const resultado = (ok, estado, motivos = [], dif = null) => ({
    ok,
    estado,
    motivos,
    diferenca: dif,
  });
  if (!config?.configurada)
    return resultado(false, "nao-configurada", [
      config?.motivo ??
        "a reserva da caderneta não está configurada (politica.json reservaDaCaderneta)",
    ]);
  const problemas = [
    ...problemasDosIndeterminados(indeterminados),
    ...problemasDaReserva(nova, { lojasObrigatorias }),
  ];
  if (problemas.length) return resultado(false, "recusada", problemas);
  let atual;
  try {
    atual = await lerReservaAtual(api, config);
  } catch (e) {
    return resultado(false, "falhou", [
      `reserva atual não lida (nada foi gravado): ${e.message}`,
    ]);
  }
  const dif = diferenca(atual, nova);
  if (mesmaListaDeLojas(atual, nova)) return resultado(true, "igual", [], dif);
  try {
    await api.patch(caminhoDosItens(config), {
      items: [{ operation: "upsert", key: config.chave, value: nova }],
    });
  } catch (e) {
    return e.cota
      ? resultado(false, "cota", [`${MENSAGEM_DE_COTA} (${e.message})`], dif)
      : resultado(false, "falhou", [`gravação recusada: ${e.message}`], dif);
  }
  let lida;
  try {
    lida = await lerReservaAtual(api, config);
  } catch (e) {
    return resultado(
      false,
      "falhou",
      [`gravada, mas a releitura falhou: ${e.message}`],
      dif,
    );
  }
  if (canonico(lida) !== canonico(nova))
    return resultado(
      false,
      "falhou",
      [
        "a releitura não é igual ao que foi gravado (mesmos campos e valores, em qualquer ordem): conferir a store antes de publicar",
      ],
      dif,
    );
  return resultado(true, "gravada", [], dif);
}

// ------------------------------------------------------------------ linha de comando

const USO =
  "uso: node scripts/frota/reserva-da-caderneta.mjs (--conferir | --gravar) --sha <40hex>";

function lerArgumentos(argv) {
  let acao = null;
  let sha = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--conferir" || a === "--gravar") {
      if (acao) return { erro: "só uma ação por vez" };
      acao = a;
    } else if (a === "--sha") {
      sha = argv[++i] ?? null;
    } else {
      return { erro: `argumento desconhecido: ${a}` };
    }
  }
  if (!acao) return { erro: "falta a ação (--conferir ou --gravar)" };
  if (typeof sha !== "string" || !RE_SHA.test(sha))
    return { erro: "--sha <40 hex> é obrigatório" };
  return { acao, sha };
}

/** deps: { politica, canais, inventariar(politica), api, agora() }. */
export async function executar(argv, deps) {
  const saida = [];
  const erros = [];
  const args = lerArgumentos(argv);
  if (args.erro) return { codigo: 2, saida, erros: [args.erro, USO] };
  const config = configDaReserva(deps.politica);
  const inventario = await deps.inventariar(deps.politica);
  const nova = montarReserva(inventario, {
    sha: args.sha,
    agora: deps.agora(),
    politica: deps.politica,
  });
  const indeterminados = enderecosIndeterminados(inventario, deps.politica);
  const lojasObrigatorias = lojasObrigatoriasDosCanais(
    deps.canais,
    deps.politica,
  );
  const problemas = problemasDaReserva(nova, { lojasObrigatorias });
  saida.push(
    "# Reserva da caderneta",
    "",
    `Montada: ${Object.keys(nova.hosts).length} endereços, ${bytesDe(nova)} bytes (release ${args.sha.slice(0, 7)}).`,
  );
  if (!inventario?.completo)
    saida.push(
      `Inventário PARCIAL: ${inventario?.motivoParcial ?? "motivo não informado"}.`,
    );
  if (!config.configurada) {
    erros.push(config.motivo);
    for (const p of problemas) erros.push(`RECUSADA: ${p}`);
    return { codigo: 1, saida, erros };
  }

  if (args.acao === "--conferir") {
    let atual;
    try {
      atual = await lerReservaAtual(deps.api, config);
    } catch (e) {
      erros.push(`reserva atual não lida: ${e.message}`);
      return { codigo: 1, saida, erros };
    }
    saida.push(
      "",
      atual === null
        ? "Na store: nenhuma reserva gravada ainda."
        : `Na store: ${Object.keys(hostsDe(atual)).length} endereços (release ${String(atual?.sha ?? "?").slice(0, 7)}).`,
      mesmaListaDeLojas(atual, nova)
        ? "Igual à atual (só a lista de lojas conta): --gravar não gravaria nada."
        : "Diferente da atual: --gravar gravaria.",
      "",
      ...descreverDiferenca(diferenca(atual, nova)),
    );
    // No --conferir o indeterminado só AVISA (o --gravar recusaria).
    for (const p of problemasDosIndeterminados(indeterminados))
      saida.push(`AVISO: ${p}`);
    for (const p of problemas) erros.push(`RECUSADA: ${p}`);
    return { codigo: problemas.length ? 1 : 0, saida, erros };
  }

  if (!inventario?.completo) {
    erros.push(
      "RECUSADA: inventário PARCIAL: gravar deixaria loja fora da reserva (rodar com a lista de aliases da Vercel)",
    );
    return { codigo: 1, saida, erros };
  }
  const r = await gravarReserva({
    nova,
    api: deps.api,
    config,
    lojasObrigatorias,
    indeterminados,
  });
  if (r.diferenca) saida.push("", ...descreverDiferenca(r.diferenca));
  if (r.estado === "igual")
    saida.push("", "Igual à atual (só a lista de lojas conta): nada gravado.");
  if (r.estado === "gravada")
    saida.push("", "Gravada e conferida na releitura.");
  const rotulo = {
    recusada: "RECUSADA",
    cota: "COTA",
    falhou: "FALHOU",
    "nao-configurada": "NÃO CONFIGURADA",
  }[r.estado];
  for (const m of r.motivos) erros.push(rotulo ? `${rotulo}: ${m}` : m);
  return { codigo: r.ok ? 0 : 1, saida, erros };
}

export function lerCanaisDaReserva(
  caminho = path.join(AQUI, "canais-de-backend.json"),
) {
  const c = JSON.parse(readFileSync(caminho, "utf8"));
  for (const ref of Object.keys(c.canais ?? {}))
    if (!RE_REF.test(ref))
      throw new Error(`canais-de-backend.json: ref inválido ${ref}`);
  return c;
}

/** As dependências reais: política e canais do disco, inventário oficial (--vercel), CLI vercel logada. */
export function dependenciasDoComando() {
  const executorVercel = criarExecutorVercel();
  return {
    politica: lerPolitica(),
    canais: lerCanaisDaReserva(),
    inventariar: (p) => inventariar(p, { pedirVercel: true, executorVercel }),
    api: criarVercelApi(),
    agora: () => Date.now(),
  };
}

export async function main(argv = process.argv.slice(2), deps = undefined) {
  const uso = lerArgumentos(argv);
  if (uso.erro) {
    // Uso errado sai 2 sem montar as dependências (nem procurar o CLI).
    console.error(uso.erro);
    console.error(USO);
    return 2;
  }
  let r;
  try {
    r = await executar(argv, deps ?? dependenciasDoComando());
  } catch (e) {
    console.error(`erro inesperado: ${e?.message ?? e}`);
    return 1;
  }
  for (const l of r.saida) console.log(l);
  for (const l of r.erros) console.error(l);
  return r.codigo;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().then(
    (c) => {
      process.exitCode = c;
    },
    (e) => {
      console.error(`erro inesperado: ${e?.message ?? e}`);
      process.exitCode = 1;
    },
  );
}
