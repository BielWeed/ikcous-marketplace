// @vitest-environment jsdom
//
// Achado 11 da auditoria de 20/08/2026
// (docs/auditoria/2026-08-20-painel-pedidos-produtos.md): ao entrar em
// Produtos, por um instante a tela mostra "Nenhum produto cadastrado" —
// mesmo havendo produtos — porque a busca da lista só dispara 320 ms depois
// de a tela abrir (`AdminProductsView.tsx`, `setTimeout(..., 320)`), e
// `loading` (do `useProducts`) só vira `true` DENTRO de `loadProducts`,
// chamada só depois do atraso. Nessa janela, a condição do estado vazio
// (`!loading && products?.length === 0`) já era verdadeira: "ainda não
// perguntei ao servidor" virava "perguntei e não há nada".
//
// A correção distingue TRÊS estados, não dois: "ainda não perguntei"
// (mostra o esqueleto de carregamento já existente na tela, mas antes
// inalcançável por causa da janela dos 320 ms), "perguntei e a resposta foi
// vazia de verdade" (mostra "Nenhum produto cadastrado") e "perguntei e a
// pergunta FALHOU" (mostra `AdminErrorState`, com botão de tentar de novo —
// nunca "Nenhum produto cadastrado", nem esqueleto eterno: o auditoria
// avisou que trocar uma mentira pela outra não é conserto).
//
// Monta `AdminProductsView` de verdade (mesmo padrão de
// admin-products-kpi-apos-mexer-no-catalogo.test.tsx), com
// `vi.useFakeTimers()` ativado ANTES do render — ativar depois deixaria o
// `setTimeout(..., 320)` preso no relógio real e nunca disparar dentro da
// vida do teste (mesmo cuidado de
// admin-product-form-draft-e-duplo-clique.test.tsx).
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

// Mutado pelos testes que simulam uma resposta com produtos — o mock de
// `useProducts` abaixo devolve sempre o valor ATUAL desta variável no
// instante do render (a view muda de estado real via `setTotalProducts`
// dentro de `loadData`, o que já força um novo render e relê este valor).
let produtosMock: any[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtosMock,
    loading: false,
    deleteProduct,
    toggleProductStatus,
    addProduct,
    loadProducts,
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

function dezenoveProdutos() {
  return Array.from({ length: 19 }).map((_, i) => ({
    id: `prod-${i}`,
    name: `Produto ${i}`,
    category: "Geral",
    images: [],
    isActive: true,
    stock: 10,
    price: 100,
  }));
}

const TEXTO_VAZIO = "Nenhum produto cadastrado";

describe("AdminProductsView — achado 11: não afirma catálogo vazio antes de perguntar ao servidor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    produtosMock = [];
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
    // Desmonta ANTES de voltar ao relógio real — mesma ordem de
    // admin-product-form-draft-e-duplo-clique.test.tsx. Fazer o inverso (ou
    // drenar timers pendentes antes de desmontar) deixa o
    // `setTimeout(320ms)` de um teste disparar `loadData` sobre uma
    // instância já finalizada, mutando `produtosMock`/`cachedProductsTotal`
    // (module-level, compartilhado por todo o arquivo) fora de ordem e
    // vazando para o teste seguinte — foi exatamente esse vazamento que
    // produziu falso-positivo aqui na primeira versão desta suíte.
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function montar() {
    // Precisa estar ativo ANTES do import/render: é durante o efeito de
    // montagem que o `setTimeout(..., 320)` é agendado.
    vi.useFakeTimers();
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );

    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
  }

  async function avancar320ms() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    // Mais dois giros de microtarefa para o `.then`/`await` de `loadProducts`
    // (uma Promise) terminar de atualizar o estado do componente antes de
    // ler o DOM — mesmo cuidado de admin-product-form-draft-e-duplo-clique.test.tsx.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("antes dos 320 ms (nenhuma pergunta feita ainda): não afirma catálogo vazio", async () => {
    loadProducts.mockResolvedValue({
      products: dezenoveProdutos(),
      total: 19,
    });

    await montar();

    expect(hospedeiro.textContent).not.toContain(TEXTO_VAZIO);
  });

  it("depois da resposta com produtos: a lista aparece, sem o aviso de vazio", async () => {
    loadProducts.mockImplementation(async () => {
      produtosMock = dezenoveProdutos();
      return { products: produtosMock, total: 19 };
    });

    await montar();
    await avancar320ms();

    expect(hospedeiro.textContent).not.toContain(TEXTO_VAZIO);
    expect(hospedeiro.textContent).toContain("Produto 0");
  });

  it("depois da resposta REALMENTE vazia: agora sim mostra o aviso de vazio", async () => {
    loadProducts.mockResolvedValue({ products: [], total: 0 });

    await montar();
    await avancar320ms();

    expect(hospedeiro.textContent).toContain(TEXTO_VAZIO);
  });

  it("quando a busca FALHA: não afirma catálogo vazio, e mostra um aviso de erro distinto (não esqueleto eterno)", async () => {
    // O hook real nunca lança aqui: `loadProducts` captura o erro
    // internamente, já mostra `toast.error("Erro ao listar produtos")` e
    // devolve `null` — é exatamente isso que este dublê reproduz.
    loadProducts.mockResolvedValue(null);

    await montar();
    await avancar320ms();

    expect(hospedeiro.textContent).not.toContain(TEXTO_VAZIO);
    expect(hospedeiro.textContent).toContain("Erro ao Carregar Produtos");
    expect(hospedeiro.textContent).toContain("Tentar Novamente");
  });
});
