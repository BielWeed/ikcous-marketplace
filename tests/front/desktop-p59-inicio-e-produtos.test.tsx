// @vitest-environment jsdom
//
// P59 (painel em computador) — dois defeitos medidos em navegador real:
//
// 1) Início do painel a 1024 px: a grade `lg:grid-cols-3` dava colunas de 227
//    px (janela 1024 - 256 do menu - 48 de folga = 720 px úteis). "R$ 1.280,50"
//    quebrava no meio do número e os atalhos viravam "Relatór/ios". A grade de
//    3 colunas passa a ser `xl:` (>= 1280 px, colunas de 312 px) e o valor
//    grande de "Hoje" ganha `xl:text-[2.25rem]` (a 1280 px o "R$ 1.234.567,89"
//    do clamp de 48 px passava 2 px da coluna).
// 2) Produtos, lista detalhada, 1280 px: "R$ 99.999,99" (célula de 92 px, texto
//    de 99) invadia a coluna do estoque e colava em "5 un.". `produto-resumo`
//    ganha `xl:grid-cols-[1.4fr_1fr_1fr]` (célula do preço a 113 px).
//
// A regra de ouro é que o CELULAR não muda: só entram classes `lg:`/`xl:`. O
// que cada elemento tem SEM prefixo fica congelado abaixo como LISTA LITERAL
// (escrita à mão — nunca lida do histórico do git, que no CI vem com 1 commit).
// O jsdom não mede layout (os números acima vêm do Chromium, ver o relatório da
// peça); aqui a prova é o className do componente REAL e mutantes em CÓPIA do
// className renderizado, para as travas não serem decorativas.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const h = vi.hoisted(() => ({
  respostas: new Map<string, { data: unknown; error: unknown }>(),
  rpc: vi.fn(),
  produtos: [] as any[],
  deleteProduct: vi.fn(),
  addProduct: vi.fn(),
  loadProducts: vi.fn(),
  toggleProductStatus: vi.fn(),
  fetchExecutiveSummary: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args?: unknown) => {
      h.rpc(nome, args);
      return Promise.resolve(
        h.respostas.get(nome) ?? { data: null, error: null },
      );
    },
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: () => {},
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: { user: { id: "adm-1" } },
    profile: { full_name: "Dono de Teste" },
    isAdmin: true,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja de Teste",
      storeCity: "Cidade Ficticia",
      storeState: "AM",
      logoUrl: "",
      originCep: "69000-000",
    },
    isLoaded: true,
    products: [{ isActive: true }],
    loadingProducts: false,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: h.produtos,
    loading: false,
    deleteProduct: h.deleteProduct,
    toggleProductStatus: h.toggleProductStatus,
    addProduct: h.addProduct,
    loadProducts: h.loadProducts,
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 300, totalValue: 690.5 } },
    fetchExecutiveSummary: h.fetchExecutiveSummary,
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const texto = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\s/g, " ");

const tokens = (className: string) => className.split(/\s+/).filter(Boolean);

