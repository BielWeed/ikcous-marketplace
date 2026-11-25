// @vitest-environment jsdom
//
// Prova do salvar de um banner NOVO: o interruptor "Exibir textos e botão" do
// editor decide `showTextOverlay` na gravação. No modo SIMPLES (só a foto) o
// banner tem de ir ao banco com os textos escondidos, mesmo que o formulário
// nasça com `showTextOverlay: true`; no modo COMPLETO os textos ficam ligados.
// Sem isto, apagar a regra do modo simples gravava a campanha com título e
// botão na vitrine sem a lojista ter pedido.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  abrirMaisOpcoes,
  abrirNovoBannerPelaBarra,
  configurarTextos,
  escolherImagemPropria,
} from "./helpers/editor-de-banner";

const h = vi.hoisted(() => ({
  banners: [] as Record<string, unknown>[],
  updateBanner: vi.fn(),
  addBanner: vi.fn(),
  uploadBannerImage: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: h.banners,
    isLoaded: true,
    uploadBannerImage: h.uploadBannerImage,
    addBanner: h.addBanner,
    updateBanner: h.updateBanner,
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
  toast: {
    success: vi.fn(),
    error: h.toastError,
    info: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// No modo simples o botão se chama "Salvar Banner"; no completo, "Salvar
// Alterações" (mesma ação).
const botaoSalvar = () =>
  [...document.body.querySelectorAll("button")].find((b) =>
    ["Salvar Banner", "Salvar Alterações"].includes(
      b.textContent?.trim() ?? "",
    ),
  ) as HTMLButtonElement | undefined;

describe("AdminBannersView: o modo do editor decide se os textos vão escondidos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  // A primeira importação da tela é pesada: faz-se uma vez, fora do prazo de
  // cada teste, para a carga da máquina não derrubar o primeiro.
  beforeAll(async () => {
    await import("@/views/admin/AdminBannersView");
  }, 120_000);

  beforeEach(() => {
    vi.clearAllMocks();
    h.addBanner.mockResolvedValue({ id: "novo-1" });
    h.uploadBannerImage.mockResolvedValue(
      "https://proj.supabase.co/storage/v1/object/public/banners/nova.jpg",
    );
    h.banners = [
      {
        id: "banner-existente-1",
        imageUrl:
          "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
        title: "Campanha Ativa",
        link: "",
        position: "home_top",
        active: true,
        order: 1,
      },
    ];
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrirBannerNovoComFoto() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
    await abrirNovoBannerPelaBarra();
    await escolherImagemPropria();
    const entrada = document.getElementById(
      "banner-upload",
    ) as HTMLInputElement;
    Object.defineProperty(entrada, "files", {
      value: [new File(["x"], "foto.jpg", { type: "image/jpeg" })],
      configurable: true,
    });
    await act(async () => {
      entrada.dispatchEvent(new Event("change", { bubbles: true }));
      await esperar();
      await esperar();
    });
  }

  async function salvar() {
    expect(botaoSalvar()).toBeDefined();
    await act(async () => {
      botaoSalvar()?.click();
      await esperar();
      await esperar();
    });
  }

  it("modo simples (só a foto): grava com os textos escondidos", async () => {
    await abrirBannerNovoComFoto();
    await configurarTextos(false);
    await abrirMaisOpcoes();
    await salvar();

    expect(h.addBanner).toHaveBeenCalledTimes(1);
    expect(h.addBanner.mock.calls[0]?.[0]).toMatchObject({
      showTextOverlay: false,
    });
  });

  it("modo completo (com textos): grava com os textos ligados", async () => {
    await abrirBannerNovoComFoto();
    await configurarTextos(true);
    await abrirMaisOpcoes();
    await salvar();

    expect(h.addBanner).toHaveBeenCalledTimes(1);
    expect(h.addBanner.mock.calls[0]?.[0]).toMatchObject({
      showTextOverlay: true,
    });
  });
});
