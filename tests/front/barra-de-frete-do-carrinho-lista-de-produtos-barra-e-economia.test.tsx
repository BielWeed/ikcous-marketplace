// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território ui/custom: a barra de frete grátis
// do carrinho, com a lista "Atinja a Meta" (produtos que completam o valor),
// tinha duas bordas sem teste:
//  - o seletor de cada produto da lista começa em 1 unidade (o teste existente
//    só olhava o teto; começar em 2 passava despercebido e a cliente
//    adicionaria dois itens sem pedir);
//  - a linha "Economia" aparecia só a partir de R$ 1,00 se alguém trocasse a
//    comparação: uma economia de centavos também tem de aparecer.
import { ShippingProgress } from "@/components/ui/custom/ShippingProgress";
import { miniaturaDeCompra } from "@/lib/miniatura-de-compra";
import type { Product } from "@/types";
import { type ReactNode, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O dublê deixa o teste LER a animação pedida (o quanto a barra enche), em vez
// de esperar o framer-motion animar de verdade.
vi.mock("framer-motion", () => {
  const componentes = new Map<string, unknown>();
  return {
    motion: new Proxy(
      {},
      {
        get: (_, tag: string) => {
          if (!componentes.has(tag))
            componentes.set(
              tag,
              ({
                children,
                animate,
                initial: _inicial,
                transition: _transicao,
                style: _estilo,
                ...props
              }: Record<string, unknown>) =>
                createElement(
                  tag,
                  { ...props, "data-animate": JSON.stringify(animate) },
                  children as ReactNode,
                ),
            );
          return componentes.get(tag);
        },
      },
    ),
  };
});

// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

function produto(sobre: Partial<Product> = {}): Product {
  return {
    id: "p-1",
    name: "Caneca",
    description: "",
    price: 25,
    stock: 10,
    images: [],
    category: "geral",
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-11-18",
    rating: 0,
    reviewCount: 0,
    ...sobre,
  };
}

function montar(
  props: Partial<Parameters<typeof ShippingProgress>[0]> & {
    freeShippingProducts?: Product[];
  } = {},
) {
  const onAddToCart = vi.fn();
  act(() => {
    raiz.render(
      <ShippingProgress
        estado="meta"
        savings={0}
        progressPercent={40}
        amountToFree={30}
        isNearlyThere={false}
        freeShippingProducts={[produto()]}
        onAddToCart={onAddToCart}
        {...props}
      />,
    );
  });
  return { onAddToCart };
}

function botao(nome: string): HTMLButtonElement {
  return hospedeiro.querySelector(
    `button[aria-label="${nome}"]`,
  ) as HTMLButtonElement;
}

function adicionar(): HTMLButtonElement {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent === "Adicionar",
  ) as HTMLButtonElement;
}

/** O número entre o "−" e o "+" do produto da lista. */
function quantidadeNaTela(): string | undefined {
  return (
    botao("Diminuir quantidade de Caneca").nextElementSibling?.textContent ??
    undefined
  );
}

describe("ShippingProgress — a lista 'Atinja a Meta' começa em 1 unidade", () => {
  it("sem mexer no seletor: mostra 1 e 'Adicionar' leva 1 unidade", () => {
    const p = produto();
    const { onAddToCart } = montar({ freeShippingProducts: [p] });
    expect(quantidadeNaTela()).toBe("1");
    act(() => adicionar().click());
    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart).toHaveBeenCalledWith(p, 1);
  });

  it("'+' sobe para 2 e '−' volta para 1; '−' em 1 não passa de 1", () => {
    const p = produto();
    const { onAddToCart } = montar({ freeShippingProducts: [p] });
    act(() => botao("Aumentar quantidade de Caneca").click());
    expect(quantidadeNaTela()).toBe("2");
    act(() => botao("Diminuir quantidade de Caneca").click());
    expect(quantidadeNaTela()).toBe("1");
    act(() => botao("Diminuir quantidade de Caneca").click());
    expect(quantidadeNaTela()).toBe("1");
    act(() => adicionar().click());
    expect(onAddToCart).toHaveBeenCalledWith(p, 1);
  });

  it("cada produto da lista guarda a sua própria quantidade", () => {
    const a = produto({ id: "a", name: "Caneca" });
    const b = produto({ id: "b", name: "Prato" });
    montar({ freeShippingProducts: [a, b] });
    act(() => botao("Aumentar quantidade de Caneca").click());
    act(() => botao("Aumentar quantidade de Caneca").click());
    expect(quantidadeNaTela()).toBe("3");
    expect(
      botao("Diminuir quantidade de Prato").nextElementSibling?.textContent,
    ).toBe("1");
  });

  it("estoque de 1: o '+' já nasce travado e a quantidade fica em 1", () => {
    const p = produto({ stock: 1 });
    const { onAddToCart } = montar({ freeShippingProducts: [p] });
    expect(quantidadeNaTela()).toBe("1");
    expect(botao("Aumentar quantidade de Caneca").disabled).toBe(true);
    act(() => adicionar().click());
    expect(onAddToCart).toHaveBeenCalledWith(p, 1);
  });
});

