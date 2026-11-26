#!/usr/bin/env node
/**
 * acordar-projeto.mjs — acorda o banco (projeto Supabase) de uma loja que o plano grátis do Supabase PAUSOU por falta de atividade.
 *
 * POR QUE É UM COMANDO LOCAL (escolha A, 26/11/2026): o vigia da gestão só DETECTA a pausa (a loja aparece como `pausada`); quem tem
 * a chave da conta Supabase da lojista é o PC do dono (o cofre DPAPI de scripts/frota/cofre-local.mjs, com o acesso OAuth gravado
 * por scripts/frota/acesso-oauth.mjs). Nada disto roda no Worker. Roteiro: docs/runbooks/estado-de-vida-da-loja.md.
 *
 * Uso:
 *   node scripts/frota/acordar-projeto.mjs --loja <projeto do lojas.json> --motivo "<texto>" [--esperar-min N]
 *
 * O fluxo (acordar):
 *   1. o access token sai do cofre (acesso-oauth renovar). Cofre sem o acesso da loja, token vazio ou OAuth recusado = PARA aqui
 *      (canário), sem tocar a Management API;
 *   2. GET /v1/projects/{ref}: 401/403 = PARA (canário), antes de qualquer POST. O status decide (decidirAcordar):
 *        INACTIVE = acordar; ACTIVE_HEALTHY = nada a fazer (saída 0); RESTORING/COMING_UP = só esperar; qualquer outro = recusa;
 *   3. no máximo UM POST /v1/projects/{ref}/restore (sem corpo) por execução — nunca um segundo, nem se o POST cair no meio ou
 *      voltar 5xx (aí ele PODE ter sido aplicado: o comando só acompanha). 4xx no POST (402 do plano, 401/403) para na hora;
 *   4. consulta o status a cada 15 s até ACTIVE_HEALTHY ou até --esperar-min (padrão 10, máximo 30). GET que falha no meio é
 *      tolerado (tenta de novo); 401/403 no meio para; RESTORE_FAILED/INIT_FAILED/REMOVED param na hora.
 *
 * Valores de status: o enum oficial de V1ProjectWithDatabaseResponse.status (https://api.supabase.com/api/v1-json, 26/11/2026):
 *   INACTIVE, ACTIVE_HEALTHY, ACTIVE_UNHEALTHY, COMING_UP, UNKNOWN, GOING_DOWN, INIT_FAILED, REMOVED, RESTORING, UPGRADING, PAUSING,
 *   RESTORE_FAILED, RESTARTING, PAUSE_FAILED, RESIZING, PROMOTING, RIGHTSIZING. O projeto pausado é INACTIVE.
 *
 * Saída: 0 = acordada (ou já estava); 1 = recusado ou parou (canário, status estranho, Supabase recusou); 2 = uso errado;
 *   3 = tempo esgotado (o restore pode estar em andamento: conferir no painel do Supabase).
 * Nenhuma linha escrita carrega token, refresh, client_secret nem corpo cru de resposta.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { criarAcessoOAuth } from "./acesso-oauth.mjs";
import { ErroDoCofre, criarCofreDpapi } from "./cofre-local.mjs";
import {
  ESTADO_DESCONHECIDO,
  ErroDaGestao,
  SemAcesso,
  criarClienteGestao,
} from "./supabase-gestao.mjs";

const require = createRequire(import.meta.url);
const {
  RE_PROJETO,
  carregarLojas,
  listaLegivel,
  lojaDoProjeto,
  textoSeguro,
} = require("./lojas.cjs");

export const ESPERA_PADRAO_MIN = 10;
export const ESPERA_MAXIMA_MIN = 30;
export const INTERVALO_MS = 15_000;
export const CODIGO_TEMPO_ESGOTADO = 3;
const RE_MOTIVO = /^[\p{L}\p{N} .,:;()/-]{3,200}$/u;
const RE_MINUTOS = /^[1-9][0-9]?$/;
const OPCOES = new Set(["--loja", "--motivo", "--esperar-min"]);
/** Status em que esperar mais não adianta: o restore não vai terminar sozinho. */
const FALHAS_NA_ESPERA = new Set(["RESTORE_FAILED", "INIT_FAILED", "REMOVED"]);
/** O que dizer em cada status recusado que tem um caminho conhecido. */
const DICAS = new Map(
  Object.entries({
    PAUSING:
      "o Supabase está pausando o projeto agora: espere uns minutos e rode o comando de novo",
    PAUSE_FAILED:
      "a pausa falhou no Supabase: o estado do projeto é incerto, confira no painel",
    RESTORE_FAILED:
      "um restore anterior falhou: confira no painel (pode ser preciso falar com o suporte do Supabase)",
    INIT_FAILED: "o projeto não terminou de nascer: confira no painel",
    REMOVED: "o projeto foi APAGADO no Supabase: não há o que acordar",
    GOING_DOWN: "o projeto está sendo desligado: confira no painel",
    ACTIVE_UNHEALTHY:
      "o projeto está ligado, mas com algum serviço com defeito: isto não é pausa, confira no painel",
  }),
);

