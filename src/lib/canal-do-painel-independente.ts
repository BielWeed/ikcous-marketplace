/**
 * Peças do canal de tempo real que uma TELA DO PAINEL abre por conta própria,
 * sem depender de a aba ser a "líder" (`useLeaderElection`).
 *
 * Por quê: a liderança é fixa por aba e não migra por visibilidade. Com a
 * vitrine aberta primeiro (líder) e o painel em outra aba (seguidor), o painel
 * esperava um repasse da líder que podia nem chegar (a líder da página de um
 * produto assina com filtro de produto). Mesmo precedente do `AdminLayout`:
 * toda aba VISÍVEL do painel assina o próprio canal; aba escondida fecha o
 * dela. O preço é um canal por aba visível do painel, só para admin — a aba
 * pública continua sem canal fora da líder (teto de conexões do plano).
 */

/** Opção que SÓ as telas do painel passam às assinaturas dos hooks. */
export interface OpcoesDaAssinaturaDoPainel {
  /**
   * A tela é do painel: sendo admin e com a aba visível, assina o próprio
   * canal mesmo numa aba seguidora. Sem a opção, nada muda.
   */
  independenteDaLideranca?: boolean;
}

/**
 * Mantém uma assinatura aberta SÓ enquanto a aba está visível.
 *
 * `abrir(reabertura)` devolve o fechamento. `reabertura` é `false` na
 * abertura da montagem (a tela acabou de ler a lista) e `true` quando a aba
 * volta depois de ter ficado escondida (o que mudou no intervalo não chegou
 * por evento: quem abre deve reler uma vez ao confirmar o canal).
 *
 * Devolve o cleanup do efeito: fecha o que estiver aberto e solta o ouvinte.
 */
export function assinarEnquantoVisivel(
  abrir: (reabertura: boolean) => () => void,
): () => void {
  if (typeof document === "undefined") return abrir(false);

  let fechar: (() => void) | null = null;

  const abrirSeVisivel = (reabertura: boolean) => {
    if (fechar || document.visibilityState !== "visible") return;
    fechar = abrir(reabertura);
  };

  const aoMudarAVisibilidade = () => {
    if (document.visibilityState === "visible") {
      abrirSeVisivel(true);
    } else if (fechar) {
      fechar();
      fechar = null;
    }
  };

  abrirSeVisivel(false);
  document.addEventListener("visibilitychange", aoMudarAVisibilidade);

  return () => {
    document.removeEventListener("visibilitychange", aoMudarAVisibilidade);
    if (fechar) {
      fechar();
      fechar = null;
    }
  };
}

/**
 * Retorno da assinatura (`channel.subscribe(...)`): pede UMA releitura ao
 * confirmar o canal quando houve lacuna sem escuta — a aba voltou a aparecer
 * (`relerNaPrimeiraConfirmacao`) ou o socket caiu e voltou. A primeira
 * confirmação de uma abertura comum não relê (a tela acabou de ler), e
 * confirmação repetida sem queda no meio também não. Não reassina nada: a
 * reconexão depois de uma queda é do SDK.
 */
export function aoMudarOStatusDoCanalDoPainel(
  nome: string,
  reler: () => void,
  relerNaPrimeiraConfirmacao = false,
) {
  let houveLacuna = relerNaPrimeiraConfirmacao;
  return (status: string, err?: unknown) => {
    if (status === "SUBSCRIBED") {
      if (houveLacuna) {
        houveLacuna = false;
        reler();
      }
      return;
    }
    if (
      status === "CHANNEL_ERROR" ||
      status === "TIMED_OUT" ||
      status === "CLOSED"
    ) {
      houveLacuna = true;
    }
    if (status === "CHANNEL_ERROR") {
      console.warn(
        `[Realtime-Painel] canal ${nome} com erro; o SDK reconecta sozinho.`,
        err instanceof Error ? err.message : err,
      );
    }
  };
}
