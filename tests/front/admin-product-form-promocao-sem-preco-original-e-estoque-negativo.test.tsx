// @vitest-environment jsdom
//
// P2 — promoção ligada com o preço original ("De:") vazio salvava SEM
// promoção e dizia "Salvo". Agora o botão fica desligado e a frase diz o que
// fazer.
// P9 — estoque de variação digitado "-5" virava 5 (o sinal era arrancado).
// Agora avisa e não cria a variação.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherAtributo } from "./helpers/atributo-da-variacao";

const fetchProduct = vi.fn();
const addProduct = vi.fn();
const updateProduct = vi.fn();
const salvarProdutoComGrade = vi.fn();
const upsertVariants = vi.fn();
const deleteVariants = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
    salvarProdutoComGrade,
    upsertVariants,
    deleteVariants,
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      data-testid="select-category"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  const proto =
    el instanceof globalThis.HTMLTextAreaElement
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    // O campo só entrega o valor ao formulário depois de uma pausa.
    await new Promise((r) => setTimeout(r, 300));
  });
}

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const PRODUTO_SEM_PROMOCAO = {
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  costPrice: null,
  originalPrice: null,
  stock: 5,
  sold: 0,
  category: "Geral",
  images: ["https://exemplo.test/camiseta.jpg"],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants: [] as unknown[],
};

describe("AdminProductFormView — promoção sem preço original e estoque negativo da variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: [],
    });
    updateProduct.mockResolvedValue({ id: "p-1" });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(produto: Record<string, unknown> = {}) {
    fetchProduct.mockResolvedValue({ ...PRODUTO_SEM_PROMOCAO, ...produto });
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="p-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  const ligarPromocao = async () => {
    await act(async () => {
      (
        document.getElementById("product-promo-active") as HTMLInputElement
      ).click();
    });
  };

  const motivo = () =>
    document.querySelector('[data-testid="motivo-do-bloqueio"]')?.textContent ??
    "";

  describe("P2 — promoção ligada com o 'De:' vazio", () => {
    it("o Salvar fica desligado e a frase diz o que fazer", async () => {
      await montar();
      await ligarPromocao();

      expect(botaoPorTexto("Salvar")?.disabled).toBe(true);
      expect(motivo()).toContain(
        "Escreva o preço original (De:) ou desligue a promoção",
      );
      expect(updateProduct).not.toHaveBeenCalled();
    });

    it("escrever o 'De:' maior que o preço libera o Salvar e grava a promoção", async () => {
      await montar();
      await ligarPromocao();
      await digitarCampo("product-original-price", "7000");

      expect(botaoPorTexto("Salvar")?.disabled).toBe(false);
      expect(motivo()).toBe("");
      await act(async () => {
        botaoPorTexto("Salvar")?.click();
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(updateProduct).toHaveBeenCalledTimes(1);
      expect(updateProduct.mock.calls[0][1]).toHaveProperty(
        "originalPrice",
        70,
      );
    });

    it("desligar a promoção de novo também libera o Salvar", async () => {
      await montar();
      await ligarPromocao();
      expect(botaoPorTexto("Salvar")?.disabled).toBe(true);
      await ligarPromocao();

      expect(botaoPorTexto("Salvar")?.disabled).toBe(false);
    });

    it("produto que JÁ está em promoção (com 'De:') abre liberado", async () => {
      await montar({ originalPrice: 70 });

      expect(botaoPorTexto("Salvar")?.disabled).toBe(false);
    });
  });

  describe("P9 — estoque negativo na variação", () => {
    async function abrirNovaVariacao() {
      await act(async () => {
        const novo = [...document.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("+ Novo"),
        ) as HTMLButtonElement | undefined;
        if (!novo) throw new Error("O botão + Novo não está na tela.");
        novo.click();
      });
      await escolherAtributo(0, "Cor", "variant-name", digitarCampo);
      await digitarCampo("variant-value", "Verde");
    }

    const confirmarVariacao = async () => {
      await act(async () => {
        (
          [...document.querySelectorAll("button")]
            .filter((b) => b.textContent?.trim() === "Salvar variação")
            .at(-1) as HTMLButtonElement
        ).click();
      });
    };

    const linhasNaTela = () =>
      document.querySelectorAll('[data-testid="variante-cadastrada"]').length;

    it('digitar "-5" avisa e NÃO cria a variação (antes virava 5)', async () => {
      await montar();
      await abrirNovaVariacao();
      await digitarCampo("variant-stock", "-5");
      await confirmarVariacao();

      expect(linhasNaTela()).toBe(0);
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(String(toastError.mock.calls[0][0])).toMatch(/negativ|menos/i);
    });

    it.each(["2.5", "1e3"])(
      'digitar "%s" avisa e NÃO cria a variação (antes virava outro número)',
      async (texto) => {
        await montar();
        await abrirNovaVariacao();
        await digitarCampo("variant-stock", texto);
        await confirmarVariacao();

        expect(linhasNaTela()).toBe(0);
        expect(toastError).toHaveBeenCalledTimes(1);
        expect(String(toastError.mock.calls[0][0])).toMatch(/inteiros/i);
      },
    );

    it("corrigir para um número válido cria a variação com o estoque certo", async () => {
      await montar();
      await abrirNovaVariacao();
      await digitarCampo("variant-stock", "-5");
      await confirmarVariacao();
      await digitarCampo("variant-stock", "5");
      await confirmarVariacao();

      expect(linhasNaTela()).toBe(1);
      expect(toastError).toHaveBeenCalledTimes(1);
    });

    it("zero continua valendo (variação esgotada de propósito)", async () => {
      await montar();
      await abrirNovaVariacao();
      await digitarCampo("variant-stock", "0");
      await confirmarVariacao();

      expect(linhasNaTela()).toBe(1);
      expect(toastError).not.toHaveBeenCalled();
    });
  });
});