describe("ShippingProgress — a linha 'Economia'", () => {
  function economia(): string | null {
    const rotulo = Array.from(hospedeiro.querySelectorAll("span")).find(
      (s) => s.textContent === "Economia",
    );
    return rotulo?.nextElementSibling?.textContent?.replace(/\s/g, " ") ?? null;
  }

  it("economia de centavos também aparece (R$ 0,50)", () => {
    montar({ savings: 0.5, estado: "liberado", progressPercent: 100 });
    expect(economia()).toBe("+ R$ 0,50");
  });

  it("economia de R$ 12,34 aparece com os centavos", () => {
    montar({ savings: 12.34, estado: "liberado", progressPercent: 100 });
    expect(economia()).toBe("+ R$ 12,34");
  });

  it("sem economia (zero) ou valor negativo: a linha some", () => {
    montar({ savings: 0, estado: "liberado", progressPercent: 100 });
    expect(economia()).toBeNull();
    montar({ savings: -3, estado: "liberado", progressPercent: 100 });
    expect(economia()).toBeNull();
  });
});

describe("ShippingProgress — a barra anda na proporção certa", () => {
  function barra(): { scaleX: number } {
    const el = hospedeiro.querySelector('[data-animate*="scaleX"]');
    return JSON.parse(el?.getAttribute("data-animate") ?? "{}");
  }

  it("40% da meta: a barra enche 0,4 e o texto diz 40%", () => {
    montar({ progressPercent: 40 });
    expect(barra().scaleX).toBeCloseTo(0.4, 5);
    expect(hospedeiro.textContent).toContain("40%");
  });

  it("meta batida: a barra enche por inteiro (1)", () => {
    montar({ estado: "liberado", progressPercent: 100, amountToFree: 0 });
    expect(barra().scaleX).toBe(1);
  });

  it("33,9%: o número fala 33% (arredonda para baixo) e a barra mostra o valor exato", () => {
    montar({ progressPercent: 33.9 });
    expect(hospedeiro.textContent).toContain("33%");
    expect(hospedeiro.textContent).not.toContain("34%");
    expect(barra().scaleX).toBeCloseTo(0.339, 5);
  });
});

describe("ShippingProgress — quando a lista 'Atinja a Meta' aparece", () => {
  const tem = () => hospedeiro.textContent?.includes("Atinja a Meta") ?? false;

  it("meta falta e há produtos: aparece", () => {
    montar();
    expect(tem()).toBe(true);
  });

  it("meta falta, mas a lista está vazia: o título não aparece sozinho", () => {
    montar({ freeShippingProducts: [] });
    expect(tem()).toBe(false);
  });

  it("modo adiado (deferred): não aparece", () => {
    montar({ deferred: true });
    expect(tem()).toBe(false);
  });

  it("meta já batida (liberado): não oferece mais produtos", () => {
    montar({ estado: "liberado", progressPercent: 100, amountToFree: 0 });
    expect(tem()).toBe(false);
  });
});

