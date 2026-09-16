// @vitest-environment jsdom
//
// Achado AdminProductsView-546 (Missão 05, catálogo): `confirmDuplicate`
// anexava um sufixo FIXO ("-COPY") ao SKU de cada variante clonada. Duplicar
// o MESMO produto de origem duas vezes gera os mesmos SKUs de variante nas
// duas cópias — e `product_variants.sku` é UNIQUE global
// (supabase/migrations/20260806000000_baseline_do_schema_vivo.sql:4611). A
// segunda duplicação bate no 23505, `addProduct` (useProducts.ts:671-682)
// captura o erro por variante, avisa por toast e SEGUE em frente: a segunda
// cópia nasce publicável sem grade nenhuma.
//
// A correção (conforme os dois vereditos de verificação, que concordam):
// duplicar a variante SEM SKU (undefined/null) em vez de repetir o sufixo
// fixo — sem SKU não há colisão possível, duplicar quantas vezes for.
//
// Este teste mocka `useProducts` inteiro (mesmo padrão de
// admin-products-um-so-aviso-ao-excluir.test.tsx): o INSERT real nunca roda
// aqui. O que ele prende é o payload que `confirmDuplicate` monta e entrega
// a `addProduct` — se o sufixo fixo voltar, a asserção de "não repete o SKU
// original" falha.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const loadProducts = vi.fn();
const deleteProduct = vi.fn();
const toggleProductStatus = vi.fn();
// Identidade: o helper de cópia de imagem não é o alvo deste teste (já tem
// suíte própria em duplicar-produto-copia-as-fotos-do-storage.test.ts).
const copiarImagemParaDuplicacao = vi.fn(async (url: string) => url);
const onNavigate = vi.fn();
const fetchExecutiveSummary = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastLoading = vi.fn();

const produtoTeste = {
  id: "prod-1",
  name: "Camiseta Base",
  category: "Geral",
  images: [
    "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
  ],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
  variants: [
    { id: "v-p", name: "Tamanho", value: "P", sku: "CAM-P", active: true },
    { id: "v-m", name: "Tamanho", value: "M", sku: "CAM-M", active: true },
  ],
};

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [produtoTeste],
    loading: false,
    deleteProduct,
    toggleProductStatus,
    addProduct,
    loadProducts,
    copiarImagemParaDuplicacao,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 500, totalValue: 900 } },
    fetchExecutiveSummary,
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    loading: toastLoading,
  },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em address-form-cep-race.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("AdminProductsView — achado 546: duplicar duas vezes preserva a grade de variações", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    loadProducts.mockResolvedValue({ products: [produtoTeste], total: 1 });
    fetchExecutiveSummary.mockResolvedValue(null);
    addProduct.mockResolvedValue({ ...produtoTeste, id: "prod-copia" });
    copiarImagemParaDuplicacao.mockImplementation(async (url: string) => url);

    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
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

  async function montar() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );

    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function duplicar() {
    const botaoDuplicar = localizarBotaoPorTexto(
      hospedeiro,
      "Duplicar Produto",
    )!;
    expect(botaoDuplicar).toBeDefined();
    await act(async () => {
      botaoDuplicar.click();
    });

    const botaoConfirmar = localizarBotaoPorTexto(
      hospedeiro,
      "Confirmar Duplicação",
    )!;
    expect(botaoConfirmar).toBeDefined();
    await act(async () => {
      botaoConfirmar.click();
      await esperarMicrotarefas();
    });
  }

  it("duplicar uma vez: a variante clonada NÃO herda o sufixo fixo '-COPY' que colide na próxima duplicação", async () => {
    await montar();
    await duplicar();

    expect(addProduct).toHaveBeenCalledTimes(1);
    const payload = addProduct.mock.calls[0][0];
    const skusDasVariantes = payload.variants.map((v: any) => v.sku);
    // Antes da correção este array seria ["CAM-P-COPY", "CAM-M-COPY"] — o
    // literal fixo que colide global (product_variants.sku é UNIQUE) assim
    // que a MESMA origem for duplicada de novo.
    expect(skusDasVariantes).not.toContain("CAM-P-COPY");
    expect(skusDasVariantes).not.toContain("CAM-M-COPY");
    for (const sku of skusDasVariantes) {
      expect(sku).toBeFalsy();
    }
  });

  it("duplicar o MESMO produto duas vezes: os SKUs de variante enviados nas duas duplicações nunca colidem", async () => {
    await montar();

    // Primeira duplicação — vira a cópia "azul" no cenário do achado.
    await duplicar();
    // `productToDuplicate` volta a null no finally do confirmDuplicate; o
    // produto de origem (produtoTeste) nunca é mutado, então duplicar de
    // novo repete exatamente o payload de origem — é isso que reproduzia a
    // colisão com o sufixo fixo.
    await duplicar();

    expect(addProduct).toHaveBeenCalledTimes(2);
    const skusPrimeiraCopia = addProduct.mock.calls[0][0].variants.map(
      (v: any) => v.sku,
    );
    const skusSegundaCopia = addProduct.mock.calls[1][0].variants.map(
      (v: any) => v.sku,
    );

    // O bug real: com o sufixo fixo, as duas cópias mandariam
    // ["CAM-P-COPY", "CAM-M-COPY"] IDÊNTICOS — a segunda bate no UNIQUE
    // global e nasce sem grade. Sem SKU, não há literal para colidir.
    expect(skusPrimeiraCopia).not.toContain("CAM-P-COPY");
    expect(skusSegundaCopia).not.toContain("CAM-P-COPY");
    for (const sku of [...skusPrimeiraCopia, ...skusSegundaCopia]) {
      expect(sku).toBeFalsy();
    }
  });
});
