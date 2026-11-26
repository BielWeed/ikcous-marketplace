#!/usr/bin/env node
/* eslint-disable security/detect-object-injection -- as chaves vêm de mapas fechados deste arquivo e do inventário que o conferir-frota monta (hosts já conferidos); nenhuma vem de quem chama. */
// A PROVA DO CANDIDATO (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`, T12 e
// "Prova"): pergunta ao deploy CANDIDATO (o `.vercel.app` único, ainda não
// promovido) o que o porteiro DELE decide para cada loja da frota, e confere
// que cada uma abre com o banco (ref) que o inventário de produção mostra.
//
// A rota é a sonda do candidato (`src/hospedagem/sondaDoCandidato.ts`, T7):
// `GET /__ikcous/sonda-do-candidato?host=<loja>` devolve JSON
// `{host, porteiro, caderneta, ref, destinoDaCaderneta}`. Ela só existe no
// endereço único do deploy, com `IKCOUS_SONDA_DO_CANDIDATO=1` e em
// Production; fora disso dá 404. O teto dela é 60 sondas por minuto por
// instância, então aqui o ritmo é UMA sonda por segundo (300 lojas ≈ 5 min).
//
// O INVENTÁRIO é o mesmo que o publicar-release e o reserva-da-caderneta
// usam: `inventariar` do conferir-frota com a lista oficial de aliases da
// Vercel, e a mesma régua de quem entra (`classificarEndereco`: ficha estável,
// HTTP 200, caderneta `hit`, UM ref). Endereço que não é loja no ar (política,
// preview, adormecida, `miss`, redirecionamento) não é sondado.
//
// O RESULTADO:
//   SIM      — toda loja do inventário abriu no candidato com o ref certo (e,
//              com --caderneta, pela caderneta esperada), e o inventário está
//              completo.
//   NÃO      — o candidato respondeu, e alguma loja abriu com OUTRO ref, não
//              abriu, ou abriu por outra caderneta que a esperada.
//   INCERTO  — não deu para provar: sonda desligada (404), limite (429) que
//              não passou, rede caída, resposta fora do contrato, inventário
//              parcial ou com endereço indeterminado, loja obrigatória fora
//              do inventário, ou nenhuma loja para sondar. Nunca vira SIM.
// NÃO vence INCERTO: uma divergência provada já basta para não promover.
//
// SAÍDA SEM SEGREDO: da resposta só sai o que passa pela régua (ref de 20
// letras, palavra curta, nome de host); o corpo nunca é repetido.
//
// USO:
//   node scripts/frota/sondar-candidato.mjs --candidato https://<deploy>.vercel.app
//   node scripts/frota/sondar-candidato.mjs --candidato <url> --caderneta reserva
//
//   --candidato  o endereço ÚNICO do deploy (o que `vercel deploy` imprime),
//                nunca o domínio de uma loja nem o alias do projeto.
//   --caderneta  hit | reserva: exige que toda loja tenha aberto por ela
//                (controle = hit; provas 1 e 2 = reserva).
//
// CÓDIGO DE SAÍDA: 0 = SIM; 1 = NÃO; 2 = uso errado; 3 = INCERTO.

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  criarExecutorVercel,
  inventariar,
  lerPolitica,
} from "./conferir-frota.mjs";
import {
  classificarEndereco,
  enderecosIndeterminados,
  lerCanaisDaReserva,
  lojasObrigatoriasDosCanais,
} from "./reserva-da-caderneta.mjs";

/** Igual a CAMINHO_DA_SONDA de src/hospedagem/sondaDoCandidato.ts. */
export const CAMINHO_DA_SONDA = "/__ikcous/sonda-do-candidato";
/** Uma sonda por segundo: o teto da rota é 60 por minuto por instância. */
export const RITMO_MS = 1000;
/** Quantas vezes UMA loja é tentada quando a resposta é 429. */
export const TENTATIVAS_COM_LIMITE = 3;
/** Espera máxima antes de repetir um 429 (o retry-after da sonda é 60). */
const ESPERA_MAXIMA_DO_LIMITE_MS = 60_000;
/** Prazo de cada pedido: a sonda espera a caderneta (5 s) e o banco da loja. */
const PRAZO_DO_PEDIDO_MS = 20_000;
const AVISO_DE_PROGRESSO_A_CADA = 30;

