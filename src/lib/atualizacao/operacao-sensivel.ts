/**
 * REGISTRO DE OPERAÇÕES SENSÍVEIS — atualização única e obrigatória,
 * 16/10/2026.
 *
 * Há trabalho que não aparece no `currentView` nem no `adminDirty` e que um
 * recarregamento destruiria: upload de imagem em andamento, fila offline sendo
 * enviada, venda do PDV sendo gravada. Quem executa esse trabalho chama
 * `marcarOperacaoSensivel(motivo)` ao começar e a função devolvida ao terminar
 * (em `finally`). Enquanto houver QUALQUER marca, o momento seguro devolve
 * "ocupado" e a aba responde "ocupada" às outras: a atualização espera.
 *
 * Este módulo só guarda a contagem. Ligar os executores (upload, fila, PDV) é
 * trabalho de quem é dono deles — um registro que ninguém marca é inofensivo, e
 * o contrário (marca que nunca é desfeita) só adia a atualização, que é o lado
 * seguro.
 */

// Contador POR motivo: duas operações do mesmo tipo ao mesmo tempo (dois
// uploads) só liberam quando as DUAS terminam.
const contagens = new Map<string, number>();
const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const ouvinte of [...ouvintes]) {
    try {
      ouvinte();
    } catch {
      // Um ouvinte com defeito não pode impedir os outros de saber.
    }
  }
}

/** Marca uma operação sensível em andamento. Devolve a função que a desmarca —
 * à prova de chamar duas vezes (a segunda não desconta a operação de outro). */
export function marcarOperacaoSensivel(motivo: string): () => void {
  const chave = motivo || "operacao-sem-motivo";
  contagens.set(chave, (contagens.get(chave) ?? 0) + 1);
  avisar();

  let desmarcada = false;
  return () => {
    if (desmarcada) return;
    desmarcada = true;
    const restante = (contagens.get(chave) ?? 0) - 1;
    if (restante > 0) {
      contagens.set(chave, restante);
    } else {
      contagens.delete(chave);
    }
    avisar();
  };
}

export function haOperacaoSensivel(): boolean {
  return contagens.size > 0;
}

/** Os motivos em andamento (para diagnóstico; a decisão usa só o booleano). */
export function motivosDeOperacaoSensivel(): string[] {
  return [...contagens.keys()];
}

/** Avisa quando o conjunto de operações muda (a aba republica seu estado às
 * outras). Devolve o cancelamento. */
export function assinarOperacoesSensiveis(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}
