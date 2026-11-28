import { createClient } from "@vercel/global-config";
import {
  CHAVE_DA_RESERVA,
  type ReservaV1,
  validarReserva,
} from "./reservaDaCaderneta";
// O LEITOR da reserva da caderneta (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`,
// T6): o que `middleware.ts` injeta no porteiro como `lerReserva`. Lê o
// documento `CHAVE_DA_RESERVA` na Global Config da Vercel (antigo Edge Config)
// e só o entrega depois de `validarReserva`. Quem DECIDE usar a reserva é o
// porteiro (T3/T4), que ainda reconfere a entrada do host (`entradaDaReserva`).
//
// Por que cada trava existe:
// - A conexão vem de `GLOBAL_CONFIG` (ou, na falta dela, `EDGE_CONFIG`) e só é
//   aceita na forma que a Vercel escreve: `https://global-config.vercel.com/
//   ecfg_…?token=…`, o mesmo em `edge-config.vercel.com`, ou `edge-config:id=…
//   &token=…`. O parser do pacote aceita QUALQUER host com id+token (o caminho
//   "external") — uma variável trocada mandaria o token, e a pergunta "qual é
//   o banco da loja", para quem a escreveu. Fora da forma = reserva desligada.
//   Uma `GLOBAL_CONFIG` fora da forma NÃO cai para a `EDGE_CONFIG`: variável
//   errada vira `x-ikcous-reserva: desligada`, que o portão vê, em vez de
//   ficar escondida atrás da outra.
// - `staleIfError: false`: o padrão do pacote (uma semana) serve a cópia velha
//   da store para sempre enquanto a origem falha. O cache que manda é o daqui.
// - Cache: leitura boa 5 min (a cota do Hobby é 100 mil leituras/mês, e a
//   reserva só muda numa publicação); falha 30 s (a store que caiu não é
//   martelada, e volta logo). Falha é exceção, prazo estourado, chave ausente
//   (`undefined`) e documento fora do formato v1.
// - Prazo de 2 s por `Promise.race` próprio: o pacote não aceita
//   `AbortSignal`, e uma leitura pendurada prenderia o host em
//   `resolucoesEmVoo` no porteiro. A promessa que perde a corrida ganha um
//   `catch` vazio: rejeitar depois não vira `unhandledrejection`.
// - Leituras simultâneas na mesma instância esperam a MESMA leitura.
// - O token nunca sai: o erro devolvido tem mensagem FIXA (sem `cause`), e o
//   log só diz o motivo da lista curta abaixo.

/** Quanto a leitura boa vale. */
export const CACHE_RESERVA_BOA_MS = 5 * 60_000;
/** Quanto a falha fica guardada antes de a store ser perguntada de novo. */
export const CACHE_RESERVA_FALHA_MS = 30_000;
/** O prazo de uma leitura da store. */
export const PRAZO_RESERVA_MS = 2_000;

/** As variáveis que ligam a reserva (só em Production, D2 do plano). */
export interface AmbienteDaReserva {
  readonly GLOBAL_CONFIG?: string;
  readonly EDGE_CONFIG?: string;
}

/** O `lerReserva` do porteiro: o documento conferido, ou rejeita. */
export type LerReserva = () => Promise<ReservaV1>;

type MotivoDaFalha = "prazo" | "leitura" | "ausente" | "invalida";

const HOSTS_DA_VERCEL = new Set([
  "global-config.vercel.com",
  "edge-config.vercel.com",
]);
// O id da store, como a Vercel o escreve (`ecfg_` + letras e dígitos).
const ID_DA_STORE = /^ecfg_[A-Za-z0-9]+$/;

function formaDeUrlAceita(conexao: string): boolean {
  let url: URL;
  try {
    url = new URL(conexao);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || !HOSTS_DA_VERCEL.has(url.hostname))
    return false;
  if (url.port !== "" || url.username !== "" || url.password !== "")
    return false;
  const segmentos = url.pathname.split("/");
  if (segmentos.length !== 2 || !ID_DA_STORE.test(segmentos[1])) return false;
  return (url.searchParams.get("token") ?? "") !== "";
}

function formaDeParametrosAceita(conexao: string): boolean {
  const PREFIXO = "edge-config:";
  if (!conexao.startsWith(PREFIXO)) return false;
  const parametros = new URLSearchParams(conexao.slice(PREFIXO.length));
  return (
    ID_DA_STORE.test(parametros.get("id") ?? "") &&
    (parametros.get("token") ?? "") !== ""
  );
}

/** A conexão está numa das formas que a Vercel escreve, apontando para ela? */
export function conexaoDaReservaAceita(conexao: string): boolean {
  return formaDeParametrosAceita(conexao) || formaDeUrlAceita(conexao);
}

