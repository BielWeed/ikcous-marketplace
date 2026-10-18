// @vitest-environment jsdom
//
// PAINEL SIMPLES, onda J, frente J3 ("produtos-no-celular"), tela de LISTA.
// Render num celular simulado (360px) mostrou: o cartão "ROI do Portfólio"
// com "130.15%" (jargão e ponto decimal em inglês), o estoque "02" com zero à
// esquerda, a grade sem palavra nenhuma para estoque baixo (só a cor — e só o
// modo detalhado tinha o selo "Crítico"), o nome cortado em 1 linha nos dois
// modos e o botão grade/lista sem nome para o leitor de tela.
//
//   a. KPI "Lucro sobre o custo" com 1 casa em pt-BR ("130,2%"); nenhum
//      "ROI"/"Portfólio" na tela nem no código (fora de comentário);
//   b. grade: estoque 2 com mínimo nulo mostra o selo "Crítico" (a MESMA regra
//      `precisaDeReposicao` do modo detalhado, P-J2), estoque 30 não;
//   c. nome da grade em até 2 linhas (`line-clamp-2`, sem `truncate`);
//   d. detalhado: margem "33,3%", lucro sobre o custo "50,0%", nome em 2
//      linhas sem ficar embaixo do ⋮ (`pr-12`);
//   e. botão de modo com nome acessível que diz o que o toque faz;
//   f. estoque "2", não "02";
//   g. fonte: nenhum `toFixed(…)%` nos dois arquivos da frente.
//
// Montagem real (createRoot + act), mesmo molde de
// admin-products-margem-sem-custo.test.tsx.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteProduct = vi.fn();
const addProduct = vi.fn();
const loadProducts = vi.fn();
const toggleProductStatus = vi.fn();
const onNavigate = vi.fn();
const fetchExecutiveSummary = vi.fn();

let produtosMock: any[] = [];
let offlineMock = false;

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtosMock,
    loading: false,
    deleteProduct,
    toggleProductStatus,
    addProduct,
    loadProducts,
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));

// Lucro sobre o custo = (690,5 − 300) ÷ 300 × 100 = 130,1666…% → "130,2%".
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 300, totalValue: 690.5 } },
    fetchExecutiveSummary,
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

const RAIZ = join(__dirname, "..", "..");
const JARGAO = /\bROI\b|Portf[óo]lio/;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function montarProduto(overrides: Record<string, unknown>) {
  produtosMock = [
    {
      id: "prod-1",
      name: "Vestido longo de linho com alças finas e botões de madeira",
      category: "Vestidos",
      images: [
        "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
      ],
      isActive: true,
      stock: 20,
      price: 15,
      costPrice: 10,
      estoqueMinimo: null,
      ...overrides,
    },
  ];
}

/** Linhas de código do arquivo, sem as de comentário (mesma regra das guardas). */
function codigoSemComentario(relativo: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do repo
  return readFileSync(join(RAIZ, relativo), "utf8")
    .split("\n")
    .filter((linha) => {
      const limpa = linha.trim();
      return !(
        limpa.startsWith("//") ||
        limpa.startsWith("/*") ||
        limpa.startsWith("*") ||
        limpa.startsWith("{/*")
      );
    })
    .join("\n");
}

