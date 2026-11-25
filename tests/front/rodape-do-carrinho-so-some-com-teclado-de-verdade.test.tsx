import type { CartFooterSummary as CartFooterSummaryTipo } from "@/components/ui/custom/CartFooterSummary";
// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território ui/custom: o rodapé do carrinho
// ("Total ... Finalizar compra") some quando o teclado do celular abre, para
// não ficar por cima do campo. Um único teste cobria isso (campo de texto, tela
// bem encolhida). Plantando defeitos na conta, nenhum era pego:
//  - tratar "caixinha de marcar" ou "botão" focados como se fosse digitação;
//  - ignorar textarea e campo editável;
//  - esconder o rodapé com a tela só um pouco menor (o teclado de verdade
//    encolhe a área visível para menos de 85% da altura);
//  - o rodapé não voltar quando o teclado fecha.
// Aqui cada uma dessas bordas tem o seu teste. E o caso de quem NÃO escolheu
// "retirada": frete zero continua sendo "GRÁTIS" (o padrão da propriedade).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Ouvinte = () => void;

describe("CartFooterSummary — só some com o teclado de verdade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ouvintes: Map<string, Ouvinte>;
  let quadros: Map<number, FrameRequestCallback>;
  let proximoQuadro: number;
  let viewport: {
    height: number;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    ouvintes = new Map();
    viewport = {
      height: 1000,
      addEventListener: vi.fn((nome: string, f: Ouvinte) => {
        ouvintes.set(nome, f);
      }),
      removeEventListener: vi.fn(),
    };
    quadros = new Map();
    proximoQuadro = 1;
    vi.stubGlobal("innerHeight", 1000);
    vi.stubGlobal("visualViewport", viewport);
    // Fila de quadros controlada pelo teste: rodar o quadro na hora faria a
    // animação do framer-motion (que também usa requestAnimationFrame) se
    // chamar sem parar.
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
      const id = proximoQuadro++;
      quadros.set(id, f);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      quadros.delete(id);
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    for (const el of Array.from(document.body.children)) el.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { CartFooterSummary } = await import(
      "@/components/ui/custom/CartFooterSummary"
    );
    await act(async () => {
      raiz.render(
        <CartFooterSummary
          cartCount={2}
          shipping={10}
          total={110}
          onNavigate={vi.fn()}
        />,
      );
    });
  }

  function barraVisivel(): boolean {
    return Array.from(document.body.querySelectorAll("button")).some((b) =>
      b.textContent?.includes("Finalizar compra"),
    );
  }

  /** Avisa o resize e roda SÓ o quadro que o rodapé pediu (não os do framer). */
  async function avisarResize() {
    const antes = proximoQuadro;
    await act(async () => {
      ouvintes.get("resize")?.();
      for (const [id, quadro] of Array.from(quadros)) {
        if (id >= antes) {
          quadros.delete(id);
          quadro(0);
        }
      }
    });
  }

  /** Foca o elemento, encolhe a área visível para `altura` e avisa o resize. */
  async function focarEEncolher(el: HTMLElement, altura: number) {
    document.body.appendChild(el);
    el.focus();
    expect(document.activeElement).toBe(el);
    viewport.height = altura;
    await avisarResize();
  }

  it("campo de texto focado e área visível bem menor: a barra some", async () => {
    await montar();
    expect(barraVisivel()).toBe(true);
    await focarEEncolher(document.createElement("input"), 500);
    expect(barraVisivel()).toBe(false);
  });

  it("textarea focada e área visível menor: a barra some", async () => {
    await montar();
    await focarEEncolher(document.createElement("textarea"), 500);
    expect(barraVisivel()).toBe(false);
  });

  it("campo editável (contenteditable) focado e área visível menor: a barra some", async () => {
    await montar();
    const editavel = document.createElement("div");
    editavel.setAttribute("contenteditable", "true");
    editavel.tabIndex = 0;
    await focarEEncolher(editavel, 500);
    expect(barraVisivel()).toBe(false);
  });

  it("um div comum focado (sem digitação) não conta como teclado", async () => {
    await montar();
    const comum = document.createElement("div");
    comum.tabIndex = 0;
    await focarEEncolher(comum, 500);
    expect(barraVisivel()).toBe(true);
  });

  it("caixinha de marcar, botão e rádio focados NÃO abrem teclado: a barra fica", async () => {
    await montar();
    for (const tipo of ["checkbox", "submit", "radio", "button"]) {
      const campo = document.createElement("input");
      campo.type = tipo;
      await focarEEncolher(campo, 500);
      expect(barraVisivel(), `input ${tipo}`).toBe(true);
      campo.remove();
    }
  });

  it("ninguém focado: mesmo com a área visível pequena, a barra fica", async () => {
    await montar();
    viewport.height = 500;
    await avisarResize();
    expect(barraVisivel()).toBe(true);
  });

  it("a borda é 85% da altura: 850 de 1000 ainda é tela cheia, 849 já é teclado", async () => {
    await montar();
    const campo = document.createElement("input");
    await focarEEncolher(campo, 850);
    expect(barraVisivel()).toBe(true);

    viewport.height = 849;
    await avisarResize();
    expect(barraVisivel()).toBe(false);
  });

  it("tela só um pouco menor (900 de 1000, barra de endereço do navegador): a barra fica", async () => {
    await montar();
    await focarEEncolher(document.createElement("input"), 900);
    expect(barraVisivel()).toBe(true);
  });

  it("o teclado fecha (área visível volta ao tamanho cheio): a barra volta", async () => {
    await montar();
    const campo = document.createElement("input");
    await focarEEncolher(campo, 500);
    expect(barraVisivel()).toBe(false);

    viewport.height = 1000;
    await avisarResize();
    expect(barraVisivel()).toBe(true);
  });

  it("ao sair da tela o ouvinte de resize é retirado (sem ouvinte órfão)", async () => {
    await montar();
    expect(viewport.addEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );
    const registrado = viewport.addEventListener.mock.calls[0]?.[1];
    act(() => {
      raiz.unmount();
    });
    expect(viewport.removeEventListener).toHaveBeenCalledWith(
      "resize",
      registrado,
    );
    // o afterEach desmonta de novo: recria a raiz para não desmontar duas vezes.
    raiz = createRoot(hospedeiro);
  });
});

