// @vitest-environment jsdom
//
// P82 (computador, a partir de 1024 px): três defeitos medidos no build 1.5.193.
//
// A) O esqueleto de Favoritos era uma coluna única de 1216-1280 px, sem o
//    espaço do subtítulo/filtros/título de seção; a página pronta é uma grade de
//    2 colunas e a primeira linha descia de y=193 para y=309 (salto de 116 px).
// B) O esqueleto de Meus pedidos era um cartão empilhado de 307 px e não tinha a
//    faixa "Em andamento / Histórico" (44 px + respiro de 16; reservada em
//    CartView, ver desktop-p82-faixa-de-pedidos-reservada); o cartão pronto é
//    horizontal, de 251 px, e a primeira linha descia de y=221 para y=281
//    (deslocamento de layout de 0,017 a 0,039).
// C) O campo CEP de /address-form (coluna de 672 px) ficava com 632 px para 9
//    caracteres. O AddressForm é o MESMO componente do checkout, então a
//    largura menor é uma opção (`cepCompacto`) que só a tela da conta liga.
//
// Só entram tokens `lg:`/`xl:`/`2xl:`. O jsdom não calcula CSS: a prova é a
// árvore montada de verdade + o que o celular enxerga (classes sem prefixo de
// computador), que tem de ser byte a byte o de antes. A medida em pixel foi
// feita no navegador real (ver o relatório da frente).

import { readFileSync } from "node:fs";
import { PaginaDoComputador } from "@/components/desktop/PaginaDoComputador";
import type { Address, Product } from "@/types";
import { FavoritesView } from "@/views/customer/FavoritesView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const loja = vi.hoisted(() => ({
  products: [] as Product[],
  config: { enableReviews: false, shippingCoverage: "local" },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    ...loja,
    loadingProducts: false,
    catalogoErro: false,
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    erro: null,
    refresh: vi.fn(),
    pendingCount: 0,
    favoritosIndisponiveis: 0,
  }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: vi.fn(),
    prefetchImage: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React usada pela suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "produto-inventado-p82",
  name: "Produto inventado",
  price: 30,
  category: "Teste",
  description: "",
  images: [],
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-11-15T00:00:00Z",
  variants: [],
};

let raiz: Root;
let container: HTMLDivElement;
beforeEach(() => {
  loja.products = [produto];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});
afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const tokens = (el: Element) => el.className.split(/\s+/).filter(Boolean);
const dePc = (el: Element) => tokens(el).filter((t) => /^(lg|xl|2xl):/.test(t));
const celular = (el: Element) => classesDoCelular(el.className);

describe("P82 A — esqueleto de Favoritos imita a página pronta no computador", () => {
  function montarCarregando() {
    act(() =>
      raiz.render(
        <PaginaDoComputador>
          <FavoritesView
            loading
            favorites={[]}
            onToggleFavorite={vi.fn()}
            onProductClick={vi.fn()}
            onNavigate={vi.fn()}
          />
        </PaginaDoComputador>,
      ),
    );
    const lista = container.querySelector(
      '[role="status"][aria-label="Carregando favoritos"]',
    )!;
    expect(lista).not.toBeNull();
    return lista;
  }

  it("as linhas viram grade de 2 colunas (as 4 linhas seguem filhas diretas da lista)", () => {
    const lista = montarCarregando();
    expect(lista.children).toHaveLength(4);
    expect(celular(lista)).toBe("px-4");
    for (const t of ["lg:px-0", "lg:grid", "lg:grid-cols-2", "lg:gap-4"]) {
      expect(dePc(lista), t).toContain(t);
    }
    // Celular intacto: cada linha e o que tem dentro.
    for (const linha of lista.children) {
      expect(celular(linha)).toBe(
        "flex min-h-[112px] items-center gap-3 border-b border-border py-2",
      );
    }
  });

  it("a margem de cima reserva os 116 px do subtítulo, dos filtros e do título da seção (sem elemento novo)", () => {
    const lista = montarCarregando();
    expect(dePc(lista)).toContain("lg:mt-[116px]");
    expect(celular(lista)).toBe("px-4");
    // Nenhum elemento novo: a lista segue logo depois do cabeçalho.
    expect(lista.previousElementSibling?.tagName).toBe("HEADER");
    expect(container.querySelector("[aria-hidden=true]")).toBeNull();
  });

  it("depois de carregar, a margem some (só o esqueleto a tem)", () => {
    act(() =>
      raiz.render(
        <PaginaDoComputador>
          <FavoritesView
            loading={false}
            favorites={[produto]}
            onToggleFavorite={vi.fn()}
            onProductClick={vi.fn()}
            onNavigate={vi.fn()}
          />
        </PaginaDoComputador>,
      ),
    );
    expect(container.querySelector("[class*='lg:mt-[116px]']")).toBeNull();
  });
});

