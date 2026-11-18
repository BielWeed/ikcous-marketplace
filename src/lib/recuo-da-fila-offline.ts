/**
 * Filas offline de pedidos e de produtos: a nova tentativa depois de uma
 * passada que deixou item na fila por falha PASSAGEIRA (o servidor respondeu
 * 500, estourou o tempo, a releitura do pedido falhou).
 *
 * Sem isto, só quatro coisas refaziam a passada: o evento `online`, a
 * montagem da tela, a troca de usuário e o religador de token. Com a rede
 * estável nenhum novo `online` acontece, e um tablet aberto o dia todo deixava
 * o pedido no status antigo no servidor (a tela, otimista, já dizia o novo) e o
 * produto com o preço/estoque antigo, até o item vencer (72 h) ou a página
 * recarregar.
 *
 * `falhasPassageirasDaFila` registra, por fila de um dono (a chave do
 * armazenamento), que a ÚLTIMA passada terminou com item devolvido por falha
 * passageira. A passada faz `delete` no começo e `add` só no fim, quando NÃO
 * foi interrompida: erro terminal (o item sai da fila), troca de conta e
 * parada por rede (`paradasPelaRede`, que tem o religador próprio) NÃO entram.
 * O efeito do hook lê com `has` ao fim da passada.
 */
export const falhasPassageirasDaFila = new Set<string>();

/** Esperas entre tentativas seguidas; a última é o teto (10 min). */
export const ESPERAS_DO_RECUO_MS = [30_000, 120_000, 600_000] as const;

/**
 * O relógio da nova tentativa. Vive no efeito do hook: `encerrar()` no
 * desmonte (ou na troca de usuário) desfaz tudo.
 *
 * `retomar` só pode AGENDAR a passada, que é a de sempre e passa pelas mesmas
 * guardas: sessão do dono conferida antes de CADA envio, etapa/versão esperada
 * (`statusEsperado`, `baseUpdatedAt`), erro terminal, validade de 72 h e uma
 * passada por vez (a de `sincronizacaoEmVoo`/`filasEmSincronizacao` e o lock
 * entre abas). Este relógio só diz QUANDO tentar de novo, nunca que o envio é
 * seguro, e não aumenta o número de envios de uma passada.
 *
 * Há no máximo UMA espera marcada: cada fim de passada cancela a anterior e,
 * se for o caso, marca a seguinte.
 */
export function criarRecuoDaFila(
  retomar: () => void,
  esperas: readonly number[] = ESPERAS_DO_RECUO_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let falhasSeguidas = 0;
  let fechado = false;
  const cancelar = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    /**
     * Fim de cada passada. Com falha passageira, marca a próxima tentativa
     * (cada vez mais longe, até o teto); sem ela -- fila vazia ou parada que
     * não é falha passageira --, cancela a espera marcada e zera o recuo.
     */
    aoFimDaPassada(deixouFalhaPassageira: boolean) {
      cancelar();
      if (fechado) return;
      if (!deixouFalhaPassageira) {
        falhasSeguidas = 0;
        return;
      }
      const espera = esperas[Math.min(falhasSeguidas, esperas.length - 1)];
      falhasSeguidas += 1;
      timer = setTimeout(() => {
        timer = undefined;
        retomar();
      }, espera);
    },
    /** Desmonte da tela ou troca de usuário: nada marcado, nada novo. */
    encerrar() {
      fechado = true;
      cancelar();
    },
  };
}