class UsoErrado extends Error {}

const USO =
  'Uso: node scripts/frota/acordar-projeto.mjs --loja <projeto do lojas.json> --motivo "<texto>" [--esperar-min N (1 a 30, padrão 10)]';

/**
 * Função pura: o que fazer com o status do projeto (GET /v1/projects/{ref}).
 * @returns {{ acao: "acordar" | "nada" | "esperar" | "recusar", mensagem: string }}
 */
export function decidirAcordar(status) {
  if (status === "INACTIVE")
    return {
      acao: "acordar",
      mensagem:
        "o banco da loja está pausado (INACTIVE): vou pedir o restore UMA vez.",
    };
  if (status === "ACTIVE_HEALTHY")
    return {
      acao: "nada",
      mensagem: "a loja já está acordada (ACTIVE_HEALTHY): nada a fazer.",
    };
  if (status === "RESTORING" || status === "COMING_UP")
    return {
      acao: "esperar",
      mensagem: `o projeto já está voltando (${status}): não peço restore, só espero.`,
    };
  const rotulo =
    typeof status === "string" ? textoSeguro(status) : "(sem status)";
  const dica =
    typeof status === "string" && DICAS.has(status)
      ? DICAS.get(status)
      : "este comando não sabe tratar este status com segurança: confira no painel do Supabase";
  return {
    acao: "recusar",
    mensagem: `o projeto está com status ${rotulo}: ${dica}. Nada foi pedido.`,
  };
}

/** Lê e valida a FORMA dos argumentos. Erro aqui é uso errado (saída 2). */
export function lerArgumentos(argv) {
  const v = new Map();
  for (let i = 0; i < argv.length; i++) {
    const x = argv.at(i);
    if (!OPCOES.has(x))
      throw new UsoErrado(`argumento desconhecido: ${textoSeguro(x)}`);
    i += 1;
    const valor = argv.at(i);
    if (valor === undefined || valor.startsWith("--"))
      throw new UsoErrado(`${x} exige um valor`);
    const nome = x.slice(2);
    if (v.has(nome)) throw new UsoErrado(`${x} repetido`);
    v.set(nome, valor);
  }
  const loja = v.get("loja");
  const motivo = v.get("motivo");
  if (loja === undefined) throw new UsoErrado("falta --loja");
  if (motivo === undefined)
    throw new UsoErrado("falta --motivo (vai para o registro)");
  if (!RE_PROJETO.test(loja))
    throw new UsoErrado(
      "--loja: o nome da loja no scripts/frota/lojas.json (minúsculas, dígitos e hífen, começando por letra)",
    );
  if (!RE_MOTIVO.test(motivo))
    throw new UsoErrado(
      "--motivo: de 3 a 200 caracteres, só letras, números, espaço e . , : ; ( ) / -",
    );
  let esperarMin = ESPERA_PADRAO_MIN;
  if (v.has("esperar-min")) {
    const t = v.get("esperar-min");
    if (!RE_MINUTOS.test(t) || Number(t) > ESPERA_MAXIMA_MIN)
      throw new UsoErrado(
        `--esperar-min: número inteiro de 1 a ${ESPERA_MAXIMA_MIN} (minutos)`,
      );
    esperarMin = Number(t);
  }
  return { loja, motivo, esperarMin };
}

