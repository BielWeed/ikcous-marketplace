// @vitest-environment jsdom
//
// A foto de uma variação é escolhida ENTRE as fotos do produto e guardada como
// o MESMO endereço (variant.imageUrl === uma de product.images). `confirmDuplicate`
// copiava as fotos do produto e a de cada variação em chamadas separadas de
// `copiarImagemParaDuplicacao`; cada chamada gera caminho novo, então o mesmo
// arquivo virava duas URLs diferentes na cópia. Na loja, a galeria separa as
// fotos da variação por igualdade de texto: a URL da variação não batia com
// nenhuma foto do produto, virava "extra" e entrava de novo no fim da galeria
// — foto repetida.
//
// A correção copia cada URL DISTINTA uma única vez e reaproveita o resultado.
// Produto e cópia continuam sem compartilhar arquivo (laudo 0109).
//
// Mesmo scaffolding de admin-products-duplicar-duas-vezes-preserva-a-grade.test.tsx:
// `useProducts` mockado, o que se prende é o payload entregue a `addProduct`.
// O dublê de cópia devolve uma URL NOVA a cada chamada (como o real, que usa
// crypto.randomUUID) — a identidade das outras suítes esconderia o defeito.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const loadProducts = vi.fn();
const deleteProduct = vi.fn();
const toggleProductStatus = vi.fn();
const copiarImagemParaDuplicacao = vi.fn();
const onNavigate = vi.fn();
const fetchExecutiveSummary = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastLoading = vi.fn();

const FOTO_1 =
  "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg";
const FOTO_2 =
  "https://proj.supabase.co/storage/v1/object/public/products/foto2.jpg";
const FOTO_PROPRIA =
  "https://proj.supabase.co/storage/v1/object/public/products/so-da-variacao.jpg";

const produtoTeste: {
  id: string;
  name: string;
  category: string;
  images: string[];
  isActive: boolean;
  stock: number;
  price: number;
  costPrice: number;
  variants: Array<Record<string, unknown>>;
} = {
  id: "prod-1",
  name: "Camiseta Base",
  category: "Geral",
  images: [FOTO_1, FOTO_2],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
  variants: [],
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
    "aria-label": ariaLabel,
  }: {
    children: ReactNode;
    onClick?: () => void;
    "aria-label"?: string;
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel}>
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
  return [...raizDom.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === texto || b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("AdminProductsView — duplicar: foto da variação que é uma foto do produto não vira foto repetida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    loadProducts.mockResolvedValue({ products: [produtoTeste], total: 1 });
    fetchExecutiveSummary.mockResolvedValue(null);
    addProduct.mockResolvedValue({ ...produtoTeste, id: "prod-copia" });
    // Como o real: cada chamada devolve um caminho NOVO.
    let contador = 0;
    copiarImagemParaDuplicacao.mockImplementation(async (url: string) => {
      contador += 1;
      return `${url}?copia=${contador}`;
    });

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
    produtoTeste.variants = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function duplicar() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

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
      "Duplicar Produto: confirmar duplicação",
    )!;
    expect(botaoConfirmar).toBeDefined();
    await act(async () => {
      botaoConfirmar.click();
      await esperarMicrotarefas();
    });
  }

  it("variação apontando para a 1ª foto do produto: a cópia aponta para a 1ª foto DA CÓPIA e o arquivo é copiado uma vez só", async () => {
    produtoTeste.variants = [
      {
        id: "v-p",
        name: "Cor",
        value: "Azul",
        active: true,
        imageUrl: FOTO_1,
      },
    ];
    await duplicar();

    expect(addProduct).toHaveBeenCalledTimes(1);
    const payload = addProduct.mock.calls[0][0];
    expect(payload.images).toHaveLength(2);
    expect(payload.variants[0].imageUrl).toBe(payload.images[0]);
    // 2 fotos distintas = 2 cópias (e não 3).
    expect(copiarImagemParaDuplicacao).toHaveBeenCalledTimes(2);
    // Cópia continua sem compartilhar arquivo com o original.
    expect(payload.images).not.toContain(FOTO_1);
    expect(payload.images).not.toContain(FOTO_2);
  });

  it("duas variações apontando para a mesma foto: uma só cópia para as duas", async () => {
    produtoTeste.variants = [
      { id: "v-1", name: "Cor", value: "Azul", active: true, imageUrl: FOTO_2 },
      {
        id: "v-2",
        name: "Cor",
        value: "Azul-claro",
        active: true,
        imageUrl: FOTO_2,
      },
    ];
    await duplicar();

    const payload = addProduct.mock.calls[0][0];
    expect(payload.variants[0].imageUrl).toBe(payload.images[1]);
    expect(payload.variants[1].imageUrl).toBe(payload.images[1]);
    expect(copiarImagemParaDuplicacao).toHaveBeenCalledTimes(2);
  });

  it("variação com foto própria, fora da lista do produto: ganha arquivo próprio (chamada extra)", async () => {
    produtoTeste.variants = [
      {
        id: "v-p",
        name: "Cor",
        value: "Verde",
        active: true,
        imageUrl: FOTO_PROPRIA,
      },
    ];
    await duplicar();

    const payload = addProduct.mock.calls[0][0];
    expect(copiarImagemParaDuplicacao).toHaveBeenCalledTimes(3);
    expect(copiarImagemParaDuplicacao).toHaveBeenCalledWith(FOTO_PROPRIA);
    expect(payload.variants[0].imageUrl).toMatch(/so-da-variacao\.jpg\?copia=/);
    expect(payload.images).not.toContain(payload.variants[0].imageUrl);
    expect(payload.variants[0].imageUrl).not.toBe(FOTO_PROPRIA);
  });

  it("variação sem foto continua sem foto e não gasta cópia", async () => {
    produtoTeste.variants = [
      { id: "v-p", name: "Cor", value: "Preto", active: true, imageUrl: null },
    ];
    await duplicar();

    const payload = addProduct.mock.calls[0][0];
    expect(payload.variants[0].imageUrl).toBeNull();
    expect(copiarImagemParaDuplicacao).toHaveBeenCalledTimes(2);
  });
});
