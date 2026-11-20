// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirMaisOpcoes,
  abrirNovoBannerPelaBarra,
  configurarTextos,
  escolherImagemPropria,
} from "./helpers/editor-de-banner";
const h = vi.hoisted(() => ({
  banners: [] as Record<string, unknown>[],
  toastError: vi.fn(),
  deleteStorageFile: vi.fn(),
  offline: false,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

const addBanner = vi.fn();
const updateBanner = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: h.banners,
    isLoaded: true,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner: vi.fn(),
    deleteStorageFile: h.deleteStorageFile,
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
  useOnlineStatus: () => h.offline,
}));
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
const dia = 24 * 60 * 60 * 1000;

function botaoComTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function emCampoLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminBannersView: foco após cancelar banner vencido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.offline = false;
    h.deleteStorageFile.mockResolvedValue(undefined);
    // O botão "Novo Banner" só aparece com a lista populada.
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
    addBanner.mockResolvedValue(undefined);
    updateBanner.mockResolvedValue(undefined);
    uploadBannerImage.mockResolvedValue(
      "https://proj.supabase.co/storage/v1/object/public/banners/nova.jpg",
    );
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
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montarPainel() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  /** Passa para o passo 3 (Destino), onde mora a "Programação Temporal". */
  async function irParaOPasso3() {
    await configurarTextos(true);
    await abrirMaisOpcoes();
  }

  /** "Novo Banner" com imagem enviada, já no passo 3. */
  async function abrirBannerNovoNoPasso3() {
    await montarPainel();
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
    await irParaOPasso3();
  }

  async function ligarProgramacao() {
    const chave = document.getElementById("banner-scheduling-toggle");
    expect(chave, "a chave da programação tem de estar na tela").not.toBeNull();
    await act(async () => {
      chave?.click();
    });
  }

  async function escolherDatas(inicio: Date, fim: Date) {
    await act(async () => {
      digitar(
        document.getElementById("banner-start-date") as HTMLInputElement,
        emCampoLocal(inicio),
      );
      digitar(
        document.getElementById("banner-end-date") as HTMLInputElement,
        emCampoLocal(fim),
      );
    });
  }
  it.each(["Escape", "Voltar e ajustar"])(
    "devolve o foco ao botão Salvar ao fechar por %s",
    async (saida) => {
      await abrirBannerNovoNoPasso3();
      await ligarProgramacao();
      const agora = Date.now();
      await escolherDatas(new Date(agora - 5 * dia), new Date(agora - 2 * dia));

      const salvar = botaoComTexto(document, "Salvar Alterações")!;
      expect(salvar).toBeDefined();
      await act(async () => {
        salvar.focus();
        salvar.click();
      });

      const confirmacao = document.querySelector('[role="alertdialog"]');
      expect(confirmacao?.textContent).toContain("Banner já terminou");
      await act(async () => {
        if (saida === "Escape") {
          document.activeElement?.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        } else {
          botaoComTexto(confirmacao!, saida)?.click();
        }
      });
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(addBanner).not.toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(document.activeElement === salvar).toBe(true),
      );
    },
  );
});
