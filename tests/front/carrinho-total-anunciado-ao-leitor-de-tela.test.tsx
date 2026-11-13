// @vitest-environment jsdom
//
// Carrinho: quem usa leitor de tela aumentava a quantidade e ouvia só a
// quantidade nova (QuantitySelector) — o TOTAL recalculado mudava em silêncio.
// Agora o elemento do VALOR do total (só ele) é uma região viva educada:
// `role="status"` (que já implica `aria-live="polite"`) + `aria-atomic="true"`,
// para o valor novo ser lido inteiro, sem repetir o rótulo "Total" nem as
// outras linhas do resumo.
//
// Há dois resumos montados ao mesmo tempo — o rodapé do celular
// (`lg:hidden`) e o painel do computador (`hidden lg:block`) — e os dois se
// escondem com `display: none`, que o leitor de tela ignora. Por isso cada um
// tem a sua região viva e nenhum dos dois fica só "visualmente oculto" (sr-only,
// opacity), o que dobraria o anúncio.
//
// Travas:
//   - o `role="status"` está no elemento do valor, nos dois resumos;
//   - nenhum ancestral dele é região viva, e a região não contém botão nem a
//     linha do frete;
//   - o texto da região muda quando o total muda (rerender);
//   - o CartFooterSummary isolado tem a mesma região (o valor, não o bloco).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  quantidade: 1,
  frete: 18.37,
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 15, freeShippingMin: 0 },
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [
      {
        product: {
          id: "prod-1",
          name: "Produto Teste",
          description: "",
          price: 100,
          images: [],
          category: "geral",
          stock: 50,
          sold: 0,
          isActive: true,
          isBestseller: false,
          freeShipping: false,
          createdAt: new Date(0).toISOString(),
        },
        quantity: estado.quantidade,
      },
    ],
    shippingFee: estado.frete,
    freteIndefinido: false,
    freteGratis: false,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: {
      id: "melhorenvio-pac",
      name: "PAC",
      price: estado.frete,
    },
    setSelectedShippingOption: vi.fn(),
    shippingCep: null,
    setShippingCep: vi.fn(),
    enderecoSelecionadoId: null,
    setEnderecoSelecionadoId: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    loading: false,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    fetchUserOrders: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div data-testid="itens" />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div data-testid="progresso" />,
}));
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: () => <div data-testid="pedidos" />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div data-testid="busca-pedido" />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SEM_ESPACO_DURO = / /g;

/** O elemento do valor: o irmão que vem logo depois do rótulo "Total". */
function valorDoTotalEm(escopo: ParentNode): HTMLElement {
  const rotulos = Array.from(escopo.querySelectorAll("span")).filter(
    (s) => s.textContent?.trim() === "Total",
  );
  expect(rotulos, "tem de haver UM rótulo 'Total' no resumo").toHaveLength(1);
  const valor = rotulos[0]?.nextElementSibling as HTMLElement | null;
  expect(valor, "o valor do Total tem de existir").toBeTruthy();
  return valor as HTMLElement;
}

function textoDe(el: Element): string {
  return (el.textContent ?? "").replace(SEM_ESPACO_DURO, " ").trim();
}

/** Algum ancestral (o próprio elemento não conta) é região viva? */
function ancestralVivo(el: Element): Element | null {
  let atual = el.parentElement;
  while (atual) {
    if (
      atual.getAttribute("aria-live") ||
      ["status", "alert", "log"].includes(atual.getAttribute("role") ?? "")
    ) {
      return atual;
    }
    atual = atual.parentElement;
  }
  return null;
}

/** Algum ancestral some só para o olho (sr-only / opacity-0)? */
function ancestralSoVisualmenteOculto(el: Element): Element | null {
  let atual: Element | null = el;
  while (atual) {
    const classes = (atual.getAttribute("class") ?? "").split(/\s+/);
    if (classes.includes("sr-only") || classes.includes("opacity-0")) {
      return atual;
    }
    atual = atual.parentElement;
  }
  return null;
}

