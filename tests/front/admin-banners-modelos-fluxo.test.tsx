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
const lista = vi.hoisted(() => ({
  banners: [] as unknown[],
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
    products: lista.products,
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
    lista.products = [
      {
        id: "produto-1",
        name: "Camiseta teste",
        images: ["https://loja.test/produto.webp"],
        price: 89.9,
      },
    ];
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
  it("ações do cartão podem quebrar a linha sem diminuir os botões", async () => {
    await montar();
    const excluir = host.querySelector<HTMLButtonElement>(
      'button[title="Excluir"]',
    )!;
    const editar = host.querySelector<HTMLButtonElement>(
      'button[title="Editar"]',
    )!;
    const acoes = excluir.parentElement!.parentElement!;
    expect(acoes.classList.contains("flex-wrap")).toBe(true);
    for (const botao of [excluir, editar]) {
      expect(botao.classList.contains("size-11")).toBe(true);
    }
  });
  it("cartão pausado mantém texto legível sem opacidade no conjunto", async () => {
    lista.banners = [
      {
        id: "pausado",
        title: "Pausado teste",
        imageUrl: "https://loja.test/banner.webp",
        position: "home_top",
        active: false,
        order: 1,
        link: "/product-detail?id=p-1",
      },
    ];
    await montar();
    const cartao = host
      .querySelector('button[title="Excluir"]')!
      .closest(".group")!;
    expect(cartao.classList.contains("opacity-60")).toBe(false);
    expect(cartao.querySelector(".text-zinc-500")).toBeNull();
    expect(
      cartao.querySelector("h3")!.classList.contains("text-zinc-400"),
    ).toBe(true);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[title="Excluir"]')!.click(),
    );
    const cancelar = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Cancelar",
    )!;
    expect(cancelar.classList.contains("text-zinc-200")).toBe(true);
    expect(cancelar.classList.contains("bg-admin-raised")).toBe(true);
    expect(cancelar.classList.contains("dark:bg-admin-raised")).toBe(true);
    const confirmar = [
      ...document.querySelectorAll('[role="alertdialog"] button'),
    ].find((b) => b.textContent?.trim().includes("Excluir"))!;
    expect(confirmar.classList.contains("bg-red-600")).toBe(true);
  });
  it("botões principais e chips mantêm contorno independente da borda base", async () => {
    await montar();
    await clicar("Novo Banner");
    const verificarAnel = (botao: Element) => {
      for (const classe of [
        "ring-1",
        "ring-inset",
        "ring-admin-border-strong",
      ]) {
        expect(botao.classList.contains(classe), classe).toBe(true);
      }
    };
    verificarAnel(
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Modelo pronto",
      )!,
    );
    await clicar("Modelo pronto");
    for (const botao of host.querySelectorAll(
      '[aria-label="Tipos de modelo"] button',
    )) {
      verificarAnel(botao);
    }
    await clicar("Usar o modelo Destaque");
    verificarAnel(
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Salvar Banner",
      )!,
    );
    verificarAnel(
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Loja",
      )!,
    );
  });
  it("chips de cor da imagem própria também mantêm contorno", async () => {
    await montar();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[title="Editar"]')!.click(),
    );
    const cores = host.querySelectorAll("button[aria-label][style]");
    expect(cores.length).toBeGreaterThan(0);
    for (const cor of cores) {
      expect(cor.classList.contains("ring-1")).toBe(true);
      expect(cor.classList.contains("ring-inset")).toBe(true);
      expect(cor.classList.contains("ring-admin-border-strong")).toBe(true);
    }
  });
  it("switch do cartão mantém trilho pequeno em alvo transparente de 44 px", async () => {
    await montar();
    const interruptor =
      host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(interruptor.classList.contains("min-h-11")).toBe(false);
    expect(interruptor.classList.contains("min-w-11")).toBe(false);
    const alvo = interruptor.closest("label")!;
    expect(alvo).not.toBeNull();
    expect(alvo.htmlFor).toBe(interruptor.id);
    expect(alvo.classList.contains("size-11")).toBe(true);
    expect(
      interruptor.classList.contains(
        "data-[state=unchecked]:bg-admin-border-strong",
      ),
    ).toBe(true);
    expect(
      interruptor.classList.contains(
        "dark:data-[state=unchecked]:bg-admin-border-strong",
      ),
    ).toBe(true);
    await act(async () => alvo.click());
    expect(updateBanner).toHaveBeenCalledWith("antigo", { active: false });
  });
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
  async function enviarFoto() {
    uploadBannerImage.mockResolvedValueOnce("https://loja.test/enviada.webp");
    const entrada = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(entrada, "files", {
      value: [new File(["imagem"], "banner.webp", { type: "image/webp" })],
      configurable: true,
    });
    await act(async () =>
      entrada.dispatchEvent(new Event("change", { bubbles: true })),
    );
  }
  it("imagem própria → produto sem modelo preserva o upload ao salvar", async () => {
    await montar();
    await clicar("Novo Banner");
    await clicar("Usar minha imagem");
    await enviarFoto();
    await clicar("Abrir Produto");
    await clicar("Camiseta teste");
    expect(deleteStorageFile).not.toHaveBeenCalled();
    await clicar("Salvar Banner");
    expect(addBanner).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: "https://loja.test/enviada.webp",
        productId: "produto-1",
        link: "/product-detail?id=produto-1",
      }),
    );
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });
  it("produto com modelo substitui o upload e apaga apenas a órfã", async () => {
    await modelo();
    await enviarFoto();
    await clicar("Camiseta teste");
    expect(deleteStorageFile.mock.calls).toEqual([
      ["https://loja.test/enviada.webp"],
    ]);
    await clicar("Salvar Banner");
    expect(addBanner).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: "https://loja.test/produto.webp" }),
    );
    expect(deleteStorageFile).toHaveBeenCalledTimes(1);
  });
  it.each([20, 21, 35])(
    "limita a busca com %s produtos e avisa só quando há mais",
    async (total) => {
      lista.products = Array.from({ length: total }, (_, i) => ({
        id: `p-${i}`,
        name: `Produto ${i + 1}`,
        price: 10,
        images: ["https://loja.test/produto.webp"],
      }));
      await modelo();
      const busca = () => host.querySelector("#banner-product-search")!;
      const resultados = () =>
        [...busca().parentElement!.querySelectorAll("button")].filter((b) =>
          b.textContent?.startsWith("Produto "),
        );
      expect(resultados()).toHaveLength(20);
      expect(
        host.textContent?.includes(`mostrando 20 de ${total}: refine a busca`),
      ).toBe(total > 20);
      await campo("#banner-product-search", "Produto 21");
      expect(resultados()).toHaveLength(total > 20 ? 1 : 0);
      expect(host.textContent).not.toContain("refine a busca");
      if (total > 20) {
        await clicar("Produto 21");
        await clicar("Salvar Banner");
        expect(addBanner).toHaveBeenCalledWith(
          expect.objectContaining({ productId: "p-20" }),
        );
      }
    },
  );
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
