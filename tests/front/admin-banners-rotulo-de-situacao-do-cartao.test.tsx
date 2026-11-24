// @vitest-environment jsdom
//
// A frase de situação de cada cartão da lista de banners: é ela que diz à
// lojista "este banner está no ar, agendado, expirado ou pausado". Errar aqui
// engana a dona da loja sem nenhum erro na tela: um banner PAUSADO que diz
// "No ar" faz ela achar que a campanha está rodando. A precedência é: pausado
// vence tudo; depois agendado (ainda não começou), expirado, e só então "No ar".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HORA = 60 * 60 * 1000;
const daqui = (ms: number) => new Date(Date.now() + ms).toISOString();

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

const banner = (extra: Partial<BannerDeTeste> = {}): BannerDeTeste => ({
  id: "topo",
  imageUrl: "https://proj.supabase.co/storage/v1/object/public/banners/t.jpg",
  title: "Campanha",
  link: "",
  position: "home_top",
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

describe("a frase de situação do cartão do banner", () => {
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

  /** A frase que o cartão do único banner mostra. */
  async function frase(extra: Partial<BannerDeTeste>): Promise<string> {
    h.banners = [banner(extra)];
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
    const frases = Array.from(
      hospedeiro.querySelectorAll("span.truncate.font-medium"),
    ).map((el) => el.textContent ?? "");
    expect(frases).toHaveLength(1);
    return frases[0] ?? "";
  }

  it("ligado e sem datas: 'No ar'", async () => {
    expect(await frase({})).toBe("No ar");
  });

  it("pausado diz 'Pausado', mesmo dentro das datas", async () => {
    expect(
      await frase({
        active: false,
        startDate: daqui(-HORA),
        endDate: daqui(HORA),
      }),
    ).toBe("Pausado");
  });

  it("pausado e já vencido continua dizendo 'Pausado'", async () => {
    expect(await frase({ active: false, endDate: daqui(-HORA) })).toBe(
      "Pausado",
    );
  });

  it("ainda não começou: 'Agendado'", async () => {
    expect(await frase({ startDate: daqui(HORA) })).toContain(
      "Agendado — entra no ar",
    );
  });

  it("o fim já passou: 'Expirado'", async () => {
    expect(await frase({ endDate: daqui(-HORA) })).toContain(
      "Expirado — saiu do ar",
    );
  });

  it("no ar com data de fim: diz quando expira", async () => {
    expect(
      await frase({ startDate: daqui(-HORA), endDate: daqui(HORA) }),
    ).toContain("No ar — expira");
  });

  it("no ar só com data de início: diz quando começou", async () => {
    expect(await frase({ startDate: daqui(-HORA) })).toContain(
      "No ar — começou",
    );
  });
});
