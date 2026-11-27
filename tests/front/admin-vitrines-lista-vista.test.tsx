// @vitest-environment jsdom
//
// Caça 27/11 — vitrines da Home em dois aparelhos. Toda ação da tela
// (exibir/ocultar, subir/descer, renomear...) grava a lista INTEIRA de
// vitrines montada da cópia que a tela tem. O celular com a tela velha
// regravava a lista e desfazia o que o computador tinha acabado de mudar.
// Agora a tela diz ao `updateConfig` qual lista ela VIU — a mesma
// `config.homeSections` de onde a lista nova saiu — e o banco recusa se ela já
// mudou (aviso e releitura saem de dentro do `updateConfig`).
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

const lancamentos: Secao = {
  id: "new_arrivals",
  title: "Últimos Lançamentos",
  active: true,
  maxItems: 6,
  productIds: [],
  isCustom: false,
};
const ofertas: Secao = {
  id: "offers",
  title: "Ofertas Imperdíveis",
  active: true,
  maxItems: 6,
  productIds: [],
  isCustom: false,
};

let configDaLoja: { homeSections?: Secao[] } = {};
const updateConfig = vi.fn(
  async (_u: { homeSections: Secao[] }, _o?: unknown) => true,
);

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja, updateConfig }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { AdminCarouselsView } = await import("@/views/admin/AdminCarouselsView");

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar() {
  await act(async () => {
    raiz.render(createElement(AdminCarouselsView, { onNavigate: vi.fn() }));
  });
}

const porRotulo = (rotulo: string) => {
  const achado = Array.from(
    document.querySelectorAll<HTMLElement>("[aria-label]"),
  ).find((el) => el.getAttribute("aria-label") === rotulo);
  if (!achado) throw new Error(`sem elemento com aria-label ${rotulo}`);
  return achado;
};

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateConfig.mockReset();
  updateConfig.mockResolvedValue(true);
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

describe("vitrines — a gravação leva a lista que a tela viu", () => {
  it("ocultar uma vitrine manda, junto da lista nova, a lista de onde ela saiu", async () => {
    const vistas = [lancamentos, ofertas];
    configDaLoja = { homeSections: vistas };
    await montar();
    await clicar(porRotulo("Exibir na loja: Ofertas Imperdíveis"));

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig).toHaveBeenCalledWith(
      { homeSections: [lancamentos, { ...ofertas, active: false }] },
      { vistos: { homeSections: vistas } },
    );
  });

  it("descer uma vitrine manda a lista vista na ordem de antes", async () => {
    const vistas = [lancamentos, ofertas];
    configDaLoja = { homeSections: vistas };
    await montar();
    await clicar(porRotulo("Descer vitrine Últimos Lançamentos"));

    expect(updateConfig).toHaveBeenCalledWith(
      { homeSections: [ofertas, lancamentos] },
      { vistos: { homeSections: vistas } },
    );
  });

  it("loja sem vitrine salva: a lista vista vai vazia (undefined), não a de fábrica", async () => {
    configDaLoja = {};
    await montar();
    await clicar(porRotulo("Exibir na loja: Ofertas Imperdíveis"));

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const opcoes = updateConfig.mock.calls[0]?.[1] as {
      vistos: { homeSections?: unknown };
    };
    expect(opcoes.vistos).toHaveProperty("homeSections");
    expect(opcoes.vistos.homeSections).toBeUndefined();
  });
});
