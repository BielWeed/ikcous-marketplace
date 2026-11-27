import { type RefObject, useCallback, useLayoutEffect } from "react";

/**
 * Por quanto tempo, depois de mudar de lugar na tela, um cartão recusa o toque
 * de um botão que age com 1 toque. O dedo leva uns 200-500 ms entre mirar e
 * encostar; 600 ms cobre essa mira com folga.
 */
export const JANELA_DO_CARTAO_QUE_MEXEU_MS = 600;

/** O aviso de quando o toque é recusado (o toast do painel é aria-live). */
export const AVISO_DA_LISTA_QUE_MUDOU =
  "A lista mudou. Confira o pedido e toque de novo.";

type Posicao = { x: number; y: number };
type Registro = Posicao & { mudouEm: number };

const registros = new Map<HTMLElement, Registro>();
/** Listas que já receberam cartões: um cartão novo nelas "acabou de aparecer". */
const listasConhecidas = new WeakSet<Element>();
/** Listas na primeira montagem (mesmo commit do React): ninguém "apareceu". */
const listasPovoando = new WeakSet<Element>();

let mutacoes: MutationObserver | null = null;
let tamanhos: ResizeObserver | null = null;
let medicaoAgendada = false;

/**
 * Posição do cartão no LAYOUT da página: a soma de `offsetLeft`/`offsetTop`
 * pela cadeia de `offsetParent`. Não é `getBoundingClientRect` de propósito:
 * o retângulo muda quando a lojista ROLA a lista (todo toque logo depois de
 * rolar seria recusado) e durante o deslize de troca de aba do painel
 * (`.admin-tab-pane` anima `transform`). O `offset*` ignora transform e
 * rolagem; medido no Chromium e no Firefox (27/11/2026) com contêiner que
 * rola, posicionado e não posicionado, e com `translate3d` no pai.
 */
function posicaoNoLayout(elemento: HTMLElement): Posicao {
  let x = 0;
  let y = 0;
  for (
    let atual: HTMLElement | null = elemento;
    atual;
    atual = atual.offsetParent as HTMLElement | null
  ) {
    x += atual.offsetLeft;
    y += atual.offsetTop;
  }
  return { x, y };
}

/** Mede de novo e carimba a hora em quem mudou de lugar desde a última medida. */
function remedir(elemento: HTMLElement, registro: Registro) {
  const agora = posicaoNoLayout(elemento);
  if (agora.x !== registro.x || agora.y !== registro.y) {
    registro.x = agora.x;
    registro.y = agora.y;
    registro.mudouEm = Date.now();
  }
}

function remedirTodos() {
  medicaoAgendada = false;
  for (const [elemento, registro] of registros) remedir(elemento, registro);
}

/** Uma medida por quadro, por mais mudanças que cheguem nele. */
function agendarMedicao() {
  if (medicaoAgendada) return;
  medicaoAgendada = true;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(remedirTodos);
  } else {
    setTimeout(remedirTodos, 16);
  }
}

/**
 * Os observadores só mantêm a medida em dia (para não recusar um toque por
 * uma mudança velha). A SEGURANÇA não depende deles: `acabouDeMexer` mede de
 * novo no próprio toque, e qualquer mudança que eles não viram conta como
 * agora.
 */
function ligarObservadores() {
  if (typeof MutationObserver === "function" && !mutacoes) {
    mutacoes = new MutationObserver(agendarMedicao);
    mutacoes.observe(document.body, {
      childList: true,
      subtree: true,
      // Só os atributos que mexem no layout: `data-*` e `aria-*` mudam a
      // todo instante (foco, hover, estado do Radix) e não movem ninguém.
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
      characterData: true,
    });
  }
  if (typeof ResizeObserver === "function" && !tamanhos) {
    tamanhos = new ResizeObserver(agendarMedicao);
  }
  window.addEventListener("resize", agendarMedicao);
}

function desligarObservadores() {
  mutacoes?.disconnect();
  mutacoes = null;
  tamanhos?.disconnect();
  tamanhos = null;
  window.removeEventListener("resize", agendarMedicao);
}

function registrar(elemento: HTMLElement) {
  const lista = elemento.parentElement;
  let apareceuAgora = false;
  if (lista) {
    if (!listasConhecidas.has(lista)) {
      listasConhecidas.add(lista);
      listasPovoando.add(lista);
      // Todos os cartões do mesmo commit registram antes deste microtask.
      queueMicrotask(() => listasPovoando.delete(lista));
    } else if (!listasPovoando.has(lista)) {
      // Entrou numa lista que já estava na tela (pedido novo no topo): o
      // cartão está onde, um instante antes, estava outro pedido.
      apareceuAgora = true;
    }
  }
  if (registros.size === 0) ligarObservadores();
  registros.set(elemento, {
    ...posicaoNoLayout(elemento),
    mudouEm: apareceuAgora ? Date.now() : Number.NEGATIVE_INFINITY,
  });
  tamanhos?.observe(elemento);
}

function desregistrar(elemento: HTMLElement) {
  registros.delete(elemento);
  tamanhos?.unobserve(elemento);
  if (registros.size === 0) desligarObservadores();
}

/**
 * Diz se o elemento (um cartão de lista) mudou de lugar na tela, ou acabou de
 * aparecer numa lista que já estava ali, nos últimos
 * `JANELA_DO_CARTAO_QUE_MEXEU_MS`. Quem chama decide o que fazer com o toque.
 */
export function useAcabouDeMexer(
  ref: RefObject<HTMLElement | null>,
): () => boolean {
  useLayoutEffect(() => {
    const elemento = ref.current;
    if (!elemento) return;
    registrar(elemento);
    return () => desregistrar(elemento);
  }, [ref]);

  return useCallback(() => {
    const elemento = ref.current;
    const registro = elemento ? registros.get(elemento) : undefined;
    if (!elemento || !registro) return false;
    remedir(elemento, registro);
    return Date.now() - registro.mudouEm < JANELA_DO_CARTAO_QUE_MEXEU_MS;
  }, [ref]);
}
