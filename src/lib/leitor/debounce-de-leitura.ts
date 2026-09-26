// Ignora o mesmo código de barras repetido por 1,5 s (plano, seção 5.3 item
// 1): um código parado na frente da câmera é decodificado várias vezes por
// segundo, e sem isso cada quadro viraria uma "leitura" nova. Puro — sem
// `document`/`window` — e com relógio injetável para o teste não depender
// de timer falso.

/** Plano, seção 5.3 item 1: "ignora o mesmo código por 1,5 s". */
export const JANELA_DE_REPETICAO_MS = 1500;

const MAXIMO_DE_CODIGOS_LEMBRADOS_PADRAO = 50;

export interface OpcoesDoDebounce {
  readonly janelaMs?: number;
  /** Relógio injetável. Padrão `Date.now`. */
  readonly agora?: () => number;
  /** Teto de códigos guardados ao mesmo tempo. Padrão 50. */
  readonly maximoDeCodigosLembrados?: number;
}

export interface DebounceDeLeitura {
  /** `true` = pode processar; JÁ registra o instante quando aceita. */
  aceita(codigo: string): boolean;
  /** Sem argumento, esquece tudo. */
  esquecer(codigo?: string): void;
}

export function criarDebounceDeLeitura(
  opcoes: OpcoesDoDebounce = {},
): DebounceDeLeitura {
  const janelaMs = opcoes.janelaMs ?? JANELA_DE_REPETICAO_MS;
  const agora = opcoes.agora ?? Date.now;
  const maximoDeCodigosLembrados =
    opcoes.maximoDeCodigosLembrados ?? MAXIMO_DE_CODIGOS_LEMBRADOS_PADRAO;

  // `Map`, não objeto: indexar por chave variável (`objeto[codigo]`)
  // dispara `security/detect-object-injection` do eslint — mesma razão
  // documentada em src/hooks/usePushNotifications.ts:47-52, e o teto de
  // warnings não tem folga. `Map` também preserva ORDEM DE INSERÇÃO, o que
  // usamos abaixo para descartar a entrada mais antiga.
  const ultimoInstantePorCodigo = new Map<string, number>();

  function aceita(codigo: string): boolean {
    const anterior = ultimoInstantePorCodigo.get(codigo);
    if (anterior !== undefined && agora() - anterior < janelaMs) {
      // NÃO atualiza o instante na recusa. Se atualizasse, um código parado
      // na frente da câmera empurraria a janela para a frente a cada
      // quadro e nunca mais seria aceito — o defeito clássico desta peça.
      return false;
    }

    // Reinsere (em vez de só `.set` sobre a chave existente, que o `Map` já
    // trataria como "mesma posição de sempre" só quando a chave é nova):
    // remover antes de gravar garante que a chave usada agora vá para o
    // FIM da ordem de inserção, então "mais antiga" continua significando
    // "há mais tempo sem ser aceita", não "inserida há mais tempo".
    ultimoInstantePorCodigo.delete(codigo);
    ultimoInstantePorCodigo.set(codigo, agora());

    if (ultimoInstantePorCodigo.size > maximoDeCodigosLembrados) {
      // A primeira chave de um `Map` é a mais antiga por ordem de inserção
      // — um turno de caixa não pode fazer isto crescer sem fim.
      const maisAntiga = ultimoInstantePorCodigo.keys().next().value;
      if (maisAntiga !== undefined) {
        ultimoInstantePorCodigo.delete(maisAntiga);
      }
    }

    return true;
  }

  function esquecer(codigo?: string): void {
    if (codigo === undefined) {
      ultimoInstantePorCodigo.clear();
      return;
    }
    ultimoInstantePorCodigo.delete(codigo);
  }

  return { aceita, esquecer };
}
