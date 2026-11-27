// A chave do rascunho do pedido de devolução e a varredura do "Sair".
//
// Módulo PEQUENO de propósito: o `AuthContext` (que toda visita carrega)
// chama a varredura, e importar `rascunho-da-devolucao.ts` levaria junto
// `devolucao.ts` (modelos e textos das devoluções, só das telas de pedido)
// para o pacote de entrada da loja. `rascunho-da-devolucao.ts` usa o prefixo
// daqui e reexporta a função.

/** Prefixo de toda chave de rascunho: `<prefixo><conta>:<pedido>`. */
export const PREFIXO_DO_RASCUNHO_DA_DEVOLUCAO = "ikcous:rascunho-da-devolucao:";

/**
 * No "Sair" (`clearLocalUserData`, AuthContext): apaga o rascunho de QUALQUER
 * conta e pedido desta aba. A leitura já ignora o de outra conta, mas o texto
 * da cliente não fica no aparelho compartilhado depois que ela saiu. Varre o
 * `sessionStorage` de verdade (o próprio acesso pode lançar SecurityError, por
 * isso fica dentro do `try`); nunca lança.
 */
export function limparTodosOsRascunhosDaDevolucao(): void {
  try {
    const armazem = globalThis.sessionStorage;
    if (!armazem) return;
    // De trás para a frente: o índice se desloca ao remover.
    for (let i = armazem.length - 1; i >= 0; i--) {
      const chave = armazem.key(i);
      if (chave?.startsWith(PREFIXO_DO_RASCUNHO_DA_DEVOLUCAO)) {
        armazem.removeItem(chave);
      }
    }
  } catch {
    // Melhor esforço: o logout nunca depende do rascunho.
  }
}