async function esperarAte(condicao: () => boolean, timeoutMs = 3000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: não aconteceu em ${timeoutMs}ms — corpo: ${texto(document.body).slice(0, 400)}`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

// ---------------------------------------------------------------------------
// As regras, como funções puras sobre o className. Os testes as aplicam ao
// className REAL; os mutantes as aplicam a uma CÓPIA adulterada e têm de falhar.
// ---------------------------------------------------------------------------

// Lista literal do que o contêiner das três colunas do Início tem no celular.
const GRADE_DO_INICIO_NO_CELULAR = "space-y-6";
// Idem, cada uma das três colunas (nenhuma tem classe de computador).
const COLUNA_DO_INICIO_NO_CELULAR = "min-w-0 space-y-6";
// O valor grande de "Hoje" com receita positiva (tom que não é "neutro").
const VALOR_DE_HOJE_NO_CELULAR =
  "text-[clamp(1.875rem,9.5vw,3rem)] leading-none break-words font-bold tabular-nums tracking-tight [overflow-wrap:anywhere] text-white";
// O resumo do cartão detalhado de produto.
const RESUMO_DO_PRODUTO_NO_CELULAR =
  "produto-resumo mt-3 grid grid-cols-3 gap-2";

function violacoesDaGradeDoInicio(className: string): string[] {
  const t = tokens(className);
  const v: string[] = [];
  if (classesDoCelular(className) !== GRADE_DO_INICIO_NO_CELULAR)
    v.push("celular mudou");
  for (const esperado of [
    "xl:grid",
    "xl:grid-cols-3",
    "xl:items-start",
    "xl:gap-6",
    "xl:space-y-0",
  ]) {
    if (!t.includes(esperado)) v.push(`falta ${esperado}`);
  }
  // Nada de grade em `lg:` (1024-1279): é onde a coluna ficava com 227 px. O
  // `space-y-0` também sai de `lg:`, senão as três pilhas se colam em 1024.
  const deLg = t.filter((c) => c.startsWith("lg:"));
  if (deLg.length > 0) v.push(`sobrou ${deLg.join(",")}`);
  return v;
}

function violacoesDoValorDeHoje(className: string): string[] {
  const v: string[] = [];
  if (classesDoCelular(className) !== VALOR_DE_HOJE_NO_CELULAR)
    v.push("celular mudou");
  if (!tokens(className).includes("xl:text-[2.25rem]"))
    v.push("falta xl:text-[2.25rem]");
  return v;
}

function violacoesDoResumoDoProduto(className: string): string[] {
  const t = tokens(className);
  const v: string[] = [];
  if (classesDoCelular(className) !== RESUMO_DO_PRODUTO_NO_CELULAR)
    v.push("celular mudou");
  if (!t.includes("xl:grid-cols-[1.4fr_1fr_1fr]"))
    v.push("falta xl:grid-cols-[1.4fr_1fr_1fr]");
  // Uma única grade em cada faixa: `lg:` não pode redefinir as colunas.
  if (t.some((c) => c.startsWith("lg:grid-cols")))
    v.push("sobrou lg:grid-cols");
  return v;
}

// ---------------------------------------------------------------------------
// 1) Início
// ---------------------------------------------------------------------------

const PAINEL = {
  hoje: {
    receita: 1234567.89,
    online: 1000000,
    presencial: 234567.89,
    pedidos: 4,
    receita_semana_passada: 280,
  },
  mes: {
    receita: 12345.67,
    receita_mes_anterior: 10000,
    pedidos: 80,
    ticket_medio: 154.32,
    lucro_estimado: 4321.09,
  },
  saldo_total: 8765.43,
  a_receber_7d: 1200.5,
  a_pagar_7d: 300,
  contas_vencidas: 2,
  pendencias: {
    pedidos_para_preparar: 5,
    devolucoes_abertas: 1,
    caixa_aberto: false,
    estoque_baixo: 3,
  },
  serie_14d: [{ dia: "2026-09-26", receita: 350 }],
};

describe("P59 Início do painel: três colunas só de 1280 px em diante", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.resetModules();
    h.respostas.clear();
    h.rpc.mockClear();
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
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
  });

  async function montarInicio() {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(<AdminDashboardView active={true} onNavigate={vi.fn()} />);
    });
    await esperarAte(() => texto(hospedeiro).includes("R$ 1.234.567,89"));
  }

  // Sobe do "Hoje" (componente real) até a coluna e até a grade das colunas:
  // nenhum elemento é fabricado aqui.
  function elementosDoInicio() {
    const secao = hospedeiro.querySelector(
      '[aria-labelledby="inicio-hoje-titulo"]',
    ) as HTMLElement;
    const coluna = secao.parentElement as HTMLElement;
    const grade = coluna.parentElement as HTMLElement;
    const valor = [...secao.querySelectorAll("p")].find((p) =>
      texto(p).includes("R$ 1.234.567,89"),
    ) as HTMLElement;
    return { secao, coluna, grade, valor };
  }

  it("a grade das três colunas é `xl:` e não existe mais `lg:grid-cols-3`", async () => {
    await montarInicio();
    const { grade } = elementosDoInicio();
    const classes = tokens(grade.className);
    expect(classes).toContain("xl:grid-cols-3");
    expect(classes).not.toContain("lg:grid-cols-3");
    expect(classes.some((c) => c.startsWith("lg:"))).toBe(false);
    expect(violacoesDaGradeDoInicio(grade.className)).toEqual([]);
  });

  it("o celular da grade e das três colunas continua byte a byte (lista literal)", async () => {
    await montarInicio();
    const { grade, coluna } = elementosDoInicio();
    expect(classesDoCelular(grade.className)).toBe(GRADE_DO_INICIO_NO_CELULAR);
    expect(grade.children).toHaveLength(3);
    for (const filha of Array.from(grade.children)) {
      // As colunas não têm classe de computador: nada nelas depende da grade.
      expect(filha.className).toBe(COLUNA_DO_INICIO_NO_CELULAR);
    }
    expect(grade.children[0]).toBe(coluna);
  });

  it("o valor grande de Hoje ganha `xl:text-[2.25rem]` e o resto fica igual", async () => {
    await montarInicio();
    const { valor } = elementosDoInicio();
    expect(violacoesDoValorDeHoje(valor.className)).toEqual([]);
    expect(classesDoCelular(valor.className)).toBe(VALOR_DE_HOJE_NO_CELULAR);
  });

  it("controle: mutantes em cópia do className reprovam as regras", async () => {
    await montarInicio();
    const { grade, valor } = elementosDoInicio();
    // Mutante 1: volta a grade para `lg:` (a regra de antes do conserto).
    const gradeEmLg = grade.className.replace(/\bxl:/g, "lg:");
    expect(violacoesDaGradeDoInicio(gradeEmLg).length).toBeGreaterThan(0);
    // Mutante 2: troca só `grid-cols-3` para `lg:`, mantendo o resto em `xl:`.
    const soColunasEmLg = grade.className.replace(
      "xl:grid-cols-3",
      "lg:grid-cols-3",
    );
    expect(violacoesDaGradeDoInicio(soColunasEmLg)).toContain(
      "falta xl:grid-cols-3",
    );
    // Mutante 3: esquece de mover o `space-y-0` (as pilhas se colariam em 1024).
    const espacoEmLg = grade.className.replace("xl:space-y-0", "lg:space-y-0");
    expect(violacoesDaGradeDoInicio(espacoEmLg).length).toBeGreaterThan(0);
    // Mutante 4: mexe no celular (tira o `space-y-6`).
    const semEspaco = grade.className.replace("space-y-6", "");
    expect(violacoesDaGradeDoInicio(semEspaco)).toContain("celular mudou");
    // Mutante 5: sem o tamanho menor do valor.
    const semTamanho = valor.className.replace("xl:text-[2.25rem]", "");
    expect(violacoesDoValorDeHoje(semTamanho)).toContain(
      "falta xl:text-[2.25rem]",
    );
    // Mutante 6: o tamanho entra editado DENTRO do literal do celular.
    const editadoNoCelular = valor.className.replace(
      "text-[clamp(1.875rem,9.5vw,3rem)]",
      "text-[2.25rem]",
    );
    expect(violacoesDoValorDeHoje(editadoNoCelular)).toContain("celular mudou");
  });
});

// ---------------------------------------------------------------------------
// 2) Produtos, lista detalhada
// ---------------------------------------------------------------------------

describe("P59 Produtos detalhado: preço de cinco dígitos cabe na célula em 1280 px", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    h.loadProducts.mockImplementation(async () => ({
      products: h.produtos,
      total: 1,
    }));
    h.fetchExecutiveSummary.mockResolvedValue(null);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
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
    const armazem = new Map<string, string>([
      ["admin_products_view_mode", "detailed"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montarProdutoComPreco(price: number) {
    h.produtos = [
      {
        id: "prod-1",
        name: "Conjunto de joias",
        category: "Joias",
        images: [],
        isActive: true,
        stock: 5,
        price,
        costPrice: 10,
        estoqueMinimo: null,
      },
    ];
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(
      () => hospedeiro.querySelector(".produto-resumo") !== null,
    );
  }

  it("`produto-resumo` ganha a grade `xl:grid-cols-[1.4fr_1fr_1fr]` e o celular segue igual", async () => {
    await montarProdutoComPreco(99999.99);
    const resumos = hospedeiro.querySelectorAll(".produto-resumo");
    expect(resumos).toHaveLength(1);
    const resumo = resumos[0] as HTMLElement;
    expect(texto(resumo)).toContain("R$ 99.999,99");
    expect(violacoesDoResumoDoProduto(resumo.className)).toEqual([]);
    expect(classesDoCelular(resumo.className)).toBe(
      RESUMO_DO_PRODUTO_NO_CELULAR,
    );
    // Só UMA classe de colunas sem prefixo: a do celular (`grid-cols-3`).
    const semPrefixo = tokens(classesDoCelular(resumo.className)).filter((c) =>
      c.startsWith("grid-cols"),
    );
    expect(semPrefixo).toEqual(["grid-cols-3"]);
  });

  it("o preço (célula 1) e o estoque (célula 2) seguem no mesmo resumo", async () => {
    await montarProdutoComPreco(99999.99);
    const resumo = hospedeiro.querySelector(".produto-resumo") as HTMLElement;
    const celulas = Array.from(resumo.children);
    expect(texto(celulas[0])).toContain("Preço de Venda");
    expect(texto(celulas[0])).toContain("R$ 99.999,99");
    expect(texto(celulas[1])).toContain("Estoque");
    // A letra do preço não mudou (cinco dígitos ainda é o caminho `nowrap`).
    const preco = celulas[0].querySelector("p.font-bold") as HTMLElement;
    expect(preco.className).toContain("whitespace-nowrap");
  });

  it("controle: mutantes em cópia do className reprovam a regra", async () => {
    await montarProdutoComPreco(99999.99);
    const resumo = hospedeiro.querySelector(".produto-resumo") as HTMLElement;
    const original = resumo.className;
    // Mutante 1: sem o token novo.
    expect(
      violacoesDoResumoDoProduto(
        original.replace("xl:grid-cols-[1.4fr_1fr_1fr]", ""),
      ),
    ).toContain("falta xl:grid-cols-[1.4fr_1fr_1fr]");
    // Mutante 2: o token entra em `lg:` (mudaria 1024-1279, onde já cabia).
    expect(
      violacoesDoResumoDoProduto(
        original.replace("xl:grid-cols", "lg:grid-cols"),
      ).length,
    ).toBeGreaterThan(0);
    // Mutante 3: o celular troca de grade (`grid-cols-3` vira `grid-cols-2`).
    expect(
      violacoesDoResumoDoProduto(
        original.replace("grid-cols-3", "grid-cols-2"),
      ),
    ).toContain("celular mudou");
    // Mutante 4: a coluna nova entra no literal do celular, sem prefixo.
    expect(
      violacoesDoResumoDoProduto(
        original.replace("grid-cols-3", "grid-cols-[1.4fr_1fr_1fr]"),
      ),
    ).toContain("celular mudou");
  });
});
