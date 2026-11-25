// @vitest-environment jsdom
//
// Prova forte da lista de Banners do painel (25/11/2026, caça por mutação).
// Defeito de uma linha que os testes vizinhos deixavam passar: o filtro
// "Expirados" listava também o banner PAUSADO cuja data de fim já passou. Mas o
// cartão desse banner diz "Pausado" (não "Expirado"), então a lojista filtrava
// "Expirados" e via uma campanha que ela mesma desligou.
// Tabela de verdade escrita à mão, com o relógio parado em 13/11/2026 12h SP,
// para os quatro filtros de Situação: cada banner cai em UM filtro só.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const foto = "https://example.com/banner-de-teste.jpg";
const base = {
  imageUrl: foto,
  link: "",
  position: "home_top" as const,
};
const listaDeBanners = [
  { ...base, id: "b1", title: "Alfa no ar", active: true, order: 1 },
  {
    ...base,
    id: "b2",
    title: "Beta vencido",
    active: true,
    order: 2,
    endDate: "2026-11-12T12:00:00.000Z",
  },
  {
    ...base,
    id: "b3",
    title: "Gama pausado vencido",
    active: false,
    order: 3,
    endDate: "2026-11-12T12:00:00.000Z",
  },
  {
    ...base,
    id: "b4",
    title: "Delta agendado",
    active: true,
    order: 4,
    startDate: "2026-11-14T12:00:00.000Z",
  },
  {
    ...base,
    id: "b5",
    title: "Epsilon pausado agendado",
    active: false,
    order: 5,
    startDate: "2026-11-14T12:00:00.000Z",
  },
  {
    ...base,
    id: "b6",
    title: "Zeta fim distante",
    active: true,
    order: 6,
    endDate: "2026-11-20T12:00:00.000Z",
  },
];
const TITULOS = listaDeBanners.map((b) => b.title);

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: listaDeBanners,
    isLoaded: true,
    uploadBannerImage: vi.fn(),
    addBanner: vi.fn(),
    updateBanner: vi.fn(),
    deleteBanner: vi.fn(),
    deleteStorageFile: vi.fn(),
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useCoupons", () => ({ useCoupons: () => ({}) }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Banners — o filtro de Situação separa no ar, pausado, agendado e expirado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazem = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    armazem.clear();
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
    armazem.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(
        <AdminBannersView
          active
          onNavigate={vi.fn()}
          onSetBackOverride={vi.fn()}
        />,
      );
    });
    await avancar(50);
  }

  async function filtrar(situacao: string) {
    const filtro = hospedeiro.querySelector<HTMLSelectElement>(
      "#banner-status-filter",
    );
    if (!filtro) throw new Error("O filtro de Situação não está na tela");
    await act(async () => {
      filtro.value = situacao;
      filtro.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function titulosNaTela(): string[] {
    const texto = hospedeiro.textContent ?? "";
    return TITULOS.filter((titulo) => texto.includes(titulo));
  }

  it("sem filtro todos aparecem (controle da fixture)", async () => {
    await montar();
    expect(titulosNaTela()).toEqual(TITULOS);
  });

  it.each([
    { filtro: "active", esperados: ["Alfa no ar", "Zeta fim distante"] },
    {
      filtro: "paused",
      esperados: ["Gama pausado vencido", "Epsilon pausado agendado"],
    },
    { filtro: "scheduled", esperados: ["Delta agendado"] },
    { filtro: "expired", esperados: ["Beta vencido"] },
  ])("filtro '$filtro' mostra só $esperados", async ({ filtro, esperados }) => {
    await montar();
    await filtrar(filtro);
    expect(titulosNaTela()).toEqual(esperados);
  });
});
