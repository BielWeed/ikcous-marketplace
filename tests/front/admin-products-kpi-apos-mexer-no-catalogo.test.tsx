// @vitest-environment jsdom
//
// Achado 7 da auditoria de 20/08/2026
// (docs/auditoria/2026-08-20-painel-pedidos-produtos.md): "Capital Alocado",
// "Lucro Potencial" e "ROI do Portfólio" congelavam depois de excluir ou
// duplicar um produto, porque `clearAnalyticsCache()` só zera o cache de
// MÓDULO em `useAnalytics.ts` — não avisa a instância do hook que a própria
// `AdminProductsView` já mantém montada.
//
// A primeira correção mexeu na RAIZ (fez `clearAnalyticsCache()` disparar um
// evento que zerava `stats` em toda instância montada) e foi bloqueada na
// revisão: zerar `stats` também atinge o Dashboard e a tela de Pedidos, que
// não rebuscam sozinhos do nulo — o Dashboard passava a mostrar KPI ZERADO
// como se fosse real, e o aviso de dinheiro em pedido cancelado sumia da
// tela de Pedidos. Este teste prova a correção NOVA, subtrativa: a própria
// `AdminProductsView` rebusca o resumo executivo (`fetchExecutiveSummary(true)`)
// depois de excluir/duplicar um produto com sucesso — o mesmo padrão já usado
// em `AdminOrdersView.tsx:292-294` — sem tocar em `useAnalytics.ts`.
//
// Monta `AdminProductsView` de verdade (sem @testing-library: createRoot +
// act do React puro, e mocks dos componentes Radix), mesmo padrão de
// admin-products-view-toast-de-exclusao.test.tsx — reaproveitado aqui porque
// é a fonte que já resolveu os mesmos obstáculos de montar esta tela
// (dropdown-menu e alert-dialog do Radix não funcionam sem PointerEvent no
// jsdom). Some ao padrão dele o ResizeObserver e o matchMedia: sem eles,
// `AdminKpiCarousel` (que usa `embla-carousel-react`) quebra ao montar,
// dentro do `LocalErrorBoundary` que envolve só o carrossel (~:595-602).
//
// Correção do cabeçalho anterior desta suíte: essa falha NÃO esconderia os
// botões de ação que este arquivo clica ("Excluir Produto", "Duplicar
// Produto", "Pausar Produto") — eles vivem em outro `LocalErrorBoundary`
// (:684), que não é afetado pela quebra do carrossel. Os dois dublês
// continuam aqui por higiene (evitar erro não relacionado no console
// durante o teste), não porque sem eles o teste passaria "verde por
// engano" — essa garantia nunca existiu.
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
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("AdminProductsView — achado 7: KPIs rebuscam depois de mexer no catálogo", () => {
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
  }

  async function excluir() {
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

  // Ativar/desativar não passa por `AlertDialog` — o item do menu chama
  // `onToggleStatus` direto no clique (`AdminProductsView.tsx:1433` no modo
  // detalhado, `:1713` no compacto). `produtoTeste.isActive` é `true`, e o
  // rótulo do item vira "Pausar Produto" (ver `:1437`/`:1717`).
  async function alternarStatus() {
    const botaoToggle = localizarBotaoPorTexto(hospedeiro, "Pausar Produto")!;
    expect(botaoToggle).toBeDefined();
    await act(async () => {
      botaoToggle.click();
      await esperarMicrotarefas();
    });
  }

  it("excluir um produto com sucesso rebusca o resumo executivo forçando o cache (true)", async () => {
    deleteProduct.mockResolvedValue(true);

    await montar();
    await excluir();

    expect(deleteProduct).toHaveBeenCalledWith("prod-1");
    expect(fetchExecutiveSummary).toHaveBeenCalledWith(true);
  });

  it("caso-limite: exclusão que FALHA não rebusca — nada mudou no catálogo para justificar", async () => {
    // `deleteProduct` real nunca lança: resolve `false` numa falha de
    // soft-delete e já avisou o erro ela mesma. Rebuscar aqui gastaria uma
    // chamada de rede sem necessidade nenhuma — o catálogo não mudou.
    deleteProduct.mockResolvedValue(false);

    await montar();
    await excluir();

    expect(deleteProduct).toHaveBeenCalledWith("prod-1");
    expect(fetchExecutiveSummary).not.toHaveBeenCalledWith(true);
  });

  it("duplicar um produto com sucesso também rebusca o resumo executivo forçando o cache (true)", async () => {
    await montar();
    await duplicar();

    expect(addProduct).toHaveBeenCalled();
    expect(fetchExecutiveSummary).toHaveBeenCalledWith(true);
  });

  it("ativar/desativar pelo card, com sucesso, rebusca o resumo executivo forçando o cache (true)", async () => {
    await montar();
    await alternarStatus();

    expect(toggleProductStatus).toHaveBeenCalledWith("prod-1", true);
    expect(fetchExecutiveSummary).toHaveBeenCalledWith(true);
  });

  it("caso-limite: toggle que FALHA não rebusca — a RPC filtra por `ativo`, e nada mudou nela", async () => {
    // `toggleProductStatus` real resolve falsy numa falha de
    // `updateProduct` (sem lançar) — rebuscar aqui gastaria uma chamada de
    // rede sem necessidade: o servidor não trocou o `ativo` do produto.
    toggleProductStatus.mockResolvedValue(false);

    await montar();
    await alternarStatus();

    expect(toggleProductStatus).toHaveBeenCalledWith("prod-1", true);
    expect(fetchExecutiveSummary).not.toHaveBeenCalledWith(true);
  });

  it("item 1: view volta a ficar ativa depois de sair (edição de produto) rebusca com true", async () => {
    // `AdminProductsView` nunca desmonta de verdade: `AdminArea.tsx` só
    // esconde por CSS ao abrir `admin-product-form`. Aqui isso é simulado
    // rerenderizando a MESMA `raiz` com `active=false` e depois
    // `active=true` de novo, sem passar por `unmount`/`createRoot` — se o
    // teste desmontasse, não provaria nada sobre o defeito real.
    await montar();
    expect(fetchExecutiveSummary).not.toHaveBeenCalledWith(true);

    await renderizar(false); // equivalente a abrir o formulário de edição
    await renderizar(true); // equivalente a voltar para "Produtos"

    await esperarAte(() =>
      fetchExecutiveSummary.mock.calls.some(([force]) => force === true),
    );
    expect(fetchExecutiveSummary).toHaveBeenCalledWith(true);
  });

  it("caso-limite: view já ativa e sem sair não rebusca sozinha — guarda contra RPC em laço", async () => {
    // Mesma condição de deps (`active`, `stats`, `fetchExecutiveSummary`)
    // se repetindo entre renders — se a correção do item 1 disparasse a
    // cada render em vez de só na transição false→true, isto pegaria.
    await montar();
    await renderizar(true);
    await renderizar(true);

    expect(fetchExecutiveSummary).not.toHaveBeenCalledWith(true);
  });
});