const CADERNETAS_ESPERAVEIS = new Set(["hit", "reserva"]);
const RE_REF = /^[a-z0-9]{20}$/;
// A mesma régua de `palavraCurta` da sonda: o que fugir dela é fora do contrato.
const PALAVRA_CURTA = /^[a-z][a-z-]{0,31}$/;
const SO_LETRA_DIGITO_HIFEN = /^[a-z0-9-]+$/;
const RE_DEPLOY_VERCEL = /^[a-z0-9-]+\.vercel\.app$/;

const ehObjeto = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// ------------------------------------------------------------------ réguas

function rotuloValido(rotulo) {
  return (
    rotulo.length >= 1 &&
    rotulo.length <= 63 &&
    SO_LETRA_DIGITO_HIFEN.test(rotulo) &&
    !rotulo.startsWith("-") &&
    !rotulo.endsWith("-")
  );
}

/**
 * O host é aceito pela sonda? Mesma régua de `hostDaSonda`
 * (sondaDoCandidato.ts): minúsculo, sem porta, sem ponto final, só rótulos
 * DNS, 2+ rótulos, até 253 caracteres, último rótulo com letra (IP não é
 * loja). O teste tests/frota_sondar_candidato_test.ts trava a concordância
 * (este arquivo é Node puro e não importa TypeScript).
 */
export function hostSondavel(host) {
  if (typeof host !== "string") return false;
  if (host.length === 0 || host.length > 253) return false;
  const rotulos = host.split(".");
  if (rotulos.length < 2 || !rotulos.every(rotuloValido)) return false;
  return /[a-z]/.test(rotulos[rotulos.length - 1]);
}

/**
 * O endereço do candidato: `https://<nome>.vercel.app`, sem caminho, consulta
 * nem credencial. Sem protocolo vale como https (o dono cola do painel).
 * Devolve { origem } ou { erro }.
 */
export function urlDoCandidato(texto) {
  const bruto = String(texto ?? "").trim();
  if (bruto === "") return { erro: "falta o endereço do candidato" };
  const comProtocolo = /^[a-z]+:\/\//i.test(bruto) ? bruto : `https://${bruto}`;
  let url;
  try {
    url = new URL(comProtocolo);
  } catch {
    return { erro: "o endereço do candidato não é uma URL" };
  }
  if (url.protocol !== "https:")
    return { erro: "o endereço do candidato tem de ser https" };
  if (url.username || url.password)
    return { erro: "o endereço do candidato não leva usuário nem senha" };
  if (url.port) return { erro: "o endereço do candidato não leva porta" };
  if (!RE_DEPLOY_VERCEL.test(url.hostname))
    return {
      erro: "o candidato tem de ser o endereço único do deploy, terminado em .vercel.app (o que o vercel deploy imprime), nunca o domínio de uma loja",
    };
  if (url.pathname !== "/" || url.search || url.hash)
    return { erro: "o endereço do candidato vai sem caminho nem consulta" };
  return { origem: url.origin };
}

// ------------------------------------------------------------------ inventário

/**
 * As lojas a sondar, a partir do inventário do conferir-frota: [{host, ref}]
 * em ordem, só o que `classificarEndereco` deixa entrar na reserva. Junto:
 *   invalidos  — hosts fora da régua da sonda (recusam ANTES de sondar);
 *   problemas  — o que impede o SIM mesmo com toda sonda boa (inventário
 *                parcial, endereço indeterminado, loja obrigatória ausente).
 */
