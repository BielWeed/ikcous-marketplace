import { useEffect, useRef } from "react";

/** Quanto tempo esperamos o `popstate` do nosso próprio `history.back()`. */
const JANELA_DO_RETORNO_MS = 500;

/** Folhas abertas, da mais antiga para a mais nova: só a última trata o Voltar. */
const pilhaDeFolhas: symbol[] = [];
/** Retornos do nosso `history.back()` ainda por chegar (devem ser engolidos). */
let retornosPendentes = 0;

// Só folhas que pedem prioridade entram aqui. No navegador real o listener
// do App pode rodar antes do listener local, mesmo que este use captura.
const ouvintesAntesDaGuarda = new Set<(evento: PopStateEvent) => boolean>();

export function consumirVoltarDaFolhaAntesDaGuarda(
  evento: PopStateEvent,
): boolean {
  for (const ouvir of ouvintesAntesDaGuarda) {
    if (ouvir(evento)) return true;
  }
  return false;
}

const enderecoDaFolha = () =>
  `${globalThis.location.pathname}${globalThis.location.search}`;

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
 * Quem trata o `popstate` primeiro, no navegador de verdade, é quem se
 * registrou primeiro (o `true` de captura NÃO passa na frente no `window`; só o
 * jsdom faz isso). O App se registra na montagem, antes de qualquer folha, então
 * o App SEMPRE acorda também: o `stopImmediatePropagation` daqui não o impede.
 * O que torna o fluxo correto é o App não fazer nada quando o endereço e a tela
 * não mudam (`syncWithUrl`, "já estamos no mesmo destino"); a folha fecha pelo
 * ouvinte daqui. O `popstate` do nosso próprio `history.back()` (fechar pelo X)
 * é engolido uma vez só, com prazo curto, para o ouvinte da folha não tratá-lo
 * como Voltar.
 *
 * Limite conhecido: se o App tiver um desvio do Voltar ativo (o `backOverride`
 * do checkout, com o painel de resumo aberto por baixo da folha), ele roda no
 * mesmo Voltar. Então um único Voltar pode fechar a folha E o painel, e sobra
 * uma entrada de histórico a mais (o Voltar seguinte pode parecer "sem
 * efeito"). A tela não troca, então o que foi digitado fica. A opção
 * `antesDaGuarda` deixa o App entregar primeiro o retorno da mesma URL a
 * esta folha, inclusive o retorno interno de fechar pelo X.
 *
 * Se a tela some com a folha aberta (a navegação trocou de tela), NADA é
 * devolvido: a entrada no topo já não é a nossa, e mexer no histórico no meio
 * da navegação dos outros atrapalharia a transição.
 *
 * Folhas EMPILHADAS (uma aberta por cima da outra): só a de cima trata o
 * Voltar, e cada Voltar fecha uma. As folhas formam uma pilha (a ordem em que
 * abriram é a ordem das entradas no histórico).
 *
 * Folha que RECUSA fechar: `aoVoltar` devolve `false` quando a folha continua
 * aberta (a pergunta "descartar o que você escreveu?", o envio em andamento).
 * O Voltar já consumiu a nossa entrada; sem empurrá-la de novo, o Voltar
 * seguinte tiraria a cliente da tela inteira. Só o `false` exato conta; qualquer
 * outro retorno (`true`, nada) é "fechou".
 *
 * Devolve uma função para marcar a saída por navegação ANTES de fechar a
 * folha. A limpeza NÃO devolve a entrada nesse caminho: o roteador precisa
 * substituí-la com replaceState pelo destino (carrinho → novo endereço),
 * senão sobra uma cópia da tela e o primeiro Voltar nela não sai do lugar.
 */
export function useVoltarFechaAFolha(
  aberta: boolean,
  aoVoltar: () => unknown,
  antesDaGuarda = false,
): () => void {
  const saindoPorNavegacaoRef = useRef(false);
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
    saindoPorNavegacaoRef.current = false;

    const eu = Symbol("folha");
    const endereco = enderecoDaFolha();
    pilhaDeFolhas.push(eu);
    const sairDaPilha = () => {
      const posicao = pilhaDeFolhas.indexOf(eu);
      if (posicao >= 0) pilhaDeFolhas.splice(posicao, 1);
    };
    const empurrarEntrada = () => {
      const atual: Record<string, unknown> = globalThis.history.state ?? {};
      // `isBase` marca a primeira entrada da Home no roteador; copiar isso para
      // a nossa entrada faria o App achar que está de volta ao início.
      const { isBase: _isBase, ...resto } = atual;
      globalThis.history.pushState(
        { ...resto, folhaDePolitica: true },
        "",
        `${globalThis.location.pathname}${globalThis.location.search}`,
      );
    };
    empurrarEntrada();
    let entradaPropria = true;

    const aoPopState = (evento: PopStateEvent) => {
      // O retorno do `history.back()` de outra folha que fechou pelo X não é
      // Voltar: quem o engole é o ouvinte armado por `engolirOProximoPopState`.
      if (retornosPendentes > 0) return false;
      // Empilhadas: só a de cima trata este Voltar.
      if (pilhaDeFolhas[pilhaDeFolhas.length - 1] !== eu) return false;
      if (antesDaGuarda && enderecoDaFolha() !== endereco) return false;
      evento.stopImmediatePropagation();
      entradaPropria = false;
      if (aoVoltarRef.current() === false) {
        // A folha continua aberta: o Voltar consumiu a nossa entrada e o
        // próximo precisa encontrar outra.
        empurrarEntrada();
        entradaPropria = true;
        return true;
      }
      sairDaPilha();
      return true;
    };
    if (antesDaGuarda) ouvintesAntesDaGuarda.add(aoPopState);
    globalThis.addEventListener("popstate", aoPopState, true);

    return () => {
      ouvintesAntesDaGuarda.delete(aoPopState);
      globalThis.removeEventListener("popstate", aoPopState, true);
      const eraDaFrente = pilhaDeFolhas[pilhaDeFolhas.length - 1] === eu;
      sairDaPilha();
      if (desmontandoRef.current || saindoPorNavegacaoRef.current) return;
      if (!entradaPropria) return;
      // Fechada por baixo de outra folha: a entrada do topo é da outra.
      if (!eraDaFrente) return;
      if (globalThis.history.state?.folhaDePolitica !== true) return;
      if (antesDaGuarda && enderecoDaFolha() !== endereco) return;
      engolirOProximoPopState(antesDaGuarda ? endereco : undefined);
      globalThis.history.back();
    };
  }, [aberta, antesDaGuarda]);

  return () => {
    saindoPorNavegacaoRef.current = true;
  };
}

/** Engole o `popstate` do `history.back()` que acabamos de pedir. */
function engolirOProximoPopState(endereco?: string): void {
  retornosPendentes += 1;
  let armado = true;
  const engolir = (evento: PopStateEvent) => {
    if (endereco !== undefined && enderecoDaFolha() !== endereco) return false;
    evento.stopImmediatePropagation();
    desarmar();
    return true;
  };
  if (endereco !== undefined) ouvintesAntesDaGuarda.add(engolir);
  const timer = setTimeout(() => desarmar(), JANELA_DO_RETORNO_MS);
  function desarmar() {
    if (!armado) return;
    armado = false;
    retornosPendentes -= 1;
    clearTimeout(timer);
    ouvintesAntesDaGuarda.delete(engolir);
    // O temporizador pode vencer depois de a janela (jsdom) ser desmontada: sem
    // o método na janela não há o que desarmar.
    globalThis.removeEventListener?.("popstate", engolir, true);
  }
  globalThis.addEventListener("popstate", engolir, true);
}
