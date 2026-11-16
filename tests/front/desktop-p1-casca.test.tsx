import appFonte from "@/App?raw";
import bottomFonte from "@/components/ui/custom/BottomNav?raw";
// @vitest-environment jsdom
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// @ts-expect-error flag interna do ambiente de testes React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const estado = vi.hoisted(() => ({
  computador: false,
  baixou: 0,
  categorias: [
    { id: "aneis", name: "Anéis", isActive: true },
    { id: "oculta", name: "Oculta", isActive: false },
  ],
}));
vi.mock("@/hooks/useTelaDeComputador", () => ({
  useTelaDeComputador: () => estado.computador,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja de ensaio", logoUrl: null } }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 2 }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCartState: () => ({ cartCount: 3 }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: estado.categorias, isLoading: false }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/components/pwa/IlhaDeAtualizacao", () => ({
  IlhaDeAtualizacao: () => null,
}));
// Importação instrumentada: não substitui a peça real. Se o celular pedir
// o módulo, o contador acusa mesmo que ele não desenhe nada.
vi.mock("@/components/desktop/CabecalhoDoComputador", async (original) => {
  estado.baixou += 1;
  return await original();
});

import { CabecalhoCliente } from "@/components/desktop/CabecalhoCliente";
import { PaginaDoComputador } from "@/components/desktop/PaginaDoComputador";
import type { View } from "@/types";

let host: HTMLDivElement;
let root: Root;
const destinos: View[] = [];
let categoria = "";
let busca = "";
const props = {
  currentView: "home" as View,
  onNavigate: (view: View) => {
    destinos.push(view);
  },
  searchQuery: "",
  onSearch: (query: string) => {
    busca = query;
  },
  selectedCategory: "Anéis",
  onCategorySelect: () => {},
  onCategoryChange: (nome: string) => {
    categoria = nome;
  },
  onOpenNotifications: vi.fn(),
};
async function desenhar(children: ReactNode) {
  await act(async () => {
    root.render(children);
    if (estado.computador)
      await import("@/components/desktop/CabecalhoDoComputador");
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  estado.computador = false;
  destinos.length = 0;
  categoria = "";
  busca = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("casca de computador sem alterar o celular", () => {
  it("celular conserva o filho original e não importa o cabeçalho de PC", async () => {
    expect(estado.baixou).toBe(0);
    await desenhar(
      <CabecalhoCliente {...props}>
        <header data-celular>Celular</header>
      </CabecalhoCliente>,
    );
    expect(host.querySelector("[data-celular]")).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Navegação do computador"]'),
    ).toBeNull();
    expect(estado.baixou).toBe(0);
  });

  it("PC oferece busca real, destinos e contadores, sem faixa de categorias", async () => {
    estado.computador = true;
    act(() =>
      root.render(
        <CabecalhoCliente {...props}>
          <span />
        </CabecalhoCliente>,
      ),
    );
    expect(
      host
        .querySelector('[aria-hidden="true"]')
        ?.classList.contains("lg:h-[73px]"),
    ).toBe(true);
    await desenhar(
      <CabecalhoCliente {...props}>
        <header data-celular>Celular</header>
      </CabecalhoCliente>,
    );
    // Espera o módulo REAL, sem presumir tempo de transformação do Vitest.
    await vi.waitFor(
      async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(
          host.querySelector('[aria-label="Navegação do computador"]'),
        ).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(host.querySelector("[data-celular]")).toBeNull();
    const nav = host.querySelector('[aria-label="Navegação do computador"]');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Início",
    );
    expect(
      host.querySelector('input[placeholder="Buscar produtos"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Carrinho, 3 itens"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Notificações, 2 não lidas"]'),
    ).not.toBeNull();
    // P80 (1.5.195): a faixa de categorias de texto saiu do cabeçalho; as
    // categorias ficam só na faixa com ícones da página inicial.
    expect(host.querySelector('[aria-label="Categorias da loja"]')).toBeNull();
    expect(host.textContent).not.toContain("Anéis");
    for (const [rotulo, destino] of [
      ["Início", "home"],
      ["Favoritos", "favorites"],
      ["Pedidos", "orders"],
      ["Perfil", "profile"],
    ] as const) {
      const botao = [...(nav?.querySelectorAll("button") ?? [])].find(
        (el) => el.textContent === rotulo,
      );
      expect(botao, rotulo).toBeDefined();
      act(() => botao?.click());
      expect(destinos.at(-1)).toBe(destino);
    }
    act(() =>
      (host.querySelector("#header-cart") as HTMLButtonElement)?.click(),
    );
    expect(destinos.at(-1)).toBe("cart");
    // Nada no cabeçalho do PC muda a categoria da página inicial.
    expect(categoria).toBe("");
    const input = host.querySelector("input") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "anel");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(busca).toBe("anel");
    const sino = host.querySelector(
      '[aria-label="Notificações, 2 não lidas"]',
    ) as HTMLButtonElement;
    act(() => sino.click());
    expect(props.onOpenNotifications).toHaveBeenCalledOnce();
  });

  for (const view of [
    "product-detail",
    "about-store",
    "notifications",
    "privacy",
    "checkout",
  ] as View[]) {
    it(`PC preserva Voltar e o mesmo onBack em ${view}`, async () => {
      estado.computador = true;
      const voltar = vi.fn();
      await desenhar(
        <CabecalhoCliente
          {...props}
          currentView={view}
          showBackButton
          onBack={voltar}
        >
          <span />
        </CabecalhoCliente>,
      );
      const botao = host.querySelector(
        '[aria-label="Voltar"]',
      ) as HTMLButtonElement;
      expect(botao).not.toBeNull();
      expect(botao?.classList.contains("size-11")).toBe(true);
      expect(botao?.className).toContain("focus-visible:");
      expect(
        botao?.compareDocumentPosition(
          host.querySelector('[aria-label="Ir para o Início"]') as Node,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      act(() => botao.click());
      expect(voltar).toHaveBeenCalledOnce();
      expect(destinos).toEqual([]);
    });
  }

  it("PC não inventa Voltar nas abas principais e na entrada", async () => {
    estado.computador = true;
    for (const view of [
      "home",
      "favorites",
      "cart",
      "orders",
      "profile",
      "auth",
      "login",
    ] as View[]) {
      await desenhar(
        <CabecalhoCliente {...props} currentView={view} showBackButton={false}>
          <span />
        </CabecalhoCliente>,
      );
      expect(host.querySelector('[aria-label="Voltar"]')).toBeNull();
    }
  });

  it("App passa a mesma condição e o mesmo handler de Voltar aos dois cabeçalhos", () => {
    const arquivo = ts.createSourceFile(
      "App.tsx",
      appFonte,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const atributos: string[][] = [];
    const visitar = (node: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        ["CabecalhoCliente", "Header"].includes(node.tagName.getText(arquivo))
      ) {
        atributos.push(
          node.attributes.properties.map((attr) => attr.getText(arquivo)),
        );
      }
      ts.forEachChild(node, visitar);
    };
    visitar(arquivo);
    expect(atributos).toHaveLength(2);
    for (const bloco of atributos) {
      expect(bloco).toContain("showBackButton={mostrarVoltarCliente}");
      expect(bloco).toContain("onBack={handleBack}");
    }
  });

  it("PC mantém a região de status e acompanha online/offline sem empurrar o conteúdo", async () => {
    estado.computador = true;
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    await desenhar(
      <CabecalhoCliente {...props}>
        <span />
      </CabecalhoCliente>,
    );
    const faixa = [...host.querySelectorAll('[role="status"]')].find((el) =>
      el.classList.contains("top-full"),
    );
    expect(faixa).toBeDefined();
    expect(faixa?.classList.contains("absolute")).toBe(true);
    expect(faixa?.textContent).toBe(
      "Sem internet — mostrando o que já foi carregado",
    );
    online = true;
    act(() => globalThis.dispatchEvent(new Event("online")));
    expect(faixa?.textContent).toBe("");
    online = false;
    act(() => globalThis.dispatchEvent(new Event("offline")));
    expect(faixa?.textContent).toBe(
      "Sem internet — mostrando o que já foi carregado",
    );
  });

  it("Home tem uma página atual e o cabeçalho não anuncia filtro de categoria", async () => {
    estado.computador = true;
    await desenhar(
      <CabecalhoCliente {...props} selectedCategory="Todas">
        <span />
      </CabecalhoCliente>,
    );
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(host.querySelector('[aria-current="true"]')).toBeNull();
  });

  it("preserva o encaixe do resumo quando a busca está proibida", async () => {
    estado.computador = true;
    await desenhar(
      <CabecalhoCliente {...props} hideSearch>
        <span />
      </CabecalhoCliente>,
    );
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector("#checkout-header-center-slot")).not.toBeNull();
  });

  it("sem categorias ativas não inventa uma faixa vazia", async () => {
    estado.computador = true;
    const antes = estado.categorias;
    estado.categorias = [];
    try {
      await desenhar(
        <CabecalhoCliente {...props}>
          <span />
        </CabecalhoCliente>,
      );
      expect(
        host.querySelector('[aria-label="Categorias da loja"]'),
      ).toBeNull();
    } finally {
      estado.categorias = antes;
    }
  });

  it("a largura máxima mora dentro da rolagem e a casca é transparente no celular", async () => {
    await desenhar(
      <div className="overflow-y-auto">
        <PaginaDoComputador>
          <p>Conteúdo</p>
        </PaginaDoComputador>
      </div>,
    );
    const casca = host.querySelector("p")?.parentElement;
    expect(casca?.classList.contains("lg:max-w-[1280px]")).toBe(true);
    expect(casca?.classList.contains("2xl:max-w-[1440px]")).toBe(true);
    expect(classesDoCelular(casca?.className ?? "")).toBe(
      "contents [&>*]:shrink-0",
    );
    expect(casca?.parentElement?.className).toBe("overflow-y-auto");
    expect(casca?.className).not.toContain("overflow-y");
  });

  it("produto, carrinho e busca mantêm o container que já possuem", async () => {
    await desenhar(
      <PaginaDoComputador containerProprio>
        <p>Produto</p>
      </PaginaDoComputador>,
    );
    expect(host.firstElementChild?.tagName).toBe("P");
  });

  it("esconde a pílula e sua reserva só a partir de lg, sem desmontá-la no PC", () => {
    expect(bottomFonte.includes("lg:hidden")).toBe(true);
    const fallbackDaBarra = appFonte.match(
      /<React\.Suspense\s+fallback=\{\s*<nav\b([\s\S]*?)<\/nav>\s*\}\s*>\s*<BottomNav\b/,
    );
    expect(fallbackDaBarra).not.toBeNull();
    const classe = fallbackDaBarra?.[1].match(/className="([^"]+)"/)?.[1];
    expect(classe?.split(/\s+/).includes("lg:hidden")).toBe(true);
    expect(bottomFonte).not.toMatch(/useTelaDeComputador|ehTelaDeComputador/);
  });
});