/** Texto de um erro que pode ir para a tela: só os erros nossos (que nunca carregam segredo); o resto, só o nome. */
function erroSeguro(e) {
  if (e instanceof ErroDaGestao || e instanceof ErroDoCofre) return e.message;
  const nome = e?.name;
  return typeof nome === "string" && /^[A-Za-z]{1,40}$/.test(nome)
    ? nome
    : "erro";
}

const RELOGIO_REAL = Object.freeze({
  agora: () => Date.now(),
  esperar: (ms) => new Promise((ok) => setTimeout(ok, ms)),
});

/**
 * Acorda UMA loja. Todas as dependências chegam de fora (o teste não toca rede, cofre nem relógio de verdade).
 * @param {{
 *   loja: string, ref: string, motivo: string, esperarMin?: number,
 *   cofre: { ler: Function, gravar: Function, apagar: Function, travar: Function },
 *   http?: typeof fetch,
 *   relogio?: { agora: () => number, esperar: (ms: number) => Promise<void> },
 *   escrever?: (linha: string) => void,
 *   prazoMs?: number,
 * }} opcoes
 * @returns {Promise<{ codigo: number, pediuRestore: boolean }>}
 */
export async function acordar({
  loja,
  ref,
  motivo,
  esperarMin = ESPERA_PADRAO_MIN,
  cofre,
  http = globalThis.fetch,
  relogio = RELOGIO_REAL,
  escrever = console.log,
  prazoMs,
}) {
  const painel = `https://supabase.com/dashboard/project/${ref}`;
  const planoB = `Plano B: quem é dono da conta Supabase da loja (o dono, para IKCOUS e Savy; a lojista, nas lojas autorizadas por OAuth) entra no painel do Supabase (${painel}) e clica em "Restore project".`;
  const hora = () => new Date(relogio.agora()).toISOString();
  // GUARDA do "nunca um 2º POST": vira true ANTES do pedido sair, então nem um POST que lança abre espaço para outro.
  let pediuRestore = false;
  const fim = (codigo, linha) => {
    escrever(linha);
    escrever(
      `registro: ${hora()} acordar-projeto loja=${loja} ref=${ref} saida=${codigo} restore_pedido=${pediuRestore ? "sim" : "nao"}`,
    );
    return { codigo, pediuRestore };
  };

  escrever(
    `registro: ${hora()} acordar-projeto loja=${loja} ref=${ref} motivo="${motivo}"`,
  );

  // 1. Canário do token: sem acesso válido, nada vai à Management API.
  let token;
  try {
    const acesso = criarAcessoOAuth({
      cofre,
      fetch: http,
      agora: relogio.agora,
    });
    token = (await acesso.renovar({ slug: loja }))?.accessToken;
  } catch (e) {
    return fim(
      1,
      `PAROU (canário do token): não consegui o acesso da loja ${loja} pelo cofre deste PC (${erroSeguro(e)}). Nada foi pedido ao Supabase. ${planoB}`,
    );
  }
  if (typeof token !== "string" || token.trim() === "") {
    return fim(
      1,
      `PAROU (canário do token): o acesso da loja ${loja} veio vazio. Nada foi pedido ao Supabase. ${planoB}`,
    );
  }
  const cliente = criarClienteGestao({
    token,
    fetch: http,
    ...(prazoMs === undefined ? {} : { prazoMs }),
  });

  async function lerStatus() {
    const corpo = await cliente.pedir("projeto", { ref });
    if (corpo === null || typeof corpo !== "object" || corpo.ref !== ref) {
      throw new ErroDaGestao(
        `Gestão Supabase: GET /v1/projects/${ref} respondeu sem o ref pedido no corpo.`,
        { codigo: "RESPOSTA_INVALIDA" },
      );
    }
    return corpo.status;
  }

  // 2. O status de agora, antes de qualquer POST.
  let atual;
  try {
    atual = await lerStatus();
  } catch (e) {
    if (e instanceof SemAcesso)
      return fim(
        1,
        `PAROU (canário do token): o Supabase recusou a leitura do projeto (HTTP ${e.status}). A autorização da lojista caiu ou não cobre este projeto. Nada foi pedido. ${planoB}`,
      );
    return fim(
      1,
      `RECUSADO: não consegui ler o status do projeto (${erroSeguro(e)}). Nada foi pedido. Rode de novo em 1 minuto.`,
    );
  }
  const primeira = decidirAcordar(atual);
  escrever(`status agora: ${textoSeguro(String(atual))}. ${primeira.mensagem}`);
  if (primeira.acao === "nada") return fim(0, `OK: ${primeira.mensagem}`);
  if (primeira.acao === "recusar")
    return fim(1, `RECUSADO: ${primeira.mensagem}`);

  /** O ÚNICO POST da execução. Devolve o resultado final se for para parar; null para seguir acompanhando. */
  async function pedirRestore() {
    pediuRestore = true;
    try {
      await cliente.pedir("restaurar", { ref, metodo: "POST" });
      escrever(
        `restore pedido ao Supabase. Acompanho o status a cada ${INTERVALO_MS / 1000} s, por até ${esperarMin} min.`,
      );
      return null;
    } catch (e) {
      if (e instanceof SemAcesso)
        return fim(
          1,
          `PAROU: o Supabase recusou o restore (HTTP ${e.status}): a autorização da lojista não cobre isto (projects:write) ou caiu. ${planoB}`,
        );
      const incerto =
        e instanceof ErroDaGestao &&
        (e.codigo === ESTADO_DESCONHECIDO ||
          (e.codigo === "HTTP" && e.status >= 500));
      if (incerto) {
        escrever(
          `o pedido de restore não teve resposta clara (${erroSeguro(e)}): ele PODE ter sido aplicado. NÃO vou pedir de novo; só acompanho o status.`,
        );
        return null;
      }
      if (e instanceof ErroDaGestao && e.status === 402)
        return fim(
          1,
          `PAROU: o Supabase não deixa restaurar (HTTP 402: plano da organização, fatura em atraso ou restrição na conta da lojista). A lojista resolve a cobrança no painel e clica em "Restore project" (${painel}).`,
        );
      return fim(
        1,
        `PAROU: o Supabase recusou o restore (${erroSeguro(e)}). ${planoB}`,
      );
    }
  }

  // 3 e 4. No máximo um POST, depois acompanhar até ACTIVE_HEALTHY ou o prazo.
  const prazo = relogio.agora() + esperarMin * 60_000;
  for (;;) {
    if (atual !== null) {
      const d = decidirAcordar(atual);
      if (d.acao === "nada")
        return fim(
          0,
          `ACORDOU: a loja ${loja} (${ref}) está ACTIVE_HEALTHY. Em 1 a 2 minutos o vigia da gestão deixa de mostrá-la como pausada.`,
        );
      if (d.acao === "acordar") {
        if (primeira.acao !== "acordar")
          return fim(
            1,
            "RECUSADO: o projeto voltou a ficar pausado (INACTIVE) enquanto eu esperava um restore que NÃO fui eu que pedi. Rode o comando de novo para pedir o restore.",
          );
        if (!pediuRestore) {
          const parou = await pedirRestore();
          if (parou) return parou;
        }
      }
      if (FALHAS_NA_ESPERA.has(atual))
        return fim(
          1,
          `PAROU: ${d.mensagem} ${pediuRestore ? "O restore já foi pedido uma vez; NÃO peça de novo sem olhar o painel." : ""} ${painel}`.trim(),
        );
    }
    if (relogio.agora() >= prazo)
      return fim(
        CODIGO_TEMPO_ESGOTADO,
        `TEMPO ESGOTADO: em ${esperarMin} min o projeto não chegou a ACTIVE_HEALTHY (último status: ${atual === null ? "não lido" : textoSeguro(String(atual))}). ${pediuRestore ? "O restore já foi pedido: NÃO rode de novo agora. " : ""}Confira no painel do Supabase: ${painel}`,
      );
    await relogio.esperar(INTERVALO_MS);
    try {
      atual = await lerStatus();
      escrever(`status: ${textoSeguro(String(atual))}`);
    } catch (e) {
      if (e instanceof SemAcesso)
        return fim(
          1,
          `PAROU: o Supabase recusou a leitura do status (HTTP ${e.status}) no meio da espera. ${pediuRestore ? "O restore já foi pedido: NÃO rode de novo agora. " : ""}Confira no painel do Supabase: ${painel}`,
        );
      atual = null;
      escrever(
        `não consegui ler o status agora (${erroSeguro(e)}); tento de novo em ${INTERVALO_MS / 1000} s.`,
      );
    }
  }
}

