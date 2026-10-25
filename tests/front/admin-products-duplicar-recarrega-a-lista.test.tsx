// @vitest-environment jsdom
//
// Duplicar um produto tem de recarregar a lista, como a exclusão já faz: sem a
// recarga, a cópia (que nasce pausada) aparecia solta na página atual — fora da
// ordem, sem contar no total — até a lojista mexer na busca ou trocar de página.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteProduct = vi.fn();
const addProduct = vi.fn();
const loadProducts = vi.fn();
const toggleProductStatus = vi.fn();
const onNavigate = vi.fn();
const fetchExecutiveSummary = vi.fn();

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
    deleteProduct,
    toggleProductStatus,
    addProduct,
    loadProducts,
    // Laudo 0109 (A2): a duplicação agora copia os arquivos do storage
    // antes de criar a cópia — aqui basta a identidade, o storage não é o
    // assunto deste arquivo.
    copiarImagemParaDuplicacao: async (url: string) => url,
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

// Mocks dos componentes Radix: renderizam sempre os itens/conteúdo (sem
// depender de abrir/fechar via pointer capture), preservando `onClick` e
// `disabled` — é isso que este teste precisa disparar diretamente.
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
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

// jsdom não implementa IntersectionObserver -- LazyImage (usado pelo card de
// produto) cria um a cada montagem.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom não implementa ResizeObserver -- embla-carousel-react (usado por
// AdminKpiCarousel) cria um a cada montagem.
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

/** Espera até `condicao()` ficar verdadeira, testando a cada `passoMs` em
 * vez de dormir um tempo fixo — mesmo helper de
 * admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx e
 * checkout-summary-bar.test.tsx. Necessário para os itens 1 e 2 desta
 * suíte: as chamadas novas (`fetchExecutiveSummary(true)` na reativação, e
 * `refreshFinancialStats()` depois do toggle) saíram SEM `await` no call
 * site — `esperarMicrotarefas` (um único tick) continua bastando para os
 * casos já existentes de exclusão/duplicação, porque a chamada ao mock
 * acontece de forma síncrona dentro da mesma cadeia de microtarefas do
 * clique, mas usar `esperarAte` aqui é mais robusto contra qualquer
 * mudança futura de profundidade dessa cadeia. */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
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

describe("AdminProductsView — duplicar recarrega a lista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    loadProducts.mockResolvedValue({ products: [produtoTeste], total: 1 });
    fetchExecutiveSummary.mockResolvedValue(null);
    addProduct.mockResolvedValue(undefined);
    toggleProductStatus.mockResolvedValue(true);

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
    // Mesmo padrão de admin-products-view-toast-de-exclusao.test.tsx: um Map
    // de verdade, não o `localStorage` real do jsdom — que neste runner
    // (Node com `--localstorage-file`) devolve um objeto sem `getItem`.
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

  // Rerenderiza a MESMA `raiz` com um novo valor de `active`, sem
  // desmontar — é exatamente o que `AdminArea.tsx` faz de verdade (esconde
  // por CSS, nunca desmonta `AdminProductsView`). Item 1: usado para
  // simular sair para "admin-product-form" (active=false) e voltar
  // (active=true) sem perder o `stats` já carregado nesta instância.
  async function renderizar(active: boolean) {
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

  async function montar() {
    await renderizar(true);
    // A abertura agora revalida o snapshot. Os casos abaixo medem apenas
    // a nova chamada causada por uma ação ou reativação, não esta inicial.
    expect(fetchExecutiveSummary).toHaveBeenCalledTimes(1);
    expect(fetchExecutiveSummary).toHaveBeenCalledWith(true);
    fetchExecutiveSummary.mockClear();
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
      "Duplicar Produto: confirmar duplicação",
    )!;
    expect(botaoConfirmar).toBeDefined();
    await act(async () => {
      botaoConfirmar.click();
      await esperarMicrotarefas();
    });
  }

  // A abertura da lista carrega com um atraso de 320 ms (debounce da busca): a
  // espera passa por ele para que só a recarga CAUSADA pela duplicação conte.
  async function esperarAForaDaAbertura() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    loadProducts.mockClear();
  }

  it("duplicar com sucesso recarrega a lista (a cópia entra na ordem e no total)", async () => {
    addProduct.mockResolvedValue({ id: "copia-1" });
    await montar();
    await esperarAForaDaAbertura();

    await duplicar();

    expect(addProduct).toHaveBeenCalledTimes(1);
    await esperarAte(() => loadProducts.mock.calls.length > 0);
    expect(loadProducts).toHaveBeenCalledTimes(1);
  });

  it("a cópia que ficou sem grade também recarrega (a cópia existe, só a grade falhou)", async () => {
    addProduct.mockResolvedValue({
      id: "copia-1",
      variantesNaoSalvas: { motivo: null },
    });
    await montar();
    await esperarAForaDaAbertura();

    await duplicar();

    await esperarAte(() => loadProducts.mock.calls.length > 0);
    expect(loadProducts).toHaveBeenCalledTimes(1);
  });

  it("duplicação que falha não recarrega nada (nada mudou na lista)", async () => {
    addProduct.mockRejectedValue(new Error("sem rede"));
    await montar();
    await esperarAForaDaAbertura();

    await duplicar();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(loadProducts).not.toHaveBeenCalled();
  });

  it("o hook não criou nada (devolveu vazio): não recarrega", async () => {
    addProduct.mockResolvedValue(undefined);
    await montar();
    await esperarAForaDaAbertura();

    await duplicar();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(loadProducts).not.toHaveBeenCalled();
  });
});
