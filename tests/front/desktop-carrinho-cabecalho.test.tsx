import { CartItemsList } from "@/components/ui/custom/CartItemsList";
import { EmptyCart } from "@/components/ui/custom/EmptyCart";
import { OrderList } from "@/components/ui/custom/OrderList";
import { OrderSearch } from "@/components/ui/custom/OrderSearch";
import type { CartItem } from "@/types";
import { CartView } from "@/views/customer/CartView";
// @vitest-environment jsdom
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const mocks = vi.hoisted(() => ({
  user: { id: "fixture" },
  fetchOrders: vi.fn(async () => []),
  fetchAddresses: vi.fn(async () => {}),
  products: vi.fn(() => []),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: mocks.products }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [
      {
        id: "casa",
        name: "Casa",
        cep: "00000000",
        street: "Rua teste",
        number: "1",
        city: "Cidade",
        state: "SP",
        is_default: true,
      },
    ],
    fetchAddresses: mocks.fetchAddresses,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders: mocks.fetchOrders }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({ cart: [], freteIndefinido: true }),
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: ({ acaoDoEndereco }: { acaoDoEndereco: ReactNode }) => (
    <div>{acaoDoEndereco}</div>
  ),
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => null,
}));
vi.mock("@/components/ui/custom/CartFooterSummary", () => ({
  CartFooterSummary: () => null,
}));
vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => <div>Casa</div>,
}));

const item: CartItem = {
  product: {
    id: "produto",
    name: "Blusa teste",
    description: "",
    price: 100,
    images: ["/teste.png"],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-01-01",
  },
  quantity: 1,
};

