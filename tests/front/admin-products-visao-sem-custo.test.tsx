// @vitest-environment jsdom
//
// Tela Produtos: o selo "N produtos sem custo · lucro parcial" só AVISAVA. O
// lojista não conseguia saber QUAL produto estava sem custo. Agora, quando há
// produto sem custo e a conferência terminou, o selo é um BOTÃO: tocar nele
// abre a visão "Sem custo" da lista (só esses produtos, completos, mesma regra
// do número do selo), com uma faixa "Mostrando só produtos sem custo · N" e o
// botão "Ver todos" para voltar. Tocar num produto segue o fluxo normal de
// editar. Custo 0 (brinde de propósito) NÃO é sem custo e não entra.
//
// Monta `AdminProductsView` de verdade (createRoot + act); só os hooks de
// dados são dublados. A lista "Sem custo" do dublê usa a MESMA regra do selo
// (`produtoSemCustoEmEstoque`) sobre o mesmo catálogo que gera o número do
// selo, então "N do selo == tamanho da lista" é testado de ponta a ponta.
import { MetricasDoPainel } from "@/components/admin/MetricasDoPainel";
import { avisarProdutoNovoCadastrado } from "@/utils/produto-recem-cadastrado";
import { produtoSemCustoEmEstoque } from "@/utils/produtos-sem-custo";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Fixture = {
  id: string;
  name: string;
  isActive: boolean;
  stock: number;
  price: number;
  costPrice?: number;
  category: string;
  images: string[];
  variants: never[];
};

const h = vi.hoisted(() => ({
  catalogo: [] as any[],
  pagina: [] as any[],
  loadProducts: vi.fn(),
  loadProductsSemCusto: vi.fn(),
  fetchExecutiveSummary: vi.fn(),
  offline: false,
  stats: null as any,
}));
const onNavigate = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: h.pagina,
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts: h.loadProducts,
    loadProductsSemCusto: h.loadProductsSemCusto,
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: h.stats,
    fetchExecutiveSummary: h.fetchExecutiveSummary,
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.offline,
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

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = (id: string, extra: Partial<Fixture> = {}): Fixture => ({
  id,
  name: `Produto ${id}`,
  isActive: true,
  stock: 3,
  price: 20,
  category: "Geral",
  images: [],
  variants: [],
  ...extra,
});

/** Catálogo da prova: 3 SEM custo de verdade (a, b, c); o resto não conta. */
const CATALOGO: Fixture[] = [
  produto("a"), // sem custo, com estoque
  produto("b"), // sem custo, com estoque
  produto("c"), // sem custo, com estoque
  produto("brinde", { costPrice: 0 }), // custo zero de propósito: NÃO é sem custo
  produto("pago", { costPrice: 8 }), // com custo
  produto("esgotado", { stock: 0 }), // sem custo mas sem estoque: fora do selo
  produto("pausado", { isActive: false }), // sem custo mas pausado: fora do selo
];

function estatisticas(catalogo: Fixture[]) {
  const semCusto = catalogo.filter(produtoSemCustoEmEstoque).length;
  const comCusto = catalogo.filter(
    (p) => p.isActive && p.costPrice != null && p.stock > 0,
  ).length;
  return {
    inventory: {
      totalCost: 8 * 3,
      totalValue: 60,
      totalRevenue: 60 + 20 * 3 * semCusto,
      revenueWithoutCost: 20 * 3 * semCusto,
      productsWithoutCost: semCusto,
      productsWithCost: comCusto,
    },
  };
}

