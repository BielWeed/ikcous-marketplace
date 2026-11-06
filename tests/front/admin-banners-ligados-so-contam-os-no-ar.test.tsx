// @vitest-environment jsdom
//
// "Opções da lista · N ligados de M" e "Preenchimento: Máximo" contavam todo
// banner com o botão "ligado", mesmo vencido ou agendado: a vitrine ficava
// vazia e o painel dizia "Máximo". Agora só conta o que está NO AR — a mesma
// regra do filtro "Ativos" e do rótulo do cartão ("No ar", "Agendado", "Expirado").
import { estaNoAr } from "@/lib/datas-do-banner";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HORA = 60 * 60 * 1000;
const daqui = (ms: number) => new Date(Date.now() + ms).toISOString();

describe("estaNoAr", () => {
  const agora = new Date("2026-11-06T12:00:00.000Z");
  const um = (extra: {
    active?: boolean;
    startDate?: string | null;
    endDate?: string | null;
  }) => ({
    active: true,
    ...extra,
  });
  it("ligado e sem datas está no ar", () => {
    expect(estaNoAr(um({}), agora)).toBe(true);
  });
  it("pausado nunca está no ar, mesmo dentro das datas", () => {
    expect(
      estaNoAr(
        um({
          active: false,
          startDate: "2026-11-01T00:00:00.000Z",
          endDate: "2026-11-30T00:00:00.000Z",
        }),
        agora,
      ),
    ).toBe(false);
  });
  it("agendado (início no futuro) não está no ar", () => {
    expect(estaNoAr(um({ startDate: "2026-11-07T00:00:00.000Z" }), agora)).toBe(
      false,
    );
  });
  it("vencido (fim no passado) não está no ar", () => {
    expect(estaNoAr(um({ endDate: "2026-11-05T00:00:00.000Z" }), agora)).toBe(
      false,
    );
  });
  it("dentro da janela, e nas bordas, está no ar", () => {
    expect(
      estaNoAr(
        um({
          startDate: "2026-11-01T00:00:00.000Z",
          endDate: "2026-11-30T00:00:00.000Z",
        }),
        agora,
      ),
    ).toBe(true);
    expect(estaNoAr(um({ startDate: agora.toISOString() }), agora)).toBe(true);
    expect(estaNoAr(um({ endDate: agora.toISOString() }), agora)).toBe(true);
  });
  it("datas vazias (null) contam como sem limite", () => {
    expect(estaNoAr(um({ startDate: null, endDate: null }), agora)).toBe(true);
  });
});

type BannerDeTeste = {
  id: string;
  imageUrl: string;
  title: string;
  link: string;
  position: "home_top" | "home_middle" | "home_bottom";
  active: boolean;
  order: number;
  startDate?: string | null;
  endDate?: string | null;
};
const banner = (
  id: string,
  position: BannerDeTeste["position"],
  extra: Partial<BannerDeTeste> = {},
): BannerDeTeste => ({
  id,
  imageUrl: `https://proj.supabase.co/storage/v1/object/public/banners/${id}.jpg`,
  title: id,
  link: "",
  position,
  active: true,
  order: 1,
  ...extra,
});

const h = vi.hoisted(() => ({ banners: [] as unknown[] }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: h.banners,
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
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "toast-id") },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("painel de banners — 'ligados' e 'Preenchimento' só contam o que está no ar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    const armazem = new Map<string, string>();
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

  async function montar(banners: BannerDeTeste[]) {
    h.banners = banners;
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(
        <AdminBannersView
          onNavigate={vi.fn()}
          active={true}
          onSetBackOverride={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const resumo = hospedeiro.querySelector("details summary")?.textContent;
    const preenchimento = hospedeiro.querySelector("details p")?.textContent;
    return { resumo: resumo ?? "", preenchimento: preenchimento ?? "" };
  }

  it("banner de topo vencido: 0 ligados e Preenchimento Nenhum", async () => {
    const { resumo, preenchimento } = await montar([
      banner("topo", "home_top", { endDate: daqui(-HORA) }),
    ]);
    expect(resumo).toContain("0 ligados de 1");
    expect(preenchimento).toContain("Preenchimento: Nenhum.");
  });

  it("banner de topo agendado: 0 ligados e Preenchimento Nenhum", async () => {
    const { resumo, preenchimento } = await montar([
      banner("topo", "home_top", { startDate: daqui(HORA) }),
    ]);
    expect(resumo).toContain("0 ligados de 1");
    expect(preenchimento).toContain("Preenchimento: Nenhum.");
  });

  it("banner no ar conta, e só ele define o Preenchimento", async () => {
    const { resumo, preenchimento } = await montar([
      banner("topo", "home_top", {
        startDate: daqui(-HORA),
        endDate: daqui(HORA),
      }),
      banner("meio", "home_middle", { endDate: daqui(-HORA) }),
      banner("base", "home_bottom", { startDate: daqui(HORA) }),
    ]);
    expect(resumo).toContain("1 ligados de 3");
    expect(preenchimento).toContain("Preenchimento: Moderado.");
  });

  it("topo e meio no ar com a base vencida: Alto", async () => {
    const { resumo, preenchimento } = await montar([
      banner("topo", "home_top"),
      banner("meio", "home_middle"),
      banner("base", "home_bottom", { endDate: daqui(-HORA) }),
    ]);
    expect(resumo).toContain("2 ligados de 3");
    expect(preenchimento).toContain("Preenchimento: Alto.");
  });

  it("as três posições no ar: Máximo", async () => {
    const { resumo, preenchimento } = await montar([
      banner("topo", "home_top"),
      banner("meio", "home_middle"),
      banner("base", "home_bottom"),
    ]);
    expect(resumo).toContain("3 ligados de 3");
    expect(preenchimento).toContain("Preenchimento: Máximo.");
  });
});
