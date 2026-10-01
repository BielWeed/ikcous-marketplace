// Peças puras do PIX com QR da tela Vender (frente A, 28/09/2026). A tela
// (`PixDoBalcao.tsx`) só mostra; quem decide o que uma resposta quer dizer
// mora aqui, testável sem DOM.

/** Mesmo vocabulário da edge `cobrar-pix-no-balcao`
 * (`supabase/functions/_shared/pix-do-balcao.ts`). */
export type SituacaoDoPixDoBalcao =
  | "aguardando"
  | "pago"
  | "pago_fora_do_prazo"
  | "expirado"
  | "cancelado";

export interface RespostaDoPixDoBalcao {
  readonly situacao: SituacaoDoPixDoBalcao;
  readonly total: number;
  readonly expiraEm: string | null;
  readonly agoraServidor: string;
  readonly qrCode?: string | null;
  readonly qrCodeBase64?: string | null;
  readonly ticketUrl?: string | null;
  /** O MP aprovou um valor fora de ±R$ 0,05 do total: NÃO foi confirmado. */
  readonly valorDivergente?: boolean;
  /** "Cancelar" encontrou o PIX já pago: a venda foi confirmada, não cancelada. */
  readonly jaEstavaPago?: boolean;
}

export type AcaoDoPixDoBalcao = "gerar" | "conferir" | "cancelar";

/** A linha do pedido que a tela relê a cada poucos segundos. */
export interface LinhaDoPixDoBalcao {
  readonly payment_status: string | null;
  readonly status: string | null;
  readonly expires_at: string | null;
}

/**
 * A situação a partir da linha do pedido. O prazo é comparado com o relógio
 * do SERVIDOR estimado (`agoraServidorMs`), nunca com o do aparelho — um
 * tablet de balcão com a hora errada não pode declarar vencido um PIX vivo.
 */
export function situacaoDaLinha(
  linha: LinhaDoPixDoBalcao,
  agoraServidorMs: number,
): SituacaoDoPixDoBalcao {
  if (linha.payment_status === "pago") return "pago";
  if (linha.payment_status === "pago_apos_expirar") return "pago_fora_do_prazo";
  if (linha.payment_status === "expirado") return "expirado";
  if (linha.payment_status === "aguardando" && linha.status === "pending") {
    const vence = linha.expires_at ? Date.parse(linha.expires_at) : Number.NaN;
    if (!Number.isFinite(vence) || vence <= agoraServidorMs) return "expirado";
    return "aguardando";
  }
  return "cancelado";
}

/** Diferença entre o relógio do servidor e o deste aparelho, em ms. */
export function desvioDoRelogio(
  agoraServidor: string,
  agoraLocalMs: number,
): number {
  const servidor = Date.parse(agoraServidor);
  return Number.isFinite(servidor) ? servidor - agoraLocalMs : 0;
}

/** Quanto falta para o PIX vencer, pelo relógio do servidor (nunca < 0). */
export function restanteMs(
  expiraEm: string | null,
  agoraLocalMs: number,
  desvioMs: number,
): number | null {
  if (!expiraEm) return null;
  const vence = Date.parse(expiraEm);
  if (!Number.isFinite(vence)) return null;
  return Math.max(0, vence - (agoraLocalMs + desvioMs));
}

/** 1_754_000 → "29:14". */
export function formatarContagem(ms: number): string {
  const segundos = Math.ceil(ms / 1000);
  const mm = Math.floor(segundos / 60);
  const ss = segundos % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** A hora do vencimento no fuso DESTE aparelho, corrigida pelo desvio. */
export function horaDoVencimento(expiraEm: string, desvioMs: number): string {
  const local = new Date(Date.parse(expiraEm) - desvioMs);
  return local.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