const esperar = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe("Produtos: tocar no selo 'sem custo' leva aos produtos sem custo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let rolar: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("admin_products_view_mode", "detailed");
    h.offline = false;
    h.catalogo = CATALOGO;
    h.pagina = [CATALOGO[3], CATALOGO[4]];
    h.stats = estatisticas(CATALOGO);
    h.loadProducts.mockResolvedValue({ products: h.pagina, total: 2 });
    h.loadProductsSemCusto.mockImplementation(async () => {
      const lista = h.catalogo.filter(produtoSemCustoEmEstoque);
      return { products: lista, total: lista.length };
    });
    h.fetchExecutiveSummary.mockResolvedValue(null);
    rolar = vi.fn();
    Element.prototype.scrollIntoView =
      rolar as unknown as typeof Element.prototype.scrollIntoView;
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // A tela nunca desmonta no app (só some por CSS): reabrir é re-renderizar a
  // MESMA instância com `active` mudando.
  let Tela: typeof import("@/views/admin/AdminProductsView").AdminProductsView;
  async function renderizar(active: boolean, visaoInicial?: string | null) {
    await act(async () => {
      raiz.render(
        <Tela
          onNavigate={onNavigate}
          active={active}
          visaoInicial={visaoInicial}
        />,
      );
    });
  }
  async function montar(active = true) {
    Tela = (await import("@/views/admin/AdminProductsView")).AdminProductsView;
    await renderizar(active);
    await esperar(360);
  }
  async function reabrir() {
    await renderizar(false);
    await renderizar(true);
    await esperar(360);
  }

  const botaoDoSelo = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label$="sem custo"], button[aria-label$="sem custo, ver"]',
    );
  const botaoVerTodos = () =>
    [...hospedeiro.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === "Ver todos",
    );
  const nomesNaLista = () =>
    [...hospedeiro.querySelectorAll("[data-produto-nome]")].map((el) =>
      el.textContent?.trim(),
    );
  const faixa = () => hospedeiro.querySelector("[data-visao-sem-custo]");

  it("vindo do Relatórios ('Cadastrar custo'), a lista já abre na visão 'Sem custo'", async () => {
    Tela = (await import("@/views/admin/AdminProductsView")).AdminProductsView;
    await renderizar(true, "sem-custo");
    await esperar(360);
    expect(faixa()).not.toBeNull();
    expect(nomesNaLista()).toEqual(["Produto a", "Produto b", "Produto c"]);
    // 'Ver todos' devolve a lista normal e o pedido não a reabre sozinho.
    await act(async () => botaoVerTodos()!.click());
    await esperar(360);
    expect(faixa()).toBeNull();
    expect(nomesNaLista()).toEqual(["Produto brinde", "Produto pago"]);
  });

  it("a visão 'Sem custo' pedida de fora espera a tela ficar ativa, e um valor qualquer não abre nada", async () => {
    Tela = (await import("@/views/admin/AdminProductsView")).AdminProductsView;
    await renderizar(false, "sem-custo");
    await esperar(360);
    expect(faixa()).toBeNull();
    await renderizar(true, "sem-custo");
    await esperar(360);
    expect(faixa()).not.toBeNull();
    await act(async () => botaoVerTodos()!.click());
    await esperar(360);
    await renderizar(true, "outra-coisa");
    await esperar(360);
    expect(faixa()).toBeNull();
  });

  it("com produtos sem custo e conferência feita, o selo é um botão que diz quantos são", async () => {
    await montar();
    const botao = botaoDoSelo();
    expect(botao).not.toBeNull();
    expect(botao?.getAttribute("aria-label")).toBe(
      "Ver os 3 produtos sem custo",
    );
    expect(botao?.textContent).toContain("3 produtos sem custo");
    expect(botao?.textContent).toContain("lucro parcial");
    expect(botao?.type).toBe("button");
    // Foco visível e área de toque estendida (a faixa do selo tem 28 px).
    expect(botao?.className).toMatch(/focus-visible:ring-2/);
    expect(botao?.className).toMatch(/after:inset-y-\[-11px\]/);
    // Ainda é a lista normal.
    expect(faixa()).toBeNull();
    expect(h.loadProductsSemCusto).not.toHaveBeenCalled();
  });

  it("com UM produto sem custo, o nome acessível fica no singular", async () => {
    h.catalogo = [CATALOGO[0], CATALOGO[4]];
    h.stats = estatisticas(h.catalogo);
    await montar();
    // O nome acessível CONTÉM o texto visível ("1 produto sem custo"), para
    // quem comanda o celular por voz.
    const botao = botaoDoSelo();
    expect(botao?.getAttribute("aria-label")).toBe("1 produto sem custo, ver");
    expect(botao?.textContent).toContain("1 produto sem custo");
    expect(botao?.getAttribute("aria-label")).toContain("1 produto sem custo");
  });

  it("sem produto sem custo (N = 0) não há botão: o aviso verde continua igual", async () => {
    h.catalogo = [CATALOGO[3], CATALOGO[4]];
    h.stats = estatisticas(h.catalogo);
    await montar();
    expect(botaoDoSelo()).toBeNull();
    expect(hospedeiro.textContent).toContain(
      "Todos os produtos em estoque têm custo cadastrado.",
    );
  });

  it("enquanto confere os custos ('Conferindo custos…') não é botão", async () => {
    h.stats = { inventory: { totalCost: 1, totalValue: 1 } };
    await montar();
    expect(hospedeiro.textContent).toContain("Conferindo custos…");
    expect(botaoDoSelo()).toBeNull();
    expect(
      hospedeiro.querySelector('[class*="metricas-painel-nota"] button'),
    ).toBeNull();
  });

  it("tocar no selo mostra SÓ os produtos sem custo, e a quantidade bate com o selo", async () => {
    await montar();
    expect(nomesNaLista()).toEqual(["Produto brinde", "Produto pago"]);
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    // Os 3 do selo, na ordem do servidor; o brinde (custo 0), o com custo, o
    // esgotado e o pausado ficam de fora.
    expect(nomesNaLista()).toEqual(["Produto a", "Produto b", "Produto c"]);
    expect(nomesNaLista().length).toBe(h.stats.inventory.productsWithoutCost);
    expect(nomesNaLista()).not.toContain("Produto brinde");
    expect(h.loadProductsSemCusto).toHaveBeenCalledTimes(1);
  });

  it("a faixa anuncia a quantidade (role=status) e oferece 'Ver todos'", async () => {
    await montar();
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    const f = faixa();
    expect(f).not.toBeNull();
    const aviso = f!.querySelector('[role="status"]');
    expect(aviso?.textContent).toBe("Mostrando só produtos sem custo · 3");
    const ver = botaoVerTodos();
    expect(ver).toBeDefined();
    expect(ver!.className).toContain("min-h-11");
  });

  it("rola a tela até a lista ao tocar no selo", async () => {
    await montar();
    const antes = rolar.mock.calls.length;
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    expect(rolar.mock.calls.length - antes).toBe(1);
    // Rola até a faixa da visão, onde a lista começa.
    expect(rolar.mock.contexts.at(-1)).toBe(faixa());
  });

  it("'Ver todos' devolve a lista normal e tira a faixa", async () => {
    await montar();
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    await act(async () => botaoVerTodos()!.click());
    await esperar(360);
    expect(faixa()).toBeNull();
    expect(botaoVerTodos()).toBeUndefined();
    expect(nomesNaLista()).toEqual(["Produto brinde", "Produto pago"]);
    // O selo continua lá, pronto para ser tocado de novo.
    expect(botaoDoSelo()).not.toBeNull();
  });

  it("abrir a visão limpa busca e categoria; 'Ver todos' devolve os filtros que ela tinha", async () => {
    localStorage.setItem(
      "admin_products_search_term",
      JSON.stringify("caneca"),
    );
    localStorage.setItem(
      "admin_products_filter_category",
      JSON.stringify("Casa"),
    );
    await montar();
    expect(h.loadProducts).toHaveBeenLastCalledWith(0, 12, {
      search: "caneca",
      category: "Casa",
    });
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    // O que o lojista procura agora são os sem custo do catálogo inteiro.
    expect(h.loadProductsSemCusto).toHaveBeenLastCalledWith({
      search: undefined,
      category: undefined,
    });
    await act(async () => botaoVerTodos()!.click());
    await esperar(360);
    expect(h.loadProducts).toHaveBeenLastCalledWith(0, 12, {
      search: "caneca",
      category: "Casa",
    });
  });

  it("tocar num produto da lista segue o fluxo normal de editar", async () => {
    await montar();
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    const editar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Editar Produto b"]',
    );
    expect(editar).not.toBeNull();
    await act(async () => editar!.click());
    expect(onNavigate).toHaveBeenCalledWith("admin-product-form", "b");
  });

  it("depois de cadastrar o custo (voltar da edição), o produto some da lista e do selo", async () => {
    await montar();
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    // O lojista cadastra o custo de "b" e a tela é reaberta.
    h.catalogo = CATALOGO.map((p) =>
      p.id === "b" ? { ...p, costPrice: 5 } : p,
    );
    h.stats = estatisticas(h.catalogo);
    await reabrir();
    expect(nomesNaLista()).toEqual(["Produto a", "Produto c"]);
    expect(botaoDoSelo()?.getAttribute("aria-label")).toBe(
      "Ver os 2 produtos sem custo",
    );
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Mostrando só produtos sem custo · 2",
    );
  });

  it("se o último sem custo ganhou custo, a visão diz que não sobrou nenhum e oferece 'Ver todos'", async () => {
    await montar();
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    h.catalogo = CATALOGO.map((p) => ({ ...p, costPrice: p.costPrice ?? 1 }));
    h.stats = estatisticas(h.catalogo);
    await reabrir();
    expect(botaoDoSelo()).toBeNull();
    expect(hospedeiro.textContent).toContain("Nenhum produto sem custo");
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Mostrando só produtos sem custo · 0",
    );
    await act(async () => botaoVerTodos()!.click());
    await esperar(360);
    expect(faixa()).toBeNull();
    expect(nomesNaLista()).toEqual(["Produto brinde", "Produto pago"]);
  });

  it("falha ao buscar mostra o erro com saída, não uma lista vazia que parece 'tudo certo'", async () => {
    h.loadProductsSemCusto.mockResolvedValue(null);
    await montar();
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Erro ao Carregar Produtos",
    );
    expect(hospedeiro.textContent).not.toContain("Nenhum produto sem custo");
    expect(botaoVerTodos()).toBeDefined();
  });

  it("com mais de 12 sem custo a lista pagina (12 por página) sem perder nenhum", async () => {
    const muitos = Array.from({ length: 14 }, (_, i) =>
      produto(`m${String(i).padStart(2, "0")}`),
    );
    h.catalogo = muitos;
    h.stats = estatisticas(muitos);
    await montar();
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    expect(nomesNaLista()).toHaveLength(12);
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Mostrando só produtos sem custo · 14",
    );
    const proximo = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent?.includes("Próximo") && !b.disabled);
    expect(proximo).toBeDefined();
    await act(async () => proximo!.click());
    expect(nomesNaLista()).toEqual(["Produto m12", "Produto m13"]);
    // Só uma consulta ao servidor: trocar de página é recorte local.
    expect(h.loadProductsSemCusto).toHaveBeenCalledTimes(1);
  });

  it("cadastrar um produto novo tira da visão: o novo tem de aparecer na lista normal", async () => {
    await montar();
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    expect(faixa()).not.toBeNull();
    await renderizar(false);
    avisarProdutoNovoCadastrado();
    await renderizar(true);
    await esperar(360);
    expect(faixa()).toBeNull();
    expect(nomesNaLista()).toEqual(["Produto brinde", "Produto pago"]);
  });

  it("sem internet o selo não abre a visão (o botão fica desativado)", async () => {
    h.offline = true;
    await montar();
    const botao = botaoDoSelo();
    expect(botao?.disabled).toBe(true);
  });

  it("sem internet, o aviso 'Sem conexão ·' sai da faixa de 28 px (só leitor de tela) para o selo caber sem quebrar linha", async () => {
    h.offline = true;
    await montar();
    const nota = hospedeiro.querySelector(".metricas-painel-nota")!;
    const visiveis = [...nota.querySelectorAll("span")].filter(
      (el) =>
        el.children.length === 0 &&
        el.textContent?.includes("Sem conexão") &&
        !el.classList.contains("sr-only"),
    );
    expect(visiveis).toHaveLength(0);
    expect(nota.textContent).toContain("Sem conexão ·");
    // A faixa não quebra linha e só corta na horizontal.
    expect(nota.className).toMatch(/whitespace-nowrap/);
    expect(nota.className).toMatch(/overflow-x-clip/);
    expect(nota.className).not.toMatch(/overflow-hidden|truncate/);
  });

  it("'Ver todos' com a varredura ainda em andamento: a resposta que chega depois é descartada", async () => {
    let terminar!: (valor: unknown) => void;
    h.loadProductsSemCusto.mockImplementation(
      () =>
        new Promise((resolve) => {
          terminar = resolve;
        }),
    );
    await montar();
    await act(async () => botaoDoSelo()!.click());
    await esperar(360); // a varredura começou e não terminou
    expect(h.loadProductsSemCusto).toHaveBeenCalledTimes(1);
    await act(async () => botaoVerTodos()!.click());
    // Antes de a recarga normal (320 ms) rodar, a varredura velha falha.
    await act(async () => {
      terminar(null);
    });
    expect(faixa()).toBeNull();
    // O erro dela não vaza para a lista normal.
    expect(hospedeiro.textContent).not.toContain("Não sincronizou");
    await esperar(360);
    expect(nomesNaLista()).toEqual(["Produto brinde", "Produto pago"]);
    expect(hospedeiro.textContent).not.toContain("Não sincronizou");
  });

  it("varredura que termina com sucesso depois de 'Ver todos' não traz a lista sem custo de volta", async () => {
    let terminar!: (valor: unknown) => void;
    h.loadProductsSemCusto.mockImplementation(
      () =>
        new Promise((resolve) => {
          terminar = resolve;
        }),
    );
    await montar();
    await act(async () => botaoDoSelo()!.click());
    await esperar(360);
    await act(async () => botaoVerTodos()!.click());
    await act(async () => {
      terminar({ products: [CATALOGO[0]], total: 1 });
    });
    await esperar(360);
    expect(faixa()).toBeNull();
    expect(nomesNaLista()).toEqual(["Produto brinde", "Produto pago"]);
    // Abrir de novo começa do zero: não mostra a lista velha enquanto busca.
    h.loadProductsSemCusto.mockImplementation(() => new Promise(() => {}));
    await act(async () => botaoDoSelo()!.click());
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Procurando os produtos sem custo…",
    );
  });

  it("busca da lista normal em andamento ao abrir a visão não deixa o erro dela na visão", async () => {
    await montar();
    // A recarga normal falha, mas só chega DEPOIS de o lojista abrir a visão.
    let falhar!: (valor: unknown) => void;
    h.loadProducts.mockImplementation(
      () =>
        new Promise((resolve) => {
          falhar = resolve;
        }),
    );
    await renderizar(false);
    await renderizar(true);
    await esperar(360); // recarga normal em andamento
    await act(async () => botaoDoSelo()!.click());
    await act(async () => {
      falhar(null);
    });
    // Logo depois da falha velha, a visão segue "procurando" (sem erro nem
    // lista vazia falsa) até a varredura dela terminar.
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(faixa()?.querySelector('[role="status"]')?.textContent).toBe(
      "Procurando os produtos sem custo…",
    );
    await esperar(360);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(nomesNaLista()).toEqual(["Produto a", "Produto b", "Produto c"]);
  });
});

