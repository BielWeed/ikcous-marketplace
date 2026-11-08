// Ignora o mesmo código de barras repetido por 1,5 s (plano, seção 5.3 item
// 1): um código parado na frente da câmera é decodificado várias vezes por
// segundo, e sem isso cada quadro viraria uma "leitura" nova. Puro — sem
// `document`/`window` — e com relógio injetável para o teste não depender
// de timer falso.
//
// A janela de 1,5 s sozinha não basta: um código que a lojista segura na
// frente da câmera por mais de 1,5 s voltava a ser aceito e somava uma unidade
// que ela não pediu. Por isso o mesmo código só vale de novo DEPOIS DE SAIR DO
// QUADRO (ver `JANELA_DE_SAIDA_DO_QUADRO_MS`), além da janela.

/** Plano, seção 5.3 item 1: "ignora o mesmo código por 1,5 s". */
export const JANELA_DE_REPETICAO_MS = 1500;

/** Quanto tempo SEM ver o código conta como "saiu do quadro". Um quadro
 * borrado ou perdido (a câmera decodifica a cada ~150 ms) não chega perto
 * disto; tirar a peça e trazer outra igual, sim. */
export const JANELA_DE_SAIDA_DO_QUADRO_MS = 1000;

const MAXIMO_DE_CODIGOS_LEMBRADOS_PADRAO = 50;

export interface OpcoesDoDebounce {
  readonly janelaMs?: number;
  /** Sem ver o código por este tempo = ele saiu do quadro. Padrão 1 s. */
  readonly saidaDoQuadroMs?: number;
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
  const saidaDoQuadroMs =
    opcoes.saidaDoQuadroMs ?? JANELA_DE_SAIDA_DO_QUADRO_MS;
  const agora = opcoes.agora ?? Date.now;
  const maximoDeCodigosLembrados =
    opcoes.maximoDeCodigosLembrados ?? MAXIMO_DE_CODIGOS_LEMBRADOS_PADRAO;

  // `Map`, não objeto: indexar por chave variável (`objeto[codigo]`)
  // dispara `security/detect-object-injection` do eslint — mesma razão
  // documentada em src/hooks/usePushNotifications.ts:47-52, e o teto de
  // warnings não tem folga. `Map` também preserva ORDEM DE INSERÇÃO, o que
  // usamos abaixo para descartar a entrada mais antiga.
  //
  // Por código: quando foi ACEITO pela última vez e quando foi VISTO pela
  // última vez (aceito ou recusado). Os dois instantes são coisas diferentes:
  // a janela de 1,5 s conta do aceite; a saída do quadro conta da última vista.
  const instantesPorCodigo = new Map<
    string,
    { aceitoEm: number; vistoEm: number }
  >();

  function aceita(codigo: string): boolean {
    const agoraEm = agora();
    const anterior = instantesPorCodigo.get(codigo);
    if (anterior !== undefined) {
      const dentroDaJanela = agoraEm - anterior.aceitoEm < janelaMs;
      const aindaNoQuadro = agoraEm - anterior.vistoEm < saidaDoQuadroMs;
      if (dentroDaJanela || aindaNoQuadro) {
        // NÃO atualiza o instante do ACEITE na recusa: a janela de 1,5 s
        // continua contando do aceite, então, depois que o código sai do
        // quadro, a janela não fica estendida pelo tempo que ele ficou parado
        // lá. Só a "última vista" anda — é ela que diz se o código continua
        // no quadro (e, enquanto continua, não vale de novo).
        anterior.vistoEm = agoraEm;
        return false;
      }
    }

    // Reinsere (em vez de só `.set` sobre a chave existente, que o `Map` já
    // trataria como "mesma posição de sempre" só quando a chave é nova):
    // remover antes de gravar garante que a chave usada agora vá para o
    // FIM da ordem de inserção, então "mais antiga" continua significando
    // "há mais tempo sem ser aceita", não "inserida há mais tempo".
    instantesPorCodigo.delete(codigo);
    instantesPorCodigo.set(codigo, { aceitoEm: agoraEm, vistoEm: agoraEm });

    if (instantesPorCodigo.size > maximoDeCodigosLembrados) {
      // A primeira chave de um `Map` é a mais antiga por ordem de inserção
      // — um turno de caixa não pode fazer isto crescer sem fim.
      const maisAntiga = instantesPorCodigo.keys().next().value;
      if (maisAntiga !== undefined) {
        instantesPorCodigo.delete(maisAntiga);
      }
    }

    return true;
  }

  function esquecer(codigo?: string): void {
    if (codigo === undefined) {
      instantesPorCodigo.clear();
      return;
    }
    instantesPorCodigo.delete(codigo);
  }

  return { aceita, esquecer };
}