export function alvosDoInventario(inventario, politica, lojasObrigatorias) {
  const problemas = [];
  if (!inventario?.completo)
    problemas.push(
      `inventário PARCIAL (${inventario?.motivoParcial ?? "motivo não informado"}): pode faltar loja na prova`,
    );
  for (const { dominio, motivo } of enderecosIndeterminados(
    inventario,
    politica,
  ))
    problemas.push(
      `o endereço ${dominio} deu resultado indeterminado no inventário (${motivo}): sem o ref de produção, não há com o que comparar`,
    );
  const alvos = [];
  const invalidos = [];
  const vistos = new Set();
  for (const sonda of inventario?.sondas ?? []) {
    const c = classificarEndereco(sonda, politica);
    if (c.tipo !== "entra") continue;
    const host = sonda.dominio;
    if (vistos.has(host)) continue;
    vistos.add(host);
    if (!hostSondavel(host)) invalidos.push(String(host));
    else alvos.push({ host, ref: c.ref });
  }
  alvos.sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  const refs = new Set(alvos.map((a) => a.ref));
  for (const { ref, nome } of lojasObrigatorias ?? [])
    if (!refs.has(ref))
      problemas.push(
        `a loja obrigatória ${nome ?? ref} (${ref}, canais-de-backend.json) não tem endereço com ficha hit estável no inventário`,
      );
  return { alvos, invalidos, problemas };
}

// ------------------------------------------------------------------ sonda

function esperaDoLimite(res) {
  const segundos = Number(res.headers.get("retry-after"));
  if (!Number.isFinite(segundos) || segundos <= 0)
    return ESPERA_MAXIMA_DO_LIMITE_MS;
  return Math.min(
    Math.max(segundos * 1000, RITMO_MS),
    ESPERA_MAXIMA_DO_LIMITE_MS,
  );
}

const descreverErro = (e) =>
  e?.name === "TimeoutError" || e?.name === "AbortError"
    ? `sem resposta em ${PRAZO_DO_PEDIDO_MS / 1000} s`
    : "erro de rede";

/** Só o nome do host do destino da caderneta, se passar pela régua. */
function destinoLegivel(valor) {
  if (valor === null) return null;
  return typeof valor === "string" && hostSondavel(valor)
    ? valor
    : "desconhecido";
}

/**
 * Lê o corpo 200 da sonda. Devolve { porteiro, caderneta, ref, destino } ou
 * null se fugir do contrato (outro host, campo fora da régua, não JSON).
 */
async function lerCorpo(res, host) {
  let corpo;
  try {
    corpo = JSON.parse(await res.text());
  } catch {
    return null;
  }
  if (!ehObjeto(corpo) || corpo.host !== host) return null;
  const { porteiro, caderneta, ref } = corpo;
  if (typeof porteiro !== "string" || !PALAVRA_CURTA.test(porteiro))
    return null;
  if (typeof caderneta !== "string" || !PALAVRA_CURTA.test(caderneta))
    return null;
  if (ref !== null && (typeof ref !== "string" || !RE_REF.test(ref)))
    return null;
  return {
    porteiro,
    caderneta,
    ref,
    destino: destinoLegivel(corpo.destinoDaCaderneta ?? null),
  };
}

/**
 * Sonda UMA loja (com as repetições do 429). Devolve
 *   { tipo: "ok" | "divergente" | "incerto", host, motivo, caderneta?, destino? }
 * ou { tipo: "parar", motivo } quando a resposta vale para o deploy inteiro
 * (404 = sonda desligada; 429 que não passou).
 */