// @ts-expect-error flag interna de testes do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("F5 — layout de computador preserva as classes do celular", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("matchMedia", undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  async function render(node: ReactNode) {
    await act(async () => root.render(node));
  }
  function conferir(el: Element | null, celular: string, ...desktop: string[]) {
    expect(el).not.toBeNull();
    expect(classesDoCelular(el!.getAttribute("class") ?? "")).toBe(
      classesDoCelular(celular),
    );
    for (const token of desktop)
      expect(el!.classList.contains(token), token).toBe(true);
  }
  async function carrinho() {
    await render(<CartView cart={[item]} onNavigate={vi.fn()} />);
  }

  it("F5.1: título, container e abas preservam o contrato acessível", async () => {
    await carrinho();
    conferir(host.querySelector("h1"), "sr-only");
    conferir(
      host.querySelector("h1")!.parentElement,
      "",
      "lg:[&>h1]:not-sr-only",
      "lg:text-4xl",
      "lg:max-w-[1280px]",
    );
    conferir(
      host.querySelector('[role="tablist"]'),
      "relative flex overflow-hidden rounded-2xl bg-zinc-100/50 p-1",
      "lg:max-w-[360px]",
    );
    conferir(
      host.querySelector('[role="tablist"]')!.parentElement,
      "sticky top-[-2px] z-50 flex flex-col gap-2 border-b border-zinc-100 bg-white/80 px-4 py-2 backdrop-blur-md xs:gap-4 xs:px-6 xs:pb-2.5 xs:pt-3",
      "lg:max-w-[1280px]",
    );
    expect(
      host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby"),
    ).toBe("tab-cart");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
  });
  it("F5.2: limita as colunas e aproxima o resumo do topo", async () => {
    await carrinho();
    conferir(
      host.querySelector('[id="painel-cart"]')!.firstElementChild,
      "mx-auto flex w-full max-w-7xl flex-col items-stretch gap-8 px-4 pb-6 pt-2 xs:px-6",
      "lg:max-w-[1280px]",
      "2xl:max-w-[1440px]",
    );
    const botao = Array.from(host.querySelectorAll("button")).find((el) =>
      el.textContent?.includes("Finalizar Compra"),
    )!;
    conferir(
      botao.parentElement,
      "sticky top-24 hidden w-full shrink-0 space-y-6 rounded-[2.5rem] border border-zinc-100 bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.02)]",
      "lg:top-6",
      "lg:w-[380px]",
    );
  });
  it("F5.2: vazio continua centrado com as mesmas classes de celular", async () => {
    await render(<EmptyCart onNavigate={vi.fn()} />);
    conferir(
      host.firstElementChild,
      "flex h-full flex-col items-center justify-center px-10 text-center",
      "lg:mx-auto",
      "lg:max-w-xl",
      "lg:py-16",
    );
  });
  it("F5.3: foto de 96px e informações em colunas sem mudar o celular", async () => {
    await render(
      <CartItemsList
        cart={[item]}
        removingId={null}
        onUpdateQuantity={vi.fn()}
        onRemove={vi.fn()}
        handleClearCart={vi.fn()}
      />,
    );
    const foto = host.querySelector("img")!.parentElement;
    conferir(
      foto,
      "relative size-20 flex-shrink-0 overflow-hidden rounded-xl border border-zinc-100/50 bg-zinc-50 xs:size-24 xs:rounded-2xl",
    );
    expect(foto?.classList.contains("lg:size-24")).toBe(false);
    const conteudo =
      host.querySelector("h2")!.parentElement!.parentElement!.parentElement!
        .parentElement;
    conferir(
      conteudo,
      "flex min-w-0 flex-1 flex-col justify-between py-0",
      "lg:grid",
      "lg:grid-cols-[minmax(0,1fr)_160px]",
    );
    conferir(
      host.querySelector("h2"),
      "line-clamp-1 text-xs font-bold leading-tight text-zinc-900 transition-colors group-hover:text-zinc-950 xs:line-clamp-2 xs:text-sm",
      "lg:text-base",
    );
  });
  it.each([false, true])(
    "F5.4: seletor no computador=%s mantém ações e devolução de foco",
    async (computador) => {
      if (computador)
        vi.stubGlobal("matchMedia", (query: string) => ({
          matches: query === "(min-width: 1024px)",
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }));
      await carrinho();
      const trocar = Array.from(host.querySelectorAll("button")).find(
        (el) => el.textContent === "Trocar",
      )!;
      await act(async () => trocar.click());
      const folha = document.querySelector(
        '[data-testid="seletor-endereco-entrega"]',
      )!;
      expect(folha).not.toBeNull();
      if (computador) {
        expect(folha.classList.contains("lg:max-w-[440px]")).toBe(true);
        expect(folha.className).toContain("slide-in-from-right");
      } else {
        expect(folha.className).toContain("slide-in-from-bottom");
        for (const token of "mx-auto max-h-[85dvh] gap-0 rounded-t-3xl sm:max-w-md".split(
          " ",
        ))
          expect(folha.classList.contains(token)).toBe(true);
      }
      expect(folha.textContent).toContain("+ Cadastrar novo endereço");
      const fechar = Array.from(folha.querySelectorAll("button")).find((el) =>
        el.textContent?.includes("Close"),
      )!;
      await act(async () => fechar.click());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
      expect(document.activeElement).toBe(trocar);
    },
  );
  it("F5.5: grade de pedidos tem duas/três colunas e preserva md", async () => {
    await render(
      <OrderList orders={[]} isLoadingOrders onNavigate={vi.fn()} />,
    );
    conferir(
      host.firstElementChild,
      "grid grid-cols-1 gap-4 md:grid-cols-2",
      "lg:grid-cols-2",
      "xl:grid-cols-3",
    );
  });
  it("F5.5: busca do convidado fica centralizada", async () => {
    await render(<OrderSearch onNavigate={vi.fn()} />);
    conferir(
      host.firstElementChild,
      "space-y-4 xs:space-y-6",
      "lg:mx-auto",
      "lg:w-full",
      "lg:max-w-xl",
    );
  });
  it("F5.5: painel de pedidos limitado e espaçador só no celular", async () => {
    await render(<CartView initialTab="orders" onNavigate={vi.fn()} />);
    conferir(
      host.querySelector('[id="painel-orders"]'),
      "flex w-full flex-1 flex-col px-6 pb-6 pt-0",
      "lg:max-w-[1280px]",
    );
    conferir(
      host.querySelector('[id="painel-orders"]')!.lastElementChild,
      "",
      "lg:hidden",
    );
    expect(
      host
        .querySelector('[id="painel-orders"]')!
        .lastElementChild?.getAttribute("style"),
    ).toContain("80px");
  });
});
