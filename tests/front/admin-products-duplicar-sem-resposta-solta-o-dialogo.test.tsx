// @vitest-environment jsdom
//
// Duplicar com rede que conecta mas não responde (4G fraco, Wi-Fi que caiu no
// meio): o diálogo ficava preso em "Duplicando…", com Cancelar e Duplicar
// desativados, até o navegador desistir da conexão. Agora a cópia das fotos tem
// prazo (no hook), e aqui, na tela, o estouro SOLTA o diálogo e diz a verdade:
// "não dá para saber se a cópia foi criada; confira a lista antes de duplicar de
// novo" — nunca "não foi possível duplicar" (a cópia pode existir) nem "Produto
// Duplicado" (não se sabe).
//
// A tela é a de verdade; só os hooks de dados são dublês. O prazo das fotos
// mora no hook e é provado em tests/front/duplicar-foto-sem-resposta-tem-prazo.test.ts.
import {
  MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  addProduct: vi.fn(),
  loadProducts: vi.fn(),
  copiar: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

const produtoTeste = {
  id: "prod-1",
  name: "Produto Teste",
  category: "Geral",
  images: [
    "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
  ],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
};

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [produtoTeste],
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: h.addProduct,
    loadProducts: h.loadProducts,
    copiarImagemParaDuplicacao: h.copiar,
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
  toast: { success: h.toastSuccess, error: h.toastError, loading: vi.fn() },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

describe("AdminProductsView: duplicar sem resposta da rede solta o diálogo e não mente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.loadProducts.mockResolvedValue({ products: [produtoTeste], total: 1 });
    h.copiar.mockImplementation(async (url: string) => url);
    h.addProduct.mockResolvedValue({ id: "copia-1" });
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
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
      raiz.render(<AdminProductsView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }
  const botao = (rotulo: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) =>
        b.getAttribute("aria-label") === rotulo ||
        b.textContent?.trim() === rotulo,
    );
  const perguntaAberta = () =>
    (document.body.textContent ?? "").includes("Confirmar Duplicação");
  const avisosDeErro = () => h.toastError.mock.calls.map((c) => c[0]);

  // O item do menu do cartão mora no hospedeiro; o texto traz também a legenda.
  const itemDuplicar = () =>
    [...hospedeiro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes("Duplicar Produto"),
    );

  async function duplicar() {
    await act(async () => {
      itemDuplicar()?.click();
      await esperar();
    });
    expect(perguntaAberta()).toBe(true);
    await act(async () => {
      botao("Duplicar Produto: confirmar duplicação")?.click();
      await esperar(60);
    });
  }

  it("a cópia das fotos sem resposta: solta o diálogo, avisa sem prometer nada e não cria produto", async () => {
    h.copiar.mockRejectedValue(
      erroDeConsultaSemResposta(MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA),
    );
    await montar();
    await duplicar();

    expect(perguntaAberta()).toBe(false);
    expect(botao("Duplicando…")).toBeUndefined();
    expect(h.addProduct).not.toHaveBeenCalled();
    expect(avisosDeErro()).toEqual([MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA]);
    // Não diz que falhou, nem que deu certo.
    expect(avisosDeErro()).not.toContain("Erro na Duplicação");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // A frase manda conferir a lista antes de repetir.
    expect(MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA).toMatch(
      /não dá para saber se a cópia foi criada/i,
    );
    expect(MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA).toMatch(/confira a lista/i);
  });

  it("depois do estouro dá para duplicar de novo (a trava foi solta)", async () => {
    h.copiar.mockRejectedValueOnce(
      erroDeConsultaSemResposta(MENSAGEM_PRODUTO_DUPLICAR_SEM_RESPOSTA),
    );
    await montar();
    await duplicar();
    expect(h.addProduct).not.toHaveBeenCalled();

    await duplicar();
    expect(h.addProduct).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "Produto Duplicado",
      expect.anything(),
    );
  });

  it("a gravação da cópia sem resposta (o hook já avisou): solta o diálogo, sem 'Erro na Duplicação' e sem aviso repetido da tela", async () => {
    h.addProduct.mockRejectedValue(
      erroDeConsultaSemResposta("Sem resposta da rede. Confira a lista."),
    );
    await montar();
    await duplicar();

    expect(perguntaAberta()).toBe(false);
    expect(botao("Duplicando…")).toBeUndefined();
    expect(h.addProduct).toHaveBeenCalledTimes(1);
    // Quem avisa é o hook (`avisarFalhaDoProduto`), que está dublado aqui: a
    // tela não empilha um "não foi possível duplicar" por cima.
    expect(avisosDeErro()).not.toContain("Erro na Duplicação");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("falha comum (não é falta de resposta) segue dizendo 'Erro na Duplicação' (controle)", async () => {
    h.addProduct.mockRejectedValue(new Error("violou uma regra"));
    await montar();
    await duplicar();

    expect(perguntaAberta()).toBe(false);
    expect(avisosDeErro()).toEqual(["Erro na Duplicação"]);
  });

  it("foto que falha de verdade (não é prazo) segue dizendo 'Erro na Duplicação' (controle)", async () => {
    h.copiar.mockRejectedValue(new Error("storage/unexpected_failure"));
    await montar();
    await duplicar();

    expect(perguntaAberta()).toBe(false);
    expect(h.addProduct).not.toHaveBeenCalled();
    expect(avisosDeErro()).toEqual(["Erro na Duplicação"]);
  });
});
