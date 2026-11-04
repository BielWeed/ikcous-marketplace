import { pagamentoOnlineLigado } from "@/lib/flags";
import { useSyncExternalStore } from "react";

/**
 * O estado do pagamento pelo app COMO O PAINEL O CONHECE (14/10/2026).
 *
 * `pagamentoOnlineLigado()` é o retrato síncrono da ficha injetada no BOOT da
 * página. Salvar, testar, Pausar e Retomar (MercadoPagoSection) gravam
 * `store_config.pagamento_online` pela edge e devolvem o estado GRAVADO — e a
 * ficha global não se reescreve em memória. `AdminSettingsView` já resolve
 * isso para as próprias telas guardando o eco em estado local; mas a tela de
 * Frete é OUTRA aba do painel (as duas ficam montadas), e lendo só o boot ela
 * mostraria aviso FALSO (lojista religou o PIX) ou calaria um aviso VERDADEIRO
 * (lojista acabou de pausar).
 *
 * Esta é a MESMA fonte, dividida: o eco que Ajustes já recebe da seção
 * Mercado Pago (`onPixAlternado`) é publicado aqui também, e a tela de Frete o
 * lê. Sem eco nenhum, vale o boot — exatamente o que Ajustes faz. Não é fonte
 * nova de verdade: não há leitura nova no servidor.
 *
 * O Início (04/11/2026) lê o mesmo eco — inclusive a Public Key, quando quem
 * publica sabe dela (ver `publicarPagamentoPeloApp`).
 *
 * Estado do módulo = estado da SESSÃO do painel (uma página, uma loja).
 */
let eco: boolean | null = null;
let ecoDaChave: boolean | null = null;
const ouvintes = new Set<() => void>();

export function pagamentoPeloAppAgora(): boolean {
  return eco ?? pagamentoOnlineLigado();
}

/**
 * O servidor devolveu o estado gravado: o painel inteiro passa a usá-lo.
 * `chaveOk` só se informa quando se SABE se a Public Key está publicada; sem
 * ele, vale o que já se sabia (e, sem eco nenhum, a chave do boot).
 */
export function publicarPagamentoPeloApp(
  ligado: boolean,
  chaveOk?: boolean,
): void {
  if (eco === ligado && (chaveOk === undefined || ecoDaChave === chaveOk)) {
    return;
  }
  eco = ligado;
  if (chaveOk !== undefined) ecoDaChave = chaveOk;
  for (const ouvinte of ouvintes) ouvinte();
}

/** Só para teste: volta a palavra ao retrato do boot. */
export function esquecerEcoDoPagamentoPeloApp(): void {
  eco = null;
  ecoDaChave = null;
  for (const ouvinte of ouvintes) ouvinte();
}

/** A Public Key está publicada? `null` = nenhum eco disse: vale o boot. */
export function chaveDoPixPeloAppAgora(): boolean | null {
  return ecoDaChave;
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** O pagamento pelo app está ligado? Re-renderiza quando o eco chega. */
export function usePagamentoPeloApp(): boolean {
  return useSyncExternalStore(
    assinar,
    pagamentoPeloAppAgora,
    pagamentoPeloAppAgora,
  );
}

/** A Public Key que o eco trouxe (ou `null`). Re-renderiza quando ela chega. */
export function useChaveDoPixPeloApp(): boolean | null {
  return useSyncExternalStore(
    assinar,
    chaveDoPixPeloAppAgora,
    chaveDoPixPeloAppAgora,
  );
}