async function sondarLoja(
  candidato,
  { host, ref: esperado },
  { fetchImpl, esperar, cadernetaEsperada },
) {
  const url = `${candidato}${CAMINHO_DA_SONDA}?host=${encodeURIComponent(host)}`;
  for (let tentativa = 1; ; tentativa++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(PRAZO_DO_PEDIDO_MS),
      });
    } catch (e) {
      return { tipo: "incerto", host, motivo: descreverErro(e) };
    }
    if (res.status === 429) {
      await res.body?.cancel().catch(() => {});
      if (tentativa >= TENTATIVAS_COM_LIMITE)
        return {
          tipo: "parar",
          host,
          motivo: `a sonda respondeu 429 (limite de 60 por minuto) ${TENTATIVAS_COM_LIMITE} vezes seguidas em ${host}: outra prova rodando ao mesmo tempo? Esperar 2 minutos e rodar de novo`,
        };
      await esperar(esperaDoLimite(res));
      continue;
    }
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return {
        tipo: "parar",
        host,
        motivo:
          "a sonda respondeu 404: ela está desligada neste endereço. Usar o endereço ÚNICO do deploy (não o alias), de um deploy de Production feito com --env IKCOUS_SONDA_DO_CANDIDATO=1",
      };
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return {
        tipo: "incerto",
        host,
        motivo: `a sonda respondeu HTTP ${res.status}`,
      };
    }
    const corpo = await lerCorpo(res, host);
    if (corpo === null)
      return {
        tipo: "incerto",
        host,
        motivo: "resposta 200 fora do contrato da sonda",
      };
    const base = {
      host,
      caderneta: corpo.caderneta,
      destino: corpo.destino,
    };
    if (corpo.ref === null || corpo.porteiro !== "ok")
      return {
        ...base,
        tipo: "divergente",
        motivo: `não abriu a loja (porteiro ${corpo.porteiro}, caderneta ${corpo.caderneta}); esperado o banco ${esperado}`,
      };
    if (corpo.ref !== esperado)
      return {
        ...base,
        tipo: "divergente",
        motivo: `abriu o banco ${corpo.ref}, esperado ${esperado} (caderneta ${corpo.caderneta})`,
      };
    if (cadernetaEsperada && corpo.caderneta !== cadernetaEsperada)
      return {
        ...base,
        tipo: "divergente",
        motivo: `abriu o banco certo pela caderneta ${corpo.caderneta}, esperada ${cadernetaEsperada}`,
      };
    return {
      ...base,
      tipo: "ok",
      motivo: `banco ${corpo.ref}, caderneta ${corpo.caderneta}`,
    };
  }
}

/**
 * Sonda o candidato loja por loja, UMA por segundo (`esperar(RITMO_MS)` antes
 * de cada sonda menos a primeira). Nunca lança por falha de rede. Devolve
 * { veredito: "SIM" | "NÃO" | "INCERTO", resultados, motivos, naoSondados }.
 */
export async function sondarCandidato({
  candidato,
  alvos,
  invalidos = [],
  problemas = [],
  fetchImpl,
  esperar,
  cadernetaEsperada = null,
  progresso = () => {},
}) {
  const motivos = [...problemas];
  const resultados = [];
  if (invalidos.length)
    return {
      veredito: "INCERTO",
      resultados,
      naoSondados: alvos.length,
      motivos: [
        ...invalidos.map(
          (h) =>
            `o inventário trouxe o endereço "${h}" fora da forma que a sonda aceita (minúsculo, sem porta, 2+ rótulos): nada foi sondado`,
        ),
        ...motivos,
      ],
    };
  if (alvos.length === 0)
    motivos.push("nenhuma loja do inventário para sondar");
  let naoSondados = 0;
  for (let i = 0; i < alvos.length; i++) {
    if (i > 0) await esperar(RITMO_MS);
    const r = await sondarLoja(candidato, alvos[i], {
      fetchImpl,
      esperar,
      cadernetaEsperada,
    });
    if (r.tipo === "parar") {
      motivos.push(r.motivo);
      naoSondados = alvos.length - i;
      break;
    }
    resultados.push(r);
    if ((i + 1) % AVISO_DE_PROGRESSO_A_CADA === 0 && i + 1 < alvos.length)
      progresso(`... ${i + 1} de ${alvos.length} sondados`);
  }
  if (naoSondados > 0)
    motivos.push(
      `${naoSondados} endereço(s) ficaram sem sonda: não há prova para eles`,
    );
  const divergentes = resultados.filter((r) => r.tipo === "divergente");
  const incertos = resultados.filter((r) => r.tipo === "incerto");
  for (const r of incertos)
    motivos.push(`${r.host}: ${r.motivo} (não provado)`);
  let veredito;
  if (divergentes.length) veredito = "NÃO";
  else if (motivos.length) veredito = "INCERTO";
  else veredito = "SIM";
  return { veredito, resultados, motivos, naoSondados };
}

// ------------------------------------------------------------------ linha de comando

const USO =
  "uso: node scripts/frota/sondar-candidato.mjs --candidato https://<deploy>.vercel.app [--caderneta hit|reserva]";

