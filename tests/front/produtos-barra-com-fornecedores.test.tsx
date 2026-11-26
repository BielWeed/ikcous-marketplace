// @vitest-environment jsdom
//
// CENTRAL DE FORNECEDORES, etapa E1: a barra fixa da tela Produtos ganha um
// segundo botão. Era UM botão amarelo ("Novo produto"); agora são DOIS lado a
// lado, no mesmo molde da barra de Clientes (`flex-1 min-w-0`): "Fornecedores"
// (secundário) à ESQUERDA e "Novo produto" (o único amarelo) à DIREITA.
//
// O que se prova aqui:
//   a. ordem e classes dos dois botões, e um só amarelo na barra;
//   b. o ícone do Fornecedores é decorativo (aria-hidden), 20 px, traço 2;
//   c. cada botão abre a tela certa;
//   d. SEM internet: "Novo produto" fica desligado e diz "Sem internet" (cabe no
//      meio da barra), com o nome completo para o leitor de tela; "Fornecedores"
//      continua ligado (a tela dele explica a falta de internet);
//   e. nenhum dos dois botões corta o texto (sem `truncate`, sem `nowrap`): em
//      320 px a frase quebra em duas linhas, não some.
//
// Montagem real (createRoot + act), mesmo molde de produtos-cabem-no-celular.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const loadProducts = vi.fn();
let offlineMock = false;

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts,
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: undefined },
    fetchExecutiveSummary: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => offlineMock,
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Produtos: barra com Fornecedores e Novo produto (E1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    offlineMock = false;
    loadProducts.mockImplementation(async () => ({ products: [], total: 0 }));
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("PointerEvent", MouseEvent);
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

  async function montar(active = true) {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductsView onNavigate={onNavigate} active={active} />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function barra(): HTMLElement {
    const grupo = hospedeiro.querySelector<HTMLElement>(
      ".admin-acoes-da-barra",
    );
    if (!grupo) throw new Error("A barra de ações não está na tela.");
    return grupo;
  }

  function botoesDaBarra(): HTMLButtonElement[] {
    return [...barra().querySelectorAll<HTMLButtonElement>("button")];
  }

  it("são DOIS botões, Fornecedores à esquerda e Novo produto à direita", async () => {
    await montar();
    const botoes = botoesDaBarra();
    expect(botoes).toHaveLength(2);
    expect(botoes.map((b) => b.textContent?.trim())).toEqual([
      "Fornecedores",
      "Novo produto",
    ]);
  });

  it("o Fornecedores é secundário; o Novo produto é o ÚNICO amarelo da barra", async () => {
    await montar();
    const [fornecedores, novo] = botoesDaBarra();
    expect(fornecedores.classList.contains("produto-secundario")).toBe(true);
    expect(fornecedores.classList.contains("produto-principal")).toBe(false);
    expect(fornecedores.classList.contains("admin-barra-principal")).toBe(
      false,
    );
    expect(novo.classList.contains("produto-principal")).toBe(true);
    expect(novo.classList.contains("admin-barra-principal")).toBe(true);
    expect(barra().querySelectorAll(".produto-principal")).toHaveLength(1);
  });

  it("os dois dividem a largura (flex-1, min-w-0) e nenhum corta o texto", async () => {
    await montar();
    for (const botao of botoesDaBarra()) {
      expect(botao.classList.contains("flex-1"), botao.textContent).toBe(true);
      expect(botao.classList.contains("min-w-0"), botao.textContent).toBe(true);
      expect(botao.className).not.toMatch(/\btruncate\b/);
      expect(botao.className).not.toMatch(/whitespace-nowrap/);
      expect(botao.querySelector(".truncate")).toBeNull();
    }
  });

  it("o ícone do Fornecedores é uma fábrica decorativa de 20 px e traço 2", async () => {
    await montar();
    const [fornecedores, novo] = botoesDaBarra();
    const icone = fornecedores.querySelector("svg");
    expect(icone).not.toBeNull();
    expect(icone?.getAttribute("aria-hidden")).toBe("true");
    expect(icone?.classList.contains("lucide-factory")).toBe(true);
    expect(icone?.classList.contains("size-5")).toBe(true);
    expect(icone?.getAttribute("stroke-width")).toBe("2");
    // O Novo produto continua com o seu Plus, igual ao de antes.
    const plus = novo.querySelector("svg");
    expect(plus?.classList.contains("lucide-plus")).toBe(true);
    expect(plus?.classList.contains("size-5")).toBe(true);
    expect(plus?.getAttribute("aria-hidden")).toBe("true");
  });

  it("a 320 px os dois ícones saem para a palavra 'Fornecedores' caber inteira (medido no navegador: 80,4 px de palavra contra 73 px de caixa com ícone)", async () => {
    // jsdom não mede layout; o que se fixa aqui é a REGRA que o conserto usa. Sem ela, a palavra se parte no meio
    // ("Fornecedor / es") em celular de 320 px, porque a barra dá 125 px a cada botão.
    await montar();
    const [fornecedores, novo] = botoesDaBarra();
    for (const botao of [fornecedores, novo]) {
      const icone = botao.querySelector("svg");
      expect(icone?.classList.contains("max-[340px]:hidden")).toBe(true);
      // O texto continua sendo um nó próprio, que o ícone escondido não leva junto.
      expect(botao.querySelector("span")?.textContent?.length).toBeGreaterThan(
        0,
      );
    }
  });

  it("cada botão abre a tela certa", async () => {
    await montar();
    const [fornecedores, novo] = botoesDaBarra();
    await act(async () => fornecedores.click());
    expect(onNavigate).toHaveBeenLastCalledWith(
      "admin-fornecedores",
      undefined,
    );
    await act(async () => novo.click());
    expect(onNavigate).toHaveBeenLastCalledWith(
      "admin-product-form",
      undefined,
    );
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("sem internet: Novo produto desliga e diz 'Sem internet'; o nome completo vai no leitor de tela", async () => {
    offlineMock = true;
    await montar();
    const [fornecedores, novo] = botoesDaBarra();
    expect(novo.disabled).toBe(true);
    expect(novo.textContent?.trim()).toBe("Sem internet");
    expect(novo.getAttribute("aria-label")).toBe(
      "Novo produto indisponível sem internet",
    );
    expect(novo.getAttribute("title")).toBe(
      "Novo produto indisponível sem internet",
    );
    await act(async () => novo.click());
    expect(onNavigate).not.toHaveBeenCalled();
    // O Fornecedores continua aberto: a tela dele explica a falta de internet.
    expect(fornecedores.disabled).toBe(false);
    await act(async () => fornecedores.click());
    expect(onNavigate).toHaveBeenCalledWith("admin-fornecedores", undefined);
  });

  it("com internet o Novo produto NÃO leva aria-label (o texto visível já é o nome)", async () => {
    await montar();
    const [, novo] = botoesDaBarra();
    expect(novo.hasAttribute("aria-label")).toBe(false);
    expect(novo.hasAttribute("title")).toBe(false);
    expect(novo.disabled).toBe(false);
  });

  it("tela escondida (active=false) não deixa a barra solta", async () => {
    await montar(false);
    expect(hospedeiro.querySelector(".admin-acoes-da-barra")).toBeNull();
  });
});