describe("P82 B — esqueleto de Meus pedidos imita o cartão horizontal", () => {
  async function montarCarregando() {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(
        <OrderList orders={[]} isLoadingOrders onNavigate={vi.fn()} />,
      );
    });
    return container.querySelector('[aria-busy="true"]')!;
  }

  it("o cartão do esqueleto vira horizontal (2 colunas, 251 px) e o celular fica como estava", async () => {
    const grade = await montarCarregando();
    const cartoes = [
      ...grade.querySelectorAll('[data-testid="order-card-skeleton"]'),
    ];
    for (const cartao of cartoes) {
      expect(celular(cartao)).toBe(
        "min-h-[278px] rounded-[18px] border border-border bg-background p-4",
      );
      for (const t of [
        "lg:min-h-[251px]",
        "lg:grid",
        "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
        "lg:gap-x-8",
        "lg:rounded-3xl",
        "lg:p-6",
      ]) {
        expect(dePc(cartao), t).toContain(t);
      }

      const [topo, meio, rodape] = [...cartao.children];
      expect(celular(topo)).toBe("flex h-14 items-center gap-3");
      expect(dePc(topo)).toContain("lg:h-20");
      expect(celular(topo.firstElementChild!)).toBe(
        "size-14 shrink-0 rounded-xl bg-muted",
      );
      expect(dePc(topo.firstElementChild!)).toContain("lg:size-20");

      expect(celular(meio)).toBe(
        "mt-3 min-h-[136px] border-t border-border pt-3",
      );
      for (const t of [
        "lg:mt-0",
        "lg:min-h-[124px]",
        "lg:border-l",
        "lg:border-t-0",
        "lg:py-0",
        "lg:pl-8",
      ]) {
        expect(dePc(meio), t).toContain(t);
      }

      expect(celular(rodape)).toBe(
        "mt-3 flex items-center justify-between border-t border-border pt-3",
      );
      expect(dePc(rodape).sort()).toEqual(["lg:col-span-2", "lg:mt-5"]);
    }
  });
});

describe("P82 C — campo CEP da tela de endereço da conta fica estreito; o do checkout não", () => {
  const enderecoSalvo: Address = {
    id: "end-1",
    name: "Casa",
    recipient_name: "Fulana",
    cep: "38500-000",
    street: "Rua Tiradentes",
    number: "10",
    complement: "",
    neighborhood: "Centro",
    city: "Monte Carmelo",
    state: "MG",
    reference: "",
    is_default: false,
  } as unknown as Address;

  async function montarFormulario(cepCompacto?: boolean) {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={enderecoSalvo}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
          onCancel={vi.fn()}
          cepCompacto={cepCompacto}
        />,
      );
    });
    const campo = document.getElementById("cep") as HTMLInputElement;
    expect(campo).not.toBeNull();
    return campo;
  }

  it("com `cepCompacto` a caixa do campo (a que carrega o ícone) ganha lg:max-w-xs", async () => {
    const campo = await montarFormulario(true);
    const caixa = campo.parentElement!;
    expect(celular(caixa)).toBe("relative");
    expect(dePc(caixa)).toEqual(["lg:max-w-xs"]);
    // O campo em si não muda: o ícone (absolute right-4) continua preso à borda dele.
    expect(dePc(campo)).toEqual([]);
    expect(caixa.querySelector(".absolute")).not.toBeNull();
  });

  it("sem a opção (checkout) o campo fica byte a byte como era", async () => {
    const campo = await montarFormulario();
    const caixa = campo.parentElement!;
    expect(caixa.className).toBe("relative");
    const semOpcao = await montarFormulario(false);
    expect(semOpcao.parentElement!.className).toBe("relative");
  });

  it("só a tela da conta liga a opção; o checkout não", () => {
    const tela = readFileSync("src/views/customer/AddressFormView.tsx", "utf8");
    const checkout = readFileSync(
      "src/views/customer/CheckoutView.tsx",
      "utf8",
    );
    // Entre `<AddressForm` e o `/>` que o fecha: a prop precisa estar na tag.
    const tag = tela.slice(
      tela.indexOf("<AddressForm"),
      tela.indexOf("/>", tela.indexOf("cabecalho=")),
    );
    expect(tag).toMatch(/\bcepCompacto\b/);
    expect(checkout).not.toContain("cepCompacto");
  });
});
