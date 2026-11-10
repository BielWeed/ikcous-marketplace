// @vitest-environment jsdom
//
// Rede pendurada no painel de Banners. O hook já encerra a ESPERA depois do
// prazo e avisa "Não sabemos se foi salvo" (use-banners-gravacao-sem-resposta);
// aqui se prova o que a TELA faz com esse desfecho:
//
// - editor: o salvar solta ("Salvando…" some), o editor continua aberto com o
//   que a lojista digitou, nenhum segundo aviso de "erro" aparece, e fechar o
//   editor NÃO apaga a foto enviada — o servidor pode ter gravado o banner com
//   ela, e apagá-la deixaria um banner publicado sem imagem;
// - lista: ligar/desligar e excluir soltam os botões, sem aviso duplicado.
import { erroDeConsultaSemResposta } from "@/lib/prazo-da-requisicao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirNovoBannerPelaBarra,
  escolherImagemPropria,
} from "./helpers/editor-de-banner";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();
const toastError = vi.fn();

const urlNova =
  "https://proj.supabase.co/storage/v1/object/public/banners/foto-que-o-servidor-pode-ter-gravado.jpg";

const TEXTO_SEM_RESPOSTA =
  "Sem resposta da rede. Não sabemos se o banner foi salvo. Confira na lista de banners antes de tentar de novo.";

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
    error: (...args: unknown[]) => toastError(...args),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

describe("AdminBannersView — gravação sem resposta solta a tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    deleteStorageFile.mockResolvedValue(undefined);
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
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
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
      raiz.render(<AdminBannersView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  async function subirImagemNoEditorNovo() {
    uploadBannerImage.mockResolvedValue(urlNova);
    await abrirNovoBannerPelaBarra();
    await escolherImagemPropria();
    const arquivo = new File(["x"], "foto.jpg", { type: "image/jpeg" });
    const entrada = document.getElementById(
      "banner-upload",
    ) as HTMLInputElement;
    Object.defineProperty(entrada, "files", {
      value: [arquivo],
      configurable: true,
    });
    await act(async () => {
      entrada.dispatchEvent(new Event("change", { bubbles: true }));
      await esperar();
      await esperar();
    });
    expect(uploadBannerImage).toHaveBeenCalledWith(arquivo);
  }

  it("salvar sem resposta: editor segue aberto, sem aviso duplicado e sem apagar a foto", async () => {
    await montar();
    await subirImagemNoEditorNovo();
    addBanner.mockRejectedValue(erroDeConsultaSemResposta(TEXTO_SEM_RESPOSTA));

    await act(async () => {
      botaoPorTexto("Salvar Banner")!.click();
      await esperar();
    });

    expect(addBanner).toHaveBeenCalledTimes(1);
    // O hook já explicou que não se sabe se salvou: a tela não acrescenta
    // um "Erro ao salvar" que contradiz isso.
    expect(toastError).not.toHaveBeenCalled();
    // Solta: nada de "Salvando…", o botão volta e o editor segue aberto.
    expect(botaoPorTexto("Salvando...")).toBeUndefined();
    const salvar = botaoPorTexto("Salvar Banner");
    expect(salvar).toBeDefined();
    expect(salvar!.disabled).toBe(false);

    // Fechar o editor agora NÃO apaga a foto: o servidor pode ter gravado o
    // banner apontando para ela.
    await act(async () => {
      botaoPorTexto("Cancelar")!.click();
    });
    expect(deleteStorageFile).not.toHaveBeenCalled();
  });

  it("controle: rejeição definitiva continua apagando a foto órfã ao fechar", async () => {
    await montar();
    await subirImagemNoEditorNovo();
    addBanner.mockRejectedValue({ code: "23505", message: "Banner rejeitado" });

    await act(async () => {
      botaoPorTexto("Salvar Banner")!.click();
      await esperar();
    });
    expect(toastError).toHaveBeenCalledWith(
      "Erro ao salvar as configurações do banner.",
    );
    await act(async () => {
      botaoPorTexto("Cancelar")!.click();
    });
    expect(deleteStorageFile).toHaveBeenCalledWith(urlNova);
  });

  it("ligar/desligar sem resposta: solta o interruptor sem aviso duplicado", async () => {
    updateBanner.mockRejectedValue(
      erroDeConsultaSemResposta(TEXTO_SEM_RESPOSTA),
    );
    await montar();
    const interruptor = hospedeiro.querySelector<HTMLButtonElement>(
      `#banner-card-active-${bannerPublicado.id}`,
    )!;

    await act(async () => {
      interruptor.click();
      await esperar();
    });

    expect(updateBanner).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(interruptor.disabled).toBe(false);
  });

  it("excluir sem resposta: fecha a confirmação, solta os botões, sem aviso duplicado", async () => {
    deleteBanner.mockRejectedValue(
      erroDeConsultaSemResposta(TEXTO_SEM_RESPOSTA),
    );
    await montar();

    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('button[title="Excluir"]')!
        .click();
      await esperar();
    });
    await act(async () => {
      botaoPorTexto("Excluir Banner")!.click();
      await esperar();
    });

    expect(deleteBanner).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(botaoPorTexto("Excluir Banner")).toBeUndefined();
    expect(
      hospedeiro.querySelector<HTMLButtonElement>('button[title="Excluir"]')!
        .disabled,
    ).toBe(false);
  });
});
