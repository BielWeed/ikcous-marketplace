// @vitest-environment jsdom
//
// A lojista exclui o produto A e, enquanto a exclusão termina (o servidor
// apaga, o catálogo é relido, as fotos vão para o backup), abre o menu do
// produto B e toca em Excluir. A pergunta "Confirmar Exclusão" de B aparecia e
// SUMIA sozinha alguns segundos depois: o fim da exclusão de A zerava o
// "produto a excluir" sem olhar se ainda era o A. Agora só zera se ainda for o
// produto que foi confirmado.
//
// Monta a tela de verdade, com a janela de confirmação REAL (o Radix fecha a
// janela no toque de confirmar, antes do fim da exclusão — é por isso que dá
// para abrir a de B no meio). Só o hook de dados é dublê, com a exclusão em
// aberto até o teste soltá-la.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loadProducts: vi.fn(),
  deleteProduct: vi.fn(),
}));

const produto = (id: string, name: string) => ({
  id,
  name,
  category: "Geral",
  images: [],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
});
const PRODUTOS = [
  produto("prod-1", "Produto Um"),
  produto("prod-2", "Produto Dois"),
];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: PRODUTOS,
    loading: false,
    deleteProduct: h.deleteProduct,
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts: h.loadProducts,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
// O menu do cartão abre por ponteiro, que o jsdom não faz: renderiza os itens direto.
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
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

describe("AdminProductsView: o fim da exclusão de A não fecha a pergunta de B", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let soltarExclusaoDeA: (valor: boolean) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    h.loadProducts.mockResolvedValue({ products: PRODUTOS, total: 2 });
    // Cada exclusão fica em aberto até o teste soltá-la, como o servidor lento.
    h.deleteProduct.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          soltarExclusaoDeA = resolve;
        }),
    );
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
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
      raiz.render(<AdminProductsView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }
  // A lixeira de cada cartão (a da pergunta mora no portal, fora do hospedeiro).
  const lixeiras = () =>
    [...hospedeiro.querySelectorAll<HTMLButtonElement>("button")].filter((b) =>
      b.textContent?.includes("Excluir Produto"),
    );
  const botaoDaPergunta = (rotulo: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) =>
        b.getAttribute("aria-label") === rotulo ||
        b.textContent?.trim() === rotulo,
    );
  const perguntaAberta = () => document.body.textContent ?? "";

  async function pedirExclusaoDoCartao(posicao: number) {
    await act(async () => {
      lixeiras().at(posicao)?.click();
      await esperar();
    });
  }
  async function confirmar() {
    await act(async () => {
      botaoDaPergunta("Excluir Produto: confirmar exclusão")?.click();
      await esperar();
    });
  }

  it("exclui A, abre a pergunta de B no meio e o fim da exclusão de A deixa a de B aberta", async () => {
    await montar();
    expect(lixeiras()).toHaveLength(2);

    await pedirExclusaoDoCartao(0);
    expect(perguntaAberta()).toContain("“Produto Um”");
    await confirmar();
    expect(h.deleteProduct).toHaveBeenCalledWith("prod-1");
    // O toque de confirmar fecha a pergunta de A na hora; a exclusão segue.
    expect(perguntaAberta()).not.toContain("Confirmar Exclusão");

    await pedirExclusaoDoCartao(1);
    expect(perguntaAberta()).toContain("Confirmar Exclusão");
    expect(perguntaAberta()).toContain("“Produto Dois”");

    // A exclusão de A termina agora.
    await act(async () => {
      soltarExclusaoDeA(true);
      await esperar();
    });

    expect(perguntaAberta()).toContain("Confirmar Exclusão");
    expect(perguntaAberta()).toContain("“Produto Dois”");
    // E ela continua valendo para B: confirmar exclui o B, não o A.
    await confirmar();
    expect(h.deleteProduct).toHaveBeenLastCalledWith("prod-2");
    expect(h.deleteProduct).toHaveBeenCalledTimes(2);
  });

  it("a exclusão de A que FALHA também não fecha a pergunta de B", async () => {
    await montar();
    await pedirExclusaoDoCartao(0);
    await confirmar();
    await pedirExclusaoDoCartao(1);
    await act(async () => {
      soltarExclusaoDeA(false);
      await esperar();
    });
    expect(perguntaAberta()).toContain("“Produto Dois”");
  });

  it("a exclusão de A que LANÇA erro também não fecha a pergunta de B", async () => {
    h.deleteProduct.mockImplementationOnce(
      () =>
        new Promise<boolean>((_, rejeitar) => {
          soltarExclusaoDeA = () => rejeitar(new Error("caiu"));
        }),
    );
    await montar();
    await pedirExclusaoDoCartao(0);
    await confirmar();
    await pedirExclusaoDoCartao(1);
    await act(async () => {
      soltarExclusaoDeA(false);
      await esperar();
    });
    expect(perguntaAberta()).toContain("“Produto Dois”");
  });

  it("sem abrir outra pergunta, o fim da exclusão não deixa nada aberto (controle)", async () => {
    await montar();
    await pedirExclusaoDoCartao(0);
    await confirmar();
    await act(async () => {
      soltarExclusaoDeA(true);
      await esperar();
    });
    expect(perguntaAberta()).not.toContain("Confirmar Exclusão");
    // O produto A ainda pode ser excluído de novo (a trava foi solta).
    await pedirExclusaoDoCartao(0);
    expect(perguntaAberta()).toContain("“Produto Um”");
  });
});