describe("ShippingProgress — produto com variação nunca entra sem a escolha", () => {
  const variacao = (active: boolean) => ({
    id: "v-1",
    productId: "p-1",
    name: "Cor",
    value: "Azul",
    stockIncrement: 0,
    active,
  });

  function botaoDoCartao(): HTMLButtonElement {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) =>
        b.textContent === "Escolher opções" || b.textContent === "Adicionar",
    ) as HTMLButtonElement;
  }

  it("variação ativa: o botão diz 'Escolher opções' e leva ao produto, sem adicionar", () => {
    const onNavigate = vi.fn();
    const { onAddToCart } = montar({
      freeShippingProducts: [produto({ variants: [variacao(true)] })],
      onNavigate,
    });
    expect(botaoDoCartao().textContent).toBe("Escolher opções");
    act(() => botaoDoCartao().click());
    expect(onNavigate).toHaveBeenCalledWith("product-detail", "p-1");
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it("só variações desligadas: é produto simples, 'Adicionar' coloca no carrinho", () => {
    const p = produto({ variants: [variacao(false)] });
    const onNavigate = vi.fn();
    const { onAddToCart } = montar({ freeShippingProducts: [p], onNavigate });
    expect(botaoDoCartao().textContent).toBe("Adicionar");
    act(() => botaoDoCartao().click());
    expect(onAddToCart).toHaveBeenCalledWith(p, 1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("sem lista de variações (produto simples): 'Adicionar'", () => {
    montar({ freeShippingProducts: [produto({ variants: undefined })] });
    expect(botaoDoCartao().textContent).toBe("Adicionar");
  });

  it("tocar no cartão abre o produto (sem adicionar nada)", () => {
    const onNavigate = vi.fn();
    const { onAddToCart } = montar({ onNavigate });
    const cartao = hospedeiro.querySelector('[role="button"]') as HTMLElement;
    act(() => cartao.click());
    expect(onNavigate).toHaveBeenCalledWith("product-detail", "p-1");
    expect(onAddToCart).not.toHaveBeenCalled();
  });
});

describe("ShippingProgress — a foto do produto da lista", () => {
  const foto = () => hospedeiro.querySelector("img");
  const semFoto = () => hospedeiro.textContent?.includes("Sem foto") ?? false;

  it("sem nenhuma foto: 'Sem foto'", () => {
    montar({ freeShippingProducts: [produto({ images: [] })] });
    expect(semFoto()).toBe(true);
    expect(foto()).toBeNull();
  });

  it("foto de marcador (placehold.co) não é foto de verdade: 'Sem foto'", () => {
    montar({
      freeShippingProducts: [
        produto({ images: ["https://placehold.co/300x300"] }),
      ],
    });
    expect(semFoto()).toBe(true);
    expect(foto()).toBeNull();
  });

  it("produto com uma única foto de verdade: a foto aparece (não vira 'Sem foto')", () => {
    const unica = "https://cdn.exemplo.test/prato.jpg";
    montar({ freeShippingProducts: [produto({ images: [unica] })] });
    expect(semFoto()).toBe(false);
    expect(foto()?.getAttribute("src")).toBe(miniaturaDeCompra(unica));
  });

  it("se a miniatura não carrega, tenta a foto ORIGINAL (a primeira) antes de desistir", () => {
    const primeira =
      "https://gnjsrucsmjkajijrakzr.supabase.co/storage/v1/object/public/produtos/caneca-1.jpg";
    const segunda =
      "https://gnjsrucsmjkajijrakzr.supabase.co/storage/v1/object/public/produtos/caneca-2.jpg";
    montar({
      freeShippingProducts: [produto({ images: [primeira, segunda] })],
    });
    expect(foto()?.getAttribute("src")).toBe(miniaturaDeCompra(primeira));
    expect(miniaturaDeCompra(primeira)).not.toBe(primeira);
    act(() => {
      foto()?.dispatchEvent(new Event("error"));
    });
    expect(semFoto()).toBe(false);
    expect(foto()?.getAttribute("src")).toBe(primeira);
    // a original também falhou: só então vira 'Sem foto'
    act(() => {
      foto()?.dispatchEvent(new Event("error"));
    });
    expect(semFoto()).toBe(true);
  });

  it("foto de verdade: usa a PRIMEIRA, em miniatura, com o nome do produto", () => {
    const primeira = "https://cdn.exemplo.test/caneca-1.jpg";
    const segunda = "https://cdn.exemplo.test/caneca-2.jpg";
    montar({
      freeShippingProducts: [produto({ images: [primeira, segunda] })],
    });
    expect(semFoto()).toBe(false);
    expect(foto()?.getAttribute("src")).toBe(miniaturaDeCompra(primeira));
    expect(foto()?.getAttribute("src")).not.toContain("caneca-2");
    expect(foto()?.getAttribute("alt")).toBe("Caneca");
  });
});
