// @vitest-environment jsdom
//
// A falha ao excluir um banner avisava "Erro ao deletar o banner.", mas o botão,
// a confirmação e o resto do painel dizem "excluir". Uma palavra por coisa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

// Só precisa de um banner publicado para o card do Switch "Exibir" renderizar.
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

// L10: o rascunho do formulário de banner é do usuário (`:<uid>`) — a tela
// agora lê o hook de auth, dublado aqui.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [bannerPublicado],
    isLoaded: true,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner,
    deleteStorageFile,
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
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

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: toastError,
    loading: vi.fn(() => "toast-id"),
  },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AdminBannersView — o aviso de falha ao excluir diz "excluir"', () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
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
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
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
          onNavigate={onNavigate}
          active={true}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("Editar e Excluir anunciam qual banner será alterado", async () => {
    await montar();
    expect(
      hospedeiro
        .querySelector('button[title="Editar"]')
        ?.getAttribute("aria-label"),
    ).toBe("Editar banner Campanha Ativa");
    expect(
      hospedeiro
        .querySelector('button[title="Excluir"]')
        ?.getAttribute("aria-label"),
    ).toBe("Excluir banner Campanha Ativa");
  });

  it("banner ausente não ganha um segundo aviso genérico ao salvar", async () => {
    const erro = new Error("Banner ausente");
    erro.name = "BannerIndisponivel";
    updateBanner.mockRejectedValueOnce(erro);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await montar();
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('button[title="Editar"]')!
        .click();
      await esperarMicrotarefas();
    });
    const campo = document.getElementById("banner-title") as HTMLInputElement;
    expect(campo).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(campo, "Outro título");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const salvar = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar Alterações",
    );
    expect(salvar).toBeDefined();
    await act(async () => {
      salvar!.click();
      await esperarMicrotarefas();
    });
    expect(updateBanner).toHaveBeenCalledTimes(1);
    // O hook já explicou a ausência; a tela não deve duplicar o aviso.
    expect(toastError).not.toHaveBeenCalled();
    // Mantém a edição para a pessoa poder copiar o que escreveu.
    expect(
      (document.getElementById("banner-title") as HTMLInputElement).value,
    ).toBe("Outro título");
  });

  it("deleteBanner falhando avisa 'Erro ao excluir o banner.'", async () => {
    deleteBanner.mockRejectedValueOnce(new Error("falha de rede"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await montar();

    const excluir = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Excluir"]',
    );
    expect(excluir).not.toBeNull();
    await act(async () => {
      excluir?.click();
      await esperarMicrotarefas();
    });
    const confirmar = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Excluir Banner",
    );
    expect(confirmar).toBeDefined();
    await act(async () => {
      confirmar?.click();
      await esperarMicrotarefas();
    });

    expect(deleteBanner).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Erro ao excluir o banner.");
  });
});