describe("Produtos cabem no celular (onda J, J3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    offlineMock = false;
    loadProducts.mockImplementation(async () => ({
      products: produtosMock,
      total: 1,
    }));
    fetchExecutiveSummary.mockResolvedValue(null);

    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
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
  });

  async function montar(modo: "compact" | "detailed" = "compact") {
    if (modo === "detailed")
      armazem.set("admin_products_view_mode", "detailed");
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function cartao(modo: "compact" | "detailed"): HTMLElement {
    const el = hospedeiro.querySelector(
      modo === "detailed"
        ? ".content-visibility-detailed-card"
        : ".content-visibility-compact-card",
    );
    if (!el) throw new Error(`Cartão ${modo} do produto não está na tela.`);
    return el as HTMLElement;
  }

  function seloCritico(modo: "compact" | "detailed"): HTMLElement | undefined {
    return [...cartao(modo).querySelectorAll('[data-slot="badge"]')].find(
      (el) => el.textContent === "Crítico",
    ) as HTMLElement | undefined;
  }

  function nomeDoProduto(modo: "compact" | "detailed"): HTMLElement {
    const nome = [...cartao(modo).querySelectorAll("[data-produto-nome]")].find(
      (el) => el.textContent === produtosMock[0].name,
    );
    if (!nome) throw new Error("Nome do produto não está no cartão.");
    return nome as HTMLElement;
  }

  describe("a. métrica do topo sem ROI e em pt-BR", () => {
    it("mostra 'Lucro sobre o custo' com '130,2%' e nenhum ROI/Portfólio na tela", async () => {
      montarProduto({});
      await montar();

      const tela = hospedeiro.textContent ?? "";
      expect(tela).toContain("Lucro sobre o custo");
      expect(tela).toContain("130,2%");
      expect(tela).not.toContain("130.17%");
      expect(tela).not.toMatch(JARGAO);
    });

    it("o código da tela (fora de comentário) não escreve ROI nem Portfólio", () => {
      expect(
        codigoSemComentario("src/views/admin/AdminProductsView.tsx"),
      ).not.toMatch(JARGAO);
    });
  });

  describe("b. grade: estoque baixo em palavra, mesma regra do detalhado", () => {
    it("estoque 2 e mínimo nulo: selo 'Crítico' em 11px", async () => {
      montarProduto({ stock: 2, estoqueMinimo: null });
      await montar();

      const selo = seloCritico("compact");
      expect(selo, "a grade não diz 'Crítico'").toBeDefined();
      expect(selo?.className).toContain("text-[11px]");
    });

    it("estoque 30 e mínimo nulo: sem selo", async () => {
      montarProduto({ stock: 30, estoqueMinimo: null });
      await montar();

      expect(seloCritico("compact")).toBeUndefined();
    });

    it("estoque 8 e mínimo 10: o mínimo do produto manda também na grade", async () => {
      montarProduto({ stock: 8, estoqueMinimo: 10 });
      await montar();

      expect(seloCritico("compact")).toBeDefined();
    });
  });

  describe("c. nome completo da grade", () => {
    it("o nome quebra palavra sem limitar linhas nem truncar", async () => {
      montarProduto({});
      await montar();

      const nome = nomeDoProduto("compact");
      expect(nome.className).not.toMatch(/line-clamp|truncate/);
      expect(nome.className).toContain("break-words");
      expect(nome.className).not.toContain("truncate");
    });
  });

  describe("d. modo detalhado", () => {
    it("margem '33,3%' e lucro sobre o custo '50,0%', em pt-BR", async () => {
      montarProduto({ price: 15, costPrice: 10 });
      await montar("detailed");

      const textos = [
        ...cartao("detailed").querySelectorAll(
          "span.font-black.tracking-tighter.tabular-nums",
        ),
      ].map((el) => el.textContent);
      expect(textos).toEqual(["33,3%", "50,0%"]);
      // percentual nunca é partido no meio: uma linha só, sem break-words
      for (const valor of cartao("detailed").querySelectorAll(
        "span.font-black.tracking-tighter.tabular-nums",
      )) {
        expect(valor.className).toContain("whitespace-nowrap");
        expect(valor.className).not.toContain("break-words");
      }
      expect(cartao("detailed").textContent).toContain("Lucro sobre o custo");
      expect(cartao("detailed").textContent).not.toMatch(JARGAO);
    });

    it("a margem tem coluna própria e o lucro sobre custo fica em linha expansível sem corte", async () => {
      montarProduto({ price: 15, costPrice: 10 });
      await montar("detailed");
      const item = cartao("detailed");
      const valores = [
        ...item.querySelectorAll<HTMLElement>(
          "[data-margem], [data-lucro-sobre-custo]",
        ),
      ];
      expect(valores).toHaveLength(2);
      expect(valores[0].closest("div.grid")?.className).toContain(
        "grid-cols-3",
      );
      const detalhes = valores[1].closest<HTMLElement>(
        "[data-metricas-do-produto]",
      );
      expect(detalhes?.hidden).toBe(true);
      const abrir = item.querySelector<HTMLButtonElement>(
        'button[aria-controls="metricas-produto-prod-1"]',
      );
      expect(abrir).not.toBeNull();
      await act(async () => abrir?.click());
      expect(detalhes?.hidden).toBe(false);
      expect(valores[1].parentElement?.className).toContain("flex-wrap");
      for (const valor of valores) {
        expect(valor.className).toContain("whitespace-nowrap");
        expect(valor.className).toContain("tabular-nums");
        expect(valor.className).not.toMatch(/truncate|line-clamp/);
      }
    });

    it("o nome completo abre o menu sem disputar espaço com outro botão", async () => {
      montarProduto({});
      await montar("detailed");

      const nome = nomeDoProduto("detailed");
      expect(nome.className).not.toMatch(/line-clamp|truncate/);
      expect(nome.className).toContain("break-words");
      expect(nome.parentElement?.className).toContain("min-w-0");
      const gatilho = nome.closest("button");
      expect(gatilho?.getAttribute("aria-label")).toBe(
        `Ações de ${produtosMock[0].name}`,
      );
      expect(gatilho?.querySelector("button")).toBeNull();
      expect(nome.className).not.toContain("truncate");
    });
  });

  describe("e. botão grade/lista com nome acessível", () => {
    it("diz o que o toque faz e troca o nome depois do toque", async () => {
      montarProduto({});
      await montar();

      const paraLista = hospedeiro.querySelector(
        'button[aria-label="Mostrar em lista com detalhes"]',
      ) as HTMLButtonElement | null;
      expect(paraLista, "botão de modo sem nome acessível").not.toBeNull();
      expect(paraLista?.getAttribute("aria-pressed")).toBe("false");

      await act(async () => {
        paraLista?.click();
        await esperarMicrotarefas();
      });

      expect(paraLista?.getAttribute("aria-pressed")).toBe("true");
      expect(paraLista?.getAttribute("aria-label")).toBe("Mostrar em grade");
      expect(
        hospedeiro.querySelectorAll('button[aria-label^="Mostrar em"]'),
      ).toHaveLength(1);
      expect(armazem.get("admin_products_view_mode")).toBe("detailed");
      await act(async () => paraLista?.click());
      expect(paraLista?.getAttribute("aria-pressed")).toBe("false");
      expect(paraLista?.getAttribute("aria-label")).toBe(
        "Mostrar em lista com detalhes",
      );
      expect(armazem.get("admin_products_view_mode")).toBe("compact");
    });
  });

  describe("f. estoque sem zero à esquerda", () => {
    it.each(["compact", "detailed"] as const)(
      "%s: estoque 2 aparece '2', não '02'",
      async (modo) => {
        montarProduto({ stock: 2 });
        await montar(modo);

        const textos = [...cartao(modo).querySelectorAll("span")].map(
          (el) => el.textContent,
        );
        expect(textos).toContain("2");
        expect(textos).not.toContain("02");
      },
    );
  });

  describe("g. fonte: percentual nunca com toFixed (ponto em inglês)", () => {
    it.each([
      "src/views/admin/AdminProductsView.tsx",
      "src/views/admin/AdminProductFormView.tsx",
    ])("%s não tem toFixed(…)% nem '33.3%' escrito à mão", (arquivo) => {
      const codigo = codigoSemComentario(arquivo);
      expect(codigo).not.toMatch(/toFixed\(\d*\)\}?%/);
      // Percentual fixo de exemplo também em pt-BR ("33,3%", não "33.3%").
      expect(codigo).not.toMatch(/\d\.\d+\s?%/);
    });
  });

  describe("redesenho aprovado: catálogo primeiro", () => {
    it("métricas começam visíveis no resumo e Expandir/Recolher alterna a grade", async () => {
      montarProduto({});
      await montar();
      const metricas = hospedeiro.querySelector<HTMLElement>(
        'section[aria-label="Métricas de Produtos"]',
      )!;
      const atalho = metricas.querySelector<HTMLButtonElement>("button");
      expect(atalho).not.toBeNull();
      expect(metricas.hidden).toBe(false);
      expect(metricas.closest("[hidden]")).toBeNull();
      expect(metricas.querySelectorAll('[role="group"]')).toHaveLength(4);
      expect(metricas.querySelectorAll("article")).toHaveLength(0);
      expect(atalho?.textContent).toContain("Expandir");
      expect(atalho?.getAttribute("aria-expanded")).toBe("false");
      await act(async () => atalho?.click());
      expect(metricas.hidden).toBe(false);
      expect(metricas.querySelectorAll("article")).toHaveLength(4);
      expect(
        [...metricas.querySelectorAll("article")].map((el) =>
          el.getAttribute("aria-label"),
        ),
      ).toEqual([
        "Dinheiro parado em estoque",
        "Lucro se vender tudo",
        "Lucro sobre o custo",
        "Produtos no Catálogo",
      ]);
      const recolher = metricas.querySelector<HTMLButtonElement>("button");
      expect(recolher?.textContent).toContain("Recolher");
      expect(recolher?.getAttribute("aria-expanded")).toBe("true");
      expect(metricas.querySelectorAll("button")).toHaveLength(1);
      await act(async () => recolher?.click());
      expect(metricas.hidden).toBe(false);
      expect(metricas.querySelectorAll("article")).toHaveLength(0);
      expect(metricas.querySelectorAll('[role="group"]')).toHaveLength(4);
      expect(
        metricas.querySelector("button")?.getAttribute("aria-expanded"),
      ).toBe("false");
      expect(
        hospedeiro.querySelector(
          'button[title="Guia Completo de Métricas e Ajuda"]',
        ),
      ).not.toBeNull();
    });

    it("preço vem antes das métricas secundárias, que abrem por produto", async () => {
      montarProduto({ price: 15, costPrice: 10 });
      await montar("detailed");
      const item = cartao("detailed");
      const botao = item.querySelector<HTMLButtonElement>(
        'button[aria-controls="metricas-produto-prod-1"]',
      );
      const detalhes = item.querySelector<HTMLElement>(
        "[data-metricas-do-produto]",
      );
      expect(detalhes?.hidden).toBe(true);
      expect(item.textContent?.indexOf("Preço de Venda")).toBeLessThan(
        item.textContent?.indexOf("Lucro sobre o custo") ?? -1,
      );
      await act(async () => botao?.click());
      expect(detalhes?.hidden).toBe(false);
      expect(botao?.textContent).toContain("Menos métricas");
      expect(detalhes?.textContent).toContain("50,0%");
      await act(async () => botao?.click());
      expect(detalhes?.hidden).toBe(true);
    });

    it("custo suspeito acompanha a margem e oferece revisar o cadastro", async () => {
      montarProduto({ price: 50, costPrice: 0.1 });
      await montar("detailed");
      const aviso = cartao("detailed").querySelector("[data-custo-suspeito]");
      expect(aviso?.textContent).toContain(
        "Margem calculada com custo suspeito",
      );
      expect(aviso?.textContent).toContain("99,8%");
      expect(aviso?.textContent).toContain("R$ 0,10");
      const revisar = [...cartao("detailed").querySelectorAll("button")].find(
        (b) => b.textContent?.includes("Revisar custo"),
      );
      expect(revisar).toBeDefined();
      await act(async () => revisar?.click());
      expect(onNavigate).toHaveBeenCalledWith("admin-product-form", "prod-1");
    });

    it.each(["compact", "detailed"] as const)(
      "%s: offline explica o bloqueio e desabilita cadastro, edição, ativação e menu",
      async (modo) => {
        montarProduto({});
        offlineMock = true;
        await montar(modo);
        const item = cartao(modo);
        expect(hospedeiro.textContent).toContain("Sem conexão com o servidor");
        expect(hospedeiro.textContent).toContain(
          "voltam quando a internet voltar",
        );
        for (const nome of ["Ações de", "Editar", "Pausar"]) {
          const botao = item.querySelector<HTMLButtonElement>(
            `button[aria-label^="${nome} "]`,
          );
          expect(botao, nome).not.toBeNull();
          expect(botao?.disabled, nome).toBe(true);
        }
        const novo = [...hospedeiro.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("Novo produto indisponível"),
        );
        expect(novo?.disabled).toBe(true);
      },
    );

    it("sem foto usa câmera e texto; editar e menu identificam o produto", async () => {
      montarProduto({
        images: ["https://placehold.co/600x400?text=Sem+Imagem"],
      });
      await montar();
      const item = cartao("compact");
      expect(item.textContent).toContain("Sem foto");
      expect(item.querySelector('img[src*="placehold.co"]')).toBeNull();
      expect(
        item.querySelector(
          `button[aria-label="Ações de ${produtosMock[0].name}"]`,
        ),
      ).not.toBeNull();
      const editar = item.querySelector<HTMLButtonElement>(
        `button[aria-label="Editar ${produtosMock[0].name}"]`,
      );
      expect(editar).not.toBeNull();
      await act(async () => editar?.click());
      expect(onNavigate).toHaveBeenCalledWith("admin-product-form", "prod-1");
    });
  });

  describe.each(["compact", "detailed"] as const)(
    "foto e título como gatilho (%s)",
    (modo) => {
      function gatilho() {
        const botao = cartao(modo).querySelector<HTMLButtonElement>(
          'button[aria-label^="Ações de "]',
        );
        expect(botao).not.toBeNull();
        return botao!;
      }

      async function abrir(alvo: Element) {
        await act(async () => {
          alvo.dispatchEvent(
            new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
          );
        });
        expect(gatilho().getAttribute("aria-expanded")).toBe("true");
        const menu = document.querySelector('[role="menu"]');
        expect(menu).not.toBeNull();
        return menu!;
      }

      it("o nome continua sendo título de verdade, fora do botão do menu", async () => {
        montarProduto({ variants: [{ value: "P", stockIncrement: 20 }] });
        await montar(modo);
        const titulo = [...cartao(modo).querySelectorAll("h4")].find(
          (el) => el.textContent === produtosMock[0].name,
        );
        expect(titulo).toBeDefined();
        expect(gatilho().contains(titulo!)).toBe(false);
        expect(gatilho().querySelector('[role="heading"]')).toBeNull();
      });

      it("no toque o menu só abre no clique: o início de uma rolagem não abre", async () => {
        montarProduto({ variants: [{ value: "P", stockIncrement: 20 }] });
        await montar(modo);
        const foto = gatilho().querySelector("img")!;
        const encostar = () => {
          const evento = new MouseEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            button: 0,
          });
          Object.defineProperty(evento, "pointerType", { value: "touch" });
          foto.dispatchEvent(evento);
          return evento;
        };
        // Dedo encosta e vira rolagem: o navegador não manda o clique.
        await act(async () => {
          encostar();
        });
        expect(gatilho().getAttribute("aria-expanded")).toBe("false");
        expect(document.querySelector('[role="menu"]')).toBeNull();
        // Toque de verdade: encosta e solta, o clique abre o menu.
        await act(async () => {
          encostar();
          foto.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(gatilho().getAttribute("aria-expanded")).toBe("true");
        expect(document.querySelector('[role="menu"]')).not.toBeNull();
      });

      it("foto inteira, categoria e nome abrem o mesmo menu; editar e ativar ficam fora", async () => {
        montarProduto({ variants: [{ value: "P", stockIncrement: 20 }] });
        await montar(modo);
        const botao = gatilho();
        const foto = botao.querySelector("img");
        const nome = nomeDoProduto(modo);
        expect(foto).not.toBeNull();
        expect(foto?.className).toContain("object-contain");
        expect(foto?.parentElement?.className).toContain(
          modo === "compact" ? "aspect-square" : "size-16",
        );
        expect(botao.contains(nome)).toBe(true);
        expect(foto!.compareDocumentPosition(nome)).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
        expect(botao.textContent).toContain("Vestidos");
        expect(botao.getAttribute("type")).toBe("button");
        expect(botao.getAttribute("aria-label")).toBe(
          `Ações de ${produtosMock[0].name}`,
        );
        expect(botao.getAttribute("aria-haspopup")).toBe("menu");
        expect(botao.className).toContain("min-h-11");
        expect(botao.querySelector("button")).toBeNull();
        expect(
          cartao(modo).querySelector(".lucide-ellipsis-vertical"),
        ).toBeNull();
        const editar = cartao(modo).querySelector(
          'button[aria-label^="Editar "]',
        );
        const pausar = cartao(modo).querySelector(
          'button[aria-label^="Pausar "]',
        );
        expect(editar).not.toBeNull();
        expect(editar?.className).toContain("min-w-11");
        expect(pausar).not.toBeNull();
        expect(botao.contains(editar)).toBe(false);
        expect(botao.contains(pausar)).toBe(false);
        expect(botao.compareDocumentPosition(editar!)).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
        const menu = await abrir(foto!);
        const itens = [...menu.querySelectorAll('[role="menuitem"]')];
        expect(
          itens.map(
            (item) =>
              item.querySelector("span")?.textContent ?? item.textContent,
          ),
        ).toEqual([
          "Editar produto",
          "Pausar Produto",
          "Duplicar Produto",
          "Excluir Produto",
          "Fechar",
        ]);
        expect(deleteProduct).not.toHaveBeenCalled();
        expect(addProduct).not.toHaveBeenCalled();
        await act(async () => {
          itens[4].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(gatilho().getAttribute("aria-expanded")).toBe("false");
        await abrir(nome);
      });

      it("o teclado abre o menu e o item editar preserva a navegação", async () => {
        montarProduto({});
        await montar(modo);
        await act(async () => {
          gatilho().dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          );
        });
        const editar = document.querySelector<HTMLElement>('[role="menuitem"]');
        expect(editar?.textContent).toContain("Editar produto");
        await act(async () => editar?.click());
        expect(onNavigate).toHaveBeenCalledWith("admin-product-form", "prod-1");
      });

      it.each(["Duplicar Produto", "Excluir Produto"])(
        "%s ainda pede confirmação antes de alterar dados",
        async (acao) => {
          montarProduto({});
          await montar(modo);
          const menu = await abrir(nomeDoProduto(modo));
          const item = [
            ...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
          ].find((el) => el.textContent?.startsWith(acao));
          expect(item).toBeDefined();
          await act(async () => item?.click());
          const dialogo = document.querySelector('[role="alertdialog"]');
          expect(dialogo).not.toBeNull();
          expect(
            dialogo?.querySelector(`button[aria-label^="${acao}: confirmar"]`),
          ).not.toBeNull();
          expect(addProduct).not.toHaveBeenCalled();
          expect(deleteProduct).not.toHaveBeenCalled();
        },
      );

      it("sem foto mantém a área e o nome", async () => {
        montarProduto({ images: [] });
        await montar(modo);
        expect(gatilho().textContent).toContain("Sem foto");
        expect(
          gatilho().querySelector("[data-produto-foto]")?.className,
        ).toContain(modo === "compact" ? "aspect-square" : "size-16");
      });

      it("foto que falha mostra aviso sem botão aninhado", async () => {
        montarProduto({});
        await montar(modo);
        const foto = gatilho().querySelector("img");
        expect(foto).not.toBeNull();
        await act(async () => {
          foto?.dispatchEvent(new Event("error"));
        });
        expect(gatilho().textContent).toContain("Foto indisponível");
        expect(gatilho().querySelector("button")).toBeNull();
        await abrir(nomeDoProduto(modo));
      });

      it("produto pausado mantém foto esmaecida, nome inteiro e ação Ativar", async () => {
        montarProduto({ isActive: false });
        await montar(modo);
        const foto = gatilho().querySelector("img");
        expect(foto?.className).toContain("opacity-40");
        expect(foto?.className).toContain("grayscale");
        expect(nomeDoProduto(modo).textContent).toBe(produtosMock[0].name);
        const menu = await abrir(nomeDoProduto(modo));
        const ativar = [
          ...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        ].find((item) => item.textContent?.startsWith("Ativar Produto"));
        expect(ativar).toBeDefined();
        await act(async () => ativar?.click());
        expect(toggleProductStatus).toHaveBeenCalledWith("prod-1", false);
      });
    },
  );

  describe("h. guia de métricas: exemplo e simulador em pt-BR e sem corte", () => {
    async function abrirGuia() {
      const ajuda = hospedeiro.querySelector(
        'button[title="Guia Completo de Métricas e Ajuda"]',
      ) as HTMLButtonElement | null;
      expect(ajuda, "botão do guia ausente").not.toBeNull();
      await act(async () => {
        ajuda?.click();
        await esperarMicrotarefas();
      });
    }

    function botaoDoGuia(texto: string): HTMLButtonElement {
      const botao = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === texto,
      );
      if (!botao) throw new Error(`aba '${texto}' do guia ausente`);
      return botao as HTMLButtonElement;
    }

    it("o exemplo da margem no dicionário diz '33,3%'", async () => {
      montarProduto({});
      await montar();
      await abrirGuia();

      const titulo = [...document.querySelectorAll('[role="dialog"] p')].find(
        (el) => el.textContent === "Margem de Lucro",
      );
      expect(titulo, "conceito de margem ausente").toBeDefined();
      const exemplo = [
        ...(titulo?.parentElement?.querySelectorAll("span") ?? []),
      ].find((el) => el.textContent?.includes("Custo R$10 / Venda R$15"));
      expect(exemplo, "exemplo da margem ausente").toBeDefined();
      expect(exemplo?.textContent).toContain("33,3%");
      expect(exemplo?.textContent).not.toContain("33.3%");
    });

    it("as 4 caixas do simulador crescem com o rótulo (min-h-20, nunca h-20)", async () => {
      montarProduto({});
      await montar();
      await abrirGuia();
      await act(async () => {
        botaoDoGuia("Simulador").click();
        await esperarMicrotarefas();
      });

      const rotulo = [...document.querySelectorAll("p")].find(
        (el) => el.textContent === "Lucro sobre o custo (por unidade)",
      );
      expect(rotulo, "caixa 'por unidade' ausente").toBeDefined();
      const grade = rotulo?.parentElement?.parentElement as HTMLElement;
      const caixas = [...grade.children] as HTMLElement[];
      expect(caixas).toHaveLength(4);
      for (const caixa of caixas) {
        const classes = caixa.className.split(/\s+/);
        expect(classes).toContain("min-h-20");
        expect(classes).not.toContain("h-20");
      }
    });

    it("as 4 caixas do simulador usam o desenho novo de cartão de métrica", async () => {
      montarProduto({});
      await montar();
      await abrirGuia();
      await act(async () => {
        botaoDoGuia("Simulador").click();
        await esperarMicrotarefas();
      });

      const rotulo = [...document.querySelectorAll("p")].find(
        (el) => el.textContent === "Lucro sobre o custo (por unidade)",
      );
      const grade = rotulo?.parentElement?.parentElement as HTMLElement;
      expect(grade.children).toHaveLength(4);
      for (const caixa of [...grade.children] as HTMLElement[]) {
        const classes = caixa.className.split(/\s+/);
        expect(classes).toContain("rounded-2xl");
        expect(classes).toContain("bg-zinc-900/70");
        expect(classes).toContain("bg-gradient-to-b");
        const [rotuloDaCaixa, valorDaCaixa] = [...caixa.children];
        // rótulo em frase normal, cinza 300; valor grande e tabular
        expect(rotuloDaCaixa.className).toContain("text-xs");
        expect(rotuloDaCaixa.className).toContain("text-zinc-300");
        expect(rotuloDaCaixa.className).not.toContain("uppercase");
        // abaixo de `sm` no máximo 18px; 22px de `sm` em diante; o número
        // nunca é partido no meio (nowrap no valor ou no <span> do número)
        expect(valorDaCaixa.className).toContain("sm:text-[22px]");
        expect(valorDaCaixa.className).not.toMatch(/(?:^|\s)text-(?:xl|2xl)/);
        expect(valorDaCaixa.className).toContain("tabular-nums");
        expect(valorDaCaixa.className).not.toContain("break-words");
        const numero = valorDaCaixa.querySelector("span") ?? valorDaCaixa;
        expect(numero.className).toContain("whitespace-nowrap");
      }
      // a borda de "Margem de Lucro" segue colorida pela saúde da margem
      expect(grade.children[0].className).toMatch(
        /border-(emerald|teal|amber|rose)-500\/20/,
      );
    });
  });
});
