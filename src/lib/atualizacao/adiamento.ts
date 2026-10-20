/**
 * ADIAMENTO — "agora não", dito ANTES de apagar ou recarregar qualquer coisa.
 *
 * Quem executa a instalação (o apply do service worker ou a purga de versão
 * obrigatória) pode recusar no último instante porque o mundo mudou desde a
 * decisão: o aparelho ficou sem rede, começou uma operação sensível. Essa
 * recusa NÃO é falha da atualização — nada foi apagado, nada recarregou — e por
 * isso o instalador DEVOLVE a tentativa gasta na trava (senão duas trocas de
 * tela sem rede esgotariam o orçamento de 2 e a atualização seria abandonada
 * por uma queda de internet).
 *
 * Recusa que repetir não conserta (trava da purga esgotada, storage que não
 * grava) é um Error comum: a tentativa conta.
 */
export class AtualizacaoAdiada extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "AtualizacaoAdiada";
  }
}

/** Reconhece o adiamento pelo nome (não por `instanceof`): sobrevive a módulos
 * duplicados e a erros que atravessam fronteiras de realm. */
export function ehAdiamento(erro: unknown): boolean {
  return (
    typeof erro === "object" &&
    erro !== null &&
    (erro as { name?: unknown }).name === "AtualizacaoAdiada"
  );
}
