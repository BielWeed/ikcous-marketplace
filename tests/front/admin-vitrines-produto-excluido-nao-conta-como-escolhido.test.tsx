// @vitest-environment jsdom
//
// VITRINE COM PRODUTO EXCLUÍDO — a lista de ids gravada na vitrine pode ter
// produto que já foi excluído da loja. O painel contava e numerava esse id
// morto como se estivesse na vitrine: "3 escolhidos" com 2 na loja, o número
// do primeiro produto vivo saía 2, e o aviso de "passou do máximo" disparava
// à toa. Agora só os ids que ainda existem no catálogo contam; e enquanto o
// catálogo não carregou a lista não é filtrada (senão ela zeraria).
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Secao = {
  id: string;
  title: string;
  active: boolean;
  maxItems?: number;
  productIds?: string[];
  isCustom?: boolean;
};

const produto = (id: string, criado: number) => ({
  id,
  name: `Produto ${id}`,
  price: 50,
  category: "Perfumaria",
  images: [`https://img.exemplo/${id}.jpg`],
  stock: 5,
  isActive: true,
  createdTime: criado,
});

const estado = {
  products: [] as ReturnType<typeof produto>[],
  loadingProducts: false,
  catalogoErro: false,
  config: {} as { homeSections?: Secao[] },
};
const updateConfig = vi.fn(async (_: unknown) => true);
const toastInfo = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estado.config,
    updateConfig,
    fetchProducts: vi.fn(async () => {}),
    loadingProducts: estado.loadingProducts,
    catalogoErro: estado.catalogoErro,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.products }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: toastInfo },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { AdminCarouselsView } = await import("@/views/admin/AdminCarouselsView");

let raiz: Root;
let hospedeiro: HTMLDivElement;

const kits = (maxItems: number, productIds: string[]): Secao => ({
  id: "custom_1",
  title: "Kits de presente",
  active: true,
  maxItems,
  productIds,
  isCustom: true,
});

const painel = () => document.querySelector<HTMLElement>('[role="dialog"]');

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

async function montar() {
  await act(async () => {
    raiz.render(createElement(AdminCarouselsView, { onNavigate: vi.fn() }));
  });
}

async function abrirKits() {
  await montar();
  const editar = document.querySelector<HTMLElement>(
    '[aria-label="Editar vitrine Kits de presente"]',
  );
  if (!editar) throw new Error("sem o botão de editar a vitrine");
  await clicar(editar);
}

const produtoNaFolha = (id: string) =>
  painel()?.querySelector<HTMLElement>(
    `[data-produto-id="${id}"]`,
  ) as HTMLElement;

const numeroNaFolha = (id: string) =>
  produtoNaFolha(id)?.querySelector("[aria-hidden='true']:last-child")
    ?.textContent;

const cartao = () =>
  document.querySelector<HTMLElement>('[data-testid="cartao-vitrine"]');

const idsGravados = (): string[] => {
  const chamada = updateConfig.mock.calls.at(-1)?.[0] as
    | { homeSections: Secao[] }
    | undefined;
  return (
    chamada?.homeSections.find((s) => s.id === "custom_1")?.productIds ?? []
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  estado.products = ["p1", "p2", "p3", "p4"].map((id, i) =>
    produto(id, 10 - i),
  );
  estado.loadingProducts = false;
  estado.catalogoErro = false;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("vitrine: produto excluído não conta como escolhido", () => {
  it("o cartão conta só os escolhidos que ainda existem", async () => {
    estado.config = { homeSections: [kits(6, ["morto", "p1", "p2"])] };
    await montar();
    const texto = cartao()?.textContent ?? "";
    expect(texto).toContain("2 escolhidos");
    expect(texto).toContain("Escolhidos (2)");
    expect(texto).not.toContain("3 escolhidos");
  });

  it("a folha numera a partir do primeiro produto vivo", async () => {
    estado.config = { homeSections: [kits(6, ["morto", "p1", "p2"])] };
    await abrirKits();
    expect(numeroNaFolha("p1")).toBe("1");
    expect(numeroNaFolha("p2")).toBe("2");
  });

  it("marcar um produto não avisa de 'passou do máximo' por causa do id morto", async () => {
    estado.config = { homeSections: [kits(2, ["morto", "p1"])] };
    await abrirKits();
    await clicar(produtoNaFolha("p2"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
    // A lista gravada fica crua: o catálogo da tela pode ser parcial e podar
    // apagaria produto pausado. Id morto na lista é inofensivo.
    expect(idsGravados()).toEqual(["morto", "p1", "p2"]);
  });

  it("gravar um toque NUNCA tira da lista um id que o catálogo da tela não mostra (catálogo parcial, ex.: vista pública sem pausados)", async () => {
    estado.config = {
      homeSections: [kits(6, ["pausado-fora-do-catalogo", "p1"])],
    };
    await abrirKits();
    await clicar(produtoNaFolha("p2"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(idsGravados()).toEqual(["pausado-fora-do-catalogo", "p1", "p2"]);
  });

  it("baixar a quantidade não avisa por causa do id morto", async () => {
    estado.config = {
      homeSections: [kits(8, ["morto", "p1", "p2", "p3", "p4"])],
    };
    await abrirKits();
    const botaoDe4 = Array.from(
      painel()?.querySelectorAll<HTMLElement>("button") ?? [],
    ).find((b) => b.textContent?.trim() === "4") as HTMLElement;
    await clicar(botaoDe4);
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("catálogo ainda carregando: a lista não é filtrada (senão zerava)", async () => {
    estado.products = [];
    estado.loadingProducts = true;
    estado.config = { homeSections: [kits(6, ["p1", "p2", "p3"])] };
    await montar();
    expect(cartao()?.textContent ?? "").toContain("3 escolhidos");
  });
});
