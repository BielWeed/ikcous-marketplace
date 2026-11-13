// @vitest-environment jsdom
//
// Defeito: no painel o relógio de programação dos banners é desligado
// (`adminMode`), e o filtro "Agendados"/"Expirados" da lista era memorizado só
// por banners, busca e filtro. Com a tela aberta de 23h59 a 00h01 (São Paulo),
// o banner agendado para a meia-noite seguia na lista de "Agendados" e a
// contagem de "ligados" ficava em ontem. Agora o dia da loja
// (`useDiaDeSaoPaulo`) redesenha a tela na virada e entra nas dependências do
// filtro memorizado. Relógio falso cruzando a meia-noite de São Paulo (03:00Z).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ANTES_DA_MEIA_NOITE = "2026-11-13T02:59:50Z"; // 12/11, 23:59:50 em SP

// Entra no ar à meia-noite de 13/11 em São Paulo (03:00Z). Lista ESTÁVEL entre
// renderizações (como a do hook real): sem isso o memo do filtro nunca valeria.
const bannerAgendado = {
  id: "banner-da-virada",
  imageUrl:
    "https://proj.supabase.co/storage/v1/object/public/banners/banner-da-virada.jpg",
  title: "Campanha da virada",
  link: "",
  position: "home_top" as const,
  active: true,
  order: 1,
  startDate: "2026-11-13T03:00:00.000Z",
};
const listaDeBanners = [bannerAgendado];
const refreshBanners = vi.fn<() => void>();

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
    refreshBanners,
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
  toast: {
    success: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    loading: vi.fn(() => "toast-id"),
  },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("AdminBannersView — acompanha a virada do dia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    refreshBanners.mockReset();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(ANTES_DA_MEIA_NOITE));
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
    vi.useRealTimers();
  });

  async function montar(ativa: boolean) {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(
        <AdminBannersView
          onNavigate={vi.fn()}
          active={ativa}
          onSetBackOverride={vi.fn()}
        />,
      );
    });
    await avancar(50);
  }

  async function filtrarPorAgendados() {
    const filtro = hospedeiro.querySelector<HTMLSelectElement>(
      "#banner-status-filter",
    );
    if (!filtro) throw new Error("filtro de situação não encontrado");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set?.call(filtro, "scheduled");
      filtro.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  it("o banner agendado para a meia-noite sai de 'Agendados' e conta como ligado, sem a lojista tocar em nada", async () => {
    await montar(true);
    await filtrarPorAgendados();
    expect(texto()).toContain("0 ligados de 1");
    expect(texto()).not.toContain("Nenhum Banner encontrado");

    await avancar(12_000); // o temporizador da meia-noite dispara aos ~11 s

    expect(texto()).toContain("1 ligados de 1");
    expect(texto()).toContain("Nenhum Banner encontrado");
  });

  it("controle: sem virada de dia, o banner segue em 'Agendados'", async () => {
    await montar(true);
    await filtrarPorAgendados();
    await avancar(5_000);
    expect(texto()).toContain("0 ligados de 1");
    expect(texto()).not.toContain("Nenhum Banner encontrado");
  });

  it("não relê os banners no banco por causa da virada (só redesenha)", async () => {
    await montar(true);
    const antes = refreshBanners.mock.calls.length;
    await avancar(12_000);
    expect(refreshBanners.mock.calls.length).toBe(antes);
  });

  it("tela inativa não arma relógio de virada", async () => {
    await montar(false);
    const antes = vi.getTimerCount();
    await avancar(12_000);
    expect(texto()).toContain("0 ligados de 1");
    expect(vi.getTimerCount()).toBeLessThanOrEqual(antes);
  });
});
