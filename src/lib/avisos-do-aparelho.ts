// O cartão do Início que diz "este aparelho NÃO está recebendo aviso de pedido
// novo" (`CartaoDeAvisosDoAparelho`). A decisão de QUAL cartão mostrar mora
// aqui, em função pura, para a tela só desenhar e para a tabela de casos ficar
// presa em teste.

/** Chave do "Agora não" — vale para ESTE aparelho (é ele que não recebe). */
export const CHAVE_DO_ADIAMENTO_DOS_AVISOS =
  "ikcous_admin_avisos_do_aparelho_adiado_ate";

/** Quanto tempo o "Agora não" esconde o cartão. */
export const PRAZO_DO_ADIAMENTO_DOS_AVISOS_MS = 7 * 24 * 60 * 60 * 1000;

// Instalado = roda sozinho, sem a barra do navegador. É o mesmo par de sinais
// que `App.tsx` e `AdminLayout.tsx` já usam (`display-mode: standalone`, e
// `navigator.standalone` do iOS), SEM o `?standalone` da URL que os dois
// aceitam: ele força o layout standalone e não prova instalação nenhuma (vale
// em qualquer aba), e aqui a resposta escolhe entre "deste app" e "do
// navegador" — numa aba com `?standalone` dizer "deste app" mandaria a pessoa
// procurar um app que ela não abriu.
// Sem `matchMedia` (ambiente que não implementa, como o jsdom) não há
// prova de instalação: vale "aba", e o tratamento do erro não quebra.
export function estaComoAppInstalado(): boolean {
  if (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(display-mode: standalone)").matches
  ) {
    return true;
  }
  return (
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// iPhone, iPad e iPod. O iPad com iPadOS 13+ se apresenta como Mac no
// user agent; o que o entrega é ser um "Mac" com tela de toque (um Mac de
// verdade não tem pontos de toque).
export function ehAparelhoDaApple(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent ?? "")) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export type SituacaoDosAvisos =
  /** A sondagem do navegador ainda não terminou: não se sabe nada. */
  | "sondando"
  /** Inscrito e com permissão: o aviso de pedido novo chega aqui. */
  | "ligados"
  /** iPhone/iPad fora do app instalado: o iOS só entrega aviso a app instalado. */
  | "instalar-no-ios"
  /** Este navegador não tem como receber aviso. */
  | "sem-suporte"
  /** A pessoa escolheu Bloquear: só se resolve nas configurações. */
  | "bloqueado"
  /** Dá para ligar com um toque. */
  | "ligar";

export interface EntradaDaSituacao {
  readonly sondado: boolean;
  readonly isSupported: boolean;
  readonly permission: NotificationPermission;
  readonly temInscricao: boolean;
  readonly ehApple: boolean;
  readonly instalado: boolean;
}

export function situacaoDosAvisos(e: EntradaDaSituacao): SituacaoDosAvisos {
  if (!e.sondado) return "sondando";
  // Inscrição sem permissão não entrega nada: o navegador guarda a inscrição
  // e o aparelho esconde o aviso. Só conta como ligado com as DUAS coisas.
  if (e.temInscricao && e.permission === "granted") return "ligados";
  // O iOS só deixa um app instalado receber aviso — e fora dele o Safari nem
  // oferece o botão. Vale antes do "sem suporte": é ele que explica o caminho.
  if (e.ehApple && !e.instalado) return "instalar-no-ios";
  if (!e.isSupported) return "sem-suporte";
  if (e.permission === "denied") return "bloqueado";
  return "ligar";
}

/** O caminho do iPhone/iPad: o aviso só chega ao app na Tela de Início. */
export const PASSOS_PARA_INSTALAR_NO_IOS: readonly string[] = [
  "Abra este painel no Safari.",
  "Toque em Compartilhar (o quadrado com a seta para cima).",
  "Escolha Adicionar à Tela de Início.",
  "Abra o app pelo novo ícone e volte aqui para ligar os avisos.",
];

/**
 * Como liberar os avisos quando a pessoa escolheu Bloquear — nenhuma página
 * consegue desfazer isso por ela. O caminho depende de ONDE ela está: o app
 * instalado tem entrada própria nas configurações do aparelho; na aba, quem
 * tem a chave é o navegador.
 */
export function passosParaLiberarOsAvisos(
  onde: { readonly instalado: boolean; readonly ehApple: boolean },
  nomeDoApp: string,
): string[] {
  const voltar =
    "Feche e abra o painel de novo — o cartão some sozinho quando os avisos voltarem.";
  if (onde.instalado && onde.ehApple) {
    return [
      "Abra os Ajustes do aparelho.",
      `Toque em Notificações e escolha ${nomeDoApp}.`,
      "Ative Permitir Notificações.",
      voltar,
    ];
  }
  if (onde.instalado) {
    return [
      "Abra as configurações do aparelho.",
      `Entre em Apps e escolha ${nomeDoApp}.`,
      "Abra Notificações e ative.",
      voltar,
    ];
  }
  return [
    "Toque no cadeado (ou no ícone de configurações) ao lado do endereço do site.",
    "Abra Permissões, ou Configurações do site, e entre em Notificações.",
    "Mude para Permitir.",
    voltar,
  ];
}

/** Até quando o "Agora não" vale (ms desde 1970), ou `null` sem adiamento. */
export function lerAdiamentoDosAvisos(): number | null {
  try {
    const bruto = localStorage.getItem(CHAVE_DO_ADIAMENTO_DOS_AVISOS);
    if (bruto === null) return null;
    const ate = Number.parseInt(bruto, 10);
    return Number.isFinite(ate) ? ate : null;
  } catch {
    // Sandbox, modo privado ou armazenamento bloqueado: sem adiamento.
    return null;
  }
}

/** Grava o "Agora não" e devolve até quando ele vale. */
export function adiarOsAvisos(agora: number): number {
  const ate = agora + PRAZO_DO_ADIAMENTO_DOS_AVISOS_MS;
  try {
    localStorage.setItem(CHAVE_DO_ADIAMENTO_DOS_AVISOS, String(ate));
  } catch {
    // Sem armazenamento o cartão some só nesta visita.
  }
  return ate;
}

export function adiamentoEstaValendo(
  ate: number | null,
  agora: number,
): boolean {
  return ate !== null && agora < ate;
}
