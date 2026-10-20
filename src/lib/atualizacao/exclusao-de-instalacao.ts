/**
 * EXCLUSÃO MÚTUA DA INSTALAÇÃO — só uma aba por vez instala a atualização
 * (atualização única e obrigatória, 16/10/2026).
 *
 * Antes de gastar uma tentativa da trava e acionar o service worker, a aba
 * toma uma reserva em localStorage (`pwa_instalando`: id da aba + instante),
 * a LÊ DE VOLTA e só segue se o id gravado for o dela. A reserva expira em
 * 30 s (aba que morreu no meio não prende ninguém) e é solta quando a
 * instalação falha.
 *
 * Limite conhecido (por desenho): localStorage não oferece compare-and-set.
 * Duas abas que gravam no MESMO instante podem ambas ler o próprio id de
 * volta. O pior caso é as duas instalarem na mesma rodada — o que o
 * service worker tolera (SKIP_WAITING é idempotente) e a trava absorve, porque
 * a reserva da tentativa é lida-e-confirmada. A segurança dos DADOS não depende
 * desta reserva: ela vem do veto local de cada aba.
 *
 * Storage que lança ou não confirma = NÃO toma a reserva = não instala.
 */

export const CHAVE_DA_RESERVA_DE_INSTALACAO = "pwa_instalando";

/** Depois disto a reserva de outra aba vale como abandonada. */
export const VALIDADE_DA_RESERVA_MS = 30_000;

interface Reserva {
  id: string;
  em: number;
}

function lerReserva(): Reserva | null {
  try {
    const cru = localStorage.getItem(CHAVE_DA_RESERVA_DE_INSTALACAO);
    if (!cru) return null;
    const parsed = JSON.parse(cru) as Partial<Reserva> | null;
    if (
      parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.em === "number"
    ) {
      return { id: parsed.id, em: parsed.em };
    }
  } catch {
    // Corrompida: tratada como ausente (a escrita abaixo a sobrescreve e a
    // leitura de volta confirma quem ficou).
  }
  return null;
}

/** `true` só se esta aba ficou com a reserva (gravou e leu de volta o próprio
 * id). Reserva vigente de OUTRA aba = `false`. */
export function tomarReservaDeInstalacao(
  idDaAba: string,
  agora: number = Date.now(),
): boolean {
  try {
    const atual = lerReserva();
    if (
      atual &&
      atual.id !== idDaAba &&
      agora - atual.em < VALIDADE_DA_RESERVA_MS
    ) {
      return false;
    }
    localStorage.setItem(
      CHAVE_DA_RESERVA_DE_INSTALACAO,
      JSON.stringify({ id: idDaAba, em: agora } satisfies Reserva),
    );
    return lerReserva()?.id === idDaAba;
  } catch {
    return false;
  }
}

/** Solta a reserva SE ela ainda é desta aba (nunca apaga a de outra). */
export function soltarReservaDeInstalacao(idDaAba: string): void {
  try {
    if (lerReserva()?.id === idDaAba) {
      localStorage.removeItem(CHAVE_DA_RESERVA_DE_INSTALACAO);
    }
  } catch {
    // Sem soltar, a validade de 30 s cobre.
  }
}
