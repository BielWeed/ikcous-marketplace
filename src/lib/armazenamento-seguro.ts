// Acesso ao armazenamento do navegador que NUNCA lança.
//
// Dois jeitos de o navegador recusar, e os dois chegam aqui:
//  - Chrome com "Bloquear todos os cookies e dados de sites", Safari com
//    "Bloquear todos os cookies" e certos modos privados/WebViews fazem o próprio
//    ACESSO a `localStorage` / `sessionStorage` lançar SecurityError, antes de
//    qualquer getItem;
//  - aparelho antigo, Safari privado antigo e cota estourada deixam o acesso
//    funcionar, mas `setItem` (ou `getItem`) lança QuotaExceededError/SecurityError.
// Quem lê ou grava no arranque da loja, no checkout e na sessão do login passa
// por aqui: o que não couber no armazenamento de verdade fica numa cópia em
// memória, e o resto da visita enxerga o valor (a loja abre, o login conclui, o
// pedido segue). Ao recarregar a página a cópia some — só isso se perde — e o
// armazenamento de verdade nunca guarda algo mais velho que a cópia (a escrita
// que falha apaga o valor antigo de lá).
//
// Com o armazenamento funcionando nada muda: lê e grava no de verdade, e a cópia
// fica vazia.

import type { ArmazenamentoSimples } from "./chave-do-pedido";

function criarArmazenamentoSeguro(
  obter: () => Storage | null | undefined,
  // Só recebe o que o de verdade recusou. Tem prioridade na leitura: um valor
  // antigo no de verdade nunca pode ganhar do que acabou de ser escrito.
  memoria = new Map<string, string>(),
): ArmazenamentoSimples {
  // O acesso à propriedade também pode lançar: por isso o `obter` roda aqui,
  // dentro do `try` de quem chama, a cada uso (nunca guardado no módulo).
  return {
    getItem(chave) {
      const guardado = memoria.get(chave);
      if (guardado !== undefined) return guardado;
      try {
        const real = obter();
        return real ? real.getItem(chave) : null;
      } catch {
        return null;
      }
    },
    setItem(chave, valor) {
      try {
        const real = obter();
        if (!real) {
          memoria.set(chave, valor);
          return;
        }
        real.setItem(chave, valor);
        memoria.delete(chave);
      } catch {
        memoria.set(chave, valor);
        // O valor antigo não pode voltar ao recarregar (a conta anterior, por
        // exemplo): sem apagar de lá, só a memória o esconde. Apagar também
        // libera espaço. Se nem isto der, o que sobra é só o que já estava.
        try {
          obter()?.removeItem(chave);
        } catch {
          // Armazenamento recusando tudo: a memória segue valendo.
        }
      }
    },
    removeItem(chave) {
      memoria.delete(chave);
      try {
        obter()?.removeItem(chave);
      } catch {
        // Sem apagar no de verdade, a cópia já saiu e o valor não volta.
      }
    },
  };
}

const memoriaDoLocal = new Map<string, string>();
const local = criarArmazenamentoSeguro(
  () => globalThis.localStorage,
  memoriaDoLocal,
);
const sessao = criarArmazenamentoSeguro(() => globalThis.sessionStorage);

/** `localStorage`, ou uma cópia em memória quando o navegador o recusa. */
export function localStorageSeguro(): ArmazenamentoSimples {
  return local;
}

/** Esquece da cópia em memória do `localStorage` as chaves que `casa` aceita. */
export function esquecerDaMemoriaDoLocal(casa: (chave: string) => boolean) {
  for (const chave of memoriaDoLocal.keys()) {
    if (casa(chave)) memoriaDoLocal.delete(chave);
  }
}

/** `sessionStorage`, ou uma cópia em memória quando o navegador o recusa. */
export function sessionStorageSeguro(): ArmazenamentoSimples {
  return sessao;
}
