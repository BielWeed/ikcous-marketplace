// A CHAVE DA DEVOLUÇÃO — idempotência do lado do painel (migration
// 20261640000000). A metade que DECIDE é o servidor
// (`solicitar_estorno_com_chave` + o índice único parcial de
// `order_refunds.chave_da_solicitacao`): a mesma chave devolve a linha que já
// existe em vez de criar outra. Este arquivo só garante que a RETENTATIVA da
// mesma intenção repita a chave em vez de inventar outra.
//
// POR QUE A CHAVE PERTENCE À INTENÇÃO (pedido + valor), NÃO AO TOQUE: a trava
// do hook (`enviandoRef`) já fecha o duplo toque. O que ela não fecha é o toque
// DEPOIS do "não dá para saber": a tela desistiu em 20 s, o servidor ainda vai
// gravar, a releitura mostra o saldo cheio e a lojista devolve o MESMO valor de
// novo. Com a mesma chave, o servidor reconhece a intenção e devolve a linha
// que já existe; o cliente recebe uma vez só.
//
// POR QUE localStorage, COM VALIDADE: fechar e reabrir a ficha, ou recarregar a
// página, é retentativa real (o mesmo motivo de `chave-do-pedido.ts`). A
// validade de 30 min (criação + 30 min, nunca estendida) impede que a
// devolução de amanhã, de igual valor, herde a de hoje. Sem localStorage
// (navegador que recusa), a chave ainda vale na aba.
//
// Intenção NOVA = chave nova: outro valor (centavos), outro pedido, ou depois
// de o servidor confirmar a anterior (`encerrarChaveDaDevolucao`).

import { PRAZO_DA_RETENTATIVA_MS } from "./pedido-sem-resposta";
import { gerarUuidV4 } from "./uuid-v4";

const PREFIXO = "ikcous-chave-da-devolucao:";

interface RegistroDaDevolucao {
  centavos: number;
  chave: string;
  /** Epoch ms em que a chave deixa de valer (criação + 30 min). */
  expiraEm: number;
}

/** Plano B quando o localStorage não existe ou recusa (SecurityError, cota). */
const naMemoria = new Map<string, RegistroDaDevolucao>();
let armazenamentoRecusou = false;

function armazenamento(): Storage | null {
  if (armazenamentoRecusou) return null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Vencido, malformado ou com validade além do prazo que este código dá =
// registro que não é nosso: não vale.
function valido(registro: unknown, agora: number): RegistroDaDevolucao | null {
  const r = registro as Partial<RegistroDaDevolucao> | null | undefined;
  if (
    !r ||
    typeof r.chave !== "string" ||
    !Number.isInteger(r.centavos) ||
    typeof r.expiraEm !== "number" ||
    !Number.isFinite(r.expiraEm) ||
    r.expiraEm <= agora ||
    r.expiraEm > agora + PRAZO_DA_RETENTATIVA_MS
  ) {
    return null;
  }
  return r as RegistroDaDevolucao;
}

function ler(orderId: string, agora: number): RegistroDaDevolucao | null {
  const s = armazenamento();
  if (s) {
    try {
      const cru = s.getItem(PREFIXO + orderId);
      return cru ? valido(JSON.parse(cru), agora) : null;
    } catch {
      // ilegível: cai na memória
    }
  }
  return valido(naMemoria.get(orderId), agora);
}

function gravar(orderId: string, registro: RegistroDaDevolucao): void {
  naMemoria.set(orderId, registro);
  const s = armazenamento();
  if (!s) return;
  try {
    s.setItem(PREFIXO + orderId, JSON.stringify(registro));
  } catch {
    // Sem gravar, a leitura do storage não acharia a chave: a memória manda.
    armazenamentoRecusou = true;
  }
}

/** Valor em centavos: 50 e 50,00 são a mesma intenção; 50,01 não é. */
function centavosDe(valor: number): number {
  return Math.round(valor * 100);
}

/**
 * A chave da intenção "devolver `valor` do pedido `orderId`": a mesma enquanto
 * a intenção não for encerrada (até 30 min); outro valor gira a chave.
 */
export function chaveDaDevolucao(
  orderId: string,
  valor: number,
  agora: number = Date.now(),
): string {
  const centavos = centavosDe(valor);
  const atual = ler(orderId, agora);
  if (atual && atual.centavos === centavos) return atual.chave;
  const novo: RegistroDaDevolucao = {
    centavos,
    chave: gerarUuidV4(),
    expiraEm: agora + PRAZO_DA_RETENTATIVA_MS,
  };
  gravar(orderId, novo);
  return novo.chave;
}

/**
 * O servidor confirmou a intenção da chave `chave` (linha criada ou já
 * registrada): a próxima devolução do pedido é intenção NOVA. Só apaga se a
 * chave guardada ainda for ESTA — a resposta tardia de uma intenção antiga não
 * apaga a da intenção em curso.
 */
export function encerrarChaveDaDevolucao(orderId: string, chave: string): void {
  if (naMemoria.get(orderId)?.chave === chave) naMemoria.delete(orderId);
  const s = armazenamento();
  if (!s) return;
  try {
    const cru = s.getItem(PREFIXO + orderId);
    if (!cru) return;
    const registro = JSON.parse(cru) as Partial<RegistroDaDevolucao> | null;
    if (registro?.chave === chave) s.removeItem(PREFIXO + orderId);
  } catch {
    // Sem apagar, o registro vence sozinho em 30 min.
  }
}
