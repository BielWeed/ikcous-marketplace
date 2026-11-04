// @vitest-environment jsdom
//
// VITRINE QUE PASSA DO MÁXIMO — a loja corta a vitrine em "Quantos produtos
// mostrar", mas o painel marcava o 7º de 6 como se estivesse na vitrine, sem
// dizer nada. Os marcados além do máximo só entram se algum dos primeiros for
// pausado (a loja corta DEPOIS de tirar os pausados). O comportamento da loja
// não muda: a lojista só passa a ser avisada.
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
const PRODUTOS = ["p1", "p2", "p3", "p4", "p5"].map((id, i) =>
  produto(id, 10 - i),
);

let configDaLoja: { homeSections?: Secao[] } = {};
const updateConfig = vi.fn(async (_: unknown) => true);

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja, updateConfig }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: PRODUTOS }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
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

async function abrirKits() {
  await act(async () => {
    raiz.render(createElement(AdminCarouselsView, { onNavigate: vi.fn() }));
  });
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

const botaoDaQuantidade = (n: number) =>
  Array.from(painel()?.querySelectorAll<HTMLElement>("button") ?? []).find(
    (b) => b.textContent?.trim() === String(n),
  ) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("vitrine que passa do máximo avisa a lojista", () => {
  it("marcar um produto além do máximo grava e diz que ele só entra se outro for pausado", async () => {
    configDaLoja = { homeSections: [kits(4, ["p1", "p2", "p3", "p4"])] };
    await abrirKits();
    await clicar(produtoNaFolha("p5"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    const [titulo, opcoes] = toastInfo.mock.calls[0] as [
      string,
      { description: string },
    ];
    expect(titulo).toContain("4 produtos");
    expect(opcoes.description).toContain("pausado");
  });

  it("marcar dentro do máximo não avisa nada", async () => {
    configDaLoja = { homeSections: [kits(4, ["p1", "p2"])] };
    await abrirKits();
    await clicar(produtoNaFolha("p3"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("baixar a quantidade abaixo do que já está escolhido avisa", async () => {
    configDaLoja = {
      homeSections: [kits(8, ["p1", "p2", "p3", "p4", "p5", "p6"])],
    };
    await abrirKits();
    await clicar(botaoDaQuantidade(4));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect((toastInfo.mock.calls[0] as [string])[0]).toContain("4 produtos");
  });

  it("baixar a quantidade sem passar do que está escolhido não avisa", async () => {
    configDaLoja = { homeSections: [kits(8, ["p1", "p2"])] };
    await abrirKits();
    await clicar(botaoDaQuantidade(4));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
  });
});
