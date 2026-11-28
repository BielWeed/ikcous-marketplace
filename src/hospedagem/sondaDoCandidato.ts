import { cleanEnvVar } from "../lib/env-publico-valores";
import type {
  AmbientePorteiro,
  EntradaCacheForaDoAr,
  EntradaCachePorteiro,
  EntradaCacheSemLoja,
  ResolucaoEmVoo,
  ResolverLojaNaCaderneta,
} from "./porteiro";
import { normalizarHost, obterFichaValidada } from "./porteiro";
// A SONDA DO CANDIDATO (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`, T7 e
// "Prova"): `GET /__ikcous/sonda-do-candidato?host=<loja>` responde, num deploy
// candidato (o `.vercel.app` ainda não promovido), o que o porteiro DAQUELE
// deploy decide para uma loja. O "/" do candidato não é loja nenhuma, então é
// esta rota que o portão da publicação e `sondar-candidato` (T12) usam para ver
// o porteiro novo com a reserva funcionando ANTES de promover.
//
// Por que cada trava existe:
// - As TRÊS condições juntas (`IKCOUS_SONDA_DO_CANDIDATO=1`, passada só no
//   deploy da prova com `--env`; host do pedido igual a `VERCEL_URL`, o
//   endereço único DESTE deploy; `VERCEL_ENV=production`). Faltando uma, 404
//   com o MESMO corpo curto e nada mais: nem caderneta, nem banco, nem reserva.
//   No domínio de qualquer loja o host nunca é o `VERCEL_URL`, então ali a rota
//   não existe — mesmo num deploy promovido que ainda carregue a variável.
// - Só JSON curto: `{host, porteiro, caderneta, ref, destinoDaCaderneta}`.
//   Nunca a página (a resposta do porteiro é lida só nos cabeçalhos e o corpo
//   é descartado), nunca o documento da reserva, nunca chave nem token:
//   `ref` é o id de 20 letras do banco que abriu (o mesmo que a página da loja
//   já publica), `destinoDaCaderneta` é SÓ o nome do host de
//   `IKCOUS_FROTA_URL` (sem caminho, consulta nem credencial) — é o que separa
//   o candidato da prova 1/2 do de controle.
// - Cache NOVO a cada sonda: `Map`s vazios para ficha, "fora do ar", "não
//   achei" e resolução em voo. A ficha de outra visita não responde pela
//   sonda, e a sonda não escreve no cache que as lojas usam. Sem `waitUntil`:
//   a resposta espera a caderneta, nunca serve ficha velha.
// - A reserva usa o MESMO leitor da instância (`lerReserva` do middleware,
//   cache de 5 min / falha 30 s): nenhuma sonda força uma leitura a mais da
//   Global Config (cota de 100 mil leituras/mês no Hobby).
// - Teto por instância: `TETO_DA_SONDA_POR_JANELA` sondas por minuto. Cada
//   sonda custa uma pergunta à caderneta e duas ao banco da loja; o teto
//   impede que um visitante do `.vercel.app` vire martelo. Host inválido é
//   recusado ANTES do teto e de qualquer pergunta.

/** O caminho da rota (o matcher de `middleware.ts` já o casa). */
export const CAMINHO_DA_SONDA = "/__ikcous/sonda-do-candidato";
/** Quantas sondas uma instância atende por janela. */
export const TETO_DA_SONDA_POR_JANELA = 60;
/** A janela do teto. */
export const JANELA_DA_SONDA_MS = 60_000;

export interface AmbienteDaSonda extends AmbientePorteiro {
  /** "1" liga (só no deploy da prova, `vercel deploy --env`). */
  readonly IKCOUS_SONDA_DO_CANDIDATO?: string;
  /** Variável de sistema da Vercel: o endereço único deste deploy, sem
   * protocolo. */
  readonly VERCEL_URL?: string;
}

/** O contador do teto: um objeto de módulo em `middleware.ts`, por instância. */
export interface JanelaDaSonda {
  inicio: number;
  usados: number;
}

export interface DependenciasDaSonda {
  readonly fetchImpl: typeof fetch;
  readonly resolverNaCaderneta?: ResolverLojaNaCaderneta;
  /** O MESMO leitor que o porteiro recebe (cache por instância). */
  readonly lerReserva?: () => Promise<unknown>;
  readonly janela: JanelaDaSonda;
  /** Relógio injetável (teste). */
  readonly agora?: () => number;
}

function respostaDaSonda(
  corpo: Record<string, string | null>,
  status: number,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
      ...extra,
    },
  });
}

/** As três condições, juntas. */
export function sondaLigada(
  request: Request,
  ambiente: AmbienteDaSonda,
): boolean {
  if (ambiente.IKCOUS_SONDA_DO_CANDIDATO !== "1") return false;
  if (ambiente.VERCEL_ENV !== "production") return false;
  const desteDeploy = (ambiente.VERCEL_URL ?? "").trim().toLowerCase();
  if (desteDeploy === "") return false;
  return normalizarHost(new URL(request.url)) === desteDeploy;
}

