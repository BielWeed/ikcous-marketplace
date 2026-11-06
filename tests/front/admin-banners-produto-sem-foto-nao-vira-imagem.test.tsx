// @vitest-environment jsdom
//
// Painel de banners: produto SEM foto não pode virar banner com a imagem cinza
// "Sem Imagem" de um site de fora.
//
// A camada de exibição entrega ao produto sem foto uma imagem de reserva
// (https://placehold.co/...). O modelo pronto copiava `images[0]` como imagem do
// banner, então o "Salvar" passava e a vitrine mostrava o cartão cinza. Agora a
// reserva não conta como foto: a imagem fica vazia e o "Salvar" avisa que a
// imagem é obrigatória, em vez de criar o banner calado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abrirNovoBannerPelaBarra } from "./helpers/editor-de-banner";

const addBanner = vi.fn();
const lista = vi.hoisted(() => ({
  products: [] as {
    id: string;
    name: string;
    images: string[];
    price: number;
  }[],
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [],
    isLoaded: true,
    uploadBannerImage: vi.fn(),
    addBanner,
    updateBanner: vi.fn(),
    deleteBanner: vi.fn(),
    deleteStorageFile: vi.fn().mockResolvedValue(undefined),
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: lista.products }),
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
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "t"),
  },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("banner de modelo pronto com produto sem foto", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    lista.products = [
      {
        id: "sem-foto",
        name: "Produto sem foto",
        images: ["https://placehold.co/400x400?text=Sem+Imagem"],
        price: 20,
      },
      {
        id: "com-foto",
        name: "Produto com foto",
        images: ["https://loja.test/produto.webp"],
        price: 30,
      },
    ];
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    vi.spyOn(history, "back").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function clicar(texto: string) {
    const botao = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    expect(botao, texto).toBeTruthy();
    await act(async () => botao!.click());
  }
  async function modelo() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () =>
      raiz.render(<AdminBannersView active onNavigate={vi.fn()} />),
    );
    await abrirNovoBannerPelaBarra();
    await clicar("Modelo pronto");
    await clicar("Destaque");
    await clicar("Usar o modelo Destaque");
  }

  it("a imagem de reserva do produto não é gravada como imagem do banner: Salvar avisa que falta imagem", async () => {
    await modelo();
    await clicar("Produto sem foto");
    await clicar("Salvar Banner");
    expect(toast.error).toHaveBeenCalledWith("Imagem é obrigatória");
    expect(addBanner).not.toHaveBeenCalled();
  });

  it("controle: produto com foto de verdade segue gravando a foto dele", async () => {
    await modelo();
    await clicar("Produto com foto");
    await clicar("Salvar Banner");
    expect(addBanner).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: "https://loja.test/produto.webp" }),
    );
  });
});
