// @vitest-environment jsdom
import {
  chaveDoRascunhoDoProduto,
  serializarRascunhoDoProduto,
} from "@/lib/rascunho-do-produto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const produto = {
  id: "p-1",
  name: "Camiseta",
  description: "Camiseta lisa",
  price: 20,
  costPrice: 14.9,
  stock: 1,
  category: "Geral",
  images: [],
  variants: [],
  isActive: true,
};

const fetchProduct = vi.fn().mockResolvedValue(produto);
const updateProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ fetchProduct, updateProduct }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: { info: toastInfo, success: vi.fn(), dismiss: vi.fn() },
}));

it.each([
  {
    preco: "14,50",
    avisos: [
      "Confira: o preço de venda (R$ 14,50) está abaixo do custo (R$ 14,90).",
    ],
  },
  { preco: "15,00", avisos: [] },
])(
  "com custo de R$ 14,90 restaurado, compara o preço de R$ $preco",
  async ({ preco, avisos }) => {
    const userId = "lojista-1";
    const chave = chaveDoRascunhoDoProduto(userId, produto.id);
    if (!chave) throw new Error("Sem chave de rascunho de edição.");
    const nomeDoRascunho = "Camiseta do rascunho";
    const armazem = new Map([
      [
        chave,
        serializarRascunhoDoProduto({
          // A grafia do mesmo custo não basta para oferecer o rascunho.
          name: nomeDoRascunho,
          costPrice: "14,90",
        }),
      ],
    ]);
    toastInfo.mockClear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
      },
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);

    try {
      const { AdminProductFormView } = await import(
        "@/views/admin/AdminProductFormView"
      );
      await act(async () => {
        raiz.render(
          <AdminProductFormView
            productId={produto.id}
            userId={userId}
            onNavigate={vi.fn()}
            onSetDirty={vi.fn()}
          />,
        );
      });

      const oferta = toastInfo.mock.calls.find(
        ([titulo]) =>
          titulo === "Rascunho não salvo encontrado para este produto",
      )?.[1] as { action: { onClick: () => void } } | undefined;
      if (!oferta) throw new Error("O rascunho de edição não foi oferecido.");
      act(() => oferta.action.onClick());
      expect(
        hospedeiro.querySelector<HTMLInputElement>("#product-name")?.value,
      ).toBe(nomeDoRascunho);

      const campo = hospedeiro.querySelector<HTMLInputElement>(
        "#product-sale-price",
      );
      if (!campo) throw new Error("O preço de venda não está na tela.");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(campo, preco);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolver) => setTimeout(resolver, 300));
      });
      expect(campo.value).toBe(preco);

      expect(
        [...hospedeiro.querySelectorAll('.produto-acoes [role="status"]')]
          .map((el) => el.textContent?.replace(/\s+/g, " ").trim())
          .filter((texto) => texto?.startsWith("Confira: o preço de venda")),
      ).toEqual(avisos);
    } finally {
      act(() => raiz.unmount());
      hospedeiro.remove();
      vi.unstubAllGlobals();
    }
  },
);
