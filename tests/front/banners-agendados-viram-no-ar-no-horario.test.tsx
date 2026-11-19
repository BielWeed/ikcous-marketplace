// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let listaDeBanners = [
  {
    id: "campanha-do-dia",
    imageUrl: "https://example.com/banner.jpg",
    title: "Campanha do almoço",
    link: "",
    position: "home_top" as const,
    active: true,
    order: 1,
    startDate: "2026-11-13T15:00:00.000Z",
    endDate: "2026-11-13T15:01:00.000Z",
  },
];
const refreshBanners = vi.fn();
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
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  refreshBanners.mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-13T14:50:00Z")); // 11h50 em SP
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
  localStorage.clear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function filtrar(situacao: string) {
  const filtro = hospedeiro.querySelector<HTMLSelectElement>(
    "#banner-status-filter",
  )!;
  await act(async () => {
    filtro.value = situacao;
    filtro.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("atualiza os filtros no início e no fim da agenda, sem reler o banco", async () => {
  const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
  await act(async () => {
    raiz.render(<AdminBannersView active onNavigate={vi.fn()} />);
  });
  await avancar(50);
  await filtrar("scheduled");
  const leiturasAntes = refreshBanners.mock.calls.length;
  const texto = () => hospedeiro.textContent ?? "";
  expect(texto()).toContain("Campanha do almoço");
  expect(texto()).toContain("0 ligados de 1");

  await avancar(599_949); // 1 ms antes do início
  expect(texto()).toContain("Campanha do almoço");
  await avancar(1);
  expect(texto()).toContain("Nenhum Banner encontrado");
  expect(texto()).toContain("1 ligados de 1");

  await filtrar("active");
  expect(texto()).toContain("Campanha do almoço");
  await avancar(60_000); // o último milissegundo ainda conta como no ar
  expect(texto()).toContain("Campanha do almoço");
  await avancar(1);
  expect(texto()).toContain("Nenhum Banner encontrado");
  expect(texto()).toContain("0 ligados de 1");
  await filtrar("expired");
  expect(texto()).toContain("Campanha do almoço");
  expect(refreshBanners).toHaveBeenCalledTimes(leiturasAntes);
});

it("refaz o filtro quando a campanha começa entre o render e o efeito", async () => {
  const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
  function Tela({ cruzarInicio }: { readonly cruzarInicio: boolean }) {
    useLayoutEffect(() => {
      if (cruzarInicio) vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    }, [cruzarInicio]);
    return <AdminBannersView active onNavigate={vi.fn()} />;
  }
  await act(async () => raiz.render(<Tela cruzarInicio={false} />));
  await avancar(50);
  await filtrar("scheduled");
  expect(hospedeiro.textContent).toContain("Campanha do almoço");

  vi.setSystemTime(new Date("2026-11-13T14:59:59.999Z"));
  listaDeBanners = [...listaDeBanners];
  await act(async () => raiz.render(<Tela cruzarInicio />));
  expect(hospedeiro.textContent).toContain("Nenhum Banner encontrado");
});
