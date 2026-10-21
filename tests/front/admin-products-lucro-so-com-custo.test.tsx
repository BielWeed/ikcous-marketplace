// @vitest-environment jsdom
//
// Onda I do painel simples (I6): "Lucro se vender tudo" é `totalValue -
// totalCost` de `get_admin_analytics_v2`. Até a 20261214000000 o valor de
// venda contava TODO produto e o custo só os que têm custo — a venda inteira
// de quem não tem custo virava lucro. O banco passou a somar o valor só de
// produto COM custo; a tela tem de dizer isso: o cartão "Dinheiro parado em
// estoque" diz "Pelo custo" (não "Capital Líquido"), o "Lucro se vender tudo"
// diz "Só com custo" (não "Margem Bruta") — rótulos curtos, que cabem no
// celular de 360 px — e a ajuda dos dois, em língua de lojista, diz que a
// conta só considera produto com custo cadastrado (sem "todas as unidades",
// que contradizia a conta, nem "capital líquido imobilizado").
//
// Monta `AdminProductsView` de verdade (createRoot + act do React puro),
// mesmo molde de admin-products-margem-sem-custo.test.tsx. O rótulo só é
// verdade se o SQL VIVO filtra — o último bloco lê a migration viva de
// get_admin_analytics_v2 e confere o FILTER.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadProducts = vi.fn();
const fetchExecutiveSummary = vi.fn();
const onNavigate = vi.fn();

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

// Semente da prova viva (tests/banco/inventario-so-com-custo-viva.cjs): custo
// 30, valor de venda só dos produtos com custo 90 — o lucro é 60.
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: {
      inventory: {
        totalCost: 30,
        totalValue: 90,
        totalRevenue: 90,
        revenueWithoutCost: 0,
        productsWithoutCost: 0,
        productsWithCost: 1,
      },
    },
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

// jsdom não implementa IntersectionObserver nem ResizeObserver (LazyImage e
// o carrossel de KPIs criam um a cada montagem).
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// admin-products-margem-sem-custo.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVISO_SO_COM_CUSTO =
  "A conta só considera produtos com custo cadastrado.";

/** Os elementos sem filho cujo texto é exatamente `texto`. */
function folhasComTexto(raiz: ParentNode, texto: string): Element[] {
  return [...raiz.querySelectorAll("*")].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === texto,
  );
}

describe("Produtos: o lucro do estoque diz que só conta produto com custo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    loadProducts.mockResolvedValue({ products: [], total: 0 });
    fetchExecutiveSummary.mockResolvedValue(null);
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("os cartões separam custo conhecido, lucro bruto e líquido não calculado", async () => {
    await montar();
    const tela = hospedeiro.textContent ?? "";
    expect(tela).toContain("Custo conhecido em estoque");
    expect(tela).toContain("Lucro bruto potencial");
    expect(tela).toContain("Lucro líquido potencial");
    expect(tela).toContain("Não calculado");
    expect(
      folhasComTexto(
        hospedeiro,
        "Quanto custaram os produtos com custo cadastrado",
      ),
    ).toHaveLength(1);
    expect(
      folhasComTexto(
        hospedeiro,
        "Receita com custo cadastrado menos custo · antes das despesas",
      ),
    ).toHaveLength(1);
    expect(tela).not.toContain("Pelo custo cadastrado");
    expect(tela).not.toContain("Só produtos com custo");
    expect(tela).not.toContain("Capital Líquido");
    expect(tela).not.toContain("Margem Bruta");
  });

  it("o número do lucro é valor menos custo (R$ 90 - R$ 30 = R$ 60,00)", async () => {
    await montar();
    const tela = hospedeiro.textContent ?? "";
    expect(tela).toContain("R$ 30,00");
    expect(tela).toContain("R$ 60,00");
  });

  it("a ajuda dos dois cartões fala a língua da loja e diz que a conta só considera produto com custo", async () => {
    await montar();
    // A ajuda (dicionário) só monta com o guia aberto — o botão do cabeçalho.
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Guia e simulador"]',
    );
    expect(botao).toBeTruthy();
    await act(async () => {
      botao?.click();
    });
    // O modal pode ir por portal para o body: mede a página inteira.
    const pagina = document.body.textContent ?? "";
    expect(pagina).toContain("Indicadores Financeiros Globais");
    expect(pagina.split(AVISO_SO_COM_CUSTO).length - 1).toBe(2);
    expect(pagina).toContain(
      "o dinheiro que está parado no estoque, pelo preço de custo",
    );
    // Jargão e a contradição com a conta (que deixa de fora quem não tem custo).
    expect(pagina).not.toContain("capital líquido imobilizado");
    expect(pagina).not.toContain("todas as unidades");
    expect(pagina).toContain("Lucro líquido potencial");
    expect(pagina).not.toContain("Produtos sem custo cadastrado ficam de fora");
  });
});

describe("o rótulo é verdade no banco: o get_admin_analytics_v2 VIVO só soma valor de produto com custo", () => {
  const TODAS_AS_MIGRATIONS = import.meta.glob<string>(
    "/supabase/migrations/*.sql",
    { query: "?raw", import: "default", eager: true },
  );
  // A de maior carimbo (14 dígitos) que redefine a função, fora rollback.
  const VIVA = Object.entries(TODAS_AS_MIGRATIONS)
    .filter(([caminho]) => !caminho.includes("/rollback-manual-"))
    .filter(([caminho]) => /\/\d{14}_[^/]+\.sql$/.test(caminho))
    .filter(([, sql]) =>
      /CREATE OR REPLACE FUNCTION\s+public\.get_admin_analytics_v2\(/.test(sql),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .at(-1);

  it("a viva é a 20261251000000 e a receita com preço efetivo continua filtrada por custo conhecido", () => {
    expect(VIVA?.[0]).toContain("20261251000000");
    const sql = VIVA?.[1] ?? "";
    // a 20261242 só troca de ONDE vem o custo do LUCRO e do ranking (o do dia da venda, senão o de hoje); o estoque
    // segue com o custo de hoje, como a 20261214 deixou.
    expect(sql).toContain(
      "FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit",
    );
    expect(sql).toContain(
      "COALESCE(SUM(faturamento) FILTER (WHERE custo IS NOT NULL), 0)",
    );
    // A soma sem filtro e APENAS o faturamento novo; totalValue segue protegido.
    expect(sql).toContain("COALESCE(SUM(faturamento), 0)");
    expect(sql).toContain("FILTER (WHERE custo IS NULL)");
    expect(sql).toContain("'revenueWithoutCost'");
    expect(sql).toContain("'productsWithoutCost'");
    expect(sql).toContain("'productsWithCost'");
    expect(sql).toContain("'totalRevenue', inv_revenue_total");
  });
});