describe("CartFooterSummary — texto e estilo do rodapé", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar(
    props: Partial<Parameters<typeof CartFooterSummaryTipo>[0]> = {},
  ) {
    const { CartFooterSummary } = await import(
      "@/components/ui/custom/CartFooterSummary"
    );
    const onNavigate = vi.fn();
    await act(async () => {
      raiz.render(
        <CartFooterSummary
          cartCount={1}
          shipping={10}
          total={110}
          onNavigate={onNavigate}
          {...props}
        />,
      );
    });
    return { onNavigate };
  }

  function texto(): string {
    // `\s` também casa o espaço sem quebra que o formatador de moeda usa.
    return (document.body.textContent ?? "").replace(/\s/g, " ");
  }

  /** O valor do frete (o span depois de "Frete") e a linha que o contém. */
  function linhaDoFrete() {
    const rotulo = Array.from(document.body.querySelectorAll("span")).find(
      (s) => s.textContent === "Frete",
    ) as HTMLElement;
    const valor = rotulo.nextElementSibling as HTMLElement;
    return { linha: rotulo.parentElement as HTMLElement, valor };
  }

  it("sem a propriedade de retirada, frete 0 diz 'GRÁTIS' com o ponto verde", async () => {
    await montar({ shipping: 0, total: 80 });
    expect(texto()).toContain("GRÁTIS");
    expect(texto()).not.toContain("Retirada na loja");
    expect(document.body.querySelector(".bg-emerald-500")).not.toBeNull();
  });

  it("frete GRÁTIS: linha verde, sem ponto na retirada e preço pago fica cinza e em negrito", async () => {
    await montar({ shipping: 0, total: 80 });
    let { linha, valor } = linhaDoFrete();
    expect(linha.classList.contains("text-emerald-700")).toBe(true);
    expect(valor.classList.contains("lowercase")).toBe(true);
    expect(valor.classList.contains("font-semibold")).toBe(false);

    // Retirada na loja com frete 0: não comemora, não é 'frete grátis'.
    await montar({ shipping: 0, total: 80, retiradaNaLoja: true });
    ({ linha, valor } = linhaDoFrete());
    expect(valor.textContent).toBe("Retirada na loja");
    expect(linha.classList.contains("text-emerald-700")).toBe(false);
    expect(valor.classList.contains("lowercase")).toBe(false);
    expect(valor.classList.contains("font-semibold")).toBe(true);
    expect(document.body.querySelector(".bg-emerald-500")).toBeNull();

    // Frete cobrado, mesmo com a retirada desligada: cinza, em negrito, valor.
    await montar({ shipping: 12.5, total: 112.5 });
    ({ linha, valor } = linhaDoFrete());
    expect(valor.textContent?.replace(/\s/g, " ")).toBe("R$ 12,50");
    expect(linha.classList.contains("text-emerald-700")).toBe(false);
    expect(valor.classList.contains("lowercase")).toBe(false);
    expect(valor.classList.contains("font-semibold")).toBe(true);
    expect(document.body.querySelector(".bg-emerald-500")).toBeNull();
  });

  it("retirada na loja com frete cobrado (valor ainda não zerado) também diz 'Retirada na loja'", async () => {
    await montar({ shipping: 9, total: 99, retiradaNaLoja: true });
    expect(linhaDoFrete().valor.textContent).toBe("Retirada na loja");
    expect(texto()).not.toContain("R$ 9,00");
  });

  it("o contador de itens: 1 item selecionado, 2 itens selecionados", async () => {
    await montar({ cartCount: 1 });
    expect(texto()).toContain("1 item selecionado");
    expect(texto()).not.toContain("1 itens");
    expect(texto()).not.toContain("selecionados");

    await montar({ cartCount: 2 });
    expect(texto()).toContain("2 itens selecionados");

    await montar({ cartCount: 12 });
    expect(texto()).toContain("12 itens selecionados");
  });

  it("conferindo preço e estoque: o botão fica ocupado e diz o que está fazendo", async () => {
    await montar({ conferindoCarrinho: true });
    const botao = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Conferindo"),
    ) as HTMLButtonElement;
    expect(botao.getAttribute("aria-busy")).toBe("true");
    expect(botao.textContent).toBe("Conferindo preços e estoque…");
    expect(texto()).not.toContain("Finalizar compra");
    // a conferência também é anunciada fora do botão
    const viva = document.body.querySelector(
      'span[aria-live="polite"]',
    ) as HTMLElement;
    expect(viva.textContent).toBe("Conferindo preços e estoque…");
  });

  it("sem conferência: botão livre (sem aria-busy), região viva vazia e o toque vai ao checkout", async () => {
    const { onNavigate } = await montar({ conferindoCarrinho: false });
    const botao = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Finalizar compra"),
    ) as HTMLButtonElement;
    expect(botao.hasAttribute("aria-busy")).toBe(false);
    const viva = document.body.querySelector(
      'span[aria-live="polite"]',
    ) as HTMLElement;
    expect(viva.textContent).toBe("");
    await act(async () => botao.click());
    expect(onNavigate).toHaveBeenCalledWith("checkout");
  });
});
