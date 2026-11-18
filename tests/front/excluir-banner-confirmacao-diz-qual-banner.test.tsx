// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { primaryColor: "#FFBF00", shippingCoverage: "national" },
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));
const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function clicar(seletor: string) {
  const botao = document.querySelector<HTMLButtonElement>(seletor);
  expect(botao).not.toBeNull();
  await act(async () => botao!.click());
}

const dados = vi.hoisted(() => ({
  banner: {
    id: "b-1",
    imageUrl: "https://example.com/banner.jpg",
    title: "Semana do algodão",
    buttonText: "Ver ofertas",
    link: "/ofertas",
    startDate: "2026-12-01T12:00:00Z",
    endDate: "2026-12-10T12:00:00Z",
    position: "home_top",
    active: true,
    order: 1,
  },
  apagar: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [dados.banner],
    isLoaded: true,
    deleteBanner: dados.apagar,
    uploadBannerImage: vi.fn(),
    addBanner: vi.fn(),
    updateBanner: vi.fn(),
    deleteStorageFile: vi.fn(),
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
it("identifica o banner pelo título ou botão e mostra o período antes de excluir", async () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
  await act(async () =>
    root.render(<AdminBannersView onNavigate={vi.fn()} active />),
  );
  await clicar('button[title="Excluir"]');
  let dialogo = document.querySelector('[role="alertdialog"]')!;
  expect(dialogo.textContent).toContain("Semana do algodão");
  expect(dialogo.textContent).toContain("01/12/2026");
  expect(dialogo.textContent).toContain("10/12/2026");
  expect(dados.apagar).not.toHaveBeenCalled();
  await act(async () => {
    [...dialogo.querySelectorAll("button")]
      .find((b) => b.textContent === "Cancelar")!
      .click();
  });
  dados.banner.title = "";
  await clicar('button[title="Excluir"]');
  dialogo = document.querySelector('[role="alertdialog"]')!;
  expect(dialogo.textContent).toContain("Ver ofertas");
});
