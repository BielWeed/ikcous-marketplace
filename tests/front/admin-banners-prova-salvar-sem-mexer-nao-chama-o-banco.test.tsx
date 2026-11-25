// @vitest-environment jsdom
//
// Prova do salvar de um banner JÁ EXISTENTE:
//   - abrir, não mexer em nada e tocar em "Salvar Alterações" NÃO manda pedido
//     ao banco (nenhuma gravação vazia) e fecha o editor;
//   - mexer num campo só manda ESSE campo (o que a lojista não tocou pode ter
//     mudado em outro aparelho e não pode voltar ao retrato da abertura).
// Sem isto, trocar `Object.keys(mexidos).length > 0` por `true` mandava um
// UPDATE vazio a cada "Salvar" sem mudança.
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
import { abrirMaisOpcoes } from "./helpers/editor-de-banner";

const h = vi.hoisted(() => ({
  banners: [] as Record<string, unknown>[],
  updateBanner: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: h.banners,
    isLoaded: true,
    uploadBannerImage: vi.fn(),
    addBanner: vi.fn(),
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

function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminBannersView: salvar um banner existente só manda o que mudou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  // A primeira importação da tela é pesada: faz-se uma vez, fora do prazo de
  // cada teste, para a carga da máquina não derrubar o primeiro.
  beforeAll(async () => {
    await import("@/views/admin/AdminBannersView");
  }, 120_000);

  beforeEach(() => {
    vi.clearAllMocks();
    h.updateBanner.mockResolvedValue(undefined);
    // Banner completo e sem texto sobre a imagem: o editor abre no modo
    // simples e o formulário nasce IGUAL ao banner (nada a gravar).
    h.banners = [
      {
        id: "banner-1",
        imageUrl:
          "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
        desktopImageUrl: null,
        title: "Campanha de teste",
        link: "",
        position: "home_top",
        active: true,
        order: 1,
        subtitle: "",
        titleColor: "",
        subtitleColor: "",
        buttonText: "",
        buttonBgColor: "",
        buttonTextColor: "",
        fontFamily: "",
        overlayColor: "",
        overlayOpacity: 40,
        badgeText: "",
        templateType: "default",
        productId: "",
        startDate: null,
        endDate: null,
        showTextOverlay: false,
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

  async function abrirEdicao() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
    const editar = document.querySelector<HTMLButtonElement>(
      'button[title="Editar"]',
    );
    expect(editar).not.toBeNull();
    await act(async () => {
      editar?.click();
      await esperar();
    });
  }

  async function salvar() {
    await act(async () => {
      botaoSalvar()?.click();
      await esperar();
      await esperar();
    });
  }

  it("não mexeu em nada: nenhum pedido ao banco, nenhum erro, e o editor fecha", async () => {
    await abrirEdicao();
    await abrirMaisOpcoes();
    expect(botaoSalvar()).toBeDefined();

    await salvar();

    expect(h.updateBanner).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
    // o salvar executou até o fim: o editor fechou
    expect(botaoSalvar()).toBeUndefined();
  });

  it("mexeu num campo só: vai só esse campo, não o retrato inteiro", async () => {
    await abrirEdicao();
    await abrirMaisOpcoes();
    const ordem = document.body.querySelector<HTMLInputElement>(
      "#banner-order, #banner-simple-order",
    );
    expect(ordem).not.toBeNull();
    await act(async () => digitar(ordem as HTMLInputElement, "4"));

    await salvar();

    expect(h.updateBanner).toHaveBeenCalledTimes(1);
    expect(h.updateBanner).toHaveBeenCalledWith("banner-1", { order: 4 });
  });
});
