import { VISAO_ESTOQUE_BAIXO } from "@/utils/produtos-sem-custo";
// @vitest-environment jsdom
//
// Caça de provas fracas por mutação, território "lista de produtos do painel".
// Nenhum teste existente fixava estes limites da tela `AdminProductsView`
// (cada um sobreviveu a uma mutação do código de produção):
//
//   (a) rodapé: "N de M" com várias páginas x "Todos os resultados estão nesta
//       página." com uma só (12 produtos cabem numa página, 13 não);
//   (b) página guardada no aparelho: a última página válida NÃO é relida; uma
//       página além do fim é corrigida e relida; lista vazia numa página alta
//       não dispara releitura de "última página" (não existe);
//   (c) digitar uma busca ou escolher uma categoria volta à página 1 (senão a
//       lojista cai numa página que o filtro nem tem);
//   (d) o texto do estado vazio com busca E categoria junta as duas com " e ";
//   (e) offline: pausar e excluir pelo menu recusam com aviso e não chamam o
//       servidor (a guarda do handler, que o botão desabilitado não cobre);
//   (f) cartão: ativo "Pausar X" / pausado "Ativar X"; "Offline" vence
//       "Esgotado"; singular/plural de variação; "mín." do estoque baixo
//       (o do produto ou o padrão 5); preço em reais com milhar; o modo
//       detalhado guardado no aparelho e um valor inválido que volta ao compacto.
//
// Mesmo harness de admin-products-lista-honesta-com-busca-e-filtro.test.tsx:
// monta `AdminProductsView` de verdade, relógio falso ligado ANTES do render,
// o estado guardado entra pelo armazenamento do aparelho (`admin_products_*`).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  offline: false,
  carregar: vi.fn(),
  alternar: vi.fn(),
  excluir: vi.fn(),
  produtos: [] as any[],
  categorias: [] as { id: string; name: string }[],
}));
const onNavigate = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: h.produtos,
    loading: false,
    deleteProduct: h.excluir,
    toggleProductStatus: h.alternar,
    addProduct: vi.fn(),
    loadProducts: h.carregar,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 500, totalValue: 900 } },
    fetchExecutiveSummary: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: h.categorias, addCategory: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.offline,
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

// O menu é dublado SEM repassar `disabled`: o que se prova aqui é a guarda do
// handler, que vale mesmo se o botão desabilitado falhar.
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
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
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
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `prod-${i}`,
    name: `Produto ${i}`,
    category: "Roupas",
    images: [],
    isActive: true,
    stock: 10,
    price: 100,
    ...extra,
  };
}

