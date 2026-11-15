// @vitest-environment jsdom
//
// P70 — a tela de Banners ganha a porta "Novo banner" no COMPUTADOR.
//
// O único botão que pedia um banner novo morava na barra de topo do
// AdminLayout, que é `lg:hidden`: a partir de 1024 px ele tinha 0x0 px e a
// lojista que já tinha banners em topo, meio e base não conseguia criar outro.
// A porta do celular continua sendo a do layout; esta é a do cabeçalho da
// própria tela, escondida no celular (`hidden`) e visível a partir de `lg`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ offline: false }));

const bannerPublicado = {
  id: "banner-existente-1",
  imageUrl:
    "https://proj.supabase.co/storage/v1/object/public/banners/banner-publicado-na-home.jpg",
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
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "t") },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

describe("AdminBannersView — porta 'Novo banner' no computador", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.offline = false;
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

  async function montar() {
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
      await esperar();
    });
  }

  // A porta mora no cabeçalho da tela; o estado vazio de cada posição tem
  // botões próprios ("Adicionar Primeiro Banner") que não contam.
  const portaDoCabecalho = () =>
    [
      ...(hospedeiro.querySelector("header")?.querySelectorAll("button") ?? []),
    ].find((b) =>
      /novo banner|indisponível offline/i.test(b.textContent ?? ""),
    );

  it("o cabeçalho tem o botão 'Novo banner', escondido no celular e visível a partir de lg", async () => {
    await montar();
    const porta = portaDoCabecalho();
    expect(porta).toBeDefined();
    expect(porta?.textContent).toContain("Novo banner");
    const classes = (porta?.className ?? "").split(/\s+/);
    expect(classes).toContain("hidden");
    expect(classes).toContain("lg:flex");
    expect(classes).toContain("min-h-11");
  });

  it("clicar pede um banner novo (o evento que abre o editor)", async () => {
    await montar();
    const ouvinte = vi.fn();
    window.addEventListener("admin:open-new-banner-dialog", ouvinte);
    await act(async () => {
      portaDoCabecalho()?.click();
      await esperar();
    });
    window.removeEventListener("admin:open-new-banner-dialog", ouvinte);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it("offline: o botão fica desligado, diz 'Indisponível offline' e aponta para o aviso da tela", async () => {
    estado.offline = true;
    await montar();
    const porta = portaDoCabecalho();
    expect(porta).toBeDefined();
    expect((porta as HTMLButtonElement).disabled).toBe(true);
    expect(porta?.textContent).toContain("Indisponível offline");
    expect(porta?.textContent).not.toContain("Novo banner");
    const id = porta?.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(hospedeiro.querySelector(`#${id}`)?.textContent).toContain(
      "Você está offline",
    );
  });

  it("com o editor aberto a porta do cabeçalho não aparece", async () => {
    await montar();
    expect(portaDoCabecalho()).toBeDefined();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("admin:open-new-banner-dialog"));
      await esperar();
    });
    expect(hospedeiro.textContent).toContain("Usar minha imagem");
    expect(portaDoCabecalho()).toBeUndefined();
  });

  it("o botão de ajuda continua ao lado, no cabeçalho", async () => {
    await montar();
    const ajuda = hospedeiro
      .querySelector("header")
      ?.querySelector('button[title="Como usar os Banners"]');
    expect(ajuda).not.toBeNull();
  });
});
