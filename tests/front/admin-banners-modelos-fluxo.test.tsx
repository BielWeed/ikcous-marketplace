// @vitest-environment jsdom
//
// Painel de banners: o destino que o painel SUGERE e GRAVA tem que existir na
// loja.
//
//  - "Página da Loja" nascia com `/produtos`, endereço que a loja não tem: a
//    cliente tocava e nada acontecia. Agora nasce `/` (a Home) e a lista de
//    páginas não oferece mais `/produtos`.
//  - O atalho "Categoria: Cama & Banho" montava `/?category=Cama & Banho` cru;
//    o "&" cortava o nome. Agora o nome vai codificado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadBannerImage = vi.fn();
const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn().mockResolvedValue(undefined);
const lista = vi.hoisted(() => ({ banners: [] as unknown[] }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: lista.banners,
    isLoaded: true,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner: vi.fn(),
    deleteStorageFile,
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [
      {
        id: "produto-1",
        name: "Camiseta teste",
        images: ["https://loja.test/produto.webp"],
        price: 89.9,
      },
    ],
  }),
}));
vi.mock("@/hooks/useCoupons", () => ({ useCoupons: () => ({}) }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [
      { id: "c1", name: "Cama & Banho", isActive: true },
      { id: "c2", name: "Mais+Vendidos", isActive: true },
      { id: "c3", name: "Moda #1", isActive: true },
    ],
  }),
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

describe("novo editor de banners prontos", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    lista.banners = [
      {
        id: "antigo",
        title: "Campanha anterior",
        subtitle: "Texto preservado",
        templateType: "split_left",
        imageUrl: "https://loja.test/antiga.webp",
        position: "home_top",
        active: true,
        order: 1,
        link: "/",
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
  async function montar() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () =>
      raiz.render(<AdminBannersView active onNavigate={vi.fn()} />),
    );
  }
  async function clicar(texto: string) {
    const botao = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    expect(botao, texto).toBeTruthy();
    await act(async () => botao!.click());
  }
  async function modelo() {
    await montar();
    await clicar("Novo Banner");
    await clicar("Modelo pronto");
    await clicar("Destaque");
    await clicar("Usar o modelo Destaque");
  }
  async function campo(id: string, valor: string) {
    const el = host.querySelector<HTMLInputElement>(id)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(el, valor);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => new Promise((r) => setTimeout(r, 250)));
  }
  it("modelo → produto → salvar grava foto, destino, textos e cor da loja", async () => {
    await modelo();
    await clicar("Camiseta teste");
    await campo("#banner-title", "Coleção nova");
    await campo("#banner-subtitle", "A partir de R$ 89,90");
    await campo("#banner-btn-text", "Comprar");
    await campo("#banner-badge", "NOVO");
    await clicar("Loja");
    await clicar("Salvar Banner");
    expect(addBanner).toHaveBeenCalledWith(
      expect.objectContaining({
        templateType: "pronto_destaque",
        productId: "produto-1",
        link: "/product-detail?id=produto-1",
        imageUrl: "https://loja.test/produto.webp",
        overlayColor: "#FFBF00",
        title: "Coleção nova",
        subtitle: "A partir de R$ 89,90",
        buttonText: "Comprar",
        badgeText: "NOVO",
      }),
    );
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });
  it("escolher produto recolhe a busca e Trocar permite escolher de novo", async () => {
    await modelo();
    await clicar("Camiseta teste");
    expect(host.querySelector("#banner-product-search")).toBeNull();
    await clicar("Trocar");
    expect(host.querySelector("#banner-product-search")).not.toBeNull();
  });
  it("imagem criada com IA passa pelo mesmo upload e vira imagem própria", async () => {
    uploadBannerImage.mockResolvedValueOnce("https://loja.test/ia.webp");
    await montar();
    await clicar("Novo Banner");
    await clicar("Criar com IA");
    const entrada = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const arquivo = new File(["imagem"], "ia.webp", { type: "image/webp" });
    Object.defineProperty(entrada, "files", {
      value: [arquivo],
      configurable: true,
    });
    await act(async () =>
      entrada.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(host.textContent).toContain("Imagem própria");
    expect(uploadBannerImage).toHaveBeenCalledWith(arquivo);
    await clicar("Salvar Banner");
    expect(addBanner).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: "https://loja.test/ia.webp",
        templateType: "default",
      }),
    );
  });
  it("limita os quatro textos sem limitar o link", async () => {
    await modelo();
    for (const [id, limite] of [
      ["banner-title", 60],
      ["banner-subtitle", 80],
      ["banner-btn-text", 24],
      ["banner-badge", 20],
    ] as const) {
      expect(host.querySelector<HTMLInputElement>(`#${id}`)?.maxLength).toBe(
        limite,
      );
    }
  });
  it("banner antigo abre como imagem própria e salva sem converter ou perder seus textos", async () => {
    await montar();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[title="Editar"]')!.click(),
    );
    expect(host.textContent).toContain("Imagem própria");
    expect(host.querySelector<HTMLInputElement>("#banner-title")?.value).toBe(
      "Campanha anterior",
    );
    await clicar("Salvar Alterações");
    expect(updateBanner).toHaveBeenCalledWith(
      "antigo",
      expect.objectContaining({
        templateType: "split_left",
        title: "Campanha anterior",
        subtitle: "Texto preservado",
      }),
    );
  });
  it("recuperar e cancelar rascunho limpa apenas seu upload ainda não publicado", async () => {
    localStorage.setItem(
      "admin_banner_form_draft:lojista-1",
      JSON.stringify({
        formData: {
          title: "Rascunho",
          imageUrl: "https://loja.test/rascunho.webp",
          position: "home_top",
          order: 2,
          active: true,
        },
        imagemEnviadaNaoSalva: "https://loja.test/rascunho.webp",
        savedAt: "2026-10-21T00:00:00Z",
      }),
    );
    await montar();
    await clicar("Novo Banner");
    await clicar("Usar minha imagem");
    await clicar("Recuperar");
    await clicar("Cancelar");
    expect(deleteStorageFile).toHaveBeenCalledExactlyOnceWith(
      "https://loja.test/rascunho.webp",
    );
  });
  it("sugestões e limpar botão continuam disponíveis na imagem própria", async () => {
    await montar();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[title="Editar"]')!.click(),
    );
    const mais = [...host.querySelectorAll("summary")].find(
      (s) => s.textContent === "Mais opções",
    )!;
    await act(async () => mais.click());
    await clicar("Comprar Agora");
    expect(
      host.querySelector<HTMLInputElement>("#banner-btn-text")?.value,
    ).toBe("Comprar Agora");
    await clicar("Limpar botão");
    await clicar("Salvar Alterações");
    expect(updateBanner).toHaveBeenCalledWith(
      "antigo",
      expect.objectContaining({ buttonText: "" }),
    );
  });
  it("cancelar um modelo com foto do produto nunca exclui a imagem do cadastro", async () => {
    await modelo();
    await clicar("Camiseta teste");
    await clicar("Cancelar");
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });
});
