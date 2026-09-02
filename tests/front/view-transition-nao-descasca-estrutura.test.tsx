import { limparNomesDeTransicao } from "@/hooks/useViewTransition";
// @vitest-environment jsdom
//
// O "pisca" da barra inferior (relato do Gabriel, 02/09: abrir a página de
// produto ou login/cadastro fazia a BottomNav sumir por um instante — e só
// nessas telas, onde a navegação roda como "forward").
//
// A CAUSA RAIZ: o cleanup da View Transition usava o seletor
// `img, [style*="view-transition-name"]` — ele não só pega imagens, pega
// QUALQUER elemento com nome, inclusive a BottomNav ("bottom-nav") e o
// Header ("app-header"), que são estrutura persistente. Nomes de estrutura
// precisam existir nos DOIS lados da transição (old e new) para o navegador
// animar um morph estável; com o nome removido do lado novo, o snapshot
// velho da barra virava animação de SAÍDA (fade-out) e a barra
// reaparecia no fim da transição.
//
// O CONTRATO da correção (`limparNomesDeTransicao`):
//   1. Estrutura persistente (nav, header, aside — qualquer não-img) NUNCA
//      tem o nome removido, em nenhuma direção.
//   2. Imagens continuam trocando de dono como antes:
//      - "forward": toda img perde, EXCETO a foto principal (.main-product-image);
//      - "back": só a foto principal perde;
//      - "none": toda img perde.
//
// A lógica é exercida espiando `removeProperty` em cada elemento (o parser
// de CSS do jsdom não conhece `view-transition-name` — afirmar por ele seria
// testar o jsdom, não o nosso código).
//
// O QUE DISCRIMINA A REGRESSÃO: os testes 1-3 travam as REGRAS de decisão
// (quem perde o nome em cada direção); o teste 4 trava o SELETOR em "img" —
// com o seletor largo antigo, é o teste 4 que falha. O conjunto fecha o
// contrato; nenhum teste isolado fecha tudo.
import { afterEach, describe, expect, it, vi } from "vitest";

type Espia = { el: HTMLElement; chamadas: string[] };

// O método REAL, capturado uma única vez — os spies dos testes chamam ele,
// nunca o método espiado (que já pode ser o spy do teste anterior).
const realQuerySelectorAll = document.querySelectorAll.bind(document);

let seletorUsado: string | null = null;

/** Instala o espionagem do `querySelectorAll` e registra o seletor pedido. */
function espionarSeletores() {
  seletorUsado = null;
  vi.spyOn(document, "querySelectorAll").mockImplementation(((
    selector: string,
  ) => {
    seletorUsado = selector;
    return realQuerySelectorAll(selector);
  }) as unknown as typeof document.querySelectorAll);
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Cria um elemento com espião de `removeProperty` anexado à instância. */
function elemento(
  tag: string,
  opcoes: { classe?: string; nome?: string } = {},
): Espia {
  const el = document.createElement(tag);
  if (opcoes.classe) el.className = opcoes.classe;
  const chamadas: string[] = [];
  const original = el.style.removeProperty.bind(el.style);
  el.style.removeProperty = (propriedade: string) => {
    chamadas.push(propriedade);
    return original(propriedade);
  };
  document.body.appendChild(el);
  return { el, chamadas };
}

describe("limparNomesDeTransicao — estrutura persistente nunca perde o nome", () => {
  it("forward: a barra e o header mantêm o nome; img comum perde; a foto principal mantém", () => {
    const nav = elemento("nav", { nome: "bottom-nav" });
    const header = elemento("header", { nome: "app-header" });
    const imgCard = elemento("img", { nome: "product-image" });
    const imgPrincipal = elemento("img", {
      classe: "main-product-image",
      nome: "product-image",
    });
    espionarSeletores();

    limparNomesDeTransicao(document, "forward");

    expect(nav.chamadas).toEqual([]);
    expect(header.chamadas).toEqual([]);
    expect(imgCard.chamadas).toEqual(["view-transition-name"]);
    expect(imgPrincipal.chamadas).toEqual([]);
  });

  it("back: só a foto principal perde; barra, header e img comum mantêm", () => {
    const nav = elemento("nav", { nome: "bottom-nav" });
    const header = elemento("header", { nome: "app-header" });
    const imgComum = elemento("img", { nome: "product-image" });
    const imgPrincipal = elemento("img", {
      classe: "main-product-image",
      nome: "product-image",
    });
    espionarSeletores();

    limparNomesDeTransicao(document, "back");

    expect(nav.chamadas).toEqual([]);
    expect(header.chamadas).toEqual([]);
    expect(imgComum.chamadas).toEqual([]);
    expect(imgPrincipal.chamadas).toEqual(["view-transition-name"]);
  });

  it("none: imgs perdem, mas a estrutura persistente ainda é intocada", () => {
    const nav = elemento("nav", { nome: "bottom-nav" });
    const img = elemento("img", { nome: "product-image" });
    espionarSeletores();

    limparNomesDeTransicao(document, "none");

    expect(nav.chamadas).toEqual([]);
    expect(img.chamadas).toEqual(["view-transition-name"]);
  });

  it("o seletor só alcança img — estrutura nem é visitada (prova do seletor)", () => {
    // O defeito era o SELETOR. Este teste trava o seletor em "img": se
    // alguém voltar para `[style*="view-transition-name"]`, esta afirmação
    // falha com o seletor largo na mão.
    const nav = elemento("nav", { nome: "bottom-nav" });
    espionarSeletores();

    limparNomesDeTransicao(document, undefined);

    expect(seletorUsado).toBe("img");
    expect(nav.chamadas).toEqual([]);
  });
});
