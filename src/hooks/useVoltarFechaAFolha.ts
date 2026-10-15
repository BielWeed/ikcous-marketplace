import { useEffect, useRef } from "react";

/** Quanto tempo esperamos o `popstate` do nosso próprio `history.back()`. */
const JANELA_DO_RETORNO_MS = 500;

/**
 * Faz o botão Voltar do aparelho (Android, gesto, tecla do navegador) FECHAR a
 * folha em vez de tirar a cliente da tela.
 *
 * O problema: o app é um roteador manual em que "Voltar" é voltar uma entrada
 * do histórico — e a folha por cima do checkout, do cadastro ou do produto não
 * tinha entrada própria. Com a folha aberta, o Voltar saía da tela inteira e
 * apagava o que a cliente já tinha digitado (CPF, forma de pagamento, frete,
 * nome, senha, tamanho e cor).
 *
 * Como funciona, o mesmo caminho que o checkout já usa para o painel de
 * resumo e o modal de endereço (`{ modal: ... }` + `popstate`):
 *
 *  1. ao abrir, empurra UMA entrada nova no histórico (marca
 *     `folhaDePolitica` no `history.state`) com o MESMO endereço
 *     (caminho + `?id=` do produto) e o mesmo `state` da tela, mais uma marca;
 *  2. o Voltar consome essa entrada: a folha fecha e a URL não muda — o
 *     roteador do App vê "mesma tela" e não navega;
 *  3. fechar pelo X, pelo toque fora ou por Esc devolve a entrada com
 *     `history.back()`, para o próximo Voltar não ficar "sem efeito".
 *
 * O ouvinte é de CAPTURA e engole o evento (`stopImmediatePropagation`): a
 * camada aberta é dona do Voltar, e o handler do App não pode, por exemplo,
 * chamar o `backOverride` do checkout e fechar o painel de resumo que estiver
 * aberto por baixo. O mesmo vale para o `popstate` do nosso próprio
 * `history.back()`: é engolido uma vez só, com prazo curto.
 *
 * Se a tela some com a folha aberta (a navegação trocou de tela), NADA é
 * devolvido: a entrada no topo já não é a nossa, e mexer no histórico no meio
 * da navegação dos outros atrapalharia a transição.
 */
export function useVoltarFechaAFolha(
  aberta: boolean,
  aoVoltar: () => void,
): void {
  const aoVoltarRef = useRef(aoVoltar);
  useEffect(() => {
    aoVoltarRef.current = aoVoltar;
  });

  // Declarado ANTES do efeito principal: na desmontagem o React roda as
  // limpezas na ordem em que foram declaradas, então a marca já está certa
  // quando a limpeza do efeito principal for olhar.
  const desmontandoRef = useRef(false);
  useEffect(() => {
    desmontandoRef.current = false;
    return () => {
      desmontandoRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!aberta) return;

    const atual: Record<string, unknown> = globalThis.history.state ?? {};
    // `isBase` marca a primeira entrada da Home no roteador; copiar isso para
    // a nossa entrada faria o App achar que está de volta ao início.
    const { isBase: _isBase, ...resto } = atual;
    globalThis.history.pushState(
      { ...resto, folhaDePolitica: true },
      "",
      `${globalThis.location.pathname}${globalThis.location.search}`,
    );
    let entradaPropria = true;

    const aoPopState = (evento: PopStateEvent) => {
      evento.stopImmediatePropagation();
      entradaPropria = false;
      aoVoltarRef.current();
    };
    globalThis.addEventListener("popstate", aoPopState, true);

    return () => {
      globalThis.removeEventListener("popstate", aoPopState, true);
      if (desmontandoRef.current) return;
      if (!entradaPropria) return;
      if (globalThis.history.state?.folhaDePolitica !== true) return;
      engolirOProximoPopState();
      globalThis.history.back();
    };
  }, [aberta]);
}

/** Engole o `popstate` do `history.back()` que acabamos de pedir. */
function engolirOProximoPopState(): void {
  const engolir = (evento: PopStateEvent) => {
    evento.stopImmediatePropagation();
    desarmar();
  };
  const timer = setTimeout(() => desarmar(), JANELA_DO_RETORNO_MS);
  function desarmar() {
    clearTimeout(timer);
    globalThis.removeEventListener("popstate", engolir, true);
  }
  globalThis.addEventListener("popstate", engolir, true);
}