describe("CartView — o novo total é anunciado a quem usa leitor de tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.quantidade = 1;
    estado.frete = 18.37;
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

  async function renderizarCarrinho() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const resumoDoComputador = () =>
    Array.from(hospedeiro.querySelectorAll("h3"))
      .find((h) => h.textContent === "Resumo do Pedido")
      ?.closest(".sticky") as HTMLElement;
  const rodapeDoCelular = () =>
    document.querySelector(".bottom-docked-navigation") as HTMLElement;

  it("o valor do Total do painel do computador é role=status + aria-atomic=true", async () => {
    await renderizarCarrinho();

    const valor = valorDoTotalEm(resumoDoComputador());
    expect(valor.getAttribute("role")).toBe("status");
    expect(valor.getAttribute("aria-atomic")).toBe("true");
    expect(textoDe(valor)).toBe("R$ 118,37");
  });

  it("o valor do Total do rodapé do celular é role=status + aria-atomic=true", async () => {
    await renderizarCarrinho();

    const valor = valorDoTotalEm(rodapeDoCelular());
    expect(valor.getAttribute("role")).toBe("status");
    expect(valor.getAttribute("aria-atomic")).toBe("true");
    expect(textoDe(valor)).toBe("R$ 118,37");
  });

  it("a região é SÓ o valor: sem rótulo, sem botão, sem frete, sem ancestral vivo", async () => {
    await renderizarCarrinho();

    for (const resumo of [resumoDoComputador(), rodapeDoCelular()]) {
      const valor = valorDoTotalEm(resumo);
      expect(textoDe(valor)).not.toContain("Total");
      expect(textoDe(valor)).not.toContain("Frete");
      expect(valor.querySelector("button, a, input")).toBeNull();
      expect(ancestralVivo(valor), "ancestral com aria-live/status").toBeNull();
    }
  });

  it("nenhuma outra linha do resumo (subtotal, frete) vira região viva", async () => {
    await renderizarCarrinho();

    for (const resumo of [resumoDoComputador(), rodapeDoCelular()]) {
      const vivas = Array.from(
        resumo.querySelectorAll("[role='status'], [aria-live]"),
      );
      expect(vivas).toHaveLength(1);
      expect(vivas[0]).toBe(valorDoTotalEm(resumo));
    }
  });

  it("um resumo por vez fala: os dois se escondem com display:none (hidden / lg:hidden), nunca só sr-only", async () => {
    await renderizarCarrinho();

    const computador = resumoDoComputador();
    const celular = rodapeDoCelular();
    expect(computador.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(celular.className).toMatch(/(^|\s)lg:hidden(\s|$)/);
    expect(ancestralSoVisualmenteOculto(valorDoTotalEm(computador))).toBeNull();
    expect(ancestralSoVisualmenteOculto(valorDoTotalEm(celular))).toBeNull();
  });

  it("quando a quantidade sobe, o texto da região muda nos dois resumos (rerender)", async () => {
    await renderizarCarrinho();
    const valorComputador = valorDoTotalEm(resumoDoComputador());
    const valorCelular = valorDoTotalEm(rodapeDoCelular());
    expect(textoDe(valorComputador)).toBe("R$ 118,37");
    expect(textoDe(valorCelular)).toBe("R$ 118,37");

    estado.quantidade = 2;
    await renderizarCarrinho();

    // Mesmos elementos (a região continua a mesma, só o texto troca): é isso
    // que o leitor de tela anuncia.
    expect(valorDoTotalEm(resumoDoComputador())).toBe(valorComputador);
    expect(valorDoTotalEm(rodapeDoCelular())).toBe(valorCelular);
    expect(textoDe(valorComputador)).toBe("R$ 218,37");
    expect(textoDe(valorCelular)).toBe("R$ 218,37");
    expect(valorComputador.getAttribute("role")).toBe("status");
    expect(valorCelular.getAttribute("role")).toBe("status");
  });
});

describe("CartFooterSummary — a região viva é o valor do total, não o bloco", () => {
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

  async function montar(total: number | null) {
    const { CartFooterSummary } = await import(
      "@/components/ui/custom/CartFooterSummary"
    );
    await act(async () => {
      raiz.render(
        <CartFooterSummary
          cartCount={1}
          shipping={18.37}
          total={total}
          onNavigate={vi.fn()}
        />,
      );
    });
  }

  it("o <p> do total é role=status + aria-atomic e o texto troca com o total", async () => {
    await montar(118.37);
    const valor = valorDoTotalEm(document.body);
    expect(valor.tagName).toBe("P");
    expect(valor.getAttribute("role")).toBe("status");
    expect(valor.getAttribute("aria-atomic")).toBe("true");
    expect(textoDe(valor)).toBe("R$ 118,37");

    await montar(218.37);
    expect(valorDoTotalEm(document.body)).toBe(valor);
    expect(textoDe(valor)).toBe("R$ 218,37");
  });

  it("o botão Finalizar compra e a linha do Frete ficam FORA de qualquer região viva", async () => {
    await montar(118.37);

    const botao = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Finalizar compra"),
    );
    expect(botao).toBeTruthy();
    expect(ancestralVivo(botao as Element)).toBeNull();
    expect(
      (botao as Element).closest("[role='status'], [aria-live]"),
    ).toBeNull();

    const frete = Array.from(document.body.querySelectorAll("p")).find((p) =>
      p.textContent?.startsWith("Frete"),
    );
    expect(frete).toBeTruthy();
    expect(frete?.getAttribute("role")).toBeNull();
    expect(ancestralVivo(frete as Element)).toBeNull();
  });
});
