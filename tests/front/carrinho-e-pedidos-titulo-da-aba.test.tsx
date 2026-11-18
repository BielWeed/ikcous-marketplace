// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { branding } from "@/config/branding";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { CartView } from "@/views/customer/CartView";

const config: { storeName?: string } = {};
const fetchUserOrders = vi.fn(async () => []);
const usuario = { id: "cliente-ficticio" };
vi.mock("@/contexts/StoreContext", () => ({ useStore: () => ({ config }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({ addresses: [], fetchAddresses: vi.fn() }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({ cart: [], cartTotal: 0, shippingFee: 0 }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => null,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({ EmptyCart: () => null }));

// @ts-expect-error flag interna do React — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mesmo helper da Home, mantido montado sob a aba, como no App.
function VitrineMontada() {
  useDocumentMeta({ title: "Loja Fictícia | Cidade" });
  return null;
}

let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  config.storeName = "  Loja Fictícia  ";
  vi.stubGlobal("localStorage", window.localStorage);
  vi.stubGlobal("sessionStorage", window.sessionStorage);
  host = document.createElement("div");
  document.body.append(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function mostrar(initialTab: "cart" | "orders", isActive = true) {
  await act(async () =>
    raiz.render(
      <>
        <VitrineMontada />
        <CartView
          initialTab={initialTab}
          isActive={isActive}
          onNavigate={() => {}}
        />
      </>,
    ),
  );
}

it.each(["cart", "orders"] as const)(
  "nomeia %s e restaura a vitrine sem desmontar",
  async (aba) => {
    await mostrar(aba, false);
    expect(document.title).toBe("Loja Fictícia | Cidade");
    await mostrar(aba);
    expect(document.title).toBe(
      `${aba === "cart" ? "Carrinho" : "Meus pedidos"} — Loja Fictícia`,
    );
    await mostrar(aba, false);
    expect(document.title).toBe("Loja Fictícia | Cidade");
    await mostrar(aba);
    expect(document.title).toBe(
      `${aba === "cart" ? "Carrinho" : "Meus pedidos"} — Loja Fictícia`,
    );
  },
);

it("acompanha a troca interna entre Carrinho e Meus pedidos e a rota", async () => {
  await mostrar("cart");
  const pedidos =
    host.querySelector<HTMLButtonElement>('[role="tab"][id*="orders"]') ??
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (b) => b.textContent?.includes("Meus Pedidos"),
    );
  expect(pedidos).toBeDefined();
  await act(async () => pedidos?.click());
  expect(document.title).toBe("Meus pedidos — Loja Fictícia");
  await mostrar("orders");
  await mostrar("cart");
  expect(document.title).toBe("Carrinho — Loja Fictícia");
});

it.each([undefined, "", "   "])(
  "usa a identidade da loja quando o nome é %s",
  async (nome) => {
    config.storeName = nome;
    await mostrar("orders");
    expect(document.title).toBe(`Meus pedidos — ${branding.appName}`);
  },
);