describe("MetricasDoPainel: nota acionável não é cortada", () => {
  it("a nota com botão deixa a área de toque passar da faixa de 28 px (sem 'truncate')", async () => {
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));
    const caixa = document.createElement("div");
    document.body.appendChild(caixa);
    const r = createRoot(caixa);
    const cards = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `m${n}`,
      label: `Métrica ${n}`,
      value: `${n}`,
      icon: () => null,
      accent: "",
      subValue: "",
    }));
    await act(async () =>
      r.render(
        <MetricasDoPainel
          titulo="Produtos"
          cards={cards as any}
          legendasDoResumo={[]}
          nota={<button type="button">tocar</button>}
          notaAcionavel
        />,
      ),
    );
    const nota = caixa.querySelector(".metricas-painel-nota")!;
    expect(nota.className).toContain("h-7");
    // Não quebra linha (não invade os cartões) e só corta na horizontal: o
    // `truncate`/`overflow-hidden` cortariam também a área de toque estendida.
    expect(nota.className).toMatch(/whitespace-nowrap/);
    expect(nota.className).toMatch(/overflow-x-clip/);
    expect(nota.className).not.toMatch(/truncate|overflow-hidden/);
    act(() => r.unmount());
    caixa.remove();
    vi.unstubAllGlobals();
  });
});
