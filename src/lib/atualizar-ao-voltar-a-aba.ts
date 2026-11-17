/**
 * Refaz uma leitura quando a pessoa VOLTA à aba -- o que ocupa o lugar do tempo
 * real para quem não tem login.
 *
 * O plano do Supabase tem teto de conexões de tempo real simultâneas, e o painel
 * do lojista (que precisa ver o pedido novo na hora) divide esse teto com a
 * vitrine. Então só o painel e a cliente logada mantêm canal aberto; o visitante
 * sem login vê o dado novo ao voltar à aba, sem segurar conexão nenhuma.
 *
 * O intervalo mínimo existe para não martelar o banco: alternar app/WhatsApp
 * várias vezes em meio minuto refaz a leitura UMA vez. A contagem começa na
 * montagem (quem chama acabou de ler o dado) e só avança quando a leitura de
 * fato roda; aba escondida não refaz nem gasta a janela.
 *
 * Devolve a função que solta os ouvintes (use no cleanup do efeito).
 */
export const INTERVALO_MINIMO_AO_VOLTAR_MS = 30_000;

export function aoVoltarAAba(
  refazer: () => unknown,
  intervaloMinimoMs: number = INTERVALO_MINIMO_AO_VOLTAR_MS,
): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }

  let ultimaLeitura = Date.now();

  const tentar = () => {
    if (document.visibilityState !== "visible") return;
    const agora = Date.now();
    if (agora - ultimaLeitura < intervaloMinimoMs) return;
    ultimaLeitura = agora;
    try {
      const resultado = refazer();
      // A leitura costuma ser assíncrona: a rejeição dela não pode virar erro
      // solto da página (quem chama já trata a falha dentro da própria leitura).
      if (
        resultado !== null &&
        typeof resultado === "object" &&
        typeof (resultado as PromiseLike<unknown>).then === "function"
      ) {
        (resultado as PromiseLike<unknown>).then(undefined, () => {});
      }
    } catch (erro) {
      console.warn("[aoVoltarAAba] a releitura lançou:", erro);
    }
  };

  // `visibilitychange` cobre trocar de app/aba; `focus` cobre voltar à janela
  // do navegador no desktop. Os dois na mesma volta custam uma leitura só (o
  // primeiro gasta a janela).
  document.addEventListener("visibilitychange", tentar);
  window.addEventListener("focus", tentar);

  return () => {
    document.removeEventListener("visibilitychange", tentar);
    window.removeEventListener("focus", tentar);
  };
}
