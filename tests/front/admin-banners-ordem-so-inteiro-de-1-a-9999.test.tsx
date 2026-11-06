// @vitest-environment jsdom
//
// Ordem de exibição do banner: a coluna do banco é inteira, mas o campo
// aceitava 1.5, negativo e número gigante, e o salvar só dava o erro genérico
// ("Erro ao salvar as configurações do banner."). Agora o campo só aceita
// inteiro de 1 a 9999 e o salvar confere antes de chamar o banco, dizendo o
// motivo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abrirMaisOpcoes } from "./helpers/editor-de-banner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { emblaApi, updateBanner, toastError, lista } = vi.hoisted(() => ({
  emblaApi: {
    scrollNext: vi.fn(),
    scrollTo: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    selectedScrollSnap: () => 0,
    scrollPrev: vi.fn(),
    scrollSnapList: () => [] as number[],
    canScrollPrev: () => false,
    canScrollNext: () => false,
    reInit: vi.fn(),
  },
  updateBanner: vi.fn(),
  toastError: vi.fn(),
  lista: { banners: [] as unknown[] },
}));

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), emblaApi],
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: lista.banners,
    isLoaded: true,
    uploadBannerImage: vi.fn(),
    addBanner: vi.fn(),
    updateBanner,
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
    error: toastError,
    info: vi.fn(),
    loading: vi.fn(() => "t"),
  },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const MENSAGEM =
  "A ordem de exibição precisa ser um número inteiro de 1 a 9999.";

describe("AdminBannersView: ordem de exibição só inteiro de 1 a 9999", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateBanner.mockResolvedValue(undefined);
    lista.banners = [
      {
        id: "banner-1",
        imageUrl:
          "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
        title: "Campanha Ativa",
        link: "",
        position: "home_top",
        active: true,
        order: 1,
      },
    ];
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
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

  const botao = (texto: string) =>
    [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  const espera = (ms: number) =>
    act(async () => {
      await new Promise<void>((r) => setTimeout(r, ms));
    });

  async function clicar(el: HTMLElement | undefined | null) {
    expect(el).toBeTruthy();
    await act(async () => {
      el?.click();
    });
  }

  /** Abre o banner existente, abre "Mais opções" e devolve o campo da ordem. */
  async function abrirCampoDaOrdem() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
    });
    await espera(0);
    await clicar(
      document.body.querySelector<HTMLElement>('button[title="Editar"]'),
    );
    await abrirMaisOpcoes();
    const campo = document.body.querySelector<HTMLInputElement>(
      "#banner-order, #banner-simple-order",
    );
    expect(campo).not.toBeNull();
    return campo as HTMLInputElement;
  }

  async function digitarOrdem(campo: HTMLInputElement, valor: string) {
    await act(async () => {
      const escrever = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      escrever?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("o campo só oferece inteiro de 1 a 9999 (min, step e max)", async () => {
    const campo = await abrirCampoDaOrdem();
    expect(campo.getAttribute("min")).toBe("1");
    expect(campo.getAttribute("step")).toBe("1");
    expect(campo.getAttribute("max")).toBe("9999");
  });

  it.each([
    ["decimal", "1.5"],
    ["negativo", "-3"],
    ["zero", "0"],
    ["acima do teto", "10000"],
    ["gigante", "99999999999"],
  ])("%s (%s): avisa o motivo e não grava", async (_nome, digitado) => {
    const campo = await abrirCampoDaOrdem();
    await digitarOrdem(campo, digitado);

    await clicar(botao("Salvar Alterações"));
    await espera(0);

    expect(toastError).toHaveBeenCalledWith(MENSAGEM);
    expect(toastError).not.toHaveBeenCalledWith(
      "Erro ao salvar as configurações do banner.",
    );
    expect(updateBanner).not.toHaveBeenCalled();
    // o botão volta a funcionar: dá para corrigir e salvar de novo
    expect(botao("Salvar Alterações")?.disabled).toBe(false);
  });

  it.each(["2", "7", "9999"])("%s: grava normalmente", async (digitado) => {
    const campo = await abrirCampoDaOrdem();
    await digitarOrdem(campo, digitado);

    await clicar(botao("Salvar Alterações"));
    await espera(0);

    expect(toastError).not.toHaveBeenCalled();
    expect(updateBanner).toHaveBeenCalledTimes(1);
    expect(updateBanner.mock.calls[0]?.[1]).toMatchObject({
      order: Number(digitado),
    });
  });

  it("depois de recusar, corrigir a ordem e salvar de novo funciona", async () => {
    const campo = await abrirCampoDaOrdem();
    await digitarOrdem(campo, "1.5");
    await clicar(botao("Salvar Alterações"));
    await espera(0);
    expect(updateBanner).not.toHaveBeenCalled();

    await digitarOrdem(campo, "3");
    await clicar(botao("Salvar Alterações"));
    await espera(0);
    expect(updateBanner).toHaveBeenCalledTimes(1);
    expect(updateBanner.mock.calls[0]?.[1]).toMatchObject({ order: 3 });
  });
});