// Um rótulo DNS (RFC 1123): letras minúsculas, dígitos e hífen no meio, até 63.
// Sem regex aninhada (sem retrocesso): o pedido vem de fora.
const SO_LETRA_DIGITO_HIFEN = /^[a-z0-9-]+$/;
function rotuloValido(rotulo: string): boolean {
  return (
    rotulo.length >= 1 &&
    rotulo.length <= 63 &&
    SO_LETRA_DIGITO_HIFEN.test(rotulo) &&
    !rotulo.startsWith("-") &&
    !rotulo.endsWith("-")
  );
}

/**
 * O `host` pedido, se for UM host já normalizado (a mesma forma que
 * `normalizarHost` produz e que a reserva guarda): minúsculo, sem porta, sem
 * ponto final, só rótulos DNS, com pelo menos um ponto, até 253 caracteres, e
 * o último rótulo com letra (IP não é loja). Qualquer outra coisa: `null`.
 */
export function hostDaSonda(url: URL): string | null {
  const valores = url.searchParams.getAll("host");
  if (valores.length !== 1) return null;
  const host = valores[0];
  if (host.length === 0 || host.length > 253) return null;
  const rotulos = host.split(".");
  if (rotulos.length < 2 || !rotulos.every(rotuloValido)) return null;
  if (!/[a-z]/.test(rotulos[rotulos.length - 1])) return null;
  return host;
}

/** Abre a janela nova quando a anterior venceu; `false` = teto atingido. */
function cabeNaJanela(janela: JanelaDaSonda, agora: number): boolean {
  if (agora < janela.inicio || agora - janela.inicio >= JANELA_DA_SONDA_MS) {
    janela.inicio = agora;
    janela.usados = 0;
  }
  if (janela.usados >= TETO_DA_SONDA_POR_JANELA) return false;
  janela.usados += 1;
  return true;
}

const REF_DO_BANCO = /^([a-z0-9]{20})\.supabase\.co$/;

/** O id de 20 letras do banco (`https://<ref>.supabase.co`), ou `null`. */
function refDoBanco(supabaseUrl: string): string | null {
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:") return null;
    return REF_DO_BANCO.exec(url.hostname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** SÓ o nome do host de `IKCOUS_FROTA_URL` — nunca caminho, consulta nem
 * credencial que a variável carregue. */
function destinoDaCaderneta(bruto: string | undefined): string | null {
  const valor = cleanEnvVar(bruto ?? "");
  if (valor === "") return null;
  try {
    const url = new URL(valor);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname === "" ? null : url.hostname;
  } catch {
    return null;
  }
}

// O que o porteiro escreve nos cabeçalhos é nosso, mas a sonda só repassa
// palavra curta: o que fugir disso vira `desconhecido`.
const PALAVRA_CURTA = /^[a-z][a-z-]{0,31}$/;
function palavraCurta(valor: string | null): string {
  return valor !== null && PALAVRA_CURTA.test(valor) ? valor : "desconhecido";
}

/** Atende `CAMINHO_DA_SONDA`. Nunca lança. */
export async function atenderSonda(
  request: Request,
  ambiente: AmbienteDaSonda,
  deps: DependenciasDaSonda,
): Promise<Response> {
  if (!sondaLigada(request, ambiente))
    return respostaDaSonda({ sonda: "desligada" }, 404);
  if (request.method !== "GET")
    return respostaDaSonda({ sonda: "metodo" }, 405, { allow: "GET" });
  const host = hostDaSonda(new URL(request.url));
  if (host === null) return respostaDaSonda({ sonda: "host-invalido" }, 400);
  const relogio = deps.agora ?? Date.now;
  if (!cabeNaJanela(deps.janela, relogio()))
    return respostaDaSonda({ sonda: "limite" }, 429, { "retry-after": "60" });

  const destino = destinoDaCaderneta(ambiente.IKCOUS_FROTA_URL);
  try {
    const resultado = await obterFichaValidada(
      new Request(`https://${host}/`),
      ambiente,
      {
        fetchImpl: deps.fetchImpl,
        resolverNaCaderneta: deps.resolverNaCaderneta,
        lerReserva: deps.lerReserva,
        cache: new Map<string, EntradaCachePorteiro>(),
        cacheForaDoAr: new Map<string, EntradaCacheForaDoAr>(),
        cacheSemLoja: new Map<string, EntradaCacheSemLoja>(),
        resolucoesEmVoo: new Map<string, ResolucaoEmVoo>(),
        agora: deps.agora,
      },
    );
    if (resultado.tipo === "ok")
      return respostaDaSonda(
        {
          host,
          porteiro: "ok",
          caderneta: resultado.caderneta,
          ref: refDoBanco(resultado.ficha.conexao.supabaseUrl),
          destinoDaCaderneta: destino,
        },
        200,
      );
    const { resposta } = resultado;
    // A página (manutenção, fora do ar) nunca sai daqui: só os cabeçalhos.
    await resposta.body?.cancel().catch(() => {});
    return respostaDaSonda(
      {
        host,
        porteiro: palavraCurta(resposta.headers.get("x-ikcous-porteiro")),
        caderneta: palavraCurta(resposta.headers.get("x-ikcous-caderneta")),
        ref: null,
        destinoDaCaderneta: destino,
      },
      200,
    );
  } catch {
    // Sem detalhe no log: a mensagem poderia carregar o que não sai daqui.
    console.error("[sonda] falhou ao consultar o porteiro");
    return respostaDaSonda({ sonda: "falhou" }, 500);
  }
}
