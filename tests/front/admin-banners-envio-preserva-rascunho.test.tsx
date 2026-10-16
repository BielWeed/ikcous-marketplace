// @vitest-environment jsdom
// Regressão: o sucesso de A não pode descartar o título B.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();

const urlNova =
  "https://proj.supabase.co/storage/v1/object/public/banners/upload-orfao.jpg";

// O botão "Novo Banner" só renderiza com a lista populada
// (AdminBannersView: `isLoaded && banners.length > 0`), então a montagem
// precisa de um banner existente mesmo com os cenários sendo de CRIAR.
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
    deleteBanner: vi.fn(),
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
  // o hook devolve "isOffline": false = online. Offline o handleSubmit
  // recusa salvar e o botão Novo Banner nasce disabled.
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

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function selecionarArquivo(id: string, arquivo: File) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.defineProperty(el, "files", {
    value: [arquivo],
    configurable: true,
  });
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AdminBannersView — envio preserva edição posterior", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    deleteStorageFile.mockResolvedValue(undefined);
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
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  /** Abre o diálogo de novo banner e sobe uma imagem (formData.imageUrl
   * passa a apontar para um upload que nenhum banner gravado referencia). */
  async function abrirDialogoESubirImagem() {
    uploadBannerImage.mockResolvedValue(urlNova);

    const botaoNovoBanner = localizarBotaoPorTexto(hospedeiro, "Novo Banner")!;
    expect(botaoNovoBanner).toBeDefined();

    await act(async () => {
      botaoNovoBanner.click();
    });

    // Diálogo aberto (botão "Salvar Banner" só existe dentro dele) e em
    // modo de criação.
    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeDefined();

    const arquivo = new File(["conteudo"], "upload-orfao.jpg", {
      type: "image/jpeg",
    });
    await act(async () => {
      selecionarArquivo("banner-upload", arquivo);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(uploadBannerImage).toHaveBeenCalledWith(arquivo);
  }

  async function clicarTexto(texto: string) {
    const botao = localizarBotaoPorTexto(hospedeiro, texto);
    if (!botao) throw new Error(`Botão ${texto} ausente`);
    await act(async () => botao.click());
    if (["1Conteúdo", "✓Conteúdo", "3Destino", "Completo"].includes(texto)) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
    } else {
      await act(async () => esperarMicrotarefas());
    }
  }

  async function titulo(valor: string, descarregar = true) {
    const campo = document.getElementById("banner-title") as HTMLInputElement;
    await act(async () => {
      campo.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (descarregar) {
      await act(async () => {
        campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
    }
  }

  it.each([false, true])(
    "mantém o título B e o rascunho após salvar A (buffer descarregado=%s)",
    async (descarregar) => {
      await montar();
      const editar = hospedeiro.querySelector<HTMLButtonElement>(
        'button[title="Editar"]',
      );
      if (!editar) throw new Error("Botão Editar ausente");
      await act(async () => editar.click());
      await act(async () => esperarMicrotarefas());
      await titulo("Título A");
      await clicarTexto("3Destino");
      let concluir!: () => void;
      updateBanner.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            concluir = resolve;
          }),
      );
      await clicarTexto("Salvar Alterações");
      expect(updateBanner).toHaveBeenCalledWith(
        bannerPublicado.id,
        expect.objectContaining({ title: "Título A" }),
      );
      await clicarTexto("✓Conteúdo");
      await titulo("Título B", descarregar);
      const chave = "admin_banner_form_draft:lojista-1";
      localStorage.setItem(chave, "rascunho pendente");
      await act(async () => concluir());
      expect(
        (document.getElementById("banner-title") as HTMLInputElement).value,
      ).toBe("Título B");
      expect(localStorage.getItem(chave)).not.toBeNull();
      expect(onSetDirty).toHaveBeenLastCalledWith(true);
      // Descarrega o buffer antes do segundo salvamento.
      await titulo("Título B");
      updateBanner.mockResolvedValueOnce(undefined);
      await clicarTexto("3Destino");
      await clicarTexto("Salvar Alterações");
      expect(updateBanner).toHaveBeenLastCalledWith(
        bannerPublicado.id,
        expect.objectContaining({ title: "Título B" }),
      );
      expect(document.getElementById("banner-title")).toBeNull();
      expect(localStorage.getItem(chave)).toBeNull();
    },
  );

  it("criação com nova edição mantém o id criado para atualizar sem duplicar", async () => {
    await montar();
    await abrirDialogoESubirImagem();
    let concluir!: (linha: { id: string }) => void;
    addBanner.mockImplementationOnce(
      () =>
        new Promise<{ id: string }>((resolve) => {
          concluir = resolve;
        }),
    );
    await clicarTexto("Salvar Banner");
    await clicarTexto("Completo");
    await titulo("Título B");
    await act(async () => concluir({ id: "banner-novo" }));
    expect(
      (document.getElementById("banner-title") as HTMLInputElement).value,
    ).toBe("Título B");
    expect(onSetDirty).toHaveBeenLastCalledWith(true);
    await clicarTexto("3Destino");
    updateBanner.mockResolvedValueOnce(undefined);
    await clicarTexto("Salvar Alterações");
    expect(addBanner).toHaveBeenCalledTimes(1);
    expect(updateBanner).toHaveBeenCalledWith(
      "banner-novo",
      expect.objectContaining({ title: "Título B" }),
    );
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });
});