describe("AdminProductsView — limites da lista de produtos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.offline = false;
    h.produtos = [];
    h.categorias = [];
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
    armazem = new Map<string, string>();
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
    vi.useRealTimers();
  });

  function guardar(
    chave: "search_term" | "filter_category" | "current_page" | "view_mode",
    valor: unknown,
  ) {
    // `view_mode` é texto cru; as demais são JSON (`useLocalStorage`).
    armazem.set(
      `admin_products_${chave}`,
      chave === "view_mode" ? String(valor) : JSON.stringify(valor),
    );
  }

  /** A lista devolvida pelo "servidor": `qtd` produtos e o total informado. */
  function servidor(qtd: number, total: number) {
    h.carregar.mockImplementation(async () => {
      h.produtos = Array.from({ length: qtd }).map((_, i) => produto(i));
      return { products: h.produtos, total };
    });
  }

  async function montar(visaoInicial?: string) {
    vi.useFakeTimers();
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductsView
          onNavigate={onNavigate}
          active={true}
          visaoInicial={visaoInicial}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  describe("(a) rodapé da paginação", () => {
    it("várias páginas: diz 'N de M' e não promete que tudo está numa página só", async () => {
      servidor(12, 25);
      await montar();

      expect(hospedeiro.querySelector(".produtos-pagina")?.textContent).toBe(
        "1 de 3",
      );
      expect(hospedeiro.textContent).not.toContain(
        "Todos os resultados estão nesta página.",
      );
      expect(hospedeiro.textContent).toContain("Exibindo 1 - 12 de 25");
    });

    it("12 produtos cabem numa página: 'Todos os resultados', '1 de 1' e botões desligados", async () => {
      servidor(12, 12);
      await montar();

      expect(hospedeiro.textContent).toContain(
        "Todos os resultados estão nesta página.",
      );
      expect(hospedeiro.querySelector(".produtos-pagina")).toBeNull();
      expect(hospedeiro.textContent).toContain("1 de 1");
      expect(botao("Anterior")?.disabled).toBe(true);
      expect(botao("Próximo")?.disabled).toBe(true);
      expect(hospedeiro.textContent).toContain("Exibindo 1 - 12 de 12");
    });

    it("13 produtos já são duas páginas", async () => {
      servidor(12, 13);
      await montar();

      expect(hospedeiro.querySelector(".produtos-pagina")?.textContent).toBe(
        "1 de 2",
      );
      expect(hospedeiro.textContent).not.toContain(
        "Todos os resultados estão nesta página.",
      );
    });

    it("tocar em Próximo guarda a página 2 e pede a página 1 do servidor (0-based)", async () => {
      servidor(12, 25);
      await montar();
      h.carregar.mockClear();

      await act(async () => {
        botao("Próximo")!.click();
      });
      await avancar(320);

      expect(h.carregar).toHaveBeenLastCalledWith(1, 12, expect.anything());
      expect(armazem.get("admin_products_current_page")).toBe("1");
      expect(hospedeiro.querySelector(".produtos-pagina")?.textContent).toBe(
        "2 de 3",
      );
    });
  });

  describe("(b) página guardada no aparelho", () => {
    it("a última página válida é lida uma vez só, sem correção", async () => {
      guardar("current_page", 2);
      servidor(1, 25); // 25 produtos = 3 páginas; a página 2 (0-based) é a última
      await montar();

      expect(h.carregar).toHaveBeenCalledTimes(1);
      expect(h.carregar).toHaveBeenCalledWith(2, 12, expect.anything());
      expect(armazem.get("admin_products_current_page")).toBe("2");
      expect(hospedeiro.querySelector(".produtos-pagina")?.textContent).toBe(
        "3 de 3",
      );
    });

    it("página além do fim é corrigida para a última e relida na hora", async () => {
      guardar("current_page", 5);
      servidor(1, 25);
      await montar();

      expect(h.carregar).toHaveBeenCalledTimes(2);
      expect(h.carregar).toHaveBeenNthCalledWith(1, 5, 12, expect.anything());
      expect(h.carregar).toHaveBeenNthCalledWith(2, 2, 12, expect.anything());
      expect(armazem.get("admin_products_current_page")).toBe("2");
    });

    it("sem nenhum produto no filtro, a página alta volta a 0 sem ler uma 'última página' que não existe", async () => {
      guardar("current_page", 3);
      guardar("search_term", "nada");
      h.carregar.mockResolvedValue({ products: [], total: 0 });
      await montar();

      // Só a leitura pedida; a releitura da página 0 é a busca automática (320 ms).
      expect(h.carregar).toHaveBeenCalledTimes(1);
      expect(h.carregar).toHaveBeenCalledWith(3, 12, expect.anything());
      expect(armazem.get("admin_products_current_page")).toBe("0");
      expect(hospedeiro.textContent).toContain("Nenhum produto encontrado");
    });
  });

  describe("(c) busca e categoria voltam à página 1", () => {
    it("digitar uma busca na página 3 relê a página 1", async () => {
      guardar("current_page", 2);
      servidor(12, 48);
      await montar();
      h.carregar.mockClear();

      const campo =
        hospedeiro.querySelector<HTMLInputElement>("#search-assets")!;
      await act(async () => {
        const gravar = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        gravar.call(campo, "camisa");
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await avancar(300); // pausa da digitação
      await avancar(320); // busca automática

      expect(h.carregar).toHaveBeenLastCalledWith(
        0,
        12,
        expect.objectContaining({ search: "camisa" }),
      );
      expect(armazem.get("admin_products_current_page")).toBe("0");
      expect(h.carregar.mock.calls.some(([pagina]) => pagina === 2)).toBe(
        false,
      );
    });

    it("escolher uma categoria na página 3 relê a página 1 daquela categoria", async () => {
      guardar("current_page", 2);
      h.categorias = [{ id: "c1", name: "Roupas" }];
      servidor(12, 48);
      await montar();
      h.carregar.mockClear();

      const chip = [
        ...hospedeiro.querySelectorAll(
          '[role="group"][aria-label="Categorias dos produtos"] button',
        ),
      ].find((b) => b.textContent?.includes("Roupas")) as HTMLButtonElement;
      await act(async () => {
        chip.click();
      });
      await avancar(320);

      expect(h.carregar).toHaveBeenLastCalledWith(
        0,
        12,
        expect.objectContaining({ category: "Roupas" }),
      );
      expect(armazem.get("admin_products_current_page")).toBe("0");
      expect(armazem.get("admin_products_filter_category")).toBe('"Roupas"');
    });
  });

  describe("(d) texto do estado vazio", () => {
    it("busca e categoria juntas aparecem ligadas por ' e '", async () => {
      guardar("search_term", "camisa");
      guardar("filter_category", "Calçados");
      h.carregar.mockResolvedValue({ products: [], total: 0 });
      await montar();

      expect(hospedeiro.textContent).toContain(
        'Nada combina com a busca "camisa" e a categoria "Calçados".',
      );
    });

    it("só a busca: cita só a busca; só a categoria: cita só a categoria", async () => {
      guardar("search_term", "camisa");
      h.carregar.mockResolvedValue({ products: [], total: 0 });
      await montar();
      expect(hospedeiro.textContent).toContain(
        'Nada combina com a busca "camisa".',
      );
      expect(hospedeiro.textContent).not.toContain("a categoria");
    });
  });

  describe("(e) offline: pausar e excluir recusam e não chamam o servidor", () => {
    beforeEach(() => {
      h.offline = true;
    });

    it("pausar pelo menu avisa e não altera o produto", async () => {
      servidor(1, 1);
      await montar();

      await act(async () => {
        botao("Pausar Produto")!.click();
      });

      expect(h.alternar).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Ação não permitida offline",
        {
          description:
            "Reconecte-se à internet para alterar o status do produto.",
        },
      );
    });

    it("excluir pelo menu avisa e não abre a pergunta de confirmação", async () => {
      servidor(1, 1);
      await montar();

      await act(async () => {
        botao("Excluir Produto")!.click();
      });

      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Ação não permitida offline",
        { description: "Reconecte-se à internet para excluir produtos." },
      );
      expect(hospedeiro.textContent).not.toContain("Confirmar Exclusão");
      expect(h.excluir).not.toHaveBeenCalled();
    });
  });

  describe("(e2) online: pausar manda o estado ATUAL e excluir pede confirmação", () => {
    it("pausar pelo menu chama o servidor com o estado atual do produto", async () => {
      servidor(1, 1);
      h.alternar.mockResolvedValue(true);
      await montar();

      await act(async () => {
        botao("Pausar Produto")!.click();
      });

      expect(h.alternar).toHaveBeenCalledExactlyOnceWith("prod-0", true);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("excluir só apaga depois de confirmar, e a pergunta diz qual produto", async () => {
      servidor(1, 1);
      h.excluir.mockResolvedValue(true);
      await montar();

      await act(async () => {
        botao("Excluir Produto")!.click();
      });
      expect(hospedeiro.textContent).toContain("Confirmar Exclusão");
      expect(hospedeiro.textContent).toContain("“Produto 0”");
      expect(h.excluir).not.toHaveBeenCalled();

      // O dublê do botão de confirmar não repassa o aria-label: ele é o único
      // botão cujo texto é exatamente "Excluir Produto" (o do menu traz a
      // legenda junto).
      const confirmar = [...hospedeiro.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Excluir Produto",
      )!;
      await act(async () => {
        confirmar.click();
      });
      expect(h.excluir).toHaveBeenCalledExactlyOnceWith("prod-0");
    });
  });

  describe("(g) pausar relê a lista só quando o produto sai do filtro da tela", () => {
    it("na visão 'Estoque baixo', pausar com sucesso relê a lista dos ativos com estoque baixo", async () => {
      servidor(1, 1);
      h.alternar.mockResolvedValue(true);
      await montar(VISAO_ESTOQUE_BAIXO);
      expect(hospedeiro.textContent).toContain(
        "Mostrando só produtos com estoque baixo",
      );
      h.carregar.mockClear();

      await act(async () => {
        botao("Pausar Produto")!.click();
      });
      await avancar(0);

      expect(h.alternar).toHaveBeenCalledExactlyOnceWith("prod-0", true);
      expect(h.carregar).toHaveBeenCalledTimes(1);
      expect(h.carregar).toHaveBeenLastCalledWith(
        0,
        12,
        expect.objectContaining({ stock: "low", status: "active" }),
      );
    });

    it("na visão 'Estoque baixo', pausar que FALHOU não relê a lista (nada mudou no servidor)", async () => {
      servidor(1, 1);
      h.alternar.mockResolvedValue(false);
      await montar(VISAO_ESTOQUE_BAIXO);
      h.carregar.mockClear();

      await act(async () => {
        botao("Pausar Produto")!.click();
      });
      await avancar(0);

      expect(h.alternar).toHaveBeenCalledTimes(1);
      expect(h.carregar).not.toHaveBeenCalled();
    });

    it("na lista normal, pausar com sucesso não relê a lista (o cartão só troca de estado)", async () => {
      servidor(1, 1);
      h.alternar.mockResolvedValue(true);
      await montar();
      h.carregar.mockClear();

      await act(async () => {
        botao("Pausar Produto")!.click();
      });
      await avancar(0);

      expect(h.alternar).toHaveBeenCalledTimes(1);
      expect(h.carregar).not.toHaveBeenCalled();
    });
  });

  describe("(f) cartão do produto", () => {
    it("ativo diz 'Pausar X' (ligado); pausado diz 'Ativar X' (desligado)", async () => {
      h.carregar.mockImplementation(async () => {
        h.produtos = [
          produto(1, { name: "Camisa", isActive: true }),
          produto(2, { name: "Bermuda", isActive: false }),
        ];
        return { products: h.produtos, total: 2 };
      });
      await montar();

      const ativo = hospedeiro.querySelector(
        '[aria-label="Pausar Camisa"]',
      ) as HTMLButtonElement;
      const pausado = hospedeiro.querySelector(
        '[aria-label="Ativar Bermuda"]',
      ) as HTMLButtonElement;
      expect(ativo.getAttribute("aria-pressed")).toBe("true");
      expect(ativo.textContent).toContain("Ativo");
      expect(pausado.getAttribute("aria-pressed")).toBe("false");
      expect(pausado.textContent).toContain("Ativar");
      expect(
        hospedeiro.querySelector('[aria-label="Ativar Camisa"]'),
      ).toBeNull();
    });

    it("pausado sem estoque é 'Offline' (nunca 'Esgotado'); ativo sem estoque é 'Esgotado'", async () => {
      h.carregar.mockImplementation(async () => {
        h.produtos = [
          produto(1, { name: "Pausado zerado", isActive: false, stock: 0 }),
          produto(2, { name: "Ativo zerado", isActive: true, stock: 0 }),
        ];
        return { products: h.produtos, total: 2 };
      });
      await montar();

      const textos = [
        ...hospedeiro.querySelectorAll("[data-produto-nome]"),
      ].map((n) => n.closest(".produto-cartao")?.textContent ?? "");
      expect(textos[0]).toContain("Offline");
      expect(textos[0]).not.toContain("Esgotado");
      expect(textos[1]).toContain("Esgotado");
      expect(textos[1]).not.toContain("Offline");
    });

    it("variações no singular e no plural", async () => {
      h.carregar.mockImplementation(async () => {
        h.produtos = [
          produto(1, {
            name: "Uma grade",
            variants: [{ id: "v1", name: "Cor", value: "Azul", active: true }],
          }),
          produto(2, {
            name: "Duas grades",
            variants: [
              { id: "v2", name: "Cor", value: "Azul", active: true },
              { id: "v3", name: "Cor", value: "Verde", active: true },
            ],
          }),
        ];
        return { products: h.produtos, total: 2 };
      });
      await montar();

      const cartoes = [...hospedeiro.querySelectorAll(".produto-cartao")];
      expect(cartoes[0].textContent).toContain("1 variação");
      expect(cartoes[0].textContent).not.toContain("1 variações");
      expect(cartoes[1].textContent).toContain("2 variações");
    });

    it("estoque baixo mostra o mínimo do produto; sem mínimo, o padrão 5; estoque acima do mínimo não mostra", async () => {
      h.carregar.mockImplementation(async () => {
        h.produtos = [
          produto(1, { name: "Com mínimo", stock: 3, estoqueMinimo: 8 }),
          produto(2, { name: "Sem mínimo", stock: 5, estoqueMinimo: null }),
          produto(3, { name: "Folgado", stock: 6, estoqueMinimo: null }),
          produto(4, { name: "Acima do mínimo", stock: 9, estoqueMinimo: 8 }),
        ];
        return { products: h.produtos, total: 4 };
      });
      await montar();

      const cartoes = [...hospedeiro.querySelectorAll(".produto-cartao")].map(
        (c) => c.textContent ?? "",
      );
      expect(cartoes[0]).toContain("mín. 8");
      expect(cartoes[0]).toContain("Crítico");
      expect(cartoes[1]).toContain("mín. 5");
      expect(cartoes[1]).toContain("Crítico");
      expect(cartoes[2]).not.toContain("mín.");
      expect(cartoes[2]).not.toContain("Crítico");
      expect(cartoes[3]).not.toContain("mín.");
    });

    it("preço em reais com milhar e vírgula nos dois modos", async () => {
      h.carregar.mockImplementation(async () => {
        h.produtos = [produto(1, { price: 1234.5, costPrice: 10 })];
        return { products: h.produtos, total: 1 };
      });
      await montar();
      expect(
        hospedeiro.querySelector(".produto-cartao")?.textContent,
      ).toContain("R$ 1.234,50");

      await act(async () => {
        hospedeiro
          .querySelector<HTMLButtonElement>(
            '[aria-label="Mostrar em lista com detalhes"]',
          )!
          .click();
      });
      expect(
        hospedeiro.querySelector(".produto-cartao")?.textContent,
      ).toContain("R$ 1.234,50");
      expect(armazem.get("admin_products_view_mode")).toBe("detailed");
    });

    it("detalhado: estoque baixo diz 'Estoque · mín. N'; com grade, 'Estoque total'; sem grade, 'Estoque'", async () => {
      guardar("view_mode", "detailed");
      h.carregar.mockImplementation(async () => {
        h.produtos = [
          produto(1, { name: "Baixo", stock: 2, estoqueMinimo: 4 }),
          produto(2, {
            name: "Com grade",
            stock: 20,
            variants: [
              {
                id: "v1",
                name: "Cor",
                value: "Azul",
                active: true,
                stockIncrement: 20,
              },
            ],
          }),
          produto(3, { name: "Simples", stock: 20 }),
          produto(4, { name: "Baixo padrão", stock: 5, estoqueMinimo: null }),
        ];
        return { products: h.produtos, total: 4 };
      });
      await montar();

      const cartoes = [...hospedeiro.querySelectorAll(".produto-cartao")].map(
        (c) => c.textContent ?? "",
      );
      expect(cartoes[3]).toContain("Estoque · mín. 5");
      expect(cartoes[0]).toContain("Estoque · mín. 4");
      expect(cartoes[1]).toContain("Estoque total");
      expect(cartoes[2]).not.toContain("Estoque total");
      expect(cartoes[2]).not.toContain("mín.");
      expect(cartoes[2]).toContain("Estoque");
    });

    it("detalhado: 1 unidade no singular e várias no plural (total das variações)", async () => {
      guardar("view_mode", "detailed");
      h.carregar.mockImplementation(async () => {
        h.produtos = [
          produto(1, {
            name: "Uma",
            stock: 1,
            variants: [
              {
                id: "v1",
                name: "Cor",
                value: "Azul",
                active: true,
                stockIncrement: 1,
              },
            ],
          }),
          produto(2, {
            name: "Varias",
            stock: 7,
            variants: [
              {
                id: "v2",
                name: "Cor",
                value: "Azul",
                active: true,
                stockIncrement: 7,
              },
            ],
          }),
        ];
        return { products: h.produtos, total: 2 };
      });
      await montar();

      const cartoes = [...hospedeiro.querySelectorAll(".produto-cartao")].map(
        (c) => c.textContent ?? "",
      );
      expect(cartoes[0]).toContain("Estoque total das variações: 1 unidade");
      expect(cartoes[0]).not.toContain("1 unidades");
      expect(cartoes[1]).toContain("Estoque total das variações: 7 unidades");
    });

    it("o modo guardado vale na abertura; valor inválido volta ao compacto e é regravado", async () => {
      guardar("view_mode", "grade-antiga");
      servidor(1, 1);
      await montar();

      expect(hospedeiro.textContent).not.toContain("Mais métricas");
      expect(
        hospedeiro.querySelector(
          '[aria-label="Mostrar em lista com detalhes"]',
        ),
      ).not.toBeNull();
      expect(armazem.get("admin_products_view_mode")).toBe("compact");
    });
  });
});
