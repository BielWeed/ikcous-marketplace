// @vitest-environment jsdom
//
// Caça 12, lote 246: carrinho, "Meus pedidos", ficha do pedido e sugestões
// da barra de frete baixavam a foto ORIGINAL para mostrar um quadradinho de
// 56 a 148 px. Agora pedem a versão pequena (mesma regra da vitrine) e, se a
// loja não transforma imagem, voltam à original no onError.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Order, Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0, enableReviews: false },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ORIGINAL =
  "https://xyz.supabase.co/storage/v1/object/public/produtos/p1/foto.jpg";
const PLACEHOLDER = "https://placehold.co/600x400?text=Sem+Imagem";

const produto: Product = {
  id: "p1",
  name: "Caneca",
  description: "",
  price: 20,
  images: [ORIGINAL],
  category: "Casa",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: true,
  createdAt: new Date(0).toISOString(),
};

describe("fotos pequenas nas telas de compra", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function montar(el: React.ReactNode) {
    await act(async () => {
      raiz.render(el);
    });
    return host.querySelector("img") as HTMLImageElement;
  }

  function exigirPequena(img: HTMLImageElement) {
    const src = img.getAttribute("src") ?? "";
    expect(src).toContain("/storage/v1/render/image/public/");
    expect(src).toContain("width=");
  }

  it("CartItemsList pede a versão pequena e cai na original no erro", async () => {
    const { CartItemsList } = await import(
      "@/components/ui/custom/CartItemsList"
    );
    const cart: CartItem[] = [{ product: produto, quantity: 1 }];
    const img = await montar(
      <CartItemsList
        cart={cart}
        removingId={null}
        onUpdateQuantity={() => {}}
        onRemove={() => {}}
        handleClearCart={() => {}}
      />,
    );
    exigirPequena(img);
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(img.getAttribute("src")).toBe(ORIGINAL);
  });

  it("CartItemsList mantém o placeholder sem foto", async () => {
    const { CartItemsList } = await import(
      "@/components/ui/custom/CartItemsList"
    );
    const img = await montar(
      <CartItemsList
        cart={[{ product: { ...produto, images: [] }, quantity: 1 }]}
        removingId={null}
        onUpdateQuantity={() => {}}
        onRemove={() => {}}
        handleClearCart={() => {}}
      />,
    );
    expect(img.getAttribute("src")).toBe(PLACEHOLDER);
  });

  it("OrderList pede a versão pequena da foto do pedido", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const pedido = {
      id: "abc123def456",
      customer: { name: "A", email: "a@a.com", phone: "", address: "" },
      items: [
        {
          productId: "p1",
          name: "Caneca",
          price: 20,
          quantity: 1,
          image: ORIGINAL,
        },
      ],
      subtotal: 20,
      shipping: 0,
      discount: 0,
      total: 20,
      paymentMethod: "pix",
      status: "pending",
      cancelledAfterShipping: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    } as unknown as Order;
    const img = await montar(
      <OrderList orders={[pedido]} onNavigate={() => {}} />,
    );
    exigirPequena(img);
  });

  it("FotoDoItemDoPedido pede a versão pequena e cai na original no erro", async () => {
    const { FotoDoItemDoPedido } = await import(
      "@/components/ui/custom/FotoDoItemDoPedido"
    );
    const img = await montar(<FotoDoItemDoPedido src={ORIGINAL} alt="x" />);
    exigirPequena(img);
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(host.querySelector("img")?.getAttribute("src")).toBe(ORIGINAL);
  });

  it("ShippingProgress pede a versão pequena das sugestões", async () => {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    const img = await montar(
      <ShippingProgress
        estado="meta"
        savings={0}
        progressPercent={50}
        amountToFree={10}
        isNearlyThere={false}
        freeShippingProducts={[produto]}
        onNavigate={() => {}}
      />,
    );
    exigirPequena(img);
  });
});