function lerArgumentos(argv) {
  let candidato = null;
  let caderneta = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--candidato") {
      candidato = argv[++i] ?? null;
      if (candidato === null) return { erro: "--candidato sem endereço" };
    } else if (a === "--caderneta") {
      caderneta = argv[++i] ?? null;
      if (!CADERNETAS_ESPERAVEIS.has(caderneta))
        return { erro: "--caderneta aceita só hit ou reserva" };
    } else {
      return { erro: `argumento desconhecido: ${a}` };
    }
  }
  if (candidato === null) return { erro: "falta --candidato" };
  const url = urlDoCandidato(candidato);
  if (url.erro) return { erro: url.erro };
  return { candidato: url.origem, caderneta };
}

const CODIGO = { SIM: 0, NÃO: 1, INCERTO: 3 };

const EXPLICACAO = {
  SIM: "toda loja abriu no candidato com o banco certo.",
  NÃO: "o candidato abriria alguma loja errada (ou não abriria). NÃO promover este deploy.",
  INCERTO:
    "não deu para provar. Não conta como SIM: ler os motivos abaixo e rodar de novo.",
};

function contar(valores) {
  const m = new Map();
  for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([v, n]) => `${v} ${n}`)
    .join(", ");
}

/** deps: { politica, canais, inventariar(politica), fetchImpl, esperar(ms), progresso?(linha) }. */
export async function executar(argv, deps) {
  const saida = [];
  const erros = [];
  const args = lerArgumentos(argv);
  if (args.erro) return { codigo: 2, saida, erros: [args.erro, USO] };
  const progresso = deps.progresso ?? (() => {});
  const inventario = await deps.inventariar(deps.politica);
  const lojasObrigatorias = lojasObrigatoriasDosCanais(
    deps.canais,
    deps.politica,
  );
  const alvos = alvosDoInventario(inventario, deps.politica, lojasObrigatorias);
  const minutos = Math.max(
    1,
    Math.ceil((alvos.alvos.length * RITMO_MS) / 60_000),
  );
  progresso(
    `Sondando ${alvos.alvos.length} endereços no candidato, 1 por segundo (cerca de ${minutos} min)...`,
  );
  const r = await sondarCandidato({
    candidato: args.candidato,
    ...alvos,
    fetchImpl: deps.fetchImpl,
    esperar: deps.esperar,
    cadernetaEsperada: args.caderneta,
    progresso,
  });
  const respondidos = r.resultados.filter((x) => x.tipo !== "incerto");
  saida.push(
    "# Prova do candidato",
    "",
    `Candidato: ${args.candidato}`,
    `Lojas no inventário: ${alvos.alvos.length} endereços.${args.caderneta ? ` Caderneta exigida: ${args.caderneta}.` : ""}`,
  );
  if (respondidos.length) {
    saida.push(
      `Caderneta que o candidato usou: ${contar(respondidos.map((x) => x.caderneta))}.`,
      `Caderneta para onde o candidato aponta: ${contar(respondidos.map((x) => x.destino ?? "nenhuma"))}.`,
    );
  }
  saida.push("");
  for (const x of r.resultados)
    saida.push(
      `- ${x.tipo === "ok" ? "ok" : x.tipo === "divergente" ? "ERRADO" : "sem prova"}: ${x.host}: ${x.motivo}`,
    );
  saida.push("", `RESULTADO: ${r.veredito} — ${EXPLICACAO[r.veredito]}`);
  for (const m of r.motivos) erros.push(`- ${m}`);
  return { codigo: CODIGO[r.veredito], saida, erros };
}

/** As dependências reais: política e canais do disco, inventário oficial (--vercel), rede de verdade. */
export function dependenciasDoComando() {
  const executorVercel = criarExecutorVercel();
  return {
    politica: lerPolitica(),
    canais: lerCanaisDaReserva(),
    inventariar: (p) => inventariar(p, { pedirVercel: true, executorVercel }),
    fetchImpl: fetch,
    esperar: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    progresso: (l) => console.log(l),
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
    return CODIGO.INCERTO;
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
      process.exitCode = CODIGO.INCERTO;
    },
  );
}
