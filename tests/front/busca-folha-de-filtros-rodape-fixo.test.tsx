// @vitest-environment jsdom
//
// "Refinar Busca" no celular: o botão "Aplicar Filtros" ficava no FIM da área
// que rola — com muitas categorias ele caía abaixo da dobra e a cliente tinha
// de rolar até o fim para aplicar. Agora a folha tem cabeçalho fixo, miolo que
// rola e rodapé fixo com o botão (com folga da barra do iPhone). O jsdom não
// calcula layout: aqui se prova a ESTRUTURA (quem está dentro de quem, e as
// classes); a medida de pixels foi feita no Chromium real.
import {
  act,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";
import { SearchView } from "@/views/customer/SearchView";

function produto(id: string, nome: string, categoria: string): Product {
  return {
    id,
    name: nome,
    description: "",
    price: 100,
    images: [],
    category: categoria,
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

const mockedProducts: Product[] = [
  produto("p1", "Vestido Floral", "Vestidos"),
  produto("p2", "Sandália Rasa", "Sandálias"),
];

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0, enableReviews: false },
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: mockedProducts,
    getFreeShippingEligibleProducts: () => [],
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

const SheetOpenContext = createContext<{
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}>({ open: false });
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  }) => (
    <SheetOpenContext.Provider value={{ open, onOpenChange }}>
      {children}
    </SheetOpenContext.Provider>
  ),
  SheetTrigger: ({ children }: { asChild?: boolean; children: ReactNode }) => {
    const { onOpenChange } = useContext(SheetOpenContext);
    if (!isValidElement(children)) return children;
    return cloneElement(children as ReactElement<{ onClick?: () => void }>, {
      onClick: () => onOpenChange?.(true),
    });
  },
  SheetContent: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => {
    const { open } = useContext(SheetOpenContext);
    return open ? (
      <div data-testid="folha-filtros" className={className}>
        {children}
      </div>
    ) : null;
  },
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  globalThis.history.replaceState({ view: "search" }, "", "/search");
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

async function abrirAFolha() {
  await act(async () => {
    raiz.render(
      <SearchView onNavigate={() => {}} onBack={() => {}} initialQuery="" />,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  const abrir = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.startsWith("Filtros"),
  );
  await act(async () => {
    abrir?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  const folha = hospedeiro.querySelector<HTMLElement>(
    '[data-testid="folha-filtros"]',
  );
  if (!folha) throw new Error("folha de filtros não abriu");
  return folha;
}

const botaoNaFolha = (folha: HTMLElement, texto: string) => {
  const achado = Array.from(folha.querySelectorAll("button")).find(
    (b) => b.textContent === texto,
  );
  if (!achado) throw new Error(`botão "${texto}" não achado`);
  return achado;
};

describe("SearchView — folha 'Refinar Busca' com rodapé fixo", () => {
  it("'Aplicar Filtros' não fica dentro da área que rola", async () => {
    const folha = await abrirAFolha();
    const aplicar = botaoNaFolha(folha, "Aplicar Filtros");
    expect(aplicar.closest(".overflow-y-auto")).toBeNull();
    // e a área que rola existe, e guarda as categorias
    const miolo = botaoNaFolha(folha, "Vestidos").closest(".overflow-y-auto");
    expect(miolo).not.toBeNull();
    expect(miolo?.className).toContain("min-h-0");
    expect(miolo?.className).toContain("flex-1");
    expect(miolo?.className).toContain("overscroll-contain");
  });

  it("a folha em si não rola (só o miolo) e a altura usa dvh", async () => {
    const folha = await abrirAFolha();
    const classes = folha.className.split(/\s+/);
    expect(classes).toContain("max-h-[90dvh]");
    expect(classes).not.toContain("max-h-[90vh]");
    expect(classes).toContain("overflow-hidden");
    expect(classes).not.toContain("overflow-y-auto");
  });

  it("o rodapé respeita a barra do iPhone", async () => {
    const folha = await abrirAFolha();
    expect(folha.className).toContain("env(safe-area-inset-bottom");
  });

  it("categorias não escolhidas seguem o tema escuro (não ficam claras sobre o escuro)", async () => {
    const folha = await abrirAFolha();
    const chip = botaoNaFolha(folha, "Vestidos");
    expect(chip.className).toContain("dark:bg-muted");
    expect(chip.className).toContain("dark:border-border");
    expect(chip.className).toContain("dark:text-muted-foreground");
    const ordem = botaoNaFolha(folha, "Alfabética");
    expect(ordem.className).toContain("dark:bg-muted");
  });
});
