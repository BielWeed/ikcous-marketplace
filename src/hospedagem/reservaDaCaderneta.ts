import type { ConexaoDaLoja } from "../config/fichaDaLojaContract";
import { assertPublicSupabaseKey } from "../lib/publicSupabaseKey";
// A RESERVA DA CADERNETA (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`, T2): o
// documento que o porteiro lê na Global Config da Vercel quando a caderneta
// central falha e não há ficha. Este módulo só define e CONFERE o formato na
// leitura; quem lê a store (T6), quem decide usar (T3/T4) e quem grava (T8)
// ficam fora daqui. Puro de propósito: roda na borda (grafo de
// `middleware.ts`), sem alias `@/` e sem pacote de terceiros.
//
// Formato v1, gravado sob `CHAVE_DA_RESERVA`:
//
//   {v: 1, gerada_em, sha, hosts: {<host>: {u: "https://<ref20>.supabase.co", k: <pública>}}}
//
// Uma entrada inválida é RECUSADA SOZINHA — as outras continuam valendo. O
// plano recusa "a entrada", não o documento; a busca é por host exato, então
// a entrada ruim de X nunca abre nada para Y, e o host X só fica sem reserva
// (503 `erro`, como já seria sem ela). Para o recuo não ser silencioso, quem
// lê compara `Object.keys(doc.hosts).length` com o de `validarReserva(doc)`.
// Já o cabeçalho (`v`, `gerada_em`, `sha`, `hosts`) fora do formato derruba o
// documento inteiro: não é a reserva que o T8 grava.

/** A chave do documento na store (Global Config / Edge Config). */
export const CHAVE_DA_RESERVA = "reserva_v1";

/** O ÚNICO endereço aceito: projeto Supabase pelo ref de 20 letras, sem
 * porta, caminho ou barra final. Nada de domínio próprio nem de terceiro. */
export const ENDERECO_DA_RESERVA_REGEX = /^https:\/\/[a-z]{20}\.supabase\.co$/;

/** Uma entrada como está gravada: só `u` e `k` (nunca segredo, hash, nome
 * nem estado). */
export interface EntradaGravadaDaReserva {
  readonly u: string;
  readonly k: string;
}

/** O documento v1 já conferido — ele mesmo um documento v1 válido. */
export interface ReservaV1 {
  readonly v: 1;
  readonly gerada_em: string;
  readonly sha: string;
  readonly hosts: Readonly<Record<string, EntradaGravadaDaReserva>>;
}

// Um rótulo DNS em minúsculas (sem sublinhado, sem hífen nas pontas). Regex
// plana de propósito (sem quantificador aninhado); as pontas vão à parte.
const ROTULO_DE_HOST = /^[a-z0-9-]{1,63}$/;

function rotuloValido(rotulo: string): boolean {
  return (
    ROTULO_DE_HOST.test(rotulo) &&
    !rotulo.startsWith("-") &&
    !rotulo.endsWith("-")
  );
}

/**
 * O host já está na forma que o porteiro usa como chave (`normalizarHost` em
 * `porteiro.ts`: minúsculo, sem porta, sem ponto final)? Confere sem importar
 * o porteiro — o porteiro é quem vai importar este módulo (T3). A concordância
 * com `normalizarHost` é travada no teste `reserva-da-caderneta-formato`.
 * Exige também forma de domínio (2+ rótulos), e que `URL` não reescreva o
 * host (ex.: `0x7f.1` vira `127.0.0.1`).
 */
function hostNormalizado(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  const rotulos = host.split(".");
  if (rotulos.length < 2 || !rotulos.every(rotuloValido)) return false;
  try {
    return new URL(`https://${host}`).hostname === host;
  } catch {
    return false;
  }
}

function objetoSimples(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function textoNaoVazio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length > 0;
}

function chaveEhPublica(chave: string): boolean {
  try {
    assertPublicSupabaseKey(chave);
    return true;
  } catch {
    return false;
  }
}

function entradaValida(entrada: unknown): EntradaGravadaDaReserva | null {
  if (!objetoSimples(entrada)) return null;
  const campos = Object.keys(entrada);
  if (campos.length !== 2 || !Object.hasOwn(entrada, "u")) return null;
  if (!Object.hasOwn(entrada, "k")) return null;
  const { u, k } = entrada;
  if (typeof u !== "string" || !ENDERECO_DA_RESERVA_REGEX.test(u)) return null;
  if (typeof k !== "string" || !chaveEhPublica(k)) return null;
  return { u, k };
}

function cabecalhoValido(
  doc: unknown,
): (Omit<ReservaV1, "hosts"> & { hosts: Record<string, unknown> }) | null {
  if (!objetoSimples(doc) || doc.v !== 1) return null;
  if (!textoNaoVazio(doc.gerada_em) || !textoNaoVazio(doc.sha)) return null;
  if (!objetoSimples(doc.hosts)) return null;
  return { v: 1, gerada_em: doc.gerada_em, sha: doc.sha, hosts: doc.hosts };
}

/**
 * Confere o documento inteiro (o que a T6 guarda em cache). Devolve `null` se
 * o cabeçalho estiver fora do formato v1; senão, o documento só com as
 * entradas válidas (as inválidas somem, uma a uma).
 */
export function validarReserva(doc: unknown): ReservaV1 | null {
  const cabecalho = cabecalhoValido(doc);
  if (!cabecalho) return null;
  // `Object.fromEntries` cria propriedade PRÓPRIA (nunca atribui): um host
  // `__proto__` vindo do JSON não vira protótipo — e já cai antes em
  // `hostNormalizado`, mas a defesa não depende disso.
  const pares: Array<[string, EntradaGravadaDaReserva]> = [];
  for (const [host, entrada] of Object.entries(cabecalho.hosts)) {
    if (!hostNormalizado(host)) continue;
    const valida = entradaValida(entrada);
    if (valida) pares.push([host, valida]);
  }
  return { ...cabecalho, hosts: Object.fromEntries(pares) };
}

/**
 * A conexão da reserva para ESTE host exato, ou `null`. Aceita o documento
 * cru ou a saída de `validarReserva`, e reconfere só o cabeçalho e a entrada
 * pedida (O(1)): nunca devolve entrada fora do formato, nem de outro host,
 * nem herdada do protótipo. `host` tem de vir já normalizado (`normalizarHost`).
 */
export function entradaDaReserva(
  doc: unknown,
  host: string,
): ConexaoDaLoja | null {
  if (!hostNormalizado(host)) return null;
  const cabecalho = cabecalhoValido(doc);
  if (!cabecalho) return null;
  // Só propriedade PRÓPRIA e de dado: nada herdado do protótipo, nenhum
  // getter executado.
  const propria = Object.getOwnPropertyDescriptor(cabecalho.hosts, host);
  const entrada = entradaValida(propria?.value);
  if (!entrada) return null;
  return { supabaseUrl: entrada.u, publishableKey: entrada.k };
}
