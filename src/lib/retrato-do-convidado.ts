// Rodada 21 (lote C2, achado B): quem rastreia o pedido SEM conta guarda no
// sessionStorage um RETRATO do que o servidor respondeu na hora da consulta
// (chave `guest_tracked_orders`, gravada em OrderSearch). Ninguém atualiza esse
// retrato: o pedido pode ter saído para entrega e a tela continua dizendo
// "Em preparo". Guardar o horário da consulta é o que deixa a tela dizer DE
// QUANDO é o que está mostrando, em vez de fingir que é o estado de agora.
//
// Dois formatos convivem no aparelho:
//   * antigo: a lista de pedidos pura (`Order[]`), sem horário;
//   * novo:   `{ consultadoEm, pedidos }`.
// Um aparelho com aba aberta pode ter o antigo guardado antes da atualização,
// então a leitura aceita OS DOIS — o antigo vem com `consultadoEm: null`
// ("horário desconhecido") e a tela não inventa hora.
import type { Order } from "@/types";

export const CHAVE_DO_RETRATO = "guest_tracked_orders";

// Disparado no `window` quando o retrato é apagado de propósito ("Consultar de
// novo"). A CartView fica montada o tempo todo (aba do app) e guarda o
// retrato também em estado: sem o aviso, voltar dos detalhes mostraria a lista
// velha que acabou de ser apagada.
export const EVENTO_RETRATO_LIMPO = "retrato-do-convidado-limpo";

export interface RetratoDoConvidado {
  pedidos: Order[];
  /** Instante da consulta (ms); `null` no formato antigo, que não o guardava. */
  consultadoEm: number | null;
}

const instanteValido = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

export function interpretarRetrato(
  bruto: string | null,
): RetratoDoConvidado | null {
  if (!bruto) return null;
  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (Array.isArray(lido)) {
    return { pedidos: lido as Order[], consultadoEm: null };
  }
  if (lido && typeof lido === "object") {
    const { pedidos, consultadoEm } = lido as Record<string, unknown>;
    if (Array.isArray(pedidos)) {
      return {
        pedidos: pedidos as Order[],
        consultadoEm: instanteValido(consultadoEm) ? consultadoEm : null,
      };
    }
  }
  return null;
}

/** Lê o retrato do aparelho. Armazenamento bloqueado ou lixo viram `null`. */
export function lerRetratoDoConvidado(): RetratoDoConvidado | null {
  try {
    return interpretarRetrato(sessionStorage.getItem(CHAVE_DO_RETRATO));
  } catch {
    return null;
  }
}

/** Grava no formato novo. LANÇA se o armazenamento recusar: quem chama decide. */
export function gravarRetratoDoConvidado(
  pedidos: Order[],
  consultadoEm: number = Date.now(),
): void {
  sessionStorage.setItem(
    CHAVE_DO_RETRATO,
    JSON.stringify({ consultadoEm, pedidos }),
  );
}

/**
 * Apaga o retrato e avisa as telas abertas. O aviso sai mesmo que o
 * armazenamento recuse a remoção: o estado em memória das telas tem de esvaziar
 * do mesmo jeito.
 */
export function limparRetratoDoConvidado(): void {
  try {
    sessionStorage.removeItem(CHAVE_DO_RETRATO);
  } catch {
    // Armazenamento indisponível: nada a apagar que se possa alcançar.
  }
  globalThis.dispatchEvent(new Event(EVENTO_RETRATO_LIMPO));
}

const dois = (n: number) => String(n).padStart(2, "0");

/**
 * A frase que acompanha qualquer status vindo do retrato. Mesmo dia: só a hora;
 * outro dia: o dia também (um retrato de ontem não pode parecer de hoje).
 */
export function textoDoRetrato(
  consultadoEm: number | null,
  agora: Date = new Date(),
): string {
  if (consultadoEm === null) {
    return "Status de quando você consultou — pode ter mudado";
  }
  const quando = new Date(consultadoEm);
  const hora = `${dois(quando.getHours())}:${dois(quando.getMinutes())}`;
  const mesmoDia =
    quando.getFullYear() === agora.getFullYear() &&
    quando.getMonth() === agora.getMonth() &&
    quando.getDate() === agora.getDate();
  return mesmoDia
    ? `Status de ${hora} — pode ter mudado`
    : `Status de ${dois(quando.getDate())}/${dois(quando.getMonth() + 1)} às ${hora} — pode ter mudado`;
}