function falhaDaReserva(motivo: MotivoDaFalha): Error {
  return new Error(`reserva da caderneta indisponivel: ${motivo}`);
}

const PRAZO_ESTOURADO = Symbol("prazo da reserva");

function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  // A perdedora pode rejeitar depois: sem dono, viraria `unhandledrejection`.
  promessa.catch(() => {});
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_resolve, rejeitar) => {
    temporizador = setTimeout(() => rejeitar(PRAZO_ESTOURADO), ms);
  });
  return Promise.race([promessa, prazo]).finally(() =>
    clearTimeout(temporizador),
  );
}

type Guardada =
  | { readonly ok: true; readonly reserva: ReservaV1; readonly quando: number }
  | {
      readonly ok: false;
      readonly motivo: MotivoDaFalha;
      readonly quando: number;
    };

/**
 * Um leitor com cliente e cache PRÓPRIOS para esta conexão, ou `undefined`
 * (reserva desligada) se não houver conexão, se ela estiver fora da forma da
 * Vercel ou se o pacote recusar criar o cliente.
 */
export function criarLeitorDaReserva(
  conexao: string | undefined,
): LerReserva | undefined {
  if (conexao === undefined || !conexaoDaReservaAceita(conexao))
    return undefined;
  let cliente: ReturnType<typeof createClient>;
  try {
    cliente = createClient(conexao, { staleIfError: false });
  } catch {
    // A mensagem do pacote não entra no log: só o fato.
    console.warn("[reserva] cliente da Global Config recusado: desligada");
    return undefined;
  }

  let guardada: Guardada | null = null;
  let emVoo: Promise<ReservaV1> | null = null;

  const buscar = async (): Promise<ReservaV1> => {
    let motivo: MotivoDaFalha;
    try {
      const valor: unknown = await comPrazo(
        new Promise<unknown>((resolve) =>
          resolve(cliente.get(CHAVE_DA_RESERVA)),
        ),
        PRAZO_RESERVA_MS,
      );
      const reserva = valor === undefined ? null : validarReserva(valor);
      if (reserva) {
        guardada = { ok: true, reserva, quando: Date.now() };
        const gravados =
          typeof valor === "object" && valor !== null && "hosts" in valor
            ? Object.keys((valor as { hosts: object }).hosts).length
            : 0;
        const validos = Object.keys(reserva.hosts).length;
        if (validos !== gravados)
          console.warn(
            `[reserva] ${gravados - validos} de ${gravados} entradas recusadas na leitura`,
          );
        return reserva;
      }
      motivo = valor === undefined ? "ausente" : "invalida";
    } catch (erro) {
      motivo = erro === PRAZO_ESTOURADO ? "prazo" : "leitura";
    }
    guardada = { ok: false, motivo, quando: Date.now() };
    console.warn(`[reserva] leitura falhou: ${motivo}`);
    throw falhaDaReserva(motivo);
  };

  return () => {
    const atual = guardada;
    if (atual !== null) {
      const validade = atual.ok ? CACHE_RESERVA_BOA_MS : CACHE_RESERVA_FALHA_MS;
      if (Date.now() - atual.quando < validade)
        return atual.ok
          ? Promise.resolve(atual.reserva)
          : Promise.reject(falhaDaReserva(atual.motivo));
    }
    if (emVoo === null)
      emVoo = buscar().finally(() => {
        emVoo = null;
      });
    return emVoo;
  };
}

// Um leitor (um cliente, um cache) por instância da função: a conexão não
// muda dentro dela. Guardado pela conexão para que um ambiente diferente (só
// acontece em teste) não herde o cache de outro.
let leitorDaInstancia: {
  readonly conexao: string;
  readonly leitor: LerReserva | undefined;
} | null = null;

/** A conexão escolhida: `GLOBAL_CONFIG` se tiver valor, senão `EDGE_CONFIG`. */
function conexaoDoAmbiente(ambiente: AmbienteDaReserva): string | undefined {
  if (ambiente.GLOBAL_CONFIG) return ambiente.GLOBAL_CONFIG;
  if (ambiente.EDGE_CONFIG) return ambiente.EDGE_CONFIG;
  return undefined;
}

/** O `lerReserva` desta instância, ou `undefined` (reserva desligada). */
export function leitorDaReservaDoAmbiente(
  ambiente: AmbienteDaReserva,
): LerReserva | undefined {
  const conexao = conexaoDoAmbiente(ambiente);
  if (conexao === undefined) return undefined;
  if (leitorDaInstancia?.conexao !== conexao)
    leitorDaInstancia = { conexao, leitor: criarLeitorDaReserva(conexao) };
  return leitorDaInstancia.leitor;
}
