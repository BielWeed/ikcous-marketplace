// @vitest-environment jsdom
import { gerarPiramide } from "@/lib/gerar-piramide";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteStorageFile = vi.fn().mockResolvedValue(undefined);
const urlEnviada =
  "https://proj.supabase.co/storage/v1/object/public/banners/imagem-em-ajuste.jpg";
const uploadBannerImage = vi.fn().mockResolvedValue(urlEnviada);
const bannerPublicado = {
  id: "banner-existente-1",
  imageUrl:
    "https://proj.supabase.co/storage/v1/object/public/banners/campanha.jpg",
  title: "Campanha Ativa",
  link: "",
  position: "home_top" as const,
  active: true,
  order: 1,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [bannerPublicado],
    isLoaded: true,
    uploadBannerImage,
    deleteStorageFile,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({}),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminBannersView — Voltar com o recorte aberto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let overrideAtual: (() => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    overrideAtual = null;
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    window.history.replaceState(
      { view: "admin-banners" },
      "",
      "/admin-banners",
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function botao(texto: string) {
    return [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
  }

  function recorteAberto() {
    return [...document.body.querySelectorAll("h3")].some(
      (h3) => h3.textContent?.trim() === "Ajustar Imagem",
    );
  }

  async function abrirRecorteComUploadNovo() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(
        <AdminBannersView
          active
          onNavigate={vi.fn()}
          onSetBackOverride={(valor) => {
            // No App, o setter recebe um updater que devolve o override real.
            overrideAtual =
              valor === null ? null : (valor as () => (() => void) | null)();
          }}
        />,
      );
    });
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          '[aria-label="Editar banner Campanha Ativa"]',
        )!
        .click();
    });
    expect(botao("Salvar Alterações")).toBeDefined();

    const arquivo = new File(["imagem"], "imagem-em-ajuste.jpg", {
      type: "image/jpeg",
    });
    await act(async () => {
      const input =
        hospedeiro.querySelector<HTMLInputElement>("#banner-upload")!;
      Object.defineProperty(input, "files", { value: [arquivo] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(uploadBannerImage).toHaveBeenCalledWith(arquivo, {
      piramide: gerarPiramide,
    });
    await act(async () => botao("Ajustar")!.click());
    expect(recorteAberto()).toBe(true);
  }

  async function voltarFisico() {
    expect(window.history.state?.modal).toBe("banner");
    // No popstate, o App chama o override DEPOIS de o navegador tirar
    // a entrada do editor. Reproduzimos esse estado sem depender do back do jsdom.
    window.history.replaceState(
      { view: "admin-banners" },
      "",
      "/admin-banners",
    );
    expect(overrideAtual).toBeInstanceOf(Function);
    await act(async () => overrideAtual?.());
  }

  it("fecha o recorte sem apagar a imagem nova; só o próximo Voltar físico fecha o editor", async () => {
    await abrirRecorteComUploadNovo();
    const voltarNoHistorico = vi.spyOn(window.history, "back");

    await voltarFisico();

    expect(recorteAberto()).toBe(false);
    expect(botao("Salvar Alterações")).toBeDefined();
    expect(deleteStorageFile).not.toHaveBeenCalled();
    expect(
      hospedeiro.querySelector<HTMLImageElement>(
        'img[alt="Miniatura do banner"]',
      )?.src,
    ).toBe(urlEnviada);

    await voltarFisico();

    expect(botao("Salvar Alterações")).toBeUndefined();
    expect(deleteStorageFile).toHaveBeenCalledExactlyOnceWith(urlEnviada);
    expect(voltarNoHistorico).not.toHaveBeenCalled();
  });
});
