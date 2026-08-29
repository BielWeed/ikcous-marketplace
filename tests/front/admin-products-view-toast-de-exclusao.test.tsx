// @vitest-environment jsdom
//
// Achado da revisão de contexto limpo (Trilha 1, #98/#99 — conserto 4):
// `AdminProductsView.confirmDelete` descartava o retorno de `deleteProduct`
// (src/hooks/useProducts.ts) e mostrava `toast.success("Produto Removido")`
// incondicionalmente. Como `deleteProduct` NUNCA lança — captura tudo
// internamente e devolve `true`/`false`, já mostrando "Erro ao excluir
// produto" ela mesma numa falha —, o `catch` da view nunca disparava numa
// falha de soft-delete: o admin via os DOIS toasts ao mesmo tempo ("Erro ao
// excluir produto" do hook + "Produto Removido" da view).
//
// Achado 16 da auditoria de 20/08/2026
// (docs/auditoria/2026-08-20-painel-pedidos-produtos.md): o "conserto 4"
// acima consertou só a metade da FALHA — o comentário que ele deixou em
// `AdminProductsView.tsx` dizia isso mesmo ("o caso de sucesso ficou de
// fora"). No SUCESSO, a view continuava mostrando o próprio
// `toast.success("Produto Removido", {...})` incondicional, duplicando o
// `toast.success("Produto removido")` que o hook já mostra sozinho — dois
// avisos empilhados para uma exclusão só. A correção do achado 16 remove o
// da view: o aviso de sucesso passa a morar só no hook (mockado neste
// arquivo, então invisível aqui), a mesma regra que a FALHA já seguia. Por
// isso o primeiro teste abaixo mudou de "a view mostra" para "a view NÃO
// mostra mais" — ver também admin-products-um-so-aviso-ao-excluir.test.tsx.
//
// Este arquivo monta `AdminProductsView` de verdade (sem @testing-library,
// mesmo padrão de admin-product-form-draft-e-duplo-clique.test.tsx: createRoot
// + act do React puro) e mocka os componentes Radix (`dropdown-menu`,
// `alert-dialog`) para não depender de PointerEvent/ResizeObserver que o
// jsdom não implementa — mesma razão que already levou a mockar
// `@/components/ui/select` no teste do formulário de produto.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteProduct = vi.fn();
const loadProducts = vi.fn();
const onNavigate = vi.fn();

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
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
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

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
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

describe("AdminProductsView — conserto 4: toast de sucesso só some com deleteProduct verdadeiro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    loadProducts.mockResolvedValue({ products: [produtoTeste], total: 1 });
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    // Mesmo padrão de admin-product-form-draft-e-duplo-clique.test.tsx: um
    // Map de verdade, não o `localStorage` real do jsdom — que neste runner
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

  async function montarEExcluir() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );

    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const botaoExcluir = localizarBotaoPorTexto(hospedeiro, "Excluir Produto")!;
    expect(botaoExcluir).toBeDefined();

    await act(async () => {
      botaoExcluir.click();
    });

    const botaoConfirmar = localizarBotaoPorTexto(
      hospedeiro,
      "Confirmar Exclusão",
    )!;
    expect(botaoConfirmar).toBeDefined();

    await act(async () => {
      botaoConfirmar.click();
      await esperarMicrotarefas();
    });
  }

  it("deleteProduct devolve true: a VIEW não mostra mais 'Produto Removido' — achado 16, quem avisa agora é só o hook", async () => {
    deleteProduct.mockResolvedValue(true);

    await montarEExcluir();

    expect(deleteProduct).toHaveBeenCalledWith("prod-1");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("deleteProduct devolve false: NÃO mostra 'Produto Removido' (o hook já avisou o erro)", async () => {
    // `deleteProduct` real nunca lança — resolve `false` e já mostrou
    // "Erro ao excluir produto" ela mesma. Este teste falha se a view voltar
    // a descartar o retorno: o `toastSuccess` seria chamado incondicionalmente.
    deleteProduct.mockResolvedValue(false);

    await montarEExcluir();

    expect(deleteProduct).toHaveBeenCalledWith("prod-1");
    expect(toastSuccess).not.toHaveBeenCalledWith(
      "Produto Removido",
      expect.anything(),
    );
  });
});