/**
 * Lê os argumentos, acha a loja no cadastro (scripts/frota/lojas.json, por lojas.cjs) e acorda. `deps`:
 *   cadastro? (o validado; padrão: carregarLojas()), abrirCofre() → cofre, http, relogio, escrever.
 * O cofre só é aberto depois que argumentos e cadastro passaram.
 */
export async function executar(argv, deps) {
  const escrever = deps.escrever ?? console.log;
  let a;
  try {
    a = lerArgumentos(argv);
  } catch (e) {
    if (!(e instanceof UsoErrado)) throw e;
    escrever(e.message);
    escrever(USO);
    return { codigo: 2 };
  }
  let cadastro;
  try {
    cadastro = deps.cadastro ?? carregarLojas();
  } catch (e) {
    escrever(`RECUSADO: ${erroSeguro(e)}`);
    return { codigo: 1 };
  }
  const l = lojaDoProjeto(a.loja, cadastro);
  if (!l) {
    escrever(
      `RECUSADO: a loja ${a.loja} não está no cadastro da frota (scripts/frota/lojas.json): ${listaLegivel(Object.keys(cadastro.lojas))}. Nada foi pedido.`,
    );
    return { codigo: 1 };
  }
  let cofre;
  try {
    cofre = deps.abrirCofre();
  } catch (e) {
    escrever(
      `PAROU (canário do token): não consegui abrir o cofre deste PC (${erroSeguro(e)}). Nada foi pedido ao Supabase. Plano B: quem é dono da conta Supabase da loja (o dono, para IKCOUS e Savy; a lojista, nas lojas por OAuth) clica em "Restore project" no painel do Supabase (https://supabase.com/dashboard/project/${l.ref}).`,
    );
    return { codigo: 1 };
  }
  return acordar({
    loja: a.loja,
    ref: l.ref,
    motivo: a.motivo,
    esperarMin: a.esperarMin,
    cofre,
    http: deps.http,
    relogio: deps.relogio,
    escrever,
  });
}

/** As dependências reais: o cadastro do disco, o cofre DPAPI deste PC (aberto só depois dos argumentos), a rede e o relógio. */
export function dependenciasDoComando() {
  return {
    abrirCofre: () => criarCofreDpapi(),
    http: globalThis.fetch,
    relogio: RELOGIO_REAL,
    escrever: (l) => console.log(l),
  };
}

export async function main(argv = process.argv.slice(2), deps = undefined) {
  try {
    return (await executar(argv, deps ?? dependenciasDoComando())).codigo;
  } catch (e) {
    console.error(`RECUSADO: erro inesperado (${erroSeguro(e)})`);
    return 1;
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
    (e) => {
      console.error(`erro inesperado (${erroSeguro(e)})`);
      process.exitCode = 1;
    },
  );
}
